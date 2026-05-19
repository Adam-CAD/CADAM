import { createAnthropic } from '@ai-sdk/anthropic';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
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
  type LanguageModel,
  type LanguageModelUsage,
  type UIMessageStreamWriter,
} from 'ai';
import type { ProviderOptions } from '@ai-sdk/provider-utils';
import { z } from 'zod';
import { billing, BillingClientError } from './billingClient';
import { corsHeaders, isRecord } from './api';
import { requiredEnv } from './env';
import { logError } from './serverLog';
import { handleMeshRequest } from './mesh';
import { getAnonSupabaseClient } from './supabaseClient';

/**
 * USD list price per **million** tokens, keyed by the same model IDs the
 * client picker uses. `cacheRead` / `cacheWrite` are per-million prices
 * for cached input — when omitted we apply provider-typical defaults:
 *   - Anthropic: read = input × 0.10, write = input × 1.25 (5-min cache)
 *
 * Keep this in sync with each provider's pricing page. Any model that
 * isn't listed here falls through to {@link FALLBACK_MODEL_PRICE}, which
 * is intentionally set to the most expensive entry so an unrecognized
 * model never free-bills the platform.
 */
const MODEL_PRICES: Record<
  string,
  { input: number; output: number; cacheRead?: number; cacheWrite?: number }
> = {
  // Anthropic
  'anthropic/claude-opus-4.7': { input: 15, output: 75 },
  'anthropic/claude-opus-4': { input: 15, output: 75 },
  'anthropic/claude-sonnet-4.6': { input: 3, output: 15 },
  'anthropic/claude-sonnet-4.5': { input: 3, output: 15 },
  'anthropic/claude-haiku-4.5': { input: 1, output: 5 },

  // Google — cached content reads bill at ~25% of input price; there is
  // no cache-write surcharge (cache storage is billed per-hour, which
  // we don't track here).
  'google/gemini-3.1-pro-preview': {
    input: 1.25,
    output: 10,
    cacheRead: 0.31,
    cacheWrite: 1.25,
  },

  // OpenAI — prompt-cache reads at 50% of input.
  'openai/gpt-5.5': { input: 5, output: 20, cacheRead: 2.5, cacheWrite: 5 },

  // MoonshotAI
  'moonshotai/kimi-k2.6': { input: 0.6, output: 2.5 },
};

const FALLBACK_MODEL_PRICE = { input: 15, output: 75 };

/**
 * One billing token represents this many USD of inference cost.
 * Tune to set the margin between subscription price and the model spend
 * a tier covers. At $0.01:
 *   - Pro (5,000 tokens) covers ~$50 of inference
 *   - Standard (1,000) covers ~$10
 *   - Free (50/day) covers ~$0.50/day
 */
const USD_PER_BILLING_TOKEN = 0.01;

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

const THINKING_BUDGET_TOKENS = 9000;

type ChatProvider = 'anthropic' | 'google' | 'openrouter';

function providerFor(modelId: string): ChatProvider {
  if (modelId.startsWith('anthropic/')) return 'anthropic';
  if (modelId.startsWith('google/')) return 'google';
  return 'openrouter';
}

type AnthropicProvider = ReturnType<typeof createAnthropic>;
type GoogleProvider = ReturnType<typeof createGoogleGenerativeAI>;

type ChatProviders = {
  anthropic: AnthropicProvider;
  google: GoogleProvider;
  /** Lazy — only initialized if a non-Anthropic / non-Google model is used. */
  openrouter: () => ReturnType<typeof createOpenRouter>;
};

function createChatProviders(): ChatProviders {
  let openrouter: ReturnType<typeof createOpenRouter> | undefined;
  return {
    anthropic: createAnthropic({ apiKey: requiredEnv('ANTHROPIC_API_KEY') }),
    google: createGoogleGenerativeAI({
      apiKey: requiredEnv('GOOGLE_API_KEY'),
    }),
    openrouter: () => {
      openrouter ??= createOpenRouter({
        apiKey: requiredEnv('OPENROUTER_API_KEY'),
      });
      return openrouter;
    },
  };
}

