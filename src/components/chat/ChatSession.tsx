import { MessageBubble } from '@/components/chat/MessageBubble';
import { SuggestionPills } from '@/components/chat/SuggestionPills';
import TextAreaChat from '@/components/TextAreaChat';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useAuth } from '@/contexts/AuthContext';
import { useCachedAiChat } from '@/hooks/useCachedAiChat';
import { useToast } from '@/hooks/use-toast';
import { previewScadColoredViaToolWorker } from '@/worker/toolWorker';
import { apiUrl } from '@/services/api';
import { messageRowToChatMessage, type ChatMessage } from '@/lib/aiMessages';
import { collectStuckToolRecovery } from '@/components/chat/stuckToolRecovery';
import { AssistantRowMissingError } from '@/services/messageService';
import { supabase } from '@/lib/supabase';
import {
  generateColoredPreview,
  generateInspectionPreview,
  generatePreview,
} from '@/utils/meshUtils';
import type {
  AppUIMessage,
  ConversationSuggestionsUpdate,
  ConversationTitleUpdate,
} from '@shared/chatAi';
import { useChat } from '@ai-sdk/react';
import {
  DefaultChatTransport,
  lastAssistantMessageIsCompleteWithToolCalls,
} from 'ai';
import Tree from '@shared/Tree';
import { shouldAutoContinueParametricBuild } from '@shared/parametricAgentLoop';
import {
  extractScadFromAssistantParts,
  hasSuccessfulParametricBuild,
  isParametricArtifact,
  shouldReportMissingParametricBuild,
} from '@shared/parametricParts';
import type {
  Conversation,
  Message,
  Model,
  ParametricArtifact,
} from '@shared/types';
import { useQueryClient } from '@tanstack/react-query';
import posthog from 'posthog-js';
import { useCallback, useEffect, useMemo, useRef } from 'react';

interface ChatSessionProps {
  conversation: Conversation;
  /** Raw message rows from the DB query — used to build the sibling tree. */
  dbMessages: Message[];
  /** Branch to seed `chat.messages` on mount of this conversation's Chat. */
  initialBranch: AppUIMessage[];
  model: Model;
  setModel: (model: Model) => void;
  /** True when the token budget is exhausted; locks the input + retry. */
  isDisabled: boolean;

  // Action handlers — each does its DB writes in the parent and returns
  // the data ChatSession needs to keep `chat.messages` in sync. See the
  // architecture plan §5 for the exact contract.
  onSendParts: (
    parts: AppUIMessage['parts'],
  ) => Promise<{ userMessageId: string }>;
  onRetry: (assistant: ChatMessage) => Promise<void>;
  onEdit: (
    original: ChatMessage,
    parts: AppUIMessage['parts'],
  ) => Promise<{ newUserMessageId: string; parentPath: AppUIMessage[] }>;
  onRestore: (assistant: ChatMessage) => Promise<{ newBranch: AppUIMessage[] }>;
  onSelectLeaf: (messageId: string) => Promise<void>;
  /** Pure tree walker — closes over the parent's `dbTree`. */
  branchForLeaf: (leafId: string) => AppUIMessage[];

  onToolOutput: (
    messageId: string,
    nextParts: AppUIMessage['parts'],
  ) => Promise<void>;
  onChangeRating: (messageId: string, rating: number) => void;
  onViewArtifact: (artifact: ParametricArtifact, messageId: string) => void;
  onViewMesh: (meshId: string, messageId: string) => void;
  /** Fired whenever the SDK's submitted/streaming flag flips. Lets the
   *  parent show the bouncing loader in the preview pane while the model
   *  is still producing the next artifact. */
  onLoadingChange?: (isLoading: boolean) => void;
}

function answerUserInput(input: unknown): { message: string } | null {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
  const message = (input as { message?: unknown }).message;
  return typeof message === 'string' && message.trim() ? { message } : null;
}

/**
 * Owns the AI-SDK Chat lifecycle for a conversation. Everything that touches
 * `chat.sendMessage` / `chat.regenerate` / `chat.setMessages` /
 * `chat.addToolOutput` lives here — and only here. DB writes are delegated
 * upward to `EditorView` via the `on*` props, which keeps the two layers
 * honest: the parent owns "what the tree looks like", this component owns
 * "what the SDK is doing right now".
 *
 * The split means we never have a stale `chat.messages` racing against a
 * React Query refetch: a chat-state update only happens as the direct
 * consequence of an action handler that the parent already awaited.
 */
