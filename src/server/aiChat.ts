import { createOpenRouter } from '@openrouter/ai-sdk-provider';
import { chatTools, type AppUIMessage, type AppTools } from '@shared/chatAi';
import { getParametricText } from '@shared/parametricParts';
import type { Conversation, Message, MeshFileType, Model } from '@shared/types';
import {
  convertToModelMessages,
  consumeStream,
  createUIMessageStream,
  createUIMessageStreamResponse,
  generateText,
  Output,
  smoothStream,
  stepCountIs,
  streamText,
  type LanguageModelUsage,
  type UIMessageStreamWriter,
} from 'ai';
import { z } from 'zod';
import { billing, BillingClientError } from './billingClient';
import { corsHeaders, isRecord } from './api';
import { requiredEnv } from './env';
import { logError } from './serverLog';
import { handleMeshRequest } from './mesh';
import { getAnonSupabaseClient } from './supabaseClient';

const FALLBACK_MODEL_TOKENS_PER_BILLING_TOKEN = 10_000;

const PARAMETRIC_AGENT_PROMPT = `You are Adam, a concise CAD assistant.

Use the build_parametric_model tool whenever the user asks for a CAD model, an edit to a CAD model, or a fix for OpenSCAD code.

The build_parametric_model tool input is the artifact shown to the user:
- title: short object name
- version: "v1"
- code: complete raw OpenSCAD code, no markdown

After you call build_parametric_model, the browser compiles the OpenSCAD and
returns whether compilation succeeded. If it fails, fix the code with another
build_parametric_model call.

OpenSCAD rules:
- Declare every editable parameter as a top-of-file variable.
- Annotate each variable with a trailing OpenSCAD Customizer comment so the
  UI can render the right widget:
    width = 50;        // [10:1:200]    ← min:step:max for sliders
    height = 25;       // [5:50]        ← min:max
    style = "round";   // [round, square, hex]   ← enum options
    enabled = true;    //                ← booleans render as switches
    label = "Cup";     // 24             ← maxLength for free-form strings
- Optionally put a "// Description of the parameter" comment on the line
  ABOVE the variable so the UI can show a description.
- Group related parameters with /* [Group Name] */ section markers.
- Keep geometry manifold and 3D-printable.
- Use modules for repeated or meaningful model parts.
- Do not mention tools, APIs, or implementation details to the user.`;

const CREATIVE_AGENT_PROMPT = `You are Adam, a concise 3D mesh assistant.

Use the create_mesh tool whenever the user asks for a generated, edited, or stylized 3D asset.

Creative rules:
- Keep replies short.
- If the request is better suited for precise CAD, say Adam can make it as a CAD model.
- Preserve the user's intent when improving a prompt for mesh generation.
- When the user provides images, use the image IDs from file part filenames when helpful.
- Do not mention tools, APIs, or implementation details to the user.`;

/**
 * The wire format is intentionally tiny. The client expresses "given the
 * current state of this conversation, generate a response" — nothing else.
 *
 * Before POSTing, the client is responsible for landing the branch state it
 * wants in the DB:
 *  * New user turn → insert the user message and bump `current_message_leaf_id`
 *    to point at it.
 *  * Retry → bump `current_message_leaf_id` back to the user message that
 *    prompted the assistant being re-rolled.
 *  * Tool-output continuation → update the assistant row's `parts` so the
 *    completed tool call is persisted.
 *
 * The server then walks `current_message_leaf_id` up to the root and uses
 * that — and only that — to build the model context. Anything the client
 * happens to ship in the request body beyond `conversationId`/`model`/
 * `thinking` is ignored, which is what makes the system rock-solid against
 * `chat.regenerate()`-style truncation hacks.
 */
type ChatBody = {
  conversationId: string;
  model: Model;
  thinking?: boolean;
};

type ConversationAccess = Pick<
  Conversation,
  'id' | 'type' | 'user_id' | 'current_message_leaf_id'
>;