/**
 * Map a `<provider>/<model>` ID to a configured LanguageModel + the
 * provider-specific options the AI SDK expects at the streamText boundary.
 *
 * Anthropic and Google are hit directly via their respective AI SDK providers.
 * Everything else (OpenAI, MoonshotAI, …) keeps going through OpenRouter so we
 * don't have to wire a dedicated provider per vendor.
 */
function buildChatModel(
  modelId: string,
  providers: ChatProviders,
  thinking: boolean,
): { model: LanguageModel; providerOptions?: ProviderOptions } {
  if (modelId.startsWith('anthropic/')) {
    // Anthropic's API uses dashes everywhere ("claude-haiku-4-5"), while the
    // OpenRouter alias uses dots ("claude-haiku-4.5"). Normalize both.
    const id = modelId.slice('anthropic/'.length).replace(/\./g, '-');
    return {
      model: providers.anthropic(id),
      providerOptions: thinking
        ? {
            anthropic: {
              thinking: {
                type: 'enabled',
                budgetTokens: THINKING_BUDGET_TOKENS,
              },
            },
          }
        : undefined,
    };
  }

  if (modelId.startsWith('google/')) {
    const id = modelId.slice('google/'.length);
    return {
      model: providers.google(id),
      // Gemini 3 Pro (and most current Google reasoning models) always
      // think internally — `thinkingBudget` only controls how MUCH, not
      // whether. `includeThoughts` is what actually surfaces those
      // thoughts in the stream as `reasoning-delta` parts. So we always
      // ask for thoughts; the user's "thinking" toggle just bumps the
      // budget. Without this, Google streams look as if the model isn't
      // reasoning at all even though it is.
      providerOptions: {
        google: {
          thinkingConfig: {
            includeThoughts: true,
            ...(thinking ? { thinkingBudget: THINKING_BUDGET_TOKENS } : {}),
          },
        },
      },
    };
  }

  return {
    model: providers.openrouter().chat(modelId, {
      ...(thinking
        ? { reasoning: { max_tokens: THINKING_BUDGET_TOKENS } }
        : {}),
      usage: { include: true },
    }),
  };
}

function priceFor(modelId: string) {
  const entry = MODEL_PRICES[modelId] ?? FALLBACK_MODEL_PRICE;
  return {
    input: entry.input,
    output: entry.output,
    cacheRead: entry.cacheRead ?? entry.input * 0.1,
    cacheWrite: entry.cacheWrite ?? entry.input * 1.25,
  };
}

/**
 * Compute USD inference cost from the AI SDK's `LanguageModelUsage`
 * breakdown.
 *
 * Field semantics (`ai`'s `LanguageModelUsage`):
 *   - `inputTokens` — total of all input categories.
 *   - `inputTokenDetails.noCacheTokens` — uncached portion (full price).
 *   - `inputTokenDetails.cacheReadTokens` — cached-input read (discounted).
 *   - `inputTokenDetails.cacheWriteTokens` — cache-creation write (surcharged).
 *   - `outputTokens` — total output, **already including reasoning tokens**.
 *     Providers bill reasoning at the output rate, so we never add
 *     `outputTokenDetails.reasoningTokens` on top of `outputTokens`.
 *
 * When a provider omits the breakdown we treat the whole `inputTokens`
 * value as uncached so we don't under-bill on a missing field.
 */
function usdCostFromUsage(modelId: string, usage: LanguageModelUsage): number {
  const price = priceFor(modelId);
  const cacheRead = usage.inputTokenDetails.cacheReadTokens ?? 0;
  const cacheWrite = usage.inputTokenDetails.cacheWriteTokens ?? 0;
  const inputTotal = usage.inputTokens ?? 0;
  const noCacheInput =
    usage.inputTokenDetails.noCacheTokens ??
    Math.max(0, inputTotal - cacheRead - cacheWrite);
  const outputTotal = usage.outputTokens ?? 0;

  return (
    (noCacheInput * price.input +
      cacheRead * price.cacheRead +
      cacheWrite * price.cacheWrite +
      outputTotal * price.output) /
    1_000_000
  );
}

