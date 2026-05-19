import { useEffect, useRef } from 'react';
import { Streamdown } from 'streamdown';
import { cjk } from '@streamdown/cjk';
import { code } from '@streamdown/code';
import { math } from '@streamdown/math';
import { mermaid } from '@streamdown/mermaid';
import {
  Reasoning,
  ReasoningTrigger,
} from '@/components/ai-elements/reasoning';
import { CollapsibleContent } from '@/components/ui/collapsible';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';

// Mirrors `streamdownPlugins` from ai-elements/reasoning.tsx ReasoningContent
// so our custom-scrolling body keeps full markdown feature parity (code
// highlighting, math, mermaid, CJK) instead of regressing to bare Streamdown.
const streamdownPlugins = { cjk, code, math, mermaid };

interface ChatReasoningProps {
  text: string;
  isStreaming: boolean;
  className?: string;
}

/**
 * CADAM-tailored reasoning block.
 *
 * Wraps the ai-elements `Reasoning` + `ReasoningTrigger` primitives with our
 * own collapsible body so we get:
 *
 *  * A fixed scrollable area (max-h-72) with auto-scroll-to-bottom while the
 *    model is still streaming reasoning tokens.
 *  * A native scrollbar contained to the reasoning block itself — the outer
 *    chat ScrollArea is unaffected, so we don't end up with stacked
 *    scrollbars when the chat is also overflowing.
 *  * CADAM-themed muted text colors (the shadcn `text-muted-foreground` /
 *    `hover:text-foreground` tokens resolve to near-black on our :root,
 *    which is unreadable on the dark chat panel).
 *
 * The actual `ReasoningContent` from ai-elements is intentionally NOT used
 * here — it dumps Streamdown directly under CollapsibleContent with no
 * height cap, which lets very long chains of thought blow out the chat
 * panel. We render an identically-styled CollapsibleContent ourselves so
 * we can own the scroll + auto-scroll behavior without modifying the
 * upstream component.
 *
 * `isStreaming` is threaded down as a prop rather than read from
 * `useReasoning()` because the upstream context provider is declared
 * inside `ai-elements/reasoning.tsx` and consumers that resolve it
 * across module boundaries (HMR reloads, route splits) can see a null
 * value and throw "Reasoning components must be used within Reasoning"
 * even when the JSX is literally inside the provider. Prop-drilling
 * one boolean side-steps the entire class of bug.
 */
export function ChatReasoning({
  text,
  isStreaming,
  className,
}: ChatReasoningProps) {
  return (
    <Reasoning isStreaming={isStreaming} className={cn('mb-0', className)}>
      <ReasoningTrigger className="text-adam-text-secondary hover:text-adam-text-primary" />
      <ChatReasoningBody isStreaming={isStreaming}>{text}</ChatReasoningBody>
    </Reasoning>
  );
}

function ChatReasoningBody({
  children,
  isStreaming,
}: {
  children: string;
  isStreaming: boolean;
}) {
  // Ref points at the ScrollArea Root. We reach into the Radix Viewport
  // (the actual scroll container) by its data attribute and pin its
  // scrollTop to the bottom while the model is still streaming reasoning.
  // Once streaming finishes we stop forcing it so the user can scroll back
  // up to re-read whatever they want.
  const scrollRootRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!isStreaming) return;
    const viewport = scrollRootRef.current?.querySelector<HTMLElement>(
      '[data-radix-scroll-area-viewport]',
    );
    if (!viewport) return;
    viewport.scrollTop = viewport.scrollHeight;
  }, [children, isStreaming]);

  return (
    <CollapsibleContent
      className={cn(
        'mt-4 text-sm text-adam-text-secondary outline-none',
        'data-[state=closed]:fade-out-0 data-[state=closed]:slide-out-to-top-2',
        'data-[state=open]:fade-in-0 data-[state=open]:slide-in-from-top-2',
        'data-[state=open]:animate-in data-[state=closed]:animate-out',
      )}
    >
      {/* Cap the Radix Viewport (not the Root) so the box only takes up
          space when the reasoning is actually that long — short chains of
          thought stay compact. The arbitrary-variant selector targets the
          Viewport's `data-*` attribute directly; `max-h-*` on the Root
          alone wouldn't work because the Viewport carries `h-full`. */}
      <ScrollArea
        ref={scrollRootRef}
        className="w-full pr-3 [&_[data-radix-scroll-area-viewport]]:max-h-72"
      >
        <Streamdown parseIncompleteMarkdown plugins={streamdownPlugins}>
          {children}
        </Streamdown>
      </ScrollArea>
    </CollapsibleContent>
  );
}
