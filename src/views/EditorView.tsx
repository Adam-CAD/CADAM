import { ChatTitle } from '@/components/chat/ChatTitle';
import { ChatSession } from '@/components/chat/ChatSession';
import { CreateIcon } from '@/components/icons/ui/CreateIcon';
import { ParameterSection } from '@/components/parameter/ParameterSection';
import { ParameterSheetContent } from '@/components/parameter/ParameterSheetContent';
import { Button } from '@/components/ui/button';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { ShareContent } from '@/components/ui/ShareContent';
import { OpenSCADPreview } from '@/components/viewer/OpenSCADViewer';
import { MeshPreview } from '@/components/viewer/MeshPreview';
import Loader from '@/components/viewer/Loader';
import { useAuth } from '@/contexts/AuthContext';
import { ConversationContext } from '@/contexts/ConversationContext';
import { SelectedItemsContext } from '@/contexts/SelectedItemsContext';
import { useConversation } from '@/contexts/ConversationContext';
import {
  ensureInputRecords,
  messageRowToChatMessage,
  type ChatMessage,
} from '@/lib/aiMessages';
import parseParameters from '@shared/parseParameters';
import { supabase } from '@/lib/supabase';
import { updateParameter } from '@/lib/utils';
import {
  persistAssistantParts,
  persistUserMessage,
  useChangeRatingMutation,
  useMessagesQuery,
} from '@/services/messageService';
import type { DxfExporter } from '@/utils/downloadUtils';
import type { AppUIMessage } from '@shared/chatAi';
import {
  isParametricArtifact,
  replaceBuildParametricModelOutput,
} from '@shared/parametricParts';
import Tree from '@shared/Tree';
import type {
  Conversation,
  Message,
  Model,
  Parameter,
  ParametricArtifact,
} from '@shared/types';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useParams } from '@tanstack/react-router';
import { Loader2, Share } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { MessageItem } from '../types/misc.ts';
import { ConversationView } from './ConversationView';

/**
 * Route-level entry for `/editor/$id`.
 *
 * Owns the conversation fetch + auth gate + provider wiring. The actual
 * editor logic lives inside `<ConversationEditor>` which assumes the
 * conversation is loaded and the contexts are mounted.
 */
export default function EditorView() {
  const { id: conversationId } = useParams({
    from: '/_layout/_auth/editor/$id',
  });
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [images, setImages] = useState<MessageItem[]>([]);
  const [mesh, setMesh] = useState<MessageItem | null>(null);

  const { data: conversation, isLoading: isConversationLoading } = useQuery({
    queryKey: ['conversation', conversationId],
    enabled: !!conversationId,
    queryFn: async () => {
      if (!conversationId) throw new Error('Conversation ID is required');
      const { data, error } = await supabase
        .from('conversations')
        .select('*')
        .eq('id', conversationId)
        .eq('user_id', user?.id ?? '')
        .limit(1)
        .single();
      if (error) throw error;
      return data as Conversation;
    },
  });

  const { mutate: updateConversation, mutateAsync: updateConversationAsync } =
    useMutation({
      mutationFn: async (conversation: Conversation) => {
        const { data, error } = await supabase
          .from('conversations')
          .update(conversation)
          .eq('id', conversation.id)
          .select()
          .single()
          .overrideTypes<Conversation>();
        if (error) throw error;
        return data;
      },
      onMutate(conversation) {
        const oldConversation = queryClient.getQueryData<Conversation>([
          'conversation',
          conversation.id,
        ]);
        queryClient.setQueryData(
          ['conversation', conversation.id],
          conversation,
        );
        return { oldConversation };
      },
      onSuccess() {
        queryClient.invalidateQueries({
          queryKey: ['conversation', conversationId],
        });
        queryClient.invalidateQueries({ queryKey: ['conversations'] });
      },
      onError(_error, conversation, context) {
        queryClient.setQueryData(
          ['conversation', conversation.id],
          context?.oldConversation,
        );
      },
    });

  useEffect(() => {
    if (!conversationId) navigate({ to: '/' });
  }, [conversationId, navigate]);

  if (isConversationLoading) {
    return (
      <div className="flex h-full w-full items-center justify-center bg-adam-bg-secondary-dark text-adam-text-primary">
        <Loader2 className="h-10 w-10 animate-spin" />
      </div>
    );
  }

  if (!conversation) {
    return (
      <div className="flex h-full w-full flex-col items-center justify-center bg-adam-bg-secondary-dark text-adam-text-primary">
        <span className="text-2xl font-medium">404</span>
        <span className="text-sm">Conversation not found</span>
      </div>
    );
  }

  return (
    <ConversationContext.Provider
      value={{ conversation, updateConversation, updateConversationAsync }}
    >
      <SelectedItemsContext.Provider
        value={{ images, setImages, mesh, setMesh }}
      >
        {/* `key` forces a full remount whenever the conversation changes,
            so all per-conversation state inside the editor (active
            preview, parameter values, model selector, dxf exporter, etc.)
            reinitialises naturally instead of needing a manual reset
            effect that would race with `ChatSession`'s auto-switch. */}
        <ConversationEditor key={conversation.id} />
      </SelectedItemsContext.Provider>
    </ConversationContext.Provider>
  );
}

