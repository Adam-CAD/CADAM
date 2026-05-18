import { CreativePreviewSection } from '@/components/viewer/CreativePreviewSection';
import { useIsMobile } from '@/hooks/useIsMobile';
import { Content, Message, Model } from '@shared/types';
import {
  ImperativePanelHandle,
  Panel,
  PanelGroup,
  PanelResizeHandle,
} from 'react-resizable-panels';
import { ChatSection } from '@/components/chat/ChatSection';
import { Button } from '@/components/ui/button';
import { useRef, useState, useMemo, useCallback } from 'react';
import { ChevronsRight } from 'lucide-react';
import { TreeNode } from '@shared/Tree';
import { CreativePreviewDialog } from '@/components/viewer/CreativePreviewDialog';

// Panel size constants
const PANEL_SIZES = {
  CHAT: {
    DEFAULT: 30,
    MIN: 384,
    MAX: 550,
  },
  PREVIEW: {
    DEFAULT: 70,
    MIN: 20,
  },
} as const;

type CreativeViewProps = {
  messages: TreeNode<Message>[];
  isLoading: boolean;
  sendMessage?: (content: Content) => void;
  stopGenerating?: () => void;
  restoreMessage?: (message: Message) => void;
  retryMessage?: ({ model, id }: { model: Model; id: string }) => void;
  editMessage?: (message: Message) => void;
  changeRating?: ({
    messageId,
    rating,
  }: {
    messageId: string;
    rating: number;
  }) => void;
  upscaleMessage?: ({
    meshId,
    parentMessageId,
  }: {
    meshId: string;
    parentMessageId: string | null;
  }) => void;
};

export function CreativeView({
  messages,
  isLoading,
  sendMessage,
  stopGenerating,
  restoreMessage,
  retryMessage,
  editMessage,
  changeRating,
  upscaleMessage,
}: CreativeViewProps) {
  const isMobile = useIsMobile();
  const panelRef = useRef<ImperativePanelHandle>(null);
  const resizeObserverRef = useRef<ResizeObserver | null>(null);
  const [isCollapsed, setIsCollapsed] = useState(false);
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
  const panelSizes = useMemo(() => {
    if (containerWidth === 0)
      return { defaultSize: 30, minSize: 0, maxSize: 100 };

    const minSize = (PANEL_SIZES.CHAT.MIN / containerWidth) * 100;
    const maxSize = Math.min(
      (PANEL_SIZES.CHAT.MAX / containerWidth) * 100,
      100,
    );
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

  // Optimized collapse/expand handlers
  const handleCollapse = useCallback(() => {
    const panel = panelRef.current;
    if (panel) {
      panel.collapse();
      setIsCollapsed(true);
    }
  }, []);

  const handleExpand = useCallback(() => {
    const panel = panelRef.current;
    if (panel) {
      panel.expand();
      setIsCollapsed(false);
    }
  }, []);

  return (
    <>
      <div
        className="flex h-full w-full overflow-hidden bg-[#292828]"
        ref={isMobile ? undefined : setContainerRef}
      >
        {isMobile ? (
          <>
            <CreativePreviewDialog />
            <ChatSection
              messages={messages}
              isLoading={isLoading}
              onSendMessage={sendMessage}
              stopGenerating={stopGenerating}
              restoreMessage={restoreMessage}
              retryMessage={retryMessage}
              onEdit={editMessage}
              changeRating={changeRating}
              upscaleMessage={upscaleMessage}
            />
          </>
        ) : (
          <PanelGroup direction="horizontal" className="w-full">
            <Panel
              collapsible
              ref={panelRef}
              defaultSize={panelSizes.defaultSize}
              minSize={panelSizes.minSize}
              maxSize={panelSizes.maxSize}
            >
              <ChatSection
                messages={messages}
                isLoading={isLoading}
                onSendMessage={sendMessage}
                stopGenerating={stopGenerating}
                restoreMessage={restoreMessage}
                retryMessage={retryMessage}
                onEdit={editMessage}
                changeRating={changeRating}
                upscaleMessage={upscaleMessage}
              />
            </Panel>
            <PanelResizeHandle className="resize-handle group relative">
              {!isCollapsed && (
                <div className="absolute left-1 top-1/2 z-50 -translate-y-1/2 opacity-0 transition-opacity duration-200 focus-within:opacity-100 group-hover:opacity-100">
                  <Button
                    variant="ghost"
                    className="rounded-l-none rounded-r-lg border-b border-r border-t border-gray-200/20 bg-adam-bg-secondary-dark p-2 text-adam-text-primary transition-colors hover:bg-black hover:text-adam-neutral-0 dark:border-gray-800"
                    onClick={handleCollapse}
                  >
                    <ChevronsRight className="h-5 w-5 rotate-180" />
                  </Button>
                </div>
              )}
              {isCollapsed && (
                <div className="absolute left-0 top-1/2 z-50 -translate-y-1/2">
                  <Button
                    aria-label="Expand chat panel"
                    onClick={handleExpand}
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
              defaultSize={PANEL_SIZES.PREVIEW.DEFAULT}
              minSize={PANEL_SIZES.PREVIEW.MIN}
              className="overflow-hidden"
            >
              <CreativePreviewSection isLoading={isLoading} />
            </Panel>
          </PanelGroup>
        )}
      </div>
    </>
  );
}