function billingTokensFromUsage(
  modelId: string,
  usage: LanguageModelUsage,
): number {
  const usdCost = usdCostFromUsage(modelId, usage);
  return Math.max(1, Math.ceil(usdCost / USD_PER_BILLING_TOKEN));
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
  anthropic,
  firstMessage,
}: {
  anthropic: AnthropicProvider;
  firstMessage: AppUIMessage;
}) {
  const text = getParametricText(firstMessage.parts) || 'New conversation';
  try {
    const result = await generateText({
      model: anthropic('claude-haiku-4-5'),
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
  anthropic,
  branch,
  conversationType,
}: {
  anthropic: AnthropicProvider;
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
      model: anthropic('claude-haiku-4-5'),
      system:
        conversationType === 'creative'
          ? 'Given a 3D mesh design conversation, return an array of exactly 3 follow-up prompts the user might want to send next. Each prompt is a single concise instruction (under 8 words), not a question. Return exactly 3 items — no more, no fewer.'
          : 'Given a parametric CAD conversation, return an array of exactly 3 follow-up prompts the user might want to send next. Each prompt is a single concise instruction (under 8 words), not a question. Return exactly 3 items — no more, no fewer.',
      prompt: summary,
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

  // Pre-flight balance gate. A chat costs at least 1 billing token, so a
  // total of 0 means we cannot let the stream start. We don't try to
  // estimate the exact cost up front — chat is variable, and the billing
  // service drains the remainder to zero if the actual usage exceeds
  // what's left (see onFinish below).
  try {
    const status = await billing.getStatus(user.email);
    if (status.tokens.total <= 0) {
      return jsonResponse(
        {
          error: 'insufficient_tokens',
          code: 'insufficient_tokens',
          tokensRequired: 1,
          tokensAvailable: 0,
        },
        402,
      );
    }
  } catch (error) {
    logError(error, {
      functionName: 'ai-chat',
      statusCode: error instanceof BillingClientError ? error.status : 502,
      userId: user.id,
      conversationId: conversation.id,
      additionalContext: { operation: 'billing_preflight' },
    });
    return jsonResponse({ error: 'Billing service unavailable' }, 503);
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

  // `createChatProviders` calls `requiredEnv(...)` eagerly — a missing
  // ANTHROPIC_API_KEY / GOOGLE_API_KEY throws here, before we've started
  // a stream. Catch + log so the failure mode is "503 with a clear
  // server log" instead of "500 with no logs".
  let providers: ChatProviders;
  try {
    providers = createChatProviders();
  } catch (error) {
    logError(error, {
      functionName: 'ai-chat',
      statusCode: 500,
      userId: user.id,
      conversationId: conversation.id,
      additionalContext: { operation: 'create_providers' },
    });
    return jsonResponse({ error: 'AI provider not configured on server' }, 503);
  }

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

  // Resolve the actual model ID the request will run against. For
  // `creative` conversations this is hardcoded to Sonnet regardless of
  // what the client picked — billing has to price the model that ran,
  // not the one the user requested.
  const actualModelId = chatModel(conversation, rawBody.model);
  const resolvedProvider = providerFor(actualModelId);

  let chatLanguageModel: LanguageModel;
  let chatProviderOptions: ProviderOptions | undefined;
  try {
    const built = buildChatModel(
      actualModelId,
      providers,
      rawBody.thinking ?? false,
    );
    chatLanguageModel = built.model;
    chatProviderOptions = built.providerOptions;
  } catch (error) {
    logError(error, {
      functionName: 'ai-chat',
      statusCode: 500,
      userId: user.id,
      conversationId: conversation.id,
      additionalContext: {
        operation: 'build_chat_model',
        modelId: actualModelId,
        provider: resolvedProvider,
      },
    });
    return jsonResponse(
      { error: `Failed to initialize model ${actualModelId}` },
      500,
    );
  }

  // Common context attached to every error we log out of this request —
  // makes it trivial to tell "Anthropic rejected the model ID" apart from
  // "Google rate-limited us" apart from "OpenRouter returned 502" in logs.
  const logContext = {
    userId: user.id,
    conversationId: conversation.id,
    modelId: actualModelId,
    requestedModelId: rawBody.model,
    provider: resolvedProvider,
    thinking: rawBody.thinking ?? false,
  };

  const result = streamText({
    model: chatLanguageModel,
    providerOptions: chatProviderOptions,
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
    // Without this, provider errors mid-stream become silent `error`
    // parts on the SSE stream — never logged, never visible in
    // production. This is the primary observability hook for "the model
    // call failed and I have no idea why".
    onError: ({ error }) => {
      logError(error, {
        functionName: 'ai-chat',
        statusCode: 500,
        userId: logContext.userId,
        conversationId: logContext.conversationId,
        additionalContext: {
          ...logContext,
          operation: 'stream_text',
        },
      });
    },
  });

  // Stream construction follows the onshape-extension pattern:
  // `createUIMessageStream({ execute })` gives us a `writer` that can emit
  // out-of-band transient parts (title / suggestions) alongside the actual
  // assistant message stream. The transient parts never land in
  // `messages.parts`; the client picks them up via `useChat`'s `onData`
  // and pokes the conversation query cache directly.
  const stream = createUIMessageStream<AppUIMessage>({
    // `onError` runs for anything thrown inside `execute` OR inside the
    // merged streamText output. Without overriding it, the AI SDK
    // replaces the real error with a generic "An error occurred." string
    // before serializing — useful for hiding stack traces from end users,
    // useless for debugging. Log here and pass through a short message
    // to the client so the failure is visible in the UI too.
    onError: (error) => {
      logError(error, {
        functionName: 'ai-chat',
        statusCode: 500,
        userId: logContext.userId,
        conversationId: logContext.conversationId,
        additionalContext: {
          ...logContext,
          operation: 'ui_message_stream',
        },
      });
      const message = error instanceof Error ? error.message : String(error);
      return `Model call failed (${resolvedProvider}/${actualModelId}): ${message}`;
    },
    execute: async ({ writer }) => {
      // Title (first user turn only) runs in parallel with the model
      // stream — fire-and-forget; the assistant doesn't wait on it.
      if (isFirstUserTurn) {
        void emitConversationTitle({
          writer,
          anthropic: providers.anthropic,
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
            const billingTokens = billingTokensFromUsage(actualModelId, usage);
            const metadata = {
              ...(responseMessage.metadata ?? {}),
              model: rawBody.model,
              billingTokens,
            };

            try {
              // Drains the user's remaining balance to zero if the
              // request cost more than they had. The billing service
              // accepts the partial deduction, writes an audit row as
              // `<operation>_partial`, and the pre-flight gate above
              // will block the next request. Not an error path —
              // intentional terminal state.
              await billing.consume(user.email!, {
                tokens: billingTokens,
                operation:
                  conversation.type === 'creative' ? 'chat' : 'parametric',
                referenceId: responseMessage.id,
              });
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
                anthropic: providers.anthropic,
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
  anthropic,
  supabaseClient,
  conversation,
  firstMessage,
}: {
  writer: UIMessageStreamWriter<AppUIMessage>;
  anthropic: AnthropicProvider;
  supabaseClient: SupabaseAnon;
  conversation: ConversationAccess;
  firstMessage: AppUIMessage;
}) {
  try {
    const title = await generateConversationTitle({ anthropic, firstMessage });
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
  anthropic,
  supabaseClient,
  conversation,
  branch,
}: {
  writer: UIMessageStreamWriter<AppUIMessage>;
  anthropic: AnthropicProvider;
  supabaseClient: SupabaseAnon;
  conversation: ConversationAccess;
  branch: AppUIMessage[];
}) {
  try {
    const suggestions = await generateConversationSuggestions({
      anthropic,
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