function isChatBody(value: unknown): value is ChatBody {
  return (
    isRecord(value) &&
    typeof value.conversationId === 'string' &&
    typeof value.model === 'string' &&
    (value.thinking == null || typeof value.thinking === 'boolean')
  );
}

function jsonResponse(body: unknown, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function reasoningOptions(thinking: boolean, tokens: number) {
  return thinking ? { reasoning: { max_tokens: tokens } } : {};
}

function billingTokensFromUsage(usage: LanguageModelUsage) {
  return Math.max(
    1,
    Math.ceil(
      (usage.totalTokens ?? 0) / FALLBACK_MODEL_TOKENS_PER_BILLING_TOKEN,
    ),
  );
}

type SupabaseAnon = ReturnType<typeof getAnonSupabaseClient>;

type BranchMessageRow = Pick<
  Message,
  'id' | 'role' | 'parts' | 'metadata' | 'parent_message_id'
>;

/**
 * Promote any `state: 'streaming'` parts to `'done'` before we persist a
 * message. Some providers (notably Gemini via OpenRouter, but it's not
 * specific to them) don't emit the closing chunk that the AI SDK's
 * reducer uses to flip a part from `'streaming'` to `'done'` — so the
 * SDK keeps the part in `'streaming'` even after the stream completes.
 *
 * If we then persist that snapshot, the UI keeps showing the
 * "Thinking..." shimmer / streaming caret forever on the next page load
 * because the renderer reads the state straight off the part. This
 * normalises terminal-state parts at the boundary instead of trying to
 * out-think every provider's quirks.
 */
function finalizeStreamingParts(
  parts: AppUIMessage['parts'],
): AppUIMessage['parts'] {
  return parts.map((part) => {
    if (
      (part.type === 'reasoning' || part.type === 'text') &&
      part.state === 'streaming'
    ) {
      return { ...part, state: 'done' as const };
    }
    return part;
  });
}

function messageRowToUIMessage(row: BranchMessageRow): AppUIMessage {
  return {
    id: row.id,
    role: row.role,
    metadata:
      row.metadata && typeof row.metadata === 'object'
        ? (row.metadata as AppUIMessage['metadata'])
        : ({} as AppUIMessage['metadata']),
    parts: Array.isArray(row.parts) ? (row.parts as AppUIMessage['parts']) : [],
  };
}

/**
 * Walks `parent_message_id` from `leafId` back to a root, returning the
 * branch in root-first order as `AppUIMessage`s ready for
 * `convertToModelMessages`. Source of truth is the messages table — the
 * client cannot influence the model context other than by writing rows
 * to the DB first.
 *
 * Includes a visited-set so a corrupt self-cycle in the data can't lock
 * the server (mirrors the same defense in shared/Tree.ts on the client).
 */
async function loadBranchFromDb({
  supabaseClient,
  conversationId,
  leafId,
}: {
  supabaseClient: SupabaseAnon;
  conversationId: string;
  leafId: string;
}): Promise<{ branch: AppUIMessage[]; leafRole: 'user' | 'assistant' }> {
  const { data: rows, error } = await supabaseClient
    .from('messages')
    .select('id, role, parts, metadata, parent_message_id')
    .eq('conversation_id', conversationId)
    .overrideTypes<BranchMessageRow[]>();

  if (error || !rows) {
    throw new Error('Failed to load conversation messages');
  }

  const byId = new Map<string, BranchMessageRow>();
  for (const row of rows) byId.set(row.id, row);

  const path: BranchMessageRow[] = [];
  const visited = new Set<string>();
  let current = byId.get(leafId);
  while (current) {
    if (visited.has(current.id)) {
      logError(new Error('parent_message_id cycle in loadBranchFromDb'), {
        functionName: 'ai-chat',
        statusCode: 500,
        userId: '',
        conversationId,
        additionalContext: { messageId: current.id },
      });
      break;
    }
    visited.add(current.id);
    path.unshift(current);
    current = current.parent_message_id
      ? byId.get(current.parent_message_id)
      : undefined;
  }

  if (path.length === 0) {
    throw new Error(
      `Leaf ${leafId} not found in conversation ${conversationId}`,
    );
  }

  return {
    branch: path.map(messageRowToUIMessage),
    leafRole: path[path.length - 1].role,
  };
}

async function generateConversationTitle({
  openrouter,
  firstMessage,
}: {
  openrouter: ReturnType<typeof createOpenRouter>;
  firstMessage: AppUIMessage;
}) {
  const text = getParametricText(firstMessage.parts) || 'New conversation';
  try {
    const result = await generateText({
      model: openrouter.chat('anthropic/claude-haiku-4.5'),
      system:
        'Generate a short title for a 3D creation conversation. Return only the title.',
      prompt: text,
      output: Output.object({
        schema: z.object({ title: z.string().min(1) }),
      }),
    });
    return result.output.title.slice(0, 80);
  } catch {
    return text.trim().split(/\s+/).slice(0, 5).join(' ') || 'New Creation';
  }
}

/**
 * Produce ~3 short follow-up suggestions for the user's NEXT prompt, given
 * the current branch. Used as transient `data-suggestions-update` parts —
 * the conversation-level pills below the input. Suggestions are
 * conversation-scoped (not per-message) because that's how they appear in
 * the UI: they're tips for "what to say next", not annotations on a
 * specific assistant turn.
 */
async function generateConversationSuggestions({
  openrouter,
  branch,
  conversationType,
}: {
  openrouter: ReturnType<typeof createOpenRouter>;
  branch: AppUIMessage[];
  conversationType: 'parametric' | 'creative';
}): Promise<string[]> {
  // Cheap prompt: the user's first request + the last assistant reply text
  // is plenty for short follow-up tips. Walking the entire branch would
  // burn tokens for no obvious win.
  const firstUserText =
    getParametricText(branch.find((m) => m.role === 'user')?.parts ?? []) || '';
  const lastAssistantText = getParametricText(
    branch
      .slice()
      .reverse()
      .find((m) => m.role === 'assistant')?.parts ?? [],
  );
  const summary = `User request: ${firstUserText.slice(0, 400)}\n\nMost recent assistant reply: ${lastAssistantText.slice(0, 400)}`;
  try {
    const result = await generateText({
      model: openrouter.chat('anthropic/claude-haiku-4.5'),
      system:
        conversationType === 'creative'
          ? 'Given a 3D mesh design conversation, return an array of exactly 3 follow-up prompts the user might want to send next. Each prompt is a single concise instruction (under 8 words), not a question. Return exactly 3 items — no more, no fewer.'
          : 'Given a parametric CAD conversation, return an array of exactly 3 follow-up prompts the user might want to send next. Each prompt is a single concise instruction (under 8 words), not a question. Return exactly 3 items — no more, no fewer.',
      prompt: summary,
      // No `.min`/`.max` on the array — those translate to JSON Schema
      // `minItems` / `maxItems`, which Bedrock (OpenRouter's backend for
      // Claude Haiku 4.5) rejects with a 400. We accept whatever
      // count the model returns and slice to 3 below for durability:
      // anything more is trimmed, anything between 1 and 3 is shown
      // as-is, an empty array means "no suggestions this turn" and the
      // pills just don't render.
      output: Output.object({
        schema: z.object({
          suggestions: z.array(z.string().min(1).max(80)),
        }),
      }),
    });
    return result.output.suggestions.slice(0, 3);
  } catch (error) {
    logError(error, {
      functionName: 'ai-chat',
      statusCode: 500,
      userId: '',
      conversationId: '',
      additionalContext: { operation: 'suggestion_generate_text' },
    });
    return [];
  }
}

function creativeTools({
  conversation,
  req,
  model,
}: {
  conversation: ConversationAccess;
  req: Request;
  model: Model;
}) {
  return {
    create_mesh: {
      ...chatTools.create_mesh,
      execute: async (input: AppTools['create_mesh']['input']) => {
        const response = await handleMeshRequest(
          new Request(new URL('/cadam/api/mesh', req.url), {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: req.headers.get('Authorization') ?? '',
            },
            body: JSON.stringify({
              conversationId: conversation.id,
              text: input.text,
              images: input.imageIds,
              mesh: input.meshId,
              model: input.model ?? model,
              meshTopology: input.meshTopology,
              polygonCount: input.polygonCount,
            }),
            signal: req.signal,
          }),
        );
        const data: {
          id?: string;
          fileType?: MeshFileType;
          error?: unknown;
        } = await response.json();

        if (!response.ok || !data.id || !data.fileType) {
          throw new Error(
            isRecord(data.error) && typeof data.error.message === 'string'
              ? data.error.message
              : 'Mesh generation failed',
          );
        }

        return { id: data.id, fileType: data.fileType };
      },
    },
  };
}