type ActivePreview =
  | { type: 'artifact'; messageId: string; artifact: ParametricArtifact }
  | { type: 'mesh'; messageId: string; meshId: string }
  | null;

/**
 * Owns the DB/tree layer for the editor: builds the tree from
 * `useMessagesQuery`, derives the visible branch from the conversation's
 * `current_message_leaf_id`, holds preview/parameter UI state, and
 * implements the action handlers that translate user intent into the right
 * DB writes (`persistUserMessage`, `updateConversationAsync`, etc.).
 *
 * The handlers return whatever data `<ChatSession>` needs to keep its
 * `useChat` state in sync after the write lands. That keeps the
 * DB-vs-SDK ordering explicit: parent persists, then child streams.
 */
function ConversationEditor() {
  const { conversation, updateConversation, updateConversationAsync } =
    useConversation();
  const { user, billing } = useAuth();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const totalTokens = billing?.tokens.total ?? 0;

  // ── Per-conversation UI state ───────────────────────────────────────────
  const [model, setModel] = useState<Model>(
    conversation.settings?.model ??
      (conversation.type === 'creative'
        ? 'quality'
        : 'google/gemini-3.1-pro-preview'),
  );
  const [activePreview, setActivePreview] = useState<ActivePreview>(null);
  const [parameters, setParameters] = useState<Parameter[]>([]);
  const [currentOutput, setCurrentOutput] = useState<Blob | undefined>();
  const [dxfExporter, setDxfExporter] = useState<DxfExporter | null>(null);
  const [mobilePreviewVersion, setMobilePreviewVersion] = useState(0);
  // Streaming flag surfaced from <ChatSession>. While true, the preview
  // pane swaps to the bouncing loader instead of mounting OpenSCAD —
  // matches the legacy ParametricPreviewSection behavior.
  const [isChatStreaming, setIsChatStreaming] = useState(false);
  const baseCodeRef = useRef<string | null>(null);

  // `dxfExporter` is itself a function, so we MUST use the lazy-set form
  // when OpenSCADPreview hands us a new exporter — `setDxfExporter(fn)`
  // would make React treat the function as an updater and call it
  // immediately, which fires `exportScad`/`writeFile` and queues
  // requests onto the worker that get rejected as "Worker terminated"
  // on the next cleanup.
  const handleDxfExporterChange = useCallback(
    (exporter: DxfExporter | null) => {
      setDxfExporter(() => exporter);
    },
    [],
  );

  // ── Source of truth: DB messages → tree → branch ───────────────────────
  const { data: dbMessages = [], isFetched: areMessagesFetched } =
    useMessagesQuery();
  const chatMessages = useMemo(
    () => dbMessages.map(messageRowToChatMessage),
    [dbMessages],
  );
  const dbTree = useMemo(() => new Tree(chatMessages), [chatMessages]);
  const branchForLeaf = useCallback(
    (leafId: string): AppUIMessage[] =>
      dbTree.getPath(leafId).map((node) => ({
        id: node.id,
        role: node.role,
        parts: node.parts,
        metadata: node.metadata,
      })),
    [dbTree],
  );
  const leafId =
    conversation.current_message_leaf_id ?? dbMessages.at(-1)?.id ?? '';
  const initialBranch = useMemo(
    () => branchForLeaf(leafId),
    [branchForLeaf, leafId],
  );

  const updateSelectedModel = useCallback(
    (nextModel: Model) => {
      setModel(nextModel);
      updateConversation?.({
        ...conversation,
        settings: {
          ...(typeof conversation.settings === 'object'
            ? conversation.settings
            : {}),
          model: nextModel,
        },
      });
    },
    [conversation, updateConversation],
  );

  // ── Action handlers — single responsibility: write the DB rows that
  // describe the next tree state, then return whatever ChatSession needs
  // to keep `chat.messages` aligned. ──────────────────────────────────
  const handleSendParts = useCallback(
    async (parts: AppUIMessage['parts']) => {
      if (!user?.id) throw new Error('User must be authenticated');
      await ensureInputRecords({
        parts,
        conversationId: conversation.id,
        userId: user.id,
      });
      const parentMessageId = conversation.current_message_leaf_id ?? null;
      const userMessageId = await persistUserMessage({
        conversationId: conversation.id,
        parts,
        metadata: { model },
        parentMessageId,
      });
      // The `update_leaf_trigger` advances the DB leaf to `userMessageId`;
      // mirror that in the cache so the next render shows the user bubble
      // immediately even before the messages query refetches.
      queryClient.setQueryData(
        ['conversation', conversation.id],
        (old: Conversation | undefined) =>
          old ? { ...old, current_message_leaf_id: userMessageId } : old,
      );
      return { userMessageId };
    },
    [conversation, model, queryClient, user?.id],
  );

  const handleRetry = useCallback(
    async (assistant: ChatMessage) => {
      const parentId = assistant.parent_message_id;
      if (!parentId) return;
      await updateConversationAsync?.({
        ...conversation,
        current_message_leaf_id: parentId,
      });
    },
    [conversation, updateConversationAsync],
  );

  const handleEdit = useCallback(
    async (original: ChatMessage, parts: AppUIMessage['parts']) => {
      if (!user?.id) throw new Error('User must be authenticated');
      await ensureInputRecords({
        parts,
        conversationId: conversation.id,
        userId: user.id,
      });
      const parentId = original.parent_message_id;
      const newUserMessageId = await persistUserMessage({
        conversationId: conversation.id,
        parts,
        metadata: { model },
        parentMessageId: parentId,
      });
      queryClient.setQueryData(
        ['conversation', conversation.id],
        (old: Conversation | undefined) =>
          old ? { ...old, current_message_leaf_id: newUserMessageId } : old,
      );
      const parentPath = parentId ? branchForLeaf(parentId) : [];
      return { newUserMessageId, parentPath };
    },
    [branchForLeaf, conversation, model, queryClient, user?.id],
  );

  const handleRestore = useCallback(
    async (assistant: ChatMessage) => {
      const newId = crypto.randomUUID();
      const parts = JSON.parse(JSON.stringify(assistant.parts));
      const metadata = JSON.parse(JSON.stringify(assistant.metadata ?? {}));
      // Restore only fires for assistants in the UI, so the role is
      // narrowed here for the strict `messages` row type ('user' |
      // 'assistant'); the broader `'system'` slot on UIMessage is
      // never legitimate to copy.
      const role: Message['role'] = 'assistant';
      const { error } = await supabase.from('messages').insert({
        id: newId,
        conversation_id: conversation.id,
        role,
        parts,
        metadata,
        parent_message_id: assistant.parent_message_id,
        rating: 0,
      });
      if (error) throw error;

      // Mirror the trigger's leaf advance + add the copy to the messages
      // cache optimistically so the new branch resolves before refetch.
      queryClient.setQueryData(
        ['conversation', conversation.id],
        (old: Conversation | undefined) =>
          old ? { ...old, current_message_leaf_id: newId } : old,
      );
      queryClient.setQueryData(
        ['messages', conversation.id],
        (old: Message[] | undefined): Message[] => [
          ...(old ?? []),
          {
            id: newId,
            conversation_id: conversation.id,
            role,
            parts,
            metadata,
            parent_message_id: assistant.parent_message_id,
            rating: 0,
            created_at: new Date().toISOString(),
          },
        ],
      );
      queryClient.invalidateQueries({
        queryKey: ['messages', conversation.id],
      });

      const parentPath = assistant.parent_message_id
        ? branchForLeaf(assistant.parent_message_id)
        : [];
      const newBranch: AppUIMessage[] = [
        ...parentPath,
        { id: newId, role, parts, metadata },
      ];
      return { newBranch };
    },
    [branchForLeaf, conversation.id, queryClient],
  );

  const handleSelectLeaf = useCallback(
    async (messageId: string) => {
      await updateConversationAsync?.({
        ...conversation,
        current_message_leaf_id: messageId,
      });
    },
    [conversation, updateConversationAsync],
  );

  const handleToolOutput = useCallback(
    async (messageId: string, nextParts: AppUIMessage['parts']) => {
      await persistAssistantParts({
        conversationId: conversation.id,
        messageId,
        parts: nextParts,
      });
      queryClient.setQueryData(
        ['messages', conversation.id],
        (old: Message[] | undefined): Message[] =>
          (old ?? []).map((row) =>
            row.id === messageId ? { ...row, parts: nextParts } : row,
          ),
      );
    },
    [conversation.id, queryClient],
  );

  const { mutate: changeRatingMutation } = useChangeRatingMutation({
    conversationId: conversation.id,
  });
  const handleChangeRating = useCallback(
    (messageId: string, rating: number) => {
      changeRatingMutation({ messageId, rating });
    },
    [changeRatingMutation],
  );

  // ── Preview-pane callbacks (called by ChatSession when a new artifact /
  // mesh lands, or by the user clicking the Eye icon on a bubble). ──────
  const handleViewArtifact = useCallback(
    (artifact: ParametricArtifact, messageId: string) => {
      baseCodeRef.current = artifact.code;
      // Parameters are derived from the OpenSCAD source — same code always
      // yields the same `<ParameterSection>`, no matter which model wrote
      // it. The current values come from the (possibly edited) artifact
      // code; the `defaultValue` (Reset target / slider home / auto range)
      // comes from `metadata.originalCode` — the model's first-authored
      // source — so an in-place parameter edit doesn't redefine the default
      // on the next reload. Read from the cache to keep this callback stable.
      const originalCode = queryClient
        .getQueryData<Message[]>(['messages', conversation.id])
        ?.find((row) => row.id === messageId)?.metadata?.originalCode;
      setParameters(mergeParameterDefaults(artifact.code, originalCode));
      setCurrentOutput(undefined);
      setDxfExporter(() => null);
      setActivePreview({ type: 'artifact', messageId, artifact });
      setMobilePreviewVersion((version) => version + 1);
    },
    [conversation.id, queryClient],
  );
  const handleViewMesh = useCallback((meshId: string, messageId: string) => {
    setCurrentOutput(undefined);
    setDxfExporter(() => null);
    setActivePreview({ type: 'mesh', messageId, meshId });
    setMobilePreviewVersion((version) => version + 1);
  }, []);

  // Serialize parameter writes (see `drainParameterWrites`): the newest
  // queued snapshot, plus a flag so at most one persist is ever in flight.
  const pendingWriteRef = useRef<{
    messageId: string;
    artifact: ParametricArtifact;
  } | null>(null);
  const writeInFlightRef = useRef(false);

  // Persist an in-place parameter edit back onto the assistant message's
  // `tool-build_parametric_model` part so it survives the `key={conversation.id}`
  // remount and a fresh `useMessagesQuery` fetch. Parameters are derived from
  // the artifact code, so writing the updated code is all that's needed — no
  // schema change. Mirrors `handleToolOutput`: DB write first, then cache, so a
  // post-stream `['messages']` invalidation refetches the already-edited row
  // instead of reverting. Reads `dbMessages` live (not a captured snapshot) so
  // `replaceBuildParametricModelOutput` indexes into the current parts array.
  const persistParameterEdit = useCallback(
    async (messageId: string, artifact: ParametricArtifact) => {
      const row = dbMessages.find((message) => message.id === messageId);
      if (!row) return;
      const nextParts = replaceBuildParametricModelOutput(row.parts, artifact);
      // Lazily capture the model's original source the first time a
      // parameter is edited. Before this feature edits never persisted, so a
      // message lacking `originalCode` still holds the model's original in
      // its stored code — which is exactly `baseCodeRef.current` (the code as
      // loaded, pre-edit). Once stashed, later edits skip this. Anchors the
      // derived `defaultValue` (Reset / slider home / range) without a
      // migration or a duplicate copy on never-edited artifacts.
      const needsOriginal =
        !!baseCodeRef.current && !row.metadata?.originalCode;
      const nextMetadata = needsOriginal
        ? { ...row.metadata, originalCode: baseCodeRef.current ?? undefined }
        : undefined;
      try {
        await persistAssistantParts({
          conversationId: conversation.id,
          messageId,
          parts: nextParts,
          metadata: nextMetadata,
        });
      } catch (error) {
        // A failed write must never break the live preview — the edit stays
        // in local state and the next change retries the persist.
        console.warn('Failed to persist parameter edit:', error);
        return;
      }
      queryClient.setQueryData(
        ['messages', conversation.id],
        (old: Message[] | undefined): Message[] =>
          (old ?? []).map((message) =>
            message.id === messageId
              ? {
                  ...message,
                  parts: nextParts,
                  ...(nextMetadata ? { metadata: nextMetadata } : {}),
                }
              : message,
          ),
      );
    },
    [conversation.id, dbMessages, queryClient],
  );

  // Flush queued parameter writes one at a time. Each `changeParameters`
  // rebuilds the full code from `baseCodeRef`, so coalescing to the latest
  // queued snapshot never drops an edit — but two overlapping writes could
  // commit out of order and leave stale code in the row, so we never let them
  // run concurrently.
  const drainParameterWrites = useCallback(async () => {
    if (writeInFlightRef.current) return;
    writeInFlightRef.current = true;
    try {
      while (pendingWriteRef.current) {
        const next = pendingWriteRef.current;
        pendingWriteRef.current = null;
        await persistParameterEdit(next.messageId, next.artifact);
      }
    } finally {
      writeInFlightRef.current = false;
    }
  }, [persistParameterEdit]);

  const changeParameters = useCallback(
    (nextParameters: Parameter[]) => {
      if (!baseCodeRef.current || activePreview?.type !== 'artifact') return;
      let nextCode = baseCodeRef.current;
      for (const parameter of nextParameters) {
        nextCode = updateParameter(nextCode, parameter);
      }
      setParameters(nextParameters);
      const updatedArtifact: ParametricArtifact = {
        ...activePreview.artifact,
        code: nextCode,
      };
      setActivePreview({
        ...activePreview,
        artifact: updatedArtifact,
      });
      // Skip the DB write while a stream is landing on this branch —
      // `handleToolOutput` owns the row's parts during a stream and would
      // clobber (or be clobbered by) a concurrent parameter write. The live
      // preview above still updates regardless.
      if (!isChatStreaming) {
        pendingWriteRef.current = {
          messageId: activePreview.messageId,
          artifact: updatedArtifact,
        };
        void drainParameterWrites();
      }
    },
    [activePreview, isChatStreaming, drainParameterWrites],
  );

  const updatePrivacy = useCallback(
    (privacy: 'public' | 'private') => {
      updateConversation?.({ ...conversation, privacy });
    },
    [conversation, updateConversation],
  );

  // Latest preview in the *persisted* branch — used as the share-popover
  // fallback before the user has clicked any artifact and before any
  // streaming completes (ChatSession's onToolCall auto-switches once a
  // fresher preview arrives, which updates activePreview directly).
  const persistedLatestPreview = useMemo(
    () => findLatestPreview(initialBranch),
    [initialBranch],
  );
  const sharePreview = activePreview ?? persistedLatestPreview;

  const hasArtifact =
    activePreview?.type === 'artifact' && parameters.length > 0;

  // `useCachedAiChat` captures `initialBranch` once at Chat construction;
  // if the messages query hasn't completed its first fetch yet the
  // branch is `[]` and the Chat gets locked in empty for this
  // conversation. Hold the render at a spinner until the messages query
  // settles so the Chat is constructed with the real branch on its
  // first frame.
  if (!areMessagesFetched) {
    return (
      <div className="flex h-full w-full items-center justify-center bg-adam-bg-secondary-dark text-adam-text-primary">
        <Loader2 className="h-10 w-10 animate-spin" />
      </div>
    );
  }

  return (
    <ConversationView
      hasParameters={hasArtifact}
      mobilePreviewKey={
        activePreview
          ? activePreview.type === 'artifact'
            ? `artifact:${activePreview.messageId}`
            : `mesh:${activePreview.messageId}:${activePreview.meshId}`
          : null
      }
      mobilePreviewVersion={mobilePreviewVersion}
      chatPanelSlot={
        <>
          {/* `pl-12` reserves space for the rotated "Chat" expand button
              that sits in the left gutter when the chat panel is collapsed,
              so the title and share button don't get covered. */}
          <div className="flex w-full items-center justify-between bg-transparent p-3 md:pl-12">
            <div className="flex min-w-0 flex-1 items-center space-x-2">
              <div className="min-w-0 flex-1">
                <ChatTitle
                  activeMeshId={
                    sharePreview?.type === 'mesh'
                      ? sharePreview.meshId
                      : undefined
                  }
                  activeOpenscadCode={
                    sharePreview?.type === 'artifact'
                      ? sharePreview.artifact.code
                      : undefined
                  }
                />
              </div>
            </div>
            <div className="hidden items-center gap-3 md:flex">
              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    variant="ghost"
                    className="flex h-8 items-center gap-2 rounded-full px-3 text-adam-text-primary hover:bg-adam-neutral-950 hover:text-adam-neutral-10 focus-visible:ring-0"
                  >
                    <Share className="h-[14px] w-[14px] min-w-[14px]" />
                    <span>Share</span>
                  </Button>
                </PopoverTrigger>
                <PopoverContent
                  align="end"
                  className="w-72 rounded-xl bg-adam-background-1 p-3"
                >
                  <ShareContent
                    conversationId={conversation.id}
                    privacy={conversation.privacy}
                    onPrivacyChange={updatePrivacy}
                    meshId={
                      sharePreview?.type === 'mesh'
                        ? sharePreview.meshId
                        : undefined
                    }
                    openscadCode={
                      sharePreview?.type === 'artifact'
                        ? sharePreview.artifact.code
                        : undefined
                    }
                  />
                </PopoverContent>
              </Popover>
            </div>
            <div className="flex items-center gap-3 md:hidden">
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 bg-transparent p-0 hover:bg-transparent"
                onClick={() => {
                  navigate({ to: '/' });
                }}
                aria-label="New Creation"
              >
                <CreateIcon className="h-5 w-5 text-adam-text-primary" />
              </Button>
            </div>
          </div>

          <ChatSession
            conversation={conversation}
            dbMessages={dbMessages as Message[]}
            initialBranch={initialBranch}
            model={model}
            setModel={updateSelectedModel}
            isDisabled={totalTokens <= 0}
            onSendParts={handleSendParts}
            onRetry={handleRetry}
            onEdit={handleEdit}
            onRestore={handleRestore}
            onSelectLeaf={handleSelectLeaf}
            branchForLeaf={branchForLeaf}
            onToolOutput={handleToolOutput}
            onChangeRating={handleChangeRating}
            onViewArtifact={handleViewArtifact}
            onViewMesh={handleViewMesh}
            onLoadingChange={setIsChatStreaming}
          />
        </>
      }
      previewSlot={
        <div className="flex h-full w-full items-center justify-center bg-adam-neutral-700">
          {isChatStreaming ? (
            <Loader showLoadingText />
          ) : activePreview?.type === 'artifact' ? (
            <OpenSCADPreview
              scadCode={activePreview.artifact.code}
              color="#00A6FF"
              onOutputChange={setCurrentOutput}
              onDxfExportChange={handleDxfExporterChange}
            />
          ) : activePreview?.type === 'mesh' ? (
            <MeshPreview meshId={activePreview.meshId} />
          ) : (
            <div className="text-sm text-adam-text-secondary">
              Send a message to start creating
            </div>
          )}
        </div>
      }
      mobilePreviewSlot={
        <div className="flex h-full w-full items-center justify-center bg-adam-bg-secondary-dark">
          {isChatStreaming ? (
            <Loader showLoadingText />
          ) : activePreview?.type === 'artifact' ? (
            <OpenSCADPreview
              scadCode={activePreview.artifact.code}
              color="#00A6FF"
              onOutputChange={setCurrentOutput}
              onDxfExportChange={handleDxfExporterChange}
              isMobile={true}
              backgroundColor="#212121"
            />
          ) : activePreview?.type === 'mesh' ? (
            <MeshPreview meshId={activePreview.meshId} />
          ) : (
            <div className="text-sm text-adam-text-secondary">
              Send a message to start creating
            </div>
          )}
        </div>
      }
      parametersSlot={
        <div className="relative h-full">
          <ParameterSection
            parameters={parameters}
            onParameterChange={changeParameters}
            currentOutput={currentOutput}
            dxfExporter={dxfExporter}
            code={
              activePreview?.type === 'artifact'
                ? activePreview.artifact.code
                : undefined
            }
          />
        </div>
      }
      mobileParametersSlot={
        <ParameterSheetContent
          parameters={parameters}
          onParameterChange={changeParameters}
          currentOutput={currentOutput}
          dxfExporter={dxfExporter}
          code={
            activePreview?.type === 'artifact'
              ? activePreview.artifact.code
              : undefined
          }
        />
      }
    />
  );
}

/**
 * Derive the parameter list from the live artifact code, but anchor each
 * parameter's `defaultValue` to the model's original source when we have it.
 *
 * Without this, a parameter edit (which rewrites `name = value;` in the live
 * code) would also become the parsed `defaultValue` on the next reload —
 * making "Reset all parameters" a no-op and letting auto-computed slider
 * ranges drift. `originalCode` is the model's first-authored OpenSCAD, stored
 * in message metadata; values still track the edited code, defaults track the
 * original. Falls back to the live code (legacy behavior) for older messages
 * that predate the stash.
 */
function mergeParameterDefaults(
  code: string,
  originalCode: string | undefined,
): Parameter[] {
  const parameters = parseParameters(code);
  if (!originalCode || originalCode === code) return parameters;
  const defaults = new Map(
    parseParameters(originalCode).map((param) => [
      param.name,
      param.defaultValue,
    ]),
  );
  return parameters.map((param) =>
    defaults.has(param.name)
      ? { ...param, defaultValue: defaults.get(param.name)! }
      : param,
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
