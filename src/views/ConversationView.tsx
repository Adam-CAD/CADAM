import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { ChevronsRight } from 'lucide-react';
import {
  type ReactNode,
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

interface ConversationViewProps {
  chatPanelSlot: ReactNode;
  previewSlot: ReactNode;
  parametersSlot: ReactNode;
  /**
   * Drives the right-hand parameters panel: when false the panel collapses to
   * 0 and its resize handle stays inert. Editor uses this to show parameters
   * only once an OpenSCAD artifact is active; Share uses the same gate.
   */
  hasParameters: boolean;
}

/**
 * Pure layout shell for the conversation editor / share view.
 *
 * Owns the three-panel chrome (`react-resizable-panels`), the chat-panel
 * collapse button, and the parameters-panel auto-collapse logic — but nothing
 * about the data those panels render. Consumers (`EditorView`, `ShareView`)
 * supply each pane as a slot.
 *
 * The container `ResizeObserver` lives here too because the min/max pixel
 * sizes the resizable-panels library expects are percentage-based, and we
 * need the live container width to convert from the pixel constraints we
 * actually want to enforce.
 */
export function ConversationView({
  chatPanelSlot,
  previewSlot,
  parametersSlot,
  hasParameters,
}: ConversationViewProps) {
  const chatPanelRef = useRef<ImperativePanelHandle>(null);
  const parametersPanelRef = useRef<ImperativePanelHandle>(null);
  const resizeObserverRef = useRef<ResizeObserver | null>(null);
  const [containerWidth, setContainerWidth] = useState(0);
  const [isChatCollapsed, setIsChatCollapsed] = useState(false);
  const [isParametersCollapsed, setIsParametersCollapsed] = useState(false);

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

  // Parameters panel collapses to 0 when there's no artifact and expands when
  // one arrives. Matches the legacy ParametricView pattern verbatim so the
  // first-paint width settles without a flash.
  useLayoutEffect(() => {
    const panel = parametersPanelRef.current;
    if (!panel) return;
    if (hasParameters) {
      panel.expand();
      setIsParametersCollapsed(false);
    } else {
      panel.collapse();
    }
  }, [hasParameters]);

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
            {chatPanelSlot}
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
            (hasParameters ? 0 : parametersPanelSizes.defaultSize)
          }
          minSize={
            PANEL_SIZES.PREVIEW.MIN +
            (hasParameters ? 0 : parametersPanelSizes.minSize)
          }
          id="preview-panel"
          order={1}
        >
          {previewSlot}
        </Panel>

        {/* Parameter panel mount stays stable; collapses to 0 when no artifact
            so react-resizable-panels doesn't reshuffle layout when the user
            switches between mesh and parametric outputs. */}
        <PanelResizeHandle
          disabled={!hasParameters}
          className={cn(
            'resize-handle group relative',
            !hasParameters && 'pointer-events-none !w-0 before:hidden',
          )}
        >
          {hasParameters && !isParametersCollapsed && (
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
          {hasParameters && isParametersCollapsed && (
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
          {hasParameters && parametersSlot}
        </Panel>
      </PanelGroup>
    </div>
  );
}
