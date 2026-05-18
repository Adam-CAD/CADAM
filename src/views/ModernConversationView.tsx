import { ModernMessageBubble } from '@/components/chat/ModernMessageBubble';
import { ChatTitle } from '@/components/chat/ChatTitle';
import { ParameterSection } from '@/components/parameter/ParameterSection';
import TextAreaChat from '@/components/TextAreaChat';
import { Button } from '@/components/ui/button';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { ScrollArea } from '@/components/ui/scroll-area';
import { ShareContent } from '@/components/ui/ShareContent';
import { OpenSCADPreview } from '@/components/viewer/OpenSCADViewer';
import { MeshPreview } from '@/components/viewer/MeshPreview';
import { useAuth } from '@/contexts/AuthContext';
import { useConversation } from '@/contexts/ConversationContext';
import { useCachedAiChat } from '@/hooks/useCachedAiChat';
import { useOpenSCAD } from '@/hooks/useOpenSCAD';
import { apiUrl } from '@/services/api';
import {
  useChangeRatingMutation,
  useMessagesQuery,
  useRestoreMessageMutation,
  useUpscaleMutation,
} from '@/services/messageService';
import {
  ensureInputRecords,
  messageRowToModernMessage,
  messageRowToUIMessage,
  type ModernChatMessage,
} from '@/lib/aiMessages';
import { cn, updateParameter } from '@/lib/utils';
import { supabase } from '@/lib/supabase';
import { generatePreview } from '@/utils/meshUtils';
import type { DxfExporter } from '@/utils/downloadUtils';
import { useQueryClient } from '@tanstack/react-query';
import { useChat } from '@ai-sdk/react';
import {
  DefaultChatTransport,
  lastAssistantMessageIsCompleteWithToolCalls,
} from 'ai';
import Tree from '@shared/Tree';
import type { AppUIMessage } from '@shared/chatAi';
import { isParametricArtifact } from '@shared/parametricParts';
import type { Model, Parameter, ParametricArtifact } from '@shared/types';
import { ChevronsRight, Share } from 'lucide-react';
import posthog from 'posthog-js';
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  type ImperativePanelHandle,
  Panel,
  PanelGroup,
  PanelResizeHandle,
} from 'react-resizable-panels';

const PANEL_SIZES = {
  CHAT: { DEFAULT: 30, MIN: 384, MAX: 550 },
  PREVIEW: { DEFAULT: 45, MIN: 20 },
  PARAMETERS: { DEFAULT: 30, MIN: 320, MAX: 384 },
} as const;

type ActivePreview =
  | { type: 'artifact'; messageId: string; artifact: ParametricArtifact }
  | { type: 'mesh'; messageId: string; meshId: string }
  | null;