export function ChatSession({
  conversation,
  dbMessages,
  initialBranch,
  model,
  setModel,
  isDisabled,
  onSendParts,
  onRetry,
  onEdit,
  onRestore,
  onSelectLeaf,
  branchForLeaf,
  onToolOutput,
  onChangeRating,
  onViewArtifact,
  onViewMesh,
  onLoadingChange,
}: ChatSessionProps) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  // ───────────────────────────────────────────────────────────────────────
  // Transport — strips client state out of the wire body. Server reads the
  // branch from `conversations.current_message_leaf_id` and walks parents
  // in the DB, so anything the SDK might put in `messages` is ignored.
  // ───────────────────────────────────────────────────────────────────────
  const authHeaders = useCallback(async (): Promise<Record<string, string>> => {
    const token = (await supabase.auth.getSession()).data.session?.access_token;
    return token ? { Authorization: `Bearer ${token}` } : {};
  }, []);

  // The chat endpoint returns 402 when the user is out of tokens. The AI
  // SDK transport doesn't expose the response status on its `onError`
  // hook — we have to intercept at the fetch layer. On 402 we invalidate
  // the billing status query so PromptView's <LimitReachedMessage /> and
  // EditorView's input-disable react immediately instead of waiting up
  // to 30s for the next status poll. A toast covers the in-between
  // moment where the user just hit send and got nothing back.
  //
  // We also set `billingErrorHandledRef` so the SDK's `onError` (which
  // fires next, because a 402 isn't a valid SSE stream) doesn't stack a
  // second generic toast on top of the specific billing one.
  const billingErrorHandledRef = useRef(false);
  const billingAwareFetch = useCallback<typeof fetch>(
    async (input, init) => {
      const response = await fetch(input, init);
      if (response.status === 402) {
        billingErrorHandledRef.current = true;
        queryClient.invalidateQueries({ queryKey: ['billing', 'status'] });
        toast({
          title: "You're out of tokens",
          description:
            'Upgrade your plan or buy a token pack to keep chatting.',
          variant: 'destructive',
        });
      }
      return response;
    },
    [queryClient, toast],
  );

  const transport = useMemo(
    () =>
      new DefaultChatTransport<AppUIMessage>({
        api: apiUrl(
          conversation.type === 'creative'
            ? 'creative-chat'
            : 'parametric-chat',
        ),
        headers: authHeaders,
        fetch: billingAwareFetch,
        prepareSendMessagesRequest: ({ body }) => ({
          body: {
            conversationId: conversation.id,
            model,
            ...(body ?? {}),
          },
        }),
      }),
    [authHeaders, billingAwareFetch, conversation.id, conversation.type, model],
  );

  // ───────────────────────────────────────────────────────────────────────
  // Tool-output bridge via `onToolCall` (no useEffect, no dedupe ref).
  //
  // The SDK fires this exactly once per tool call as soon as the model's
  // input completes. We compile the OpenSCAD locally, upload the preview,
  // persist the assistant's parts to DB (so the server reads the right
  // thing on auto-continuation), and only then call `chat.addToolOutput`
  // which lets `sendAutomaticallyWhen` continue the CAD build/review loop.
  // ───────────────────────────────────────────────────────────────────────
  const chatRef = useRef<ReturnType<typeof useCachedAiChat> | null>(null);
  // Latest `chat.messages` snapshot for use inside `onToolCall` (callbacks
  // baked at Chat-init time would otherwise close over the initial array).
  const messagesRef = useRef<AppUIMessage[]>(initialBranch);
  // Set when persisting a tool's `output-available` to the DB fails. The
  // server reads the branch from the DB (never from client-sent messages), so
  // auto-resubmitting after a failed persist would continue against a stale
  // branch — at best a wasted round-trip the server has to recover from. While
  // this is set, `sendAutomaticallyWhen` returns false so the loop pauses and
  // the user can retry. Reset at the top of each `handleToolCall`.
  const persistFailedRef = useRef(false);

  const handleToolCall = useCallback(
    async ({
      toolCall,
    }: {
      toolCall: {
        toolName: string;
        toolCallId: string;
        input: unknown;
      };
    }) => {
      if (
        toolCall.toolName !== 'build_parametric_model' &&
        toolCall.toolName !== 'answer_user'
      ) {
        return;
      }
      const chat = chatRef.current;
      if (!chat) return;

      // Fresh tool call → clear any prior persist-failure pause.
      persistFailedRef.current = false;

      // Prefer the SDK's live `chat.messages` — it's always current.
      // `messagesRef.current` is a React-mirrored copy that lags one
      // commit behind, and onToolCall can fire before that commit lands.
      const findAssistant = (msgs: readonly AppUIMessage[]) =>
        msgs.find(
          (msg) =>
            msg.role === 'assistant' &&
            msg.parts.some(
              (p) =>
                p.type === `tool-${toolCall.toolName}` &&
                'toolCallId' in p &&
                p.toolCallId === toolCall.toolCallId,
            ),
        );
      const assistant =
        findAssistant(chat.messages as AppUIMessage[]) ??
        findAssistant(messagesRef.current);

      if (toolCall.toolName === 'answer_user') {
        if (
          conversation.type === 'parametric' &&
          assistant &&
          !hasSuccessfulParametricBuild(assistant.parts)
        ) {
          const errorText =
            'You must call build_parametric_model with complete OpenSCAD code before answer_user.';
          const errorPart = {
            type: 'tool-answer_user',
            toolCallId: toolCall.toolCallId,
            state: 'output-error',
            input: toolCall.input,
            errorText,
          } as AppUIMessage['parts'][number];
          const nextParts = assistant.parts.map((existing) =>
            existing.type === 'tool-answer_user' &&
            existing.toolCallId === toolCall.toolCallId
              ? errorPart
              : existing,
          ) as AppUIMessage['parts'];
          try {
            await onToolOutput(assistant.id, nextParts);
          } catch (persistError) {
            console.warn(
              'Failed to persist premature answer_user error to DB:',
              persistError,
            );
          }
          chat.addToolOutput({
            state: 'output-error',
            tool: 'answer_user',
            toolCallId: toolCall.toolCallId,
            errorText,
          });
          return;
        }

        const output = answerUserInput(toolCall.input);
        if (!output) {
          const errorText = 'answer_user input was missing a message.';
          // Persist the error so the DB row isn't left with a dangling
          // `input-available` tool call (which would 500 the next send before
          // the server-side sanitizer rewrites it).
          if (assistant) {
            const nextParts = assistant.parts.map((existing) =>
              existing.type === 'tool-answer_user' &&
              existing.toolCallId === toolCall.toolCallId
                ? ({
                    type: 'tool-answer_user',
                    toolCallId: toolCall.toolCallId,
                    state: 'output-error',
                    input: toolCall.input,
                    errorText,
                  } as AppUIMessage['parts'][number])
                : existing,
            ) as AppUIMessage['parts'];
            try {
              await onToolOutput(assistant.id, nextParts);
            } catch (persistError) {
              console.warn(
                'Failed to persist answer_user error to DB:',
                persistError,
              );
            }
          }
          chat.addToolOutput({
            state: 'output-error',
            tool: 'answer_user',
            toolCallId: toolCall.toolCallId,
            errorText,
          });
          return;
        }

        const successPart = {
          type: 'tool-answer_user',
          toolCallId: toolCall.toolCallId,
          state: 'output-available',
          input: output,
          output,
        } as AppUIMessage['parts'][number];

        if (assistant) {
          const nextParts = assistant.parts.map((existing) => {
            if (
              existing.type === 'tool-answer_user' &&
              existing.toolCallId === toolCall.toolCallId
            ) {
              return successPart;
            }
            if (
              (existing.type === 'reasoning' || existing.type === 'text') &&
              existing.state === 'streaming'
            ) {
              return { ...existing, state: 'done' as const };
            }
            return existing;
          }) as AppUIMessage['parts'];

          try {
            await onToolOutput(assistant.id, nextParts);
          } catch (persistError) {
            console.warn(
              'Failed to persist answer_user output to DB:',
              persistError,
            );
            toast({
              title: "Couldn't save the reply",
              description:
                'Your message is shown but may not survive a refresh. Please retry if it disappears.',
              variant: 'destructive',
            });
          }
        }

        chat.addToolOutput({
          tool: 'answer_user',
          toolCallId: toolCall.toolCallId,
          output,
        });
        return;
      }

      // Build the next parts array for `assistant`, replacing the
      // matching tool part with `replacement` and normalising any
      // streaming reasoning/text to `done` (some providers skip the
      // closing chunk; persisting an intermediate snapshot leaves the
      // UI showing "Thinking..." on refresh).
      const buildNextParts = (
        replacement: AppUIMessage['parts'][number],
      ): AppUIMessage['parts'] | null => {
        if (!assistant) return null;
        return assistant.parts.map((existing) => {
          if (
            existing.type === 'tool-build_parametric_model' &&
            existing.toolCallId === toolCall.toolCallId
          ) {
            // Carry forward `callProviderMetadata` from the model-emitted
            // tool-call (Gemini 3 stashes its `thoughtSignature` there).
            // Without it the next server-side turn echoes the functionCall
            // back to Gemini without a signature and Gemini rejects the
            // request with "Function call is missing a thought_signature".
            return existing.callProviderMetadata
              ? {
                  ...replacement,
                  callProviderMetadata: existing.callProviderMetadata,
                }
              : replacement;
          }
          if (
            (existing.type === 'reasoning' || existing.type === 'text') &&
            existing.state === 'streaming'
          ) {
            return { ...existing, state: 'done' as const };
          }
          return existing;
        }) as AppUIMessage['parts'];
      };

      // Always finish the tool — both in memory (spinner clears, SDK
      // can auto-continue) and on disk (refresh doesn't resurrect the
      // stuck `input-available` state, which would break every
      // subsequent send because the server can't continue a
      // conversation with an unresolved tool call).
      //
      // Persist BEFORE `addToolOutput` — same ordering as the success path.
      // `addToolOutput` is what triggers `sendAutomaticallyWhen`, and the
      // server continues from the DB branch, so the resolved (error) parts
      // must be on disk before the resubmit can fire. A compile error SHOULD
      // auto-continue (the model fixes it), so we don't pause here on a failed
      // persist; the server-side sanitizer backstops a stale read.
      const finishWithError = async (errorText: string) => {
        if (assistant) {
          const errorPart = {
            type: 'tool-build_parametric_model',
            toolCallId: toolCall.toolCallId,
            state: 'output-error',
            input: toolCall.input,
            errorText,
          } as AppUIMessage['parts'][number];
          const nextParts = buildNextParts(errorPart);
          if (nextParts) {
            try {
              await onToolOutput(assistant.id, nextParts);
            } catch (persistError) {
              console.warn('Failed to persist tool error to DB:', persistError);
            }
          }
        }
        chat.addToolOutput({
          state: 'output-error',
          tool: 'build_parametric_model',
          toolCallId: toolCall.toolCallId,
          errorText,
        });
      };

      const input = isParametricArtifact(toolCall.input)
        ? toolCall.input
        : null;

      if (!input) {
        await finishWithError(
          'CAD tool input was not a valid OpenSCAD artifact.',
        );
        return;
      }

      try {
        // Upload both images before auto-continuation:
        // - preview-* is the single ISO thumbnail the chat UI displays.
        // - inspection-preview-* is the multi-view sheet the agent receives.
        const { stl, off } = await previewScadColoredViaToolWorker(input.code);
        let inspectionUploaded = false;
        try {
          if (user?.id) {
            const inspectionDataUrl = await generateInspectionPreview({
              stl,
              off,
            });
            const inspectionBlob = await fetch(inspectionDataUrl).then(
              (response) => response.blob(),
            );
            const inspectionPath = `${user.id}/${conversation.id}/inspection-preview-${toolCall.toolCallId}`;
            const { error: inspectionUploadError } = await supabase.storage
              .from('images')
              .upload(inspectionPath, inspectionBlob, {
                contentType: 'image/png',
                upsert: true,
              });
            if (inspectionUploadError) throw inspectionUploadError;
            inspectionUploaded = true;
          }
        } catch (uploadError) {
          console.warn(
            'Failed to upload OpenSCAD inspection preview:',
            uploadError,
          );
        }

        try {
          if (user?.id) {
            let thumbnailDataUrl: string | null = null;
            if (off) {
              thumbnailDataUrl = await generateColoredPreview(off);
            }
            if (!thumbnailDataUrl) {
              thumbnailDataUrl = await generatePreview(stl, 'stl');
            }
            const thumbnailBlob = await fetch(thumbnailDataUrl).then(
              (response) => response.blob(),
            );
            const previewPath = `${user.id}/${conversation.id}/preview-${toolCall.toolCallId}`;
            const { error: thumbnailUploadError } = await supabase.storage
              .from('images')
              .upload(previewPath, thumbnailBlob, {
                contentType: 'image/png',
                upsert: true,
              });
            if (thumbnailUploadError) throw thumbnailUploadError;
          }
        } catch (uploadError) {
          console.warn('Failed to upload OpenSCAD thumbnail:', uploadError);
        }

        const inspectionViews: Array<
          'ISO' | 'FRONT' | 'BACK' | 'LEFT' | 'RIGHT' | 'TOP' | 'BOTTOM'
        > = ['ISO', 'FRONT', 'BACK', 'LEFT', 'RIGHT', 'TOP', 'BOTTOM'];
        const output = {
          status: 'success' as const,
          inspection: {
            views: inspectionViews,
            imageAttached: inspectionUploaded,
          },
          message: inspectionUploaded
            ? 'Compilation successful. Inspect the multi-view render in this tool result against the user request from every visible angle. If any required feature is missing, wrong, too simple, disconnected, non-printable, hidden from some view, or visually unclear, call build_parametric_model again with a corrected complete OpenSCAD script. If all views satisfy the request, give a concise final response.'
            : 'Compilation successful, but the multi-view preview sheet was not available. Review the OpenSCAD you wrote against the user request. If anything is missing, wrong, too simple, disconnected, non-printable, or visually unclear, call build_parametric_model again with a corrected complete OpenSCAD script. If it satisfies the request, give a concise final response.',
        };

        const successPart = {
          type: 'tool-build_parametric_model',
          toolCallId: toolCall.toolCallId,
          state: 'output-available',
          input,
          output,
        } as AppUIMessage['parts'][number];
        const nextParts = buildNextParts(successPart);

        if (assistant) {
          onViewArtifact(input, assistant.id);
        }

        if (nextParts && assistant) {
          try {
            await onToolOutput(assistant.id, nextParts);
          } catch (persistError) {
            console.warn('Failed to persist tool output to DB:', persistError);
            // The server continues from the DB branch. If this build's output
            // never landed, auto-resubmitting would run against a stale branch
            // and discard a model the user can already see. Pause the loop and
            // let them retry.
            persistFailedRef.current = true;
            toast({
              title: "Couldn't save this step",
              description:
                "The model is shown but the build wasn't saved, so Adam paused. Please retry.",
              variant: 'destructive',
            });
          }
        }

        chat.addToolOutput({
          tool: 'build_parametric_model',
          toolCallId: toolCall.toolCallId,
          output,
        });
      } catch (error) {
        await finishWithError(
          `Compilation failed:\n${error instanceof Error ? error.message : String(error)}`,
        );
      }
    },
    [
      conversation.id,
      conversation.type,
      onToolOutput,
      onViewArtifact,
      toast,
      user?.id,
    ],
  );

  // ───────────────────────────────────────────────────────────────────────
  // Chat instance — keyed by conversation.id via `useCachedAiChat` so that
  // switching conversations reuses cached instances (or creates one), but
  // the Chat for THIS conversation is stable across re-renders.
  // ───────────────────────────────────────────────────────────────────────
  const chat = useCachedAiChat({
    id: conversation.id,
    messages: initialBranch,
    transport,
    onToolCall: handleToolCall,
    // Pause the loop if a tool-output persist failed — resubmitting would run
    // the server against a stale DB branch (see `persistFailedRef`).
    sendAutomaticallyWhen: (ctx) => {
      if (persistFailedRef.current) return false;
      return conversation.type === 'parametric'
        ? shouldAutoContinueParametricBuild(ctx.messages)
        : lastAssistantMessageIsCompleteWithToolCalls(ctx);
    },
    // Out-of-band conversation-level signals (title + suggestions) arrive
    // here as transient data parts — they never land in `messages.parts`,
    // so we patch the conversation query cache directly. See
    // `emitConversationTitle` / `emitConversationSuggestions` in
    // `src/server/aiChat.ts` for the producers.
    onData: (part) => {
      // The SDK's `ChatOnDataCallback` widens `data` to `unknown` even
      // though we typed `AppDataTypes` — `InferUIMessageData` doesn't
      // preserve the per-key mapping through the generic. Narrow
      // ourselves: discriminate on `type`, cast `data` to the
      // corresponding `AppDataTypes` entry. The producer side
      // (`writer.write({ type, data })`) is the type-checked counterpart.
      if (part.type === 'data-title-update') {
        const { title } = part.data as ConversationTitleUpdate;
        queryClient.setQueryData(
          ['conversation', conversation.id],
          (old: Conversation | undefined) => (old ? { ...old, title } : old),
        );
        queryClient.invalidateQueries({ queryKey: ['conversations'] });
        return;
      }
      if (part.type === 'data-suggestions-update') {
        const { suggestions } = part.data as ConversationSuggestionsUpdate;
        queryClient.setQueryData(
          ['conversation', conversation.id],
          (old: Conversation | undefined) =>
            old
              ? {
                  ...old,
                  settings: {
                    ...(old.settings && typeof old.settings === 'object'
                      ? old.settings
                      : {}),
                    suggestions,
                  },
                }
              : old,
        );
      }
    },
    onFinish: ({ message }) => {
      // The DB trigger has already advanced `current_message_leaf_id` to
      // the new assistant. Push that into the conversation cache
      // optimistically so the UI doesn't flicker; the invalidation right
      // after re-confirms against the server.
      if (message?.id) {
        queryClient.setQueryData(
          ['conversation', conversation.id],
          (old: Conversation | undefined) =>
            old ? { ...old, current_message_leaf_id: message.id } : old,
        );
      }

      if (
        conversation.type === 'parametric' &&
        message?.role === 'assistant' &&
        shouldReportMissingParametricBuild(message.parts)
      ) {
        const recoveredCode = extractScadFromAssistantParts(message.parts);
        if (recoveredCode) {
          void (async () => {
            try {
              await previewScadColoredViaToolWorker(recoveredCode);
              onViewArtifact(
                {
                  title: 'Recovered model',
                  version: 'v1',
                  code: recoveredCode,
                },
                message.id,
              );
              toast({
                title: 'Model code recovered',
                description:
                  'OpenSCAD was found in the reply text and loaded into the preview.',
              });
            } catch (error) {
              console.warn('Recovered OpenSCAD failed to compile:', error);
              toast({
                title: 'Found code but it did not compile',
                description:
                  'OpenSCAD was in the reply but could not be rendered. Try retrying the prompt.',
                variant: 'destructive',
              });
            }
          })();
        } else {
          toast({
            title: 'No model was generated',
            description:
              'Adam replied without OpenSCAD code. Try again or retry with a different model.',
            variant: 'destructive',
          });
        }
      }

      queryClient.invalidateQueries({
        queryKey: ['messages', conversation.id],
      });
      queryClient.invalidateQueries({
        queryKey: ['conversation', conversation.id],
      });
      queryClient.invalidateQueries({ queryKey: ['conversations'] });
      queryClient.invalidateQueries({ queryKey: ['billing', 'status'] });
    },
    onError: (error) => {
      console.error('[chat]', error);
      // 402 is already surfaced by `billingAwareFetch` above with a
      // tailored message — don't show a generic toast on top of it.
      if (billingErrorHandledRef.current) {
        billingErrorHandledRef.current = false;
        return;
      }
      const message = error instanceof Error ? error.message : String(error);
      toast({
        title: 'Adam ran into a problem',
        description: message || 'The model call failed. Please try again.',
        variant: 'destructive',
      });
    },
  });

  const { messages, status, stop, sendMessage, regenerate, setMessages } =
    useChat<AppUIMessage>({ chat });

  // Keep the refs in sync for callbacks that were baked at Chat-init time
  // (`onToolCall`) — those captured `messages` at mount otherwise.
  useEffect(() => {
    chatRef.current = chat;
    messagesRef.current = messages;
  }, [chat, messages]);

  // Load-time recovery for tool parts that never finished in a previous
  // session. If the last assistant in DB has a `tool-build_parametric_model`
  // stuck at `input-streaming` / `input-available`, the UI shows a perma-
  // spinner AND every subsequent send 500s because the server can't
  // continue a conversation with an unresolved tool call. Rewrite to
  // `output-error` so the chat is in a valid state — the user can retry
  // or send a new message. Use setMessages (not addToolOutput) so we
  // don't trigger an unwanted auto-resubmit on load.
  const recoveredChatRef = useRef<unknown>(null);
  useEffect(() => {
    if (recoveredChatRef.current === chat) return;
    recoveredChatRef.current = chat;

    // `chat.status` is read once per chat+mount on purpose: a cached Chat
    // that is mid-generation when ChatSession (re)mounts is not "stuck from
    // a previous session", and collectStuckToolRecovery skips it entirely.
    //
    // The scan is structurally typed (dependency-free for its unit tests),
    // so its map comes back as `RecoveryPartLike[]` values. Every rewrite
    // spreads the original part and only narrows tool/text `state`, so
    // re-narrowing to our part union is sound — this is the one place the
    // structural boundary is crossed.
    const stuckByMessageId = collectStuckToolRecovery({
      status: chat.status,
      messages: chat.messages,
    }) as Map<string, AppUIMessage['parts']>;

    if (stuckByMessageId.size === 0) return;

    setMessages(
      (chat.messages as AppUIMessage[]).map((msg) =>
        stuckByMessageId.has(msg.id)
          ? { ...msg, parts: stuckByMessageId.get(msg.id)! }
          : msg,
      ),
    );

    for (const [messageId, nextParts] of stuckByMessageId) {
      void onToolOutput(messageId, nextParts).catch((err) => {
        if (err instanceof AssistantRowMissingError) {
          // The interruption happened before the server's `onFinish` INSERT,
          // so this assistant exists only in the cached in-memory chat. The
          // DB branch (leaf = the user message) has no dangling tool call to
          // repair, and the setMessages above already fixed the UI.
          console.info(
            'Stuck-tool recovery: assistant row was never persisted; ' +
              'nothing to repair in DB (benign).',
          );
          return;
        }
        console.warn('Failed to persist stuck-tool recovery:', err);
      });
    }
  }, [chat, onToolOutput, setMessages]);

  const isLoading = status === 'submitted' || status === 'streaming';

  useEffect(() => {
    onLoadingChange?.(isLoading);
  }, [isLoading, onLoadingChange]);

  // ───────────────────────────────────────────────────────────────────────
  // Sibling tree for branch nav.
  //
  // The tree merges DB rows (authoritative `parent_message_id` + persisted
  // columns) with live `chat.messages` (streaming `parts` and any not-yet-
  // persisted bubbles). For messages we've seen in DB, the merge takes the
  // DB row's parent + rating/etc. and overlays the SDK's live parts. For
  // chat-only messages (streaming user/assistant before the refetch lands)
  // the parent is derived from chat order — they're a linear branch by
  // definition.
  // ───────────────────────────────────────────────────────────────────────
  const treeMessages = useMemo(() => {
    const byId = new Map<string, ChatMessage>();
    for (const row of dbMessages) {
      byId.set(row.id, messageRowToChatMessage(row));
    }
    for (let i = 0; i < messages.length; i += 1) {
      const live = messages[i];
      const existing = byId.get(live.id);
      if (existing) {
        byId.set(live.id, {
          ...existing,
          parts: live.parts,
          metadata: live.metadata,
        });
      } else {
        const parent = i === 0 ? null : messages[i - 1].id;
        byId.set(live.id, {
          ...live,
          parent_message_id: parent,
          conversation_id: conversation.id,
        });
      }
    }
    return Array.from(byId.values());
  }, [dbMessages, messages, conversation.id]);

  const messageTree = useMemo(() => new Tree(treeMessages), [treeMessages]);
  const branchNodes = useMemo(
    () =>
      messages
        .map((m) => messageTree.allNodes.get(m.id))
        .filter((node): node is NonNullable<typeof node> => !!node),
    [messages, messageTree],
  );

  // ───────────────────────────────────────────────────────────────────────
  // Auto-switch the preview pane to the freshest assistant output.
  //
  // Tracks the last preview key we've fired so clicking an OLD artifact's
  // Eye button doesn't get clobbered by a delayed auto-switch on the next
  // render. Only triggers when a genuinely new preview appears (key
  // changes) — not for every state tick.
  // ───────────────────────────────────────────────────────────────────────
  const lastAutoAppliedPreviewKeyRef = useRef<string | null>(null);
  useEffect(() => {
    const preview = findLatestPreview(messages);
    if (!preview) return;
    const key =
      preview.type === 'artifact'
        ? `artifact:${preview.messageId}:${preview.artifact.code.length}`
        : `mesh:${preview.messageId}:${preview.meshId}`;
    if (lastAutoAppliedPreviewKeyRef.current === key) return;
    lastAutoAppliedPreviewKeyRef.current = key;
    if (preview.type === 'artifact') {
      onViewArtifact(preview.artifact, preview.messageId);
    } else {
      onViewMesh(preview.meshId, preview.messageId);
    }
  }, [messages, onViewArtifact, onViewMesh]);

  // ───────────────────────────────────────────────────────────────────────
  // Action handlers. Pattern: await the parent's DB write, then call the
  // matching `chat.*` method. Each handler lives next to the operation
  // that justifies its `chat.setMessages` / `chat.sendMessage` /
  // `chat.regenerate` — no auto-sync effect, no prop watching.
  // ───────────────────────────────────────────────────────────────────────
  const handleSend = useCallback(
    async (parts: AppUIMessage['parts']) => {
      const text = parts
        .filter((p) => p.type === 'text')
        .map((p) => p.text)
        .join('');
      const imageCount = parts.filter(
        (p) => p.type === 'file' && p.mediaType.startsWith('image/'),
      ).length;
      const meshCount = parts.filter(
        (p) => p.type === 'data-mesh-context',
      ).length;
      posthog.capture('message_sent', {
        type: conversation.type,
        model_name: model,
        text,
        image_count: imageCount,
        mesh_count: meshCount,
        conversation_id: conversation.id,
      });

      const { userMessageId } = await onSendParts(parts);
      // The transport closes over `model` at the time the Chat instance was
      // created (which might be `PromptView`'s `model` for first-turn
      // conversations created from the landing page). Always pass the
      // current model in the per-call body so the transport's
      // `...(body ?? {})` spread overrides any stale baked-in value.
      await sendMessage(
        { id: userMessageId, parts, metadata: { model } },
        { body: { model } },
      );
    },
    [conversation.id, conversation.type, model, onSendParts, sendMessage],
  );

  const handleEditUserText = useCallback(
    async (original: ChatMessage, text: string) => {
      const parts: AppUIMessage['parts'] = [{ type: 'text', text }];
      const { newUserMessageId, parentPath } = await onEdit(original, parts);
      setMessages(parentPath);
      await sendMessage(
        { id: newUserMessageId, parts, metadata: { model } },
        { body: { model } },
      );
    },
    [model, onEdit, sendMessage, setMessages],
  );

  const handleRetry = useCallback(
    async (assistant: ChatMessage, nextModel: Model) => {
      if (nextModel !== model) setModel(nextModel);
      await onRetry(assistant);
      await regenerate({
        messageId: assistant.id,
        body: { model: nextModel },
      });
    },
    [model, onRetry, regenerate, setModel],
  );

  const handleRestore = useCallback(
    async (assistant: ChatMessage) => {
      const { newBranch } = await onRestore(assistant);
      setMessages(newBranch);
    },
    [onRestore, setMessages],
  );

  const handleSelectLeaf = useCallback(
    async (messageId: string) => {
      await onSelectLeaf(messageId);
      setMessages(branchForLeaf(messageId));
    },
    [branchForLeaf, onSelectLeaf, setMessages],
  );

  // ───────────────────────────────────────────────────────────────────────
  // Scroll-to-bottom on new content. Reads the Radix Viewport directly so
  // the user can still scroll up to re-read older turns without us forcing
  // them back down.
  // ───────────────────────────────────────────────────────────────────────
  const scrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const viewport = scrollRef.current?.querySelector(
      '[data-radix-scroll-area-viewport]',
    );
    if (viewport) viewport.scrollTop = viewport.scrollHeight;
  }, [branchNodes, isLoading]);

  return (
    <>
      <ScrollArea
        className="relative w-full min-w-0 max-w-full flex-1 self-center overflow-x-hidden px-3 py-0 md:min-h-0 md:p-4 [&_[data-radix-scroll-area-viewport]]:overflow-x-hidden"
        ref={scrollRef}
      >
        <div className="pointer-events-none sticky left-0 top-0 z-50 h-3 bg-gradient-to-b from-adam-bg-secondary-dark/90 to-transparent md:hidden" />
        <div className="mx-auto flex w-full min-w-0 max-w-3xl flex-col gap-4 pb-6 md:gap-8 md:pb-4">
          {branchNodes.map((node, index) => {
            const isLastMessage = index === branchNodes.length - 1;
            return (
              <MessageBubble
                key={node.id}
                message={node}
                isLoading={isLoading}
                isLastMessage={isLastMessage}
                currentModel={model}
                onSelectLeaf={(id) => void handleSelectLeaf(id)}
                onEditUserText={
                  node.role === 'user' ? handleEditUserText : undefined
                }
                onViewArtifact={(artifact) => onViewArtifact(artifact, node.id)}
                onViewMesh={(meshId) => onViewMesh(meshId, node.id)}
                onChangeRating={
                  node.role === 'assistant'
                    ? (rating) => onChangeRating(node.id, rating)
                    : undefined
                }
                onRetry={
                  node.role === 'assistant'
                    ? (nextModel) => void handleRetry(node, nextModel)
                    : undefined
                }
                onRestore={
                  node.role === 'assistant' && !isLastMessage
                    ? () => void handleRestore(node)
                    : undefined
                }
              />
            );
          })}
        </div>
      </ScrollArea>

      <div className="w-full shrink-0 self-center px-3 pb-[calc(1rem+env(safe-area-inset-bottom))] sm:px-4 md:pb-4">
        {/* Suggestions are conversation-level — the server writes them
            to `conversation.settings.suggestions` and emits a transient
            `data-suggestions-update` on each non-tool-call assistant
            turn (see `emitConversationSuggestions` in
            `src/server/aiChat.ts`). We hide them while a stream is in
            flight; the freshly-arrived pills replace the stale ones
            when streaming finishes. */}
        {!isLoading && (
          <div className="mx-auto max-w-3xl pt-1">
            <SuggestionPills
              suggestions={conversation.settings?.suggestions ?? []}
              onSelect={(suggestion) =>
                void handleSend([{ type: 'text', text: suggestion }])
              }
              disabled={isDisabled}
            />
          </div>
        )}
        <TextAreaChat
          type={conversation.type}
          onSubmit={(parts) => void handleSend(parts)}
          placeholder="Keep iterating with Adam..."
          isLoading={isLoading}
          stopGenerating={stop}
          disabled={isDisabled}
          model={model}
          setModel={setModel}
          conversation={conversation}
        />
      </div>
    </>
  );
}

type LatestPreview =
  | { type: 'artifact'; messageId: string; artifact: ParametricArtifact }
  | { type: 'mesh'; messageId: string; meshId: string }
  | null;

function findLatestPreview(messages: AppUIMessage[]): LatestPreview {
  for (
    let messageIndex = messages.length - 1;
    messageIndex >= 0;
    messageIndex -= 1
  ) {
    const message = messages[messageIndex];
    for (
      let partIndex = message.parts.length - 1;
      partIndex >= 0;
      partIndex -= 1
    ) {
      const part = message.parts[partIndex];
      if (
        part.type === 'tool-build_parametric_model' &&
        part.state !== 'input-streaming' &&
        isParametricArtifact(part.input)
      ) {
        return {
          type: 'artifact',
          messageId: message.id,
          artifact: part.input,
        };
      }
      if (
        part.type === 'tool-create_mesh' &&
        part.state === 'output-available'
      ) {
        return {
          type: 'mesh',
          messageId: message.id,
          meshId: part.output.id,
        };
      }
    }
  }
  return null;
}
