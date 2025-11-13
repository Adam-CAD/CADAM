import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Message } from '@shared/types';
import { useConversation } from '@/services/conversationService';
import { useCurrentMessage } from '@/contexts/CurrentMessageContext';
import { useMessagesQuery } from '@/services/messageService';
import Tree from '@shared/Tree';
import {
  ImperativePanelHandle,
  Panel,
  PanelGroup,
  PanelResizeHandle,
} from 'react-resizable-panels';
import { ChatSection } from '@/components/chat/ChatSection';
import { Button } from '@/components/ui/button';
import { ChevronsRight } from 'lucide-react';
import { ViewerSection } from '@/components/viewer/ViewerSection';
import { ParameterSection } from '@/components/parameter/ParameterSection';
import { useBlob } from '@/contexts/BlobContext';
import { useColor } from '@/contexts/ColorContext';
import { OpenSCADCodeEditor } from '@/components/code/OpenSCADCodeEditor';
import { useSettings } from '@/contexts/SettingsContext';
import { Textarea } from '@/components/ui/textarea';

const PANEL_SIZES = {
  CHAT: {
    DEFAULT: 30,
    MIN: 384,
    MAX: 550,
  },
  PREVIEW: {
    DEFAULT: 45,
    MIN: 20,
  },
  PARAMETERS: {
    DEFAULT: 30,
    MIN: 320,
    MAX: 384,
  },
} as const;

