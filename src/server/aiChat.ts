import { createOpenRouter } from '@openrouter/ai-sdk-provider';
import { chatTools, type AppUIMessage, type AppTools } from '@shared/chatAi';
import { getParametricText } from '@shared/parametricParts';
import type { Conversation, MeshFileType, Model } from '@shared/types';
import {
  convertToModelMessages,
  consumeStream,
  generateText,
  Output,
  smoothStream,
  stepCountIs,
  streamText,
  validateUIMessages,
  type LanguageModelUsage,
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

The build_parametric_model tool output is the artifact shown to the user:
Use the build_parametric_model tool input as the artifact shown to the user:
- title: short object name
- version: "v1"
- code: complete raw OpenSCAD code, no markdown
- parameters: editable OpenSCAD variables
- parts: semantic model regions and the parameter names that affect each region
- suggestions: optional follow-up edits

After you call build_parametric_model, the browser compiles the OpenSCAD and
returns whether compilation succeeded. If it fails, fix the code with another
build_parametric_model call.

OpenSCAD rules:
- Declare editable parameters as variables at the top.
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

type ChatBody = {
  conversationId: string;
  messages: AppUIMessage[];
  model: Model;
  parentMessageId?: string | null;
  thinking?: boolean;
  /**
   * Submitted automatically by `@ai-sdk/react`'s `regenerate()` so we can
   * distinguish a fresh user turn from a re-roll of an existing assistant.
   * When `'regenerate-message'`, the last item in `messages` is an
   * already-persisted user message we must NOT re-upsert (doing so could
   * clobber its persisted `parent_message_id`).
   */
  trigger?: 'submit-message' | 'regenerate-message';
};

type ConversationAccess = Pick<Conversation, 'id' | 'type' | 'user_id'>;

function isChatBody(value: unknown): value is ChatBody {
  return (
    isRecord(value) &&
    typeof value.conversationId === 'string' &&
    Array.isArray(value.messages) &&
    typeof value.model === 'string' &&
    (value.parentMessageId == null ||
      typeof value.parentMessageId === 'string') &&
    (value.thinking == null || typeof value.thinking === 'boolean') &&
    (value.trigger == null ||
      value.trigger === 'submit-message' ||
      value.trigger === 'regenerate-message')
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
  supabaseClient: ReturnType<typeof getAnonSupabaseClient>,
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
  supabaseClient: ReturnType<typeof getAnonSupabaseClient>;
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
        const base64 = await downloadAsBase64(
          supabaseClient,
          'images',
          output.previewPath ?? previewPathForToolCall(toolCallId),
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
    .select('id, type, user_id')
    .eq('id', rawBody.conversationId)
    .eq('user_id', user.id)
    .single()
    .overrideTypes<ConversationAccess>();

  if (conversationError || !conversation) {
    return jsonResponse({ error: 'Conversation not found' }, 404);
  }

  const tools =
    conversation.type === 'creative'
      ? creativeTools({ conversation, req, model: rawBody.model })
      : parametricTools({
          supabaseClient,
          previewPathForToolCall: (toolCallId) =>
            `${user.id}/${conversation.id}/preview-${toolCallId}`,
        });

  let messages: AppUIMessage[];
  try {
    messages = await validateUIMessages<AppUIMessage>({
      messages: rawBody.messages,
      tools,
    });
  } catch {
    return jsonResponse({ error: 'Invalid UI messages' }, 400);
  }

  const lastMessage = messages[messages.length - 1];
  if (!lastMessage) {
    return jsonResponse({ error: 'No messages submitted' }, 400);
  }

  if (lastMessage.role !== 'user' && lastMessage.role !== 'assistant') {
    return jsonResponse(
      { error: 'Last message must be user or assistant' },
      400,
    );
  }

  const openrouter = createOpenRouter({
    apiKey: requiredEnv('OPENROUTER_API_KEY'),
  });
  const parentMessageId = rawBody.parentMessageId ?? null;
  const isRegenerate = rawBody.trigger === 'regenerate-message';

  if (lastMessage.role === 'user') {
    // On regenerate, the last message is an already-persisted user message
    // (the SDK truncates to before the assistant being re-rolled and the
    // user turn that prompted it is the new tail). We must NOT re-upsert it
    // here: doing so overwrites its `parent_message_id` with whatever the
    // client put in the body, which has historically produced self-cycles
    // that lock the chat-tree `getPath()` walk into an infinite loop.
    if (!isRegenerate) {
      const { error: userMessageError } = await supabaseClient
        .from('messages')
        .upsert({
          id: lastMessage.id,
          conversation_id: conversation.id,
          role: lastMessage.role,
          metadata: JSON.parse(
            JSON.stringify({
              ...(lastMessage.metadata ?? {}),
              model: rawBody.model,
            }),
          ),
          parts: JSON.parse(JSON.stringify(lastMessage.parts)),
          parent_message_id: parentMessageId,
        });

      if (userMessageError) {
        return jsonResponse({ error: 'Failed to persist user message' }, 500);
      }
    }
  } else {
    const { error: assistantMessageError } = await supabaseClient
      .from('messages')
      .update({
        metadata: JSON.parse(
          JSON.stringify({
            ...(lastMessage.metadata ?? {}),
            model: rawBody.model,
          }),
        ),
        parts: JSON.parse(JSON.stringify(lastMessage.parts)),
      })
      .eq('id', lastMessage.id)
      .eq('conversation_id', conversation.id);

    if (assistantMessageError) {
      return jsonResponse({ error: 'Failed to persist tool output' }, 500);
    }
  }

  if (lastMessage.role === 'user' && messages.length === 1) {
    const title = await generateConversationTitle({
      openrouter,
      firstMessage: lastMessage,
    });
    await supabaseClient
      .from('conversations')
      .update({ title })
      .eq('id', conversation.id);
  }

  const modelMessages = await convertToModelMessages<AppUIMessage>(messages, {
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
  });
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

  return result.toUIMessageStreamResponse<AppUIMessage>({
    originalMessages: messages,
    generateMessageId: () => crypto.randomUUID(),
    headers: corsHeaders,
    consumeSseStream: consumeStream,
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
          operation: conversation.type === 'creative' ? 'chat' : 'parametric',
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
          statusCode: error instanceof BillingClientError ? error.status : 502,
          userId: user.id,
          conversationId: conversation.id,
          additionalContext: { operation: 'billing_consume' },
        });
      }

      const serializedMessage = {
        metadata: JSON.parse(JSON.stringify(metadata)),
        parts: JSON.parse(JSON.stringify(responseMessage.parts)),
      };

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
            parent_message_id: lastMessage.id,
          });

      if (!error) {
        await supabaseClient
          .from('conversations')
          .update({ current_message_leaf_id: responseMessage.id })
          .eq('id', conversation.id);
        return;
      }

      logError(error, {
        functionName: 'ai-chat',
        statusCode: 500,
        userId: user.id,
        conversationId: conversation.id,
        additionalContext: { operation: 'persist_response_message' },
      });
    },
  });
}