export function ModernConversationView() {
  const { conversation, updateConversation, updateConversationAsync } =
    useConversation();
  const { user, billing } = useAuth();
  const queryClient = useQueryClient();
  const totalTokens = billing?.tokens.total ?? 0;
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
  // `dxfExporter` is itself a function, so we MUST use the lazy-set form when
  // OpenSCADPreview hands us a new exporter — `setDxfExporter(exporter)` would
  // make React treat `exporter` as an updater and call it immediately
  // (firing exportScad / writeFile, which pile pending requests onto the
  // worker that then get rejected as "Worker terminated" on the next cleanup).
  const handleDxfExporterChange = useCallback(
    (exporter: DxfExporter | null) => {
      setDxfExporter(() => exporter);
    },
    [],
  );
  const baseCodeRef = useRef<string | null>(null);
  const parentByIdRef = useRef<Map<string, string | null>>(new Map());
  const handledToolCallsRef = useRef<Set<string>>(new Set());
  // Track which `latestPreview` key we've already auto-applied so the auto-
  // switch only fires when a fresh assistant preview appears — not every time
  // the user clicks an older artifact and pings `activePreview` state.
  const lastAutoAppliedPreviewKeyRef = useRef<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const chatPanelRef = useRef<ImperativePanelHandle>(null);
  const parametersPanelRef = useRef<ImperativePanelHandle>(null);
  const [containerWidth, setContainerWidth] = useState(0);
  const resizeObserverRef = useRef<ResizeObserver | null>(null);
  const [isChatCollapsed, setIsChatCollapsed] = useState(false);
  const [isParametersCollapsed, setIsParametersCollapsed] = useState(false);
  const { exportScad } = useOpenSCAD();

  // Reset per-conversation state when the conversation switches. We do this
  // imperatively rather than via `key={conversation.id}` on this component
  // because keying causes TanStack Router's lazy Outlet to discard and rebuild
  // the entire subtree after hydration, producing a third mount cycle and
  // WebGL context churn in the 3D viewer.
  const prevConversationIdRef = useRef(conversation.id);
  useEffect(() => {
    if (prevConversationIdRef.current === conversation.id) return;
    prevConversationIdRef.current = conversation.id;
    setActivePreview(null);
    setParameters([]);
    setCurrentOutput(undefined);
    setDxfExporter(() => null);
    setIsChatCollapsed(false);
    setIsParametersCollapsed(false);
    baseCodeRef.current = null;
    parentByIdRef.current = new Map();
    handledToolCallsRef.current = new Set();
    lastAutoAppliedPreviewKeyRef.current = null;
  }, [conversation.id]);

  const setContainerRef = useCallback((element: HTMLDivElement | null) => {
    resizeObserverRef.current?.disconnect();
    resizeObserverRef.current = null;
    if (!element) return;
    setContainerWidth(element.offsetWidth);
    const observer = new ResizeObserver(() => {
      setContainerWidth(element.offsetWidth);
    });
    observer.observe(element);
    resizeObserverRef.current = observer;
  }, []);

  useEffect(
    () => () => {
      resizeObserverRef.current?.disconnect();
    },
    [],
  );

  const chatPanelSizes = useMemo(() => {
    if (containerWidth === 0)
      return { defaultSize: 30, minSize: 0, maxSize: 100 };
    const minSize = (PANEL_SIZES.CHAT.MIN / containerWidth) * 100;
    const maxSize = (PANEL_SIZES.CHAT.MAX / containerWidth) * 100;
    const defaultSize = Math.min(
      Math.max(PANEL_SIZES.CHAT.DEFAULT, minSize),
      maxSize,
    );
    return { defaultSize, minSize, maxSize };
  }, [containerWidth]);

  const parametersPanelSizes = useMemo(() => {
    if (containerWidth === 0)
      return { defaultSize: 25, minSize: 15, maxSize: 30 };
    const chatMinPixels = PANEL_SIZES.CHAT.MIN;
    const previewMinPixels = (PANEL_SIZES.PREVIEW.MIN / 100) * containerWidth;
    const availableForParameters =
      containerWidth - chatMinPixels - previewMinPixels;
    const maxPixelsAvailable = Math.min(
      PANEL_SIZES.PARAMETERS.MAX,
      availableForParameters,
    );
    const minSize = (PANEL_SIZES.PARAMETERS.MIN / containerWidth) * 100;
    const maxSize = (maxPixelsAvailable / containerWidth) * 100;
    const defaultSize = Math.min(
      Math.max(PANEL_SIZES.PARAMETERS.DEFAULT, minSize),
      maxSize,
    );
    return { defaultSize, minSize, maxSize };
  }, [containerWidth]);

  const { data: dbMessages = [] } = useMessagesQuery();
  const dbTree = useMemo(() => new Tree(dbMessages), [dbMessages]);
  const selectedLeafId =
    conversation.current_message_leaf_id ?? dbMessages.at(-1)?.id ?? '';
  const selectedBranch = useMemo(
    () => dbTree.getPath(selectedLeafId).map(messageRowToUIMessage),
    [dbTree, selectedLeafId],
  );
  const selectedBranchKey = selectedBranch
    .map((message) => message.id)
    .join(':');

  const authHeaders = useCallback(async (): Promise<Record<string, string>> => {
    const token = (await supabase.auth.getSession()).data.session?.access_token;
    return token ? { Authorization: `Bearer ${token}` } : {};
  }, []);

  useEffect(() => {
    for (const message of dbMessages) {
      parentByIdRef.current.set(message.id, message.parent_message_id);
    }
  }, [dbMessages]);

  const transport = useMemo(
    () =>
      new DefaultChatTransport<AppUIMessage>({
        api: apiUrl(
          conversation.type === 'creative'
            ? 'creative-chat'
            : 'parametric-chat',
        ),
        body: { conversationId: conversation.id, model },
        headers: authHeaders,
      }),
    [authHeaders, conversation.id, conversation.type, model],
  );

  const chat = useCachedAiChat({
    id: conversation.id,
    generateId: () => crypto.randomUUID(),
    messages: selectedBranch,
    transport,
    sendAutomaticallyWhen: lastAssistantMessageIsCompleteWithToolCalls,
    onError: (error) => {
      console.error('[chat]', error);
    },
    onFinish: ({ message }) => {
      if (message?.id) {
        updateConversation?.({
          ...conversation,
          current_message_leaf_id: message.id,
        });
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
  });

  const {
    messages,
    setMessages,
    sendMessage,
    regenerate,
    addToolOutput,
    status,
    stop,
  } = useChat<AppUIMessage>({ chat });

  const isLoading = status === 'submitted' || status === 'streaming';

  useEffect(() => {
    if (isLoading) return;
    const currentKey = messages.map((message) => message.id).join(':');
    if (selectedBranchKey && currentKey !== selectedBranchKey) {
      setMessages(selectedBranch);
    }
  }, [isLoading, messages, selectedBranch, selectedBranchKey, setMessages]);

  // Merge the two sources without coercing either to look like the other.
  //
  //  * `useChat.messages` is the source of truth for live `parts`/`metadata`
  //    while a turn is streaming.
  //  * `dbMessages` (from useMessagesQuery) is the source of truth for the
  //    persisted columns — `rating`, `created_at`, `conversation_id`,
  //    `parent_message_id`, plus the post-onFinish version of `parts`.
  //
  // For each id, take parts/metadata from the active stream if it's present
  // there, and take rating/created_at/conversation_id from the DB row. That
  // way a thumbs-up optimistic update on the DB cache stays visible — the
  // old code coerced active messages into rating: 0, clobbering the change.
  const treeMessages = useMemo(() => {
    const dbById = new Map<string, ModernChatMessage>();
    for (const row of dbMessages) {
      dbById.set(row.id, messageRowToModernMessage(row));
    }

    const merged = new Map<string, ModernChatMessage>();

    // Seed with DB rows so messages that aren't in the active stream
    // (older turns, alternate branches) still appear.
    for (const [id, row] of dbById) {
      merged.set(id, row);
    }

    // Overlay active stream messages — they own the live `parts`/`metadata`
    // but we preserve the DB row's persisted columns.
    for (let i = 0; i < messages.length; i += 1) {
      const active = messages[i];
      const dbRow = dbById.get(active.id);
      const parentMessageId =
        parentByIdRef.current.get(active.id) ??
        dbRow?.parent_message_id ??
        (i === 0 ? null : messages[i - 1].id);
      parentByIdRef.current.set(active.id, parentMessageId);

      merged.set(active.id, {
        ...active,
        parent_message_id: parentMessageId,
        ...(dbRow
          ? {
              conversation_id: dbRow.conversation_id,
              created_at: dbRow.created_at,
              rating: dbRow.rating,
              ...(dbRow.isLegacy
                ? { isLegacy: true, legacyContent: dbRow.legacyContent }
                : {}),
            }
          : { conversation_id: conversation.id }),
      });
    }

    return Array.from(merged.values());
  }, [dbMessages, messages, conversation.id]);

  const messageTree = useMemo(() => new Tree(treeMessages), [treeMessages]);
  const activeLeafId =
    messages.at(-1)?.id ?? conversation.current_message_leaf_id ?? '';
  const currentBranch = useMemo(
    () => messageTree.getPath(activeLeafId),
    [messageTree, activeLeafId],
  );

  useEffect(() => {
    const viewport = scrollRef.current?.querySelector(
      '[data-radix-scroll-area-viewport]',
    );
    if (viewport) viewport.scrollTop = viewport.scrollHeight;
  }, [currentBranch, isLoading]);

  const latestPreview = useMemo(() => findLatestPreview(messages), [messages]);

  // Auto-switch the preview panel to the newest assistant output ONLY when a
  // genuinely new preview lands. `activePreview` deliberately is NOT a dep
  // here — including it caused the panel to snap back to the latest preview
  // whenever the user clicked an older message's Eye button.
  useEffect(() => {
    if (!latestPreview) return;
    const key = `${latestPreview.type}:${latestPreview.messageId}:${
      latestPreview.type === 'artifact'
        ? latestPreview.artifact.code.length
        : latestPreview.meshId
    }`;
    if (lastAutoAppliedPreviewKeyRef.current === key) return;
    lastAutoAppliedPreviewKeyRef.current = key;
    setActivePreview(latestPreview);
    if (latestPreview.type === 'artifact') {
      baseCodeRef.current = latestPreview.artifact.code;
      setParameters(latestPreview.artifact.parameters);
    }
    setCurrentOutput(undefined);
    setDxfExporter(null);
  }, [latestPreview]);

  // Drive parameters panel visibility from artifact presence — match old
  // ParametricView pattern so the panel collapses to 0 when there's no
  // artifact and expands when one arrives.
  const hasArtifact =
    activePreview?.type === 'artifact' && parameters.length > 0;
  useLayoutEffect(() => {
    const panel = parametersPanelRef.current;
    if (!panel) return;
    if (hasArtifact) {
      panel.expand();
      setIsParametersCollapsed(false);
    } else {
      panel.collapse();
    }
  }, [hasArtifact]);

  const handleChatCollapse = useCallback(() => {
    chatPanelRef.current?.collapse();
    setIsChatCollapsed(true);
  }, []);
  const handleChatExpand = useCallback(() => {
    chatPanelRef.current?.expand();
    setIsChatCollapsed(false);
  }, []);
  const handleParametersCollapse = useCallback(() => {
    parametersPanelRef.current?.collapse();
    setIsParametersCollapsed(true);
  }, []);
  const handleParametersExpand = useCallback(() => {
    parametersPanelRef.current?.expand();
    setIsParametersCollapsed(false);
  }, []);

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

  const sendPayload = useCallback(
    async (parts: AppUIMessage['parts'], parentMessageId?: string | null) => {
      if (!user?.id) return;
      await ensureInputRecords({
        parts,
        conversationId: conversation.id,
        userId: user.id,
      });
      if (parts.length === 0) return;

      const parentId =
        parentMessageId === undefined
          ? (messages.at(-1)?.id ?? null)
          : parentMessageId;
      const userMessageId = crypto.randomUUID();
      parentByIdRef.current.set(userMessageId, parentId);

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

      await sendMessage(
        { id: userMessageId, parts, metadata: { model } },
        {
          headers: await authHeaders(),
          body: {
            conversationId: conversation.id,
            model,
            parentMessageId: parentId,
          },
        },
      );
    },
    [
      authHeaders,
      conversation.id,
      conversation.type,
      messages,
      model,
      sendMessage,
      user?.id,
    ],
  );

  const editUserText = useCallback(
    async (message: ModernChatMessage, text: string) => {
      const parentId = message.parent_message_id;
      const parentPath = parentId
        ? messageTree.getPath(parentId).map((branchMessage) => ({
            id: branchMessage.id,
            role: branchMessage.role,
            metadata: branchMessage.metadata,
            parts: branchMessage.parts,
          }))
        : [];
      setMessages(parentPath);
      await sendPayload([{ type: 'text', text }], parentId);
    },
    [messageTree, sendPayload, setMessages],
  );

  const { mutate: changeRating } = useChangeRatingMutation({
    conversationId: conversation.id,
  });
  const { mutate: restoreMessageMutation } = useRestoreMessageMutation({
    conversation,
    updateConversationAsync,
  });
  const { mutate: upscaleMesh } = useUpscaleMutation({
    conversation,
    updateConversationAsync,
  });

  const retryFromAssistant = useCallback(
    async (assistant: ModernChatMessage, nextModel: Model) => {
      // Re-generate this assistant turn as a NEW sibling of the existing one.
      //
      // Using the AI SDK's `regenerate({ messageId })` instead of crafting a
      // new sendMessage call is what produces a real branch:
      //
      //   1. The SDK truncates the local chat state to just before the
      //      assistant message being regenerated.
      //   2. It POSTs the truncated messages to our chat endpoint with
      //      `trigger: 'regenerate-message'`. The user message that produced
      //      the original assistant is still the last item in the array.
      //   3. The server streams a fresh assistant response. Our onFinish
      //      writes it as a new row with `parent_message_id` = the user
      //      message's id — exactly the parent the original assistant has.
      //   4. dbMessages now contains two assistants with the same parent,
      //      so `messageTree` exposes them as siblings and BranchNavigation
      //      lights up.
      //
      // (Previously we were calling `sendPayload(parent.parts, grandparentId)`
      // which appended a new user message at the grandparent — that creates
      // a separate user-message branch, not an assistant sibling, so the
      // branch arrows never appeared.)
      // The user message that produced this assistant turn — used here only
      // as a guard (we need it to exist to retry). We deliberately DO NOT
      // pass it as `parentMessageId` in the request body: on regenerate the
      // user message IS the last item in the SDK-truncated message array,
      // and the server's user-upsert path would clobber its
      // `parent_message_id` with whatever we send — producing a self-cycle
      // (parent_message_id === id) and locking the chat tree into an
      // infinite getPath() loop on the next render.
      const parentId = assistant.parent_message_id;
      if (!parentId) return;
      if (nextModel !== model) {
        updateSelectedModel(nextModel);
      }
      const token = (await supabase.auth.getSession()).data.session
        ?.access_token;
      await regenerate({
        messageId: assistant.id,
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        body: {
          conversationId: conversation.id,
          model: nextModel,
        },
      });
    },
    [conversation.id, model, regenerate, updateSelectedModel],
  );

  const selectLeaf = useCallback(
    (messageId: string) => {
      updateConversation?.({
        ...conversation,
        current_message_leaf_id: messageId,
      });
    },
    [conversation, updateConversation],
  );

  const showArtifact = useCallback(
    (artifact: ParametricArtifact, messageId = '') => {
      baseCodeRef.current = artifact.code;
      setParameters(artifact.parameters);
      setCurrentOutput(undefined);
      setDxfExporter(null);
      setActivePreview({ type: 'artifact', messageId, artifact });
    },
    [],
  );

  const showMesh = useCallback((meshId: string, messageId = '') => {
    setCurrentOutput(undefined);
    setDxfExporter(null);
    setActivePreview({ type: 'mesh', messageId, meshId });
  }, []);

  const changeParameters = useCallback(
    (nextParameters: Parameter[]) => {
      if (!baseCodeRef.current || activePreview?.type !== 'artifact') return;
      let nextCode = baseCodeRef.current;
      for (const parameter of nextParameters) {
        nextCode = updateParameter(nextCode, parameter);
      }
      setParameters(nextParameters);
      setActivePreview({
        ...activePreview,
        artifact: {
          ...activePreview.artifact,
          code: nextCode,
          parameters: nextParameters,
        },
      });
    },
    [activePreview],
  );

  const updatePrivacy = useCallback(
    (privacy: 'public' | 'private') => {
      updateConversation?.({ ...conversation, privacy });
    },
    [conversation, updateConversation],
  );

  useEffect(() => {
    for (const message of messages) {
      for (const part of message.parts) {
        if (
          part.type !== 'tool-build_parametric_model' ||
          part.state !== 'input-available' ||
          handledToolCallsRef.current.has(part.toolCallId)
        ) {
          continue;
        }

        handledToolCallsRef.current.add(part.toolCallId);

        const artifact = isParametricArtifact(part.input) ? part.input : null;
        if (!artifact) {
          addToolOutput({
            state: 'output-error',
            tool: 'build_parametric_model',
            toolCallId: part.toolCallId,
            errorText: 'CAD tool input was not a valid OpenSCAD artifact.',
          });
          continue;
        }

        exportScad(artifact.code, 'stl')
          .then(async (stl) => {
            let previewPath: string | undefined;
            try {
              if (user?.id) {
                const previewDataUrl = await generatePreview(stl, 'stl');
                const previewBlob = await fetch(previewDataUrl).then(
                  (response) => response.blob(),
                );
                previewPath = `${user.id}/${conversation.id}/preview-${part.toolCallId}`;
                await supabase.storage
                  .from('images')
                  .upload(previewPath, previewBlob, {
                    contentType: 'image/png',
                    upsert: true,
                  });
              }
            } catch (error) {
              console.warn('Failed to upload OpenSCAD preview:', error);
            }

            addToolOutput({
              tool: 'build_parametric_model',
              toolCallId: part.toolCallId,
              output: {
                status: 'success',
                message:
                  'Compilation successful. The 3D model is now displayed to the user.',
                previewPath,
              },
            });
          })
          .catch((error) => {
            addToolOutput({
              state: 'output-error',
              tool: 'build_parametric_model',
              toolCallId: part.toolCallId,
              errorText: `Compilation failed:\n${error instanceof Error ? error.message : String(error)}`,
            });
          });
      }
    }
  }, [addToolOutput, conversation.id, exportScad, messages, user?.id]);

  const sharePreview = activePreview ?? latestPreview;

  return (
    <div
      className="flex h-full w-full overflow-hidden bg-[#292828]"
      ref={setContainerRef}
    >
      <PanelGroup
        direction="horizontal"
        className="h-full w-full"
        autoSaveId="editor-panels"
      >
        <Panel
          collapsible
          ref={chatPanelRef}
          defaultSize={chatPanelSizes.defaultSize}
          minSize={chatPanelSizes.minSize}
          maxSize={chatPanelSizes.maxSize}
          id="chat-panel"
          order={0}
        >
          <div className="relative flex h-full min-w-0 flex-col border-r border-adam-neutral-700 bg-adam-bg-secondary-dark">
            {/* `pl-12` reserves space for the rotated "Chat" expand button
                that sits in the left gutter when the chat panel is collapsed,
                so the title and share button don't get covered. Mirrors
                legacy ChatSection's header padding. */}
            <div className="flex w-full items-center justify-between bg-transparent p-3 pl-12">
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
              <div className="flex items-center gap-3">
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
            </div>

            <ScrollArea className="min-h-0 flex-1 p-4" ref={scrollRef}>
              <div className="mx-auto flex max-w-3xl flex-col gap-4">
                {currentBranch.map((message, index) => {
                  const isLastMessage = index === currentBranch.length - 1;
                  return (
                    <ModernMessageBubble
                      key={message.id}
                      message={message}
                      isLoading={isLoading}
                      isLastMessage={isLastMessage}
                      currentModel={model}
                      onSelectLeaf={selectLeaf}
                      onEditUserText={
                        message.role === 'user' ? editUserText : undefined
                      }
                      onViewArtifact={(artifact) =>
                        showArtifact(artifact, message.id)
                      }
                      onViewMesh={(meshId) => showMesh(meshId, message.id)}
                      onChangeRating={
                        message.role === 'assistant'
                          ? (rating) =>
                              changeRating({
                                messageId: message.id,
                                rating,
                              })
                          : undefined
                      }
                      onRetry={
                        message.role === 'assistant'
                          ? (nextModel) =>
                              void retryFromAssistant(message, nextModel)
                          : undefined
                      }
                      onRestore={
                        message.role === 'assistant' && !isLastMessage
                          ? () =>
                              restoreMessageMutation({
                                message: {
                                  role: 'assistant',
                                  parts: JSON.parse(
                                    JSON.stringify(message.parts),
                                  ),
                                  metadata: JSON.parse(
                                    JSON.stringify(message.metadata ?? {}),
                                  ),
                                  parent_message_id: message.parent_message_id,
                                },
                              })
                          : undefined
                      }
                      onUpscale={
                        message.role === 'assistant'
                          ? (meshId) =>
                              upscaleMesh({
                                meshId,
                                parentMessageId: message.parent_message_id,
                              })
                          : undefined
                      }
                    />
                  );
                })}
              </div>
            </ScrollArea>

            <div className="shrink-0 p-4">
              <TextAreaChat
                type={conversation.type}
                onSubmit={(parts) => void sendPayload(parts)}
                placeholder="Keep iterating with Adam..."
                isLoading={isLoading}
                stopGenerating={stop}
                disabled={totalTokens <= 0}
                model={model}
                setModel={updateSelectedModel}
                conversation={conversation}
              />
            </div>
          </div>
        </Panel>

        <PanelResizeHandle className="resize-handle group relative">
          {!isChatCollapsed && (
            <div className="absolute left-1 top-1/2 z-50 -translate-y-1/2 opacity-0 transition-opacity duration-200 group-hover:opacity-100">
              <Button
                variant="ghost"
                className="rounded-l-none rounded-r-lg border-b border-r border-t border-gray-200/20 bg-adam-bg-secondary-dark p-2 text-adam-text-primary transition-colors [@media(hover:hover)]:hover:bg-adam-neutral-950 [@media(hover:hover)]:hover:text-adam-neutral-10"
                onClick={handleChatCollapse}
              >
                <ChevronsRight className="h-5 w-5 rotate-180" />
              </Button>
            </div>
          )}
          {isChatCollapsed && (
            <div className="absolute left-0 top-1/2 z-50 -translate-y-1/2">
              <Button
                aria-label="Expand chat panel"
                onClick={handleChatExpand}
                className="flex h-[100px] w-9 flex-col items-center rounded-l-none rounded-r-lg bg-adam-bg-secondary-dark px-1.5 py-2 text-adam-text-primary"
              >
                <ChevronsRight className="h-5 w-5 text-white" />
                <div className="flex flex-1 items-center justify-center">
                  <span className="rotate-90 transform text-center text-base font-semibold text-white">
                    Chat
                  </span>
                </div>
              </Button>
            </div>
          )}
        </PanelResizeHandle>

        <Panel
          defaultSize={
            PANEL_SIZES.PREVIEW.DEFAULT +
            (hasArtifact ? 0 : parametersPanelSizes.defaultSize)
          }
          minSize={
            PANEL_SIZES.PREVIEW.MIN +
            (hasArtifact ? 0 : parametersPanelSizes.minSize)
          }
          id="preview-panel"
          order={1}
        >
          <div className="flex h-full w-full items-center justify-center bg-adam-neutral-700">
            {activePreview?.type === 'artifact' ? (
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
        </Panel>

        {/* Parameter panel mount stays stable; collapses to 0 when no artifact
            so react-resizable-panels doesn't reshuffle. Mirrors the legacy
            ParametricView pattern verbatim. */}
        <PanelResizeHandle
          disabled={!hasArtifact}
          className={cn(
            'resize-handle group relative',
            !hasArtifact && 'pointer-events-none !w-0 before:hidden',
          )}
        >
          {hasArtifact && !isParametersCollapsed && (
            <div className="absolute right-1 top-1/2 z-50 -translate-y-1/2 opacity-0 transition-opacity duration-200 group-hover:opacity-100">
              <Button
                variant="ghost"
                className="rounded-l-lg rounded-r-none border-b border-l border-t border-gray-200/20 bg-adam-bg-secondary-dark p-2 text-adam-text-primary transition-colors [@media(hover:hover)]:hover:bg-adam-neutral-950 [@media(hover:hover)]:hover:text-adam-neutral-10"
                onClick={handleParametersCollapse}
              >
                <ChevronsRight className="h-5 w-5" />
              </Button>
            </div>
          )}
          {hasArtifact && isParametersCollapsed && (
            <div className="absolute right-0 top-1/2 z-50 -translate-y-1/2">
              <Button
                aria-label="Expand parameters panel"
                onClick={handleParametersExpand}
                className="flex h-[140px] w-9 flex-col items-center rounded-l-lg rounded-r-none bg-adam-bg-secondary-dark p-2 px-1.5 py-2 text-adam-text-primary"
              >
                <ChevronsRight className="mb-3 h-5 w-5 rotate-180 text-white" />
                <div className="flex flex-1 items-center justify-center">
                  <span className="min-w-[100px] -rotate-90 transform text-center text-base font-semibold text-white">
                    Parameters
                  </span>
                </div>
              </Button>
            </div>
          )}
        </PanelResizeHandle>

        <Panel
          collapsible
          collapsedSize={0}
          ref={parametersPanelRef}
          defaultSize={parametersPanelSizes.defaultSize}
          minSize={parametersPanelSizes.minSize}
          maxSize={parametersPanelSizes.maxSize}
          id="parameters-panel"
          order={2}
        >
          {hasArtifact && (
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
          )}
        </Panel>
      </PanelGroup>
    </div>
  );
}

function findLatestPreview(messages: AppUIMessage[]): ActivePreview {
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