async function downloadAsBase64(
  supabaseClient: SupabaseAnon,
  bucket: string,
  path: string,
) {
  const { data, error } = await supabaseClient.storage
    .from(bucket)
    .download(path);
  if (error || !data) return null;

  const bytes = new Uint8Array(await data.arrayBuffer());
  let binary = '';
  const chunkSize = 0x8000;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.slice(index, index + chunkSize));
  }
  return btoa(binary);
}

function parametricTools({
  previewPathForToolCall,
  supabaseClient,
}: {
  previewPathForToolCall: (toolCallId: string) => string;
  supabaseClient: SupabaseAnon;
}) {
  return {
    build_parametric_model: {
      ...chatTools.build_parametric_model,
      async toModelOutput({
        toolCallId,
        output,
      }: {
        toolCallId: string;
        output: AppTools['build_parametric_model']['output'];
      }) {
        // The client uploads a render of the compiled SCAD to a path
        // derived from toolCallId BEFORE sending the tool result (see
        // ChatSession's `onToolCall`). If for any reason the upload
        // didn't land, `downloadAsBase64` returns null and we fall back
        // to text-only — never block the loop on a missing thumbnail.
        const base64 = await downloadAsBase64(
          supabaseClient,
          'images',
          previewPathForToolCall(toolCallId),
        );

        if (base64) {
          return {
            type: 'content' as const,
            value: [
              { type: 'text' as const, text: output.message },
              {
                type: 'image-data' as const,
                data: base64,
                mediaType: 'image/png' as const,
              },
            ],
          };
        }

        return { type: 'text' as const, value: output.message };
      },
    },
  };
}

