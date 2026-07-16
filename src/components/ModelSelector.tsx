import { Check, ChevronDown } from 'lucide-react';
import { useState, useEffect, useRef } from 'react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Button } from '@/components/ui/button';
import { ProviderLogo } from '@/components/ProviderLogo';
import { cn } from '@/lib/utils';
import { Model } from '@shared/types';
import { ModelConfig } from '../types/misc.ts';
import { useConversation } from '@/contexts/ConversationContext';

interface ModelSelectorProps {
  models: ModelConfig[];
  selectedModel: string;
  onModelChange: (modelId: Model) => void;
  disabled?: boolean;
  className?: string;
  type?: 'parametric' | 'creative'; // Optional type prop that takes precedence over conversation context
  focused?: boolean; // New prop to indicate if text area is focused
}

export function ModelSelector({
  models,
  selectedModel,
  onModelChange,
  className,
  disabled,
  type,
  focused = false,
}: ModelSelectorProps) {
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const { conversation } = useConversation();

  // Use provided type prop or fall back to conversation context
  const currentType = type || conversation.type;

  // Track previous model name for slide animation
  const [prevModelName, setPrevModelName] = useState<string | null>(null);
  const [isSliding, setIsSliding] = useState(false);
  const [slideDirection, setSlideDirection] = useState<'up' | 'down'>('up');

  const selectedModelConfig = models.find((m) => m.id === selectedModel);

  // Store previous selected model name and type
  const prevNameRef = useRef<string | undefined>(selectedModelConfig?.name);
  const prevTypeRef = useRef<'parametric' | 'creative' | undefined>(
    currentType,
  );
  const recentTypeChangeRef = useRef<number>(0); // Timestamp of last type change

  // ---------------------------------------------------------------------------
  // Focus management
  // ---------------------------------------------------------------------------
  // Radix will always move focus back to the trigger after the dropdown closes.
  // When the user opened the menu via *keyboard* this is great for accessibility
  // because they can keep tabbing.  But when the user opened the menu with a
  // *pointer* (mouse / touch), that behaviour leaves an unwanted focus outline
  // "stuck" on the button.  We therefore:
  //   1. Track *how* the menu was opened (pointer vs. keyboard).
  //   2. If it was opened via pointer, cancel the automatic focus-return and
  //      blur the trigger so no outline is shown.
  // ---------------------------------------------------------------------------
  const openedWithPointerRef = useRef(false);

  // Ref to the trigger button so we can blur it if needed.
  const triggerRef = useRef<HTMLButtonElement | null>(null);

  // Trigger slide animation when selected model changes
  useEffect(() => {
    if (
      prevNameRef.current &&
      prevNameRef.current !== selectedModelConfig?.name
    ) {
      setPrevModelName(prevNameRef.current);
      setIsSliding(true);

      // Check if type changed (mode switch)
      const typeChanged = prevTypeRef.current !== currentType;
      const now = Date.now();
      const recentTypeChange = now - recentTypeChangeRef.current < 100; // Within 100ms

      if (typeChanged) {
        // Mode switching logic: parametric = down, creative = up
        const direction = currentType === 'parametric' ? 'down' : 'up';
        setSlideDirection(direction);
        recentTypeChangeRef.current = now;
      } else if (!recentTypeChange) {
        // Within same mode: preserve existing index-based logic
        // But only if we haven't had a recent type change
        const prevIndex = models.findIndex(
          (m) => m.name === prevNameRef.current,
        );
        const newIndex = models.findIndex((m) => m.id === selectedModel);
        if (prevIndex !== -1 && newIndex !== -1) {
          const direction = newIndex > prevIndex ? 'up' : 'down';
          setSlideDirection(direction);
        }
      }
    }

    prevNameRef.current = selectedModelConfig?.name;
    prevTypeRef.current = currentType;
  }, [selectedModelConfig?.name, currentType, models, selectedModel]);

  const handleSlideEnd = () => {
    setPrevModelName(null);
    setIsSliding(false);
  };

  return (
    <DropdownMenu open={isDropdownOpen} onOpenChange={setIsDropdownOpen}>
      <DropdownMenuTrigger asChild>
        <Button
          ref={triggerRef}
          // Record that the menu was opened with a pointer so we can adjust
          // focus handling on close.
          onPointerDown={() => {
            openedWithPointerRef.current = true;
          }}
          // Keyboard interaction should *not* suppress the focus outline.
          onKeyDown={() => {
            openedWithPointerRef.current = false;
          }}
          variant="ghost"
          className={cn(
            'flex h-8 w-auto items-center gap-1.5 rounded-lg px-3 text-sm transition-all duration-200 hover:border-[#333333] hover:bg-adam-neutral-800',
            focused
              ? 'text-white hover:text-white'
              : 'text-adam-text-secondary hover:text-adam-text-primary',
            isDropdownOpen &&
              (focused
                ? 'bg-adam-neutral-800 text-white'
                : 'bg-adam-neutral-800 text-adam-text-primary'),
            className,
          )}
          disabled={!!disabled}
        >
          <span className="relative inline-grid items-center overflow-hidden text-right font-normal">
            {/* Previous name sliding out */}
            {prevModelName && (
              <span
                style={{ gridColumn: 1, gridRow: 1 }}
                className={`block ${
                  slideDirection === 'up' ? 'slide-out-up' : 'slide-out-down'
                }`}
                onAnimationEnd={handleSlideEnd}
              >
                {prevModelName}
              </span>
            )}

            {/* Current name sliding in */}
            <span
              style={{ gridColumn: 1, gridRow: 1 }}
              className={
                isSliding
                  ? slideDirection === 'up'
                    ? 'slide-in-up block'
                    : 'slide-in-down block'
                  : 'block'
              }
            >
              {selectedModelConfig?.name}
            </span>
          </span>
          <ChevronDown
            className={`ml-1 h-4 w-4 flex-shrink-0 opacity-70 transition-transform duration-200 ${
              isDropdownOpen ? 'rotate-180' : ''
            }`}
          />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        className="flex w-80 max-w-[calc(100vw-2rem)] flex-col gap-1 overflow-y-auto rounded-lg bg-adam-neutral-700 p-1 [max-height:min(340px,var(--radix-dropdown-menu-content-available-height))]"
        align="end"
        // Radix fires this just before it tries to refocus the trigger.
        // We intercept the event: if the menu was opened with a pointer we
        //   – call `event.preventDefault()` to stop the refocus
        //   – blur the trigger to clear any outline.
        // For keyboard users we leave the default behaviour untouched.
        onCloseAutoFocus={(event) => {
          if (openedWithPointerRef.current) {
            event.preventDefault();
            openedWithPointerRef.current = false;
            triggerRef.current?.blur();
          }
        }}
      >
        {models.map((model) => (
          <DropdownMenuItem
            key={model.id}
            className={cn(
              'cursor-pointer rounded-md bg-adam-neutral-700 px-3 py-2.5 transition-colors duration-150 focus:bg-adam-bg-secondary-dark',
              selectedModel === model.id && 'bg-adam-neutral-800',
              !!model.disabled && 'cursor-not-allowed opacity-50',
            )}
            onClick={(event) => {
              onModelChange(model.id);
              setIsDropdownOpen(false);
              event.stopPropagation();
            }}
            disabled={!!model.disabled}
          >
            <div className="flex w-full items-start gap-3">
              <ProviderLogo
                provider={model.provider}
                className={cn(
                  'mt-0.5',
                  focused ? 'text-white' : 'text-adam-text-primary',
                )}
              />
              <div className="min-w-0 flex-1">
                <span
                  className={cn(
                    'text-sm font-medium',
                    focused ? 'text-white' : 'text-adam-text-primary',
                  )}
                >
                  {model.name}
                </span>
                {model.description && (
                  <p
                    className={cn(
                      'mt-0.5 text-xs',
                      focused ? 'text-white' : 'text-gray-400',
                    )}
                  >
                    {model.description}
                  </p>
                )}
              </div>
              {selectedModel === model.id && (
                <Check
                  className={cn(
                    'mt-0.5 h-4 w-4 shrink-0',
                    focused ? 'text-white' : 'text-adam-text-primary',
                  )}
                />
              )}
            </div>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
