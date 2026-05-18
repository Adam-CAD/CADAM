import { ChatSection } from '@/components/chat/ChatSection';
import { ParameterSection } from '@/components/parameter/ParameterSection';
import { Content, Message, Model, Parameter } from '@shared/types';
import OpenSCADError from '@/lib/OpenSCADError';
import { cn } from '@/lib/utils';
import { useRef, useState, useMemo, useCallback, useLayoutEffect } from 'react';
import {
  ImperativePanelHandle,
  Panel,
  PanelGroup,
  PanelResizeHandle,
} from 'react-resizable-panels';
import { useCurrentMessage } from '@/contexts/CurrentMessageContext';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import { Button } from '@/components/ui/button';
import { ChevronsRight } from 'lucide-react';
import { TreeNode } from '@shared/Tree';
import { ParametricPreviewSection } from '@/components/viewer/ParametricPreviewSection';
import { ParametricPreviewDialog } from '@/components/viewer/ParametricPreviewDialog';
import { DxfExporter } from '@/utils/downloadUtils';

// Panel size constants
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

interface ParametricViewProps {
  messages: TreeNode<Message>[];
  sendMessage?: (content: Content) => void;
  editMessage?: (message: Message) => void;
  retryMessage?: ({ model, id }: { model: Model; id: string }) => void;
  isLoading: boolean;
  currentOutput: Blob | undefined;
  setCurrentOutput: (output: Blob | undefined) => void;
  color: string;
  limitReached?: boolean;
  changeParameters: (message: Message | null, parameters: Parameter[]) => void;
  stopGenerating?: () => void;
  fixError?: (error: OpenSCADError) => void;
  changeRating?: (data: { messageId: string; rating: number }) => void;
  restoreMessage?: (message: Message) => void;
}

export default function ParametricView({
  messages,
  sendMessage,
  editMessage,
  retryMessage,
  isLoading,
  currentOutput,
  setCurrentOutput,
  color,
  limitReached = false,
  changeParameters,
  stopGenerating,
  fixError,
  changeRating,
  restoreMessage,
}: ParametricViewProps) {
  const isTabletOrMobile = useMediaQuery('(max-width: 1024px)');
  const { currentMessage } = useCurrentMessage();
  const [isParametersPanelCollapsed, setIsParametersPanelCollapsed] =
    useState(false);
  const [isChatCollapsed, setIsChatCollapsed] = useState(false);
  const [dxfExporter, setDxfExporter] = useState<DxfExporter | null>(null);
  const chatPanelRef = useRef<ImperativePanelHandle>(null);
  const parameterPanelRef = useRef<ImperativePanelHandle>(null);
  const resizeObserverRef = useRef<ResizeObserver | null>(null);
  const [containerWidth, setContainerWidth] = useState(0);

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

  // `react-resizable-panels` only honors `defaultSize` at initial mount, and
  // the PanelGroup's `autoSaveId` can restore a persisted size of 0 from a
  // prior no-artifact session. Drive visibility imperatively via
  // collapse/expand so the panel actually opens when the artifact arrives
  // and shrinks to 0 when it's gone. useLayoutEffect avoids a visible flash
  // on first paint when the persisted layout disagrees with `hasArtifact`.
  useLayoutEffect(() => {
    const panel = parameterPanelRef.current;
    if (!panel) return;
    if (hasArtifact) {
      panel.expand();
      setIsParametersPanelCollapsed(false);
    } else {
      panel.collapse();
    }
  }, [hasArtifact]);

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

  const handleDxfExportChange = useCallback((exporter: DxfExporter | null) => {
    // The state value is itself a function, so we use the lazy-set form;
    // a bare setDxfExporter(exporter) would invoke it as a state updater.
    setDxfExporter(() => exporter);
  }, []);

  return (
    <div
      className="flex h-full w-full overflow-hidden bg-[#292828]"
      ref={setContainerRef}
    >
      {isTabletOrMobile ? (
        <div className="relative h-full w-full">
          <ChatSection
            messages={messages ?? []}
            isLoading={isLoading}
            onSendMessage={sendMessage}
            onEdit={editMessage}
            stopGenerating={stopGenerating}
            retryMessage={retryMessage}
            changeRating={changeRating}
            restoreMessage={restoreMessage}
          />
          <ParametricPreviewDialog
            onOutputChange={setCurrentOutput}
            onDxfExportChange={handleDxfExportChange}
            fixError={!limitReached ? fixError : undefined}
            onSubmit={changeParameters}
            currentOutput={currentOutput}
            dxfExporter={dxfExporter}
          />
        </div>
      ) : (
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
              <ChatSection
                messages={messages ?? []}
                isLoading={isLoading}
                onSendMessage={sendMessage}
                onEdit={editMessage}
                stopGenerating={stopGenerating}
                retryMessage={retryMessage}
                changeRating={changeRating}
                restoreMessage={restoreMessage}
              />
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
            <ParametricPreviewSection
              isLoading={isLoading}
              onOutputChange={setCurrentOutput}
              onDxfExportChange={handleDxfExportChange}
              color={color}
              fixError={!limitReached ? fixError : undefined}
            />
          </Panel>
          {/*
            Always mount the resize handle + parameters Panel so the
            PanelGroup's registered panel count never changes. Toggling
            `hasArtifact` caused react-resizable-panels to throw
            "Panel data not found for index 2", which unmounted the
            view mid-stream and orphaned the SSE mutation.
            When no artifact exists we collapse the panel to zero size
            and hide the handle so the layout reads as two panels.
          */}
          <PanelResizeHandle
            disabled={!hasArtifact}
            className={cn(
              'resize-handle group relative',
              !hasArtifact && 'pointer-events-none !w-0 before:hidden',
            )}
          >
            {hasArtifact && !isParametersPanelCollapsed && (
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
            {hasArtifact && isParametersPanelCollapsed && (
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
            ref={parameterPanelRef}
            defaultSize={parametersPanelSizes.defaultSize}
            minSize={parametersPanelSizes.minSize}
            maxSize={parametersPanelSizes.maxSize}
            id="parameters-panel"
            order={2}
          >
            {hasArtifact && (
              <div className="relative h-full">
                <ParameterSection
                  parameters={
                    currentMessage?.content.artifact?.parameters ?? []
                  }
                  onSubmit={changeParameters}
                  currentOutput={currentOutput}
                  dxfExporter={dxfExporter}
                />
              </div>
            )}
          </Panel>
        </PanelGroup>
      )}
    </div>
  );
}