function chatModel(conversation: ConversationAccess, model: Model) {
  if (conversation.type === 'creative') {
    return 'anthropic/claude-sonnet-4.5';
  }
  return model;
}

function systemPrompt(conversation: ConversationAccess) {
  return conversation.type === 'creative'
    ? CREATIVE_AGENT_PROMPT
    : PARAMETRIC_AGENT_PROMPT;
}

export async function handleAiChatRequest(req: Request) {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  if (req.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, 405);
  }

  const supabaseClient = getAnonSupabaseClient({
    global: {
      headers: { Authorization: req.headers.get('Authorization') ?? '' },
    },
  });
  const {
    data: { user },
  } = await supabaseClient.auth.getUser();

  if (!user?.id || !user.email) {
    return jsonResponse({ error: 'Unauthorized' }, 401);
  }

  const rawBody = await req.json().catch(() => null);
  if (!isChatBody(rawBody)) {
    return jsonResponse({ error: 'Invalid request body' }, 400);
  }

  const { data: conversation, error: conversationError } = await supabaseClient
    .from('conversations')
    .select('id, type, user_id, current_message_leaf_id')
    .eq('id', rawBody.conversationId)
    .eq('user_id', user.id)
    .single()
    .overrideTypes<ConversationAccess>();

  if (conversationError || !conversation) {
    return jsonResponse({ error: 'Conversation not found' }, 404);
  }

  if (!conversation.current_message_leaf_id) {
    return jsonResponse(
      { error: 'Conversation has no leaf to generate from' },
      400,
    );
  }

  const tools =
    conversation.type === 'creative'
      ? creativeTools({ conversation, req, model: rawBody.model })
      : parametricTools({
          supabaseClient,
          previewPathForToolCall: (toolCallId) =>
            `${user.id}/${conversation.id}/preview-${toolCallId}`,
        });

  let branchMessages: AppUIMessage[];
  let leafRole: 'user' | 'assistant';
  try {
    const branchResult = await loadBranchFromDb({
      supabaseClient,
      conversationId: conversation.id,
      leafId: conversation.current_message_leaf_id,
    });
    branchMessages = branchResult.branch;
    leafRole = branchResult.leafRole;
  } catch (error) {
    logError(error, {
      functionName: 'ai-chat',
      statusCode: 500,
      userId: user.id,
      conversationId: conversation.id,
      additionalContext: { operation: 'load_branch' },
    });
    return jsonResponse({ error: 'Failed to load conversation branch' }, 500);
  }

  const leafMessageId = conversation.current_message_leaf_id;
  const openrouter = createOpenRouter({
    apiKey: requiredEnv('OPENROUTER_API_KEY'),
  });

  // Title is generated INSIDE the stream's execute (below), as a transient
  // `data-title-update` part — that way the client receives it without a
  // round-trip to refetch the conversation, AND the title gen runs in
  // parallel with the model stream instead of blocking it. Only fires on
  // the very first user turn.
  const isFirstUserTurn = branchMessages.length === 1 && leafRole === 'user';

  const modelMessages = await convertToModelMessages<AppUIMessage>(
    branchMessages,
    {
      tools,
      convertDataPart: (part) => {
        if (part.type === 'data-mesh-context') {
          const { meshId, fileType, filename, boundingBox } = part.data;
          if (conversation.type === 'parametric' && filename) {
            const dims = boundingBox
              ? `\nModel dimensions (mm): width=${boundingBox.x.toFixed(1)}, height=${boundingBox.y.toFixed(1)}, depth=${boundingBox.z.toFixed(1)}`
              : '';
            return {
              type: 'text',
              text: `[user attached ${fileType.toUpperCase()} "${filename}"]${dims}\nUse import("${filename}") to include the user's model. Use rotation_x = 90 to stand it upright.`,
            };
          }
          return {
            type: 'text',
            text: `[user reference mesh ${meshId} (${fileType})]`,
          };
        }
        if (part.type === 'data-mesh-preferences') {
          return {
            type: 'text',
            text: `[mesh preferences: topology=${part.data.topology}, target=${part.data.polygonCount} polys]`,
          };
        }
        return undefined;
      },
    },
  );

  const result = streamText({
    model: openrouter.chat(chatModel(conversation, rawBody.model), {
      ...reasoningOptions(rawBody.thinking ?? false, 9000),
      usage: { include: true },
    }),
    system: systemPrompt(conversation),
    messages: modelMessages,
    tools,
    stopWhen: stepCountIs(5),
    maxOutputTokens: rawBody.thinking ? 20000 : 16000,
    abortSignal: req.signal,
    // Decouple our render cadence from the provider's native chunking.
    // OpenRouter (and the underlying provider) sometimes emits text in
    // paragraph-sized frames; smoothStream rebuckets the deltas into
    // word-sized chunks at a steady cadence so the chat panel reads
    // word-by-word the way the rest of the AI ecosystem does. Default
    // delay is 10ms — bumped to 30ms for a more readable cadence.
    experimental_transform: smoothStream({ delayInMs: 30 }),
  });

  // Stream construction follows the onshape-extension pattern:
  // `createUIMessageStream({ execute })` gives us a `writer` that can emit
  // out-of-band transient parts (title / suggestions) alongside the actual
  // assistant message stream. The transient parts never land in
  // `messages.parts`; the client picks them up via `useChat`'s `onData`
  // and pokes the conversation query cache directly.
  const stream = createUIMessageStream<AppUIMessage>({
    execute: async ({ writer }) => {
      // Title (first user turn only) runs in parallel with the model
      // stream — fire-and-forget; the assistant doesn't wait on it.
      if (isFirstUserTurn) {
        void emitConversationTitle({
          writer,
          openrouter,
          supabaseClient,
          conversation,
          firstMessage: branchMessages[0],
        });
      }

      writer.merge(
        result.toUIMessageStream<AppUIMessage>({
          originalMessages: branchMessages,
          generateMessageId: () => crypto.randomUUID(),
          onFinish: async ({ responseMessage, isContinuation }) => {
            const usage = await result.totalUsage;
            const billingTokens = billingTokensFromUsage(usage);
            const metadata = {
              ...(responseMessage.metadata ?? {}),
              model: rawBody.model,
              billingTokens,
            };

            try {
              const consumed = await billing.consume(user.email!, {
                tokens: billingTokens,
                operation:
                  conversation.type === 'creative' ? 'chat' : 'parametric',
                referenceId: responseMessage.id,
              });
              if (!consumed.ok) {
                logError(new Error('insufficient_tokens'), {
                  functionName: 'ai-chat',
                  statusCode: 402,
                  userId: user.id,
                  conversationId: conversation.id,
                  additionalContext: {
                    tokensRequired: consumed.tokensRequired,
                    tokensAvailable: consumed.tokensAvailable,
                  },
                });
              }
            } catch (error) {
              logError(error, {
                functionName: 'ai-chat',
                statusCode:
                  error instanceof BillingClientError ? error.status : 502,
                userId: user.id,
                conversationId: conversation.id,
                additionalContext: { operation: 'billing_consume' },
              });
            }

            const finalizedParts = finalizeStreamingParts(
              responseMessage.parts,
            );
            const serializedMessage = {
              metadata: JSON.parse(JSON.stringify(metadata)),
              parts: JSON.parse(JSON.stringify(finalizedParts)),
            };

            // `isContinuation` fires when the response stream extended an
            // existing assistant message (the leaf was an assistant with a
            // pending tool call). In that case the row already exists — we
            // just update its parts in place and the leaf stays where it
            // is.
            //
            // Otherwise we insert a NEW assistant whose parent is whatever
            // the leaf was when the request came in. For a fresh user turn
            // that's the user message we generated this response for; for
            // a retry (client repointed the leaf back at the parent user
            // message) it's the same parent, so the new assistant becomes
            // a sibling of the one being re-rolled — which is what makes
            // BranchNavigation light up. The `update_leaf_trigger` on
            // `public.messages` automatically advances
            // `current_message_leaf_id` to the new row, so we don't need a
            // separate conversations update.
            const { error } = isContinuation
              ? await supabaseClient
                  .from('messages')
                  .update(serializedMessage)
                  .eq('id', responseMessage.id)
                  .eq('conversation_id', conversation.id)
              : await supabaseClient.from('messages').insert({
                  id: responseMessage.id,
                  conversation_id: conversation.id,
                  role: responseMessage.role,
                  ...serializedMessage,
                  parent_message_id: leafMessageId,
                });

            if (error) {
              logError(error, {
                functionName: 'ai-chat',
                statusCode: 500,
                userId: user.id,
                conversationId: conversation.id,
                additionalContext: { operation: 'persist_response_message' },
              });
            }

            // Only generate suggestions once the assistant has actually
            // finished talking. Mid-tool-roundtrip (parts ends with a
            // tool-call awaiting client output) we skip — the next
            // continuation `onFinish` will fire suggestions for the real
            // final state. Avoids a wasted Haiku call AND prevents
            // mid-turn placeholder pills.
            const hasPendingToolCall = finalizedParts.some(
              (part) =>
                part.type.startsWith('tool-') &&
                (part as { state?: string }).state === 'input-available',
            );
            if (!hasPendingToolCall) {
              // MUST be awaited (not `void`). `createUIMessageStream`
              // closes the SSE controller as soon as the merged stream
              // drains — and the merged stream resolves once this
              // `onFinish` returns. A fire-and-forget here would race
              // the close, and the `writer.write` inside
              // `emitConversationSuggestions` would silently no-op
              // because `safeEnqueue` swallows enqueue errors on a
              // closed controller (see ai/dist/index.mjs:8264). The
              // ~200-500ms Haiku call delays the client's "streaming"
              // → "ready" transition by the same amount, which is the
              // tradeoff for getting pills delivered.
              await emitConversationSuggestions({
                writer,
                openrouter,
                supabaseClient,
                conversation,
                branch: [
                  ...branchMessages,
                  { ...responseMessage, parts: finalizedParts },
                ],
              });
            }
          },
        }),
      );
    },
  });

  return createUIMessageStreamResponse({
    stream,
    headers: corsHeaders,
    consumeSseStream: consumeStream,
  });
}