export function ParametricEditor() {
  const { conversation } = useConversation();
  const { currentMessage, setCurrentMessage } = useCurrentMessage();
  const { setBlob } = useBlob();
  const { setColor } = useColor();
  const { useExperimentalEditor } = useSettings();
  const [isParametersPanelCollapsed, setIsParametersPanelCollapsed] =
    useState(false);
  const [isChatCollapsed, setIsChatCollapsed] = useState(false);
  const chatPanelRef = useRef<ImperativePanelHandle>(null);
  const parameterPanelRef = useRef<ImperativePanelHandle>(null);
  const resizeObserverRef = useRef<ResizeObserver | null>(null);
  const [containerWidth, setContainerWidth] = useState(0);
  const [code, setCode] = useState('');
  const [debouncedCode, setDebouncedCode] = useState('');
  const [isCodeDirty, setIsCodeDirty] = useState(false);

  const { data: messages = [] } = useMessagesQuery();

  const lastMessage = useMemo(() => {
    if (conversation.current_message_leaf_id) {
      return messages.find(
        (msg) => msg.id === conversation.current_message_leaf_id,
      );
    }
    return messages[messages.length - 1];
  }, [messages, conversation.current_message_leaf_id]);

  const messageTree = useMemo(() => {
    return new Tree<Message>(messages);
  }, [messages]);

  const currentMessageBranch = useMemo(() => {
    return messageTree.getPath(lastMessage?.id ?? '');
  }, [lastMessage, messageTree]);

  useEffect(() => {
    currentMessageBranch.forEach((message) => {
      if (message.id === currentMessage?.id) {
        setCurrentMessage(message);
      }
    });
  }, [currentMessageBranch, currentMessage, setCurrentMessage]);

  useEffect(() => {
    setCurrentMessage(null);
    setBlob(null);
    setColor('#00A6FF');
  }, [conversation.id, setCurrentMessage, setBlob, setColor]);

  useEffect(() => {
    if (lastMessage?.role === 'assistant') {
      setCurrentMessage(lastMessage);
    }
  }, [lastMessage, setCurrentMessage]);

  useEffect(() => {
    const nextCode = currentMessage?.content.artifact?.code ?? '';
    setCode(nextCode);
    setDebouncedCode(nextCode);
    setIsCodeDirty(false);
  }, [currentMessage?.content.artifact?.code, currentMessage?.id]);

  useEffect(() => {
    if (!isCodeDirty) return;
    const handle = setTimeout(() => {
      setDebouncedCode(code);
      setIsCodeDirty(false);
    }, 400);
    return () => clearTimeout(handle);
  }, [code, isCodeDirty]);

  // Update container width on resize
  const setContainerRef = useCallback((element: HTMLDivElement) => {
    // Initial measurement
    setContainerWidth(element.offsetWidth);

    // Create ResizeObserver to watch for container size changes
    resizeObserverRef.current = new ResizeObserver(() => {
      setContainerWidth(element.offsetWidth);
    });
    resizeObserverRef.current.observe(element);
    return () => {
      // Cleanup when element is removed
      if (resizeObserverRef.current) {
        resizeObserverRef.current.disconnect();
        resizeObserverRef.current = null;
      }
    };
  }, []);

  // Calculate panel sizes based on container width
  const chatPanelSizes = useMemo(() => {
    if (containerWidth === 0)
      return { defaultSize: 30, minSize: 0, maxSize: 100 };

    const minSize = (PANEL_SIZES.CHAT.MIN / containerWidth) * 100;
    const maxSize = (PANEL_SIZES.CHAT.MAX / containerWidth) * 100;
    const defaultSize = Math.min(
      Math.max(PANEL_SIZES.CHAT.DEFAULT, minSize),
      maxSize,
    );
    return {
      defaultSize,
      minSize,
      maxSize,
    };
  }, [containerWidth]);

  const parametersPanelSizes = useMemo(() => {
    if (containerWidth === 0)
      return { defaultSize: 25, minSize: 15, maxSize: 30 };

    // Calculate space taken by other panels at their minimums
    const chatMinPixels = PANEL_SIZES.CHAT.MIN;
    const previewMinPixels = (PANEL_SIZES.PREVIEW.MIN / 100) * containerWidth;
    const availableForParameters =
      containerWidth - chatMinPixels - previewMinPixels;

    // Use the smaller of our desired max (308px) or available space
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

    return {
      defaultSize,
      minSize,
      maxSize,
    };
  }, [containerWidth]);

  const hasArtifact = useMemo(
    () => !!currentMessage?.content.artifact,
    [currentMessage],
  );

  // Optimized collapse/expand handlers
  const handleChatCollapse = useCallback(() => {
    const panel = chatPanelRef.current;
    if (panel) {
      panel.collapse();
      setIsChatCollapsed(true);
    }
  }, []);

  const handleChatExpand = useCallback(() => {
    const panel = chatPanelRef.current;
    if (panel) {
      panel.expand();
      setIsChatCollapsed(false);
    }
  }, []);

  const handleParametersCollapse = useCallback(() => {
    const panel = parameterPanelRef.current;
    if (panel) {
      panel.collapse();
      setIsParametersPanelCollapsed(true);
    }
  }, []);

  const handleParametersExpand = useCallback(() => {
    const panel = parameterPanelRef.current;
    if (panel) {
      panel.expand();
      setIsParametersPanelCollapsed(false);
    }
  }, []);

  const handleCodeChange = useCallback((next: string) => {
    setCode(next);
    setIsCodeDirty(true);
  }, []);

  const currentCode = debouncedCode || code;

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
          <div className="relative h-full">
            <ChatSection messages={currentMessageBranch ?? []} />
          </div>
        </Panel>
        <PanelResizeHandle className="resize-handle group relative">
          {!isChatCollapsed && (
            <div className="absolute left-1 top-1/2 z-50 -translate-y-1/2 opacity-0 transition-opacity duration-200 group-hover:opacity-100">
              <Button
                variant="ghost"
                className="rounded-l-none rounded-r-lg border-b border-r border-t border-gray-200/20 bg-adam-bg-secondary-dark p-2 text-adam-text-primary transition-colors dark:border-gray-800 [@media(hover:hover)]:hover:bg-adam-neutral-950 [@media(hover:hover)]:hover:text-adam-neutral-10"
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
          <PanelGroup direction="vertical" className="h-full">
            <Panel defaultSize={35} minSize={15} id="code-editor-panel">
              <div className="h-full w-full bg-adam-bg-secondary-dark p-3">
                <div className="mb-2 flex items-center justify-between">
                  <span className="text-xs font-semibold uppercase tracking-wide text-adam-text-secondary">
                    OpenSCAD Source
                  </span>
                  {isCodeDirty && (
                    <span className="text-xs text-adam-blue">Compiling…</span>
                  )}
                </div>
                <div className="h-[calc(100%-1.5rem)] w-full">
                  {useExperimentalEditor ? (
                    <OpenSCADCodeEditor
                      value={code}
                      onChange={handleCodeChange}
                    />
                  ) : (
                    <Textarea
                      value={code}
                      onChange={(event) => handleCodeChange(event.target.value)}
                      className="h-full min-h-[240px] resize-none rounded-md border border-adam-neutral-800 bg-adam-neutral-950 font-mono text-xs text-adam-text-primary"
                    />
                  )}
                </div>
              </div>
            </Panel>
            <PanelResizeHandle className="relative h-2 cursor-row-resize bg-adam-neutral-900" />
            <Panel
              defaultSize={65}
              minSize={35}
              id="viewer-panel"
              className="min-h-[200px]"
            >
              <ViewerSection code={currentCode} />
            </Panel>
          </PanelGroup>
        </Panel>
        {hasArtifact && (
          <>
            <PanelResizeHandle className="resize-handle group relative">
              {!isParametersPanelCollapsed && (
                <div className="absolute right-1 top-1/2 z-50 -translate-y-1/2 opacity-0 transition-opacity duration-200 group-hover:opacity-100">
                  <Button
                    variant="ghost"
                    className="rounded-l-lg rounded-r-none border-b border-l border-t border-gray-200/20 bg-adam-bg-secondary-dark p-2 text-adam-text-primary transition-colors dark:border-gray-800 [@media(hover:hover)]:hover:bg-adam-neutral-950 [@media(hover:hover)]:hover:text-adam-neutral-10"
                    onClick={handleParametersCollapse}
                  >
                    <ChevronsRight className="h-5 w-5" />
                  </Button>
                </div>
              )}
              {isParametersPanelCollapsed && (
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
              ref={parameterPanelRef}
              defaultSize={parametersPanelSizes.defaultSize}
              minSize={parametersPanelSizes.minSize}
              maxSize={parametersPanelSizes.maxSize}
              id="parameters-panel"
              order={2}
            >
              <div className="relative h-full">
                <ParameterSection />
              </div>
            </Panel>
          </>
        )}
      </PanelGroup>
    </div>
  );
}
