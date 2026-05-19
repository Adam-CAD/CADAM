import { MessageBubble } from '@/components/chat/MessageBubble';
import { SuggestionPills } from '@/components/chat/SuggestionPills';
import TextAreaChat from '@/components/TextAreaChat';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useAuth } from '@/contexts/AuthContext';
import { useCachedAiChat } from '@/hooks/useCachedAiChat';
import { useOpenSCAD } from '@/hooks/useOpenSCAD';
import { useToast } from '@/hooks/use-toast';
import { apiUrl } from '@/services/api';
import { messageRowToChatMessage, type ChatMessage } from '@/lib/aiMessages';
import { supabase } from '@/lib/supabase';
import { generateColoredPreview, generatePreview } from '@/utils/meshUtils';
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
import { isParametricArtifact } from '@shared/parametricParts';
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
  const { previewScadColored } = useOpenSCAD();

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
  // which triggers `sendAutomaticallyWhen` → next stream.
  // ───────────────────────────────────────────────────────────────────────
  const chatRef = useRef<ReturnType<typeof useCachedAiChat> | null>(null);
  // Latest `chat.messages` snapshot for use inside `onToolCall` (callbacks
  // baked at Chat-init time would otherwise close over the initial array).
  const messagesRef = useRef<AppUIMessage[]>(initialBranch);

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
      if (toolCall.toolName !== 'build_parametric_model') return;
      const input = isParametricArtifact(toolCall.input)
        ? toolCall.input
        : null;
      const chat = chatRef.current;
      if (!chat) return;

      // Find the assistant message that owns this toolCallId so we can
      // compute its next parts and tell the parent which row to UPDATE.
      const assistant = messagesRef.current.find(
        (msg) =>
          msg.role === 'assistant' &&
          msg.parts.some(
            (p) =>
              p.type === 'tool-build_parametric_model' &&
              p.toolCallId === toolCall.toolCallId,
          ),
      );
      if (!assistant) return;

      if (!input) {
        chat.addToolOutput({
          state: 'output-error',
          tool: 'build_parametric_model',
          toolCallId: toolCall.toolCallId,
          errorText: 'CAD tool input was not a valid OpenSCAD artifact.',
        });
        return;
      }

      try {
        // Render + upload the preview as part of the tool's execution,
        // BEFORE `addToolOutput` triggers the auto-continuation. The
        // server reads it back by toolCallId (see `previewPathForToolCall`
        // in `aiChat.ts`) and the MessageBubble's `<ParametricImagePreview>`
        // pulls from the same canonical path via `usePreview`. No path is
        // returned in the tool output — both consumers derive it.
        // Mirror VisualCard / ParametricImagePreview's get-or-generate path:
        // prefer the colored OFF render so the cached thumbnail matches what
        // the rest of the app shows. Fall back to the gray STL render if OFF
        // is unavailable or empty.
        const { stl, off } = await previewScadColored(input.code);
        try {
          if (user?.id) {
            let previewDataUrl: string | null = null;
            if (off) {
              previewDataUrl = await generateColoredPreview(off);
            }
            if (!previewDataUrl) {
              previewDataUrl = await generatePreview(stl, 'stl');
            }
            const previewBlob = await fetch(previewDataUrl).then((response) =>
              response.blob(),
            );
            const previewPath = `${user.id}/${conversation.id}/preview-${toolCall.toolCallId}`;
            await supabase.storage
              .from('images')
              .upload(previewPath, previewBlob, {
                contentType: 'image/png',
                upsert: true,
              });
          }
        } catch (uploadError) {
          console.warn('Failed to upload OpenSCAD preview:', uploadError);
        }

        const output = {
          status: 'success' as const,
          message:
            'Compilation successful. The 3D model is now displayed to the user.',
        };

        // Build the assistant's next `parts` array — same transformation
        // `addToolOutput` will apply locally — and persist it before
        // calling `addToolOutput`. Auto-resubmit then reads the updated
        // row from DB.
        //
        // Also normalise any `state: 'streaming'` part (reasoning / text)
        // to `'done'`. Some providers don't emit the closing chunk that
        // the SDK uses to transition states, and if we persist that
        // intermediate snapshot the UI keeps showing "Thinking..." on
        // the next page load. Same fix lives on the server's
        // onFinish — applied here too because this code path PERSISTS
        // chat state directly without going through onFinish.
        const nextParts = assistant.parts.map((existing) => {
          if (
            existing.type !== 'tool-build_parametric_model' ||
            existing.toolCallId !== toolCall.toolCallId
          ) {
            if (
              (existing.type === 'reasoning' || existing.type === 'text') &&
              existing.state === 'streaming'
            ) {
              return { ...existing, state: 'done' as const };
            }
            return existing;
          }
          return {
            ...existing,
            state: 'output-available' as const,
            output,
          };
        }) as AppUIMessage['parts'];

        try {
          await onToolOutput(assistant.id, nextParts);
        } catch (persistError) {
          console.warn('Failed to persist tool output to DB:', persistError);
        }

        chat.addToolOutput({
          tool: 'build_parametric_model',
          toolCallId: toolCall.toolCallId,
          output,
        });
      } catch (error) {
        chat.addToolOutput({
          state: 'output-error',
          tool: 'build_parametric_model',
          toolCallId: toolCall.toolCallId,
          errorText: `Compilation failed:\n${error instanceof Error ? error.message : String(error)}`,
        });
      }
    },
    [conversation.id, previewScadColored, onToolOutput, user?.id],
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
    sendAutomaticallyWhen: lastAssistantMessageIsCompleteWithToolCalls,
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
      <ScrollArea className="min-h-0 flex-1 p-4" ref={scrollRef}>
        <div className="mx-auto flex max-w-3xl flex-col gap-8">
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

      <div className="shrink-0 px-4 pb-4">
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