/**
 * Generate a short conversation title from the first user message,
 * persist it on the conversation row, AND emit a transient
 * `data-title-update` part so the client's title bar updates without a
 * round-trip refetch. Fire-and-forget — runs in parallel with the
 * assistant message stream so the user sees their message echo back
 * immediately even if Haiku is still naming the thread.
 */
async function emitConversationTitle({
  writer,
  openrouter,
  supabaseClient,
  conversation,
  firstMessage,
}: {
  writer: UIMessageStreamWriter<AppUIMessage>;
  openrouter: ReturnType<typeof createOpenRouter>;
  supabaseClient: SupabaseAnon;
  conversation: ConversationAccess;
  firstMessage: AppUIMessage;
}) {
  try {
    const title = await generateConversationTitle({ openrouter, firstMessage });
    await supabaseClient
      .from('conversations')
      .update({ title })
      .eq('id', conversation.id);
    writer.write({
      transient: true,
      type: 'data-title-update',
      data: { conversationId: conversation.id, title },
    });
  } catch (error) {
    logError(error, {
      functionName: 'ai-chat',
      statusCode: 500,
      userId: '',
      conversationId: conversation.id,
      additionalContext: { operation: 'title_update' },
    });
  }
}

/**
 * Generate fresh per-conversation suggestions, persist them on the
 * conversation's `settings.suggestions`, and emit a transient
 * `data-suggestions-update` part. Suggestions are conversation-level
 * (not per-message) because that's how they appear in the UI: pills
 * below the chat input that drive the user's next prompt.
 */
async function emitConversationSuggestions({
  writer,
  openrouter,
  supabaseClient,
  conversation,
  branch,
}: {
  writer: UIMessageStreamWriter<AppUIMessage>;
  openrouter: ReturnType<typeof createOpenRouter>;
  supabaseClient: SupabaseAnon;
  conversation: ConversationAccess;
  branch: AppUIMessage[];
}) {
  try {
    const suggestions = await generateConversationSuggestions({
      openrouter,
      branch,
      conversationType: conversation.type,
    });
    if (suggestions.length === 0) return;

    // Merge into existing settings (which holds `model`, etc.) instead of
    // clobbering — keep the row's other fields intact.
    const { data: convRow } = await supabaseClient
      .from('conversations')
      .select('settings')
      .eq('id', conversation.id)
      .single();
    const currentSettings =
      convRow?.settings &&
      typeof convRow.settings === 'object' &&
      !Array.isArray(convRow.settings)
        ? (convRow.settings as Record<string, unknown>)
        : {};
    await supabaseClient
      .from('conversations')
      .update({ settings: { ...currentSettings, suggestions } })
      .eq('id', conversation.id);

    writer.write({
      transient: true,
      type: 'data-suggestions-update',
      data: { conversationId: conversation.id, suggestions },
    });
  } catch (error) {
    logError(error, {
      functionName: 'ai-chat',
      statusCode: 500,
      userId: '',
      conversationId: conversation.id,
      additionalContext: { operation: 'suggestions_update' },
    });
  }
}
