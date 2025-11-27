/**
 * Adam-Quality Slider Component
 *
 * An enhanced slider component with improved UX features inspired by adam.new:
 *
 * **Key Features:**
 * - Improved hit targets (44px touch area, 20px thumb)
 * - Progressive hover states (track → range → thumb scaling)
 * - Enhanced keyboard navigation (arrows, PageUp/Down, Home/End, Shift for fine control)
 * - Animated reset-to-default marker with tooltip
 * - Separate desktop (jump-to-click) vs mobile (relative drag) behaviors
 * - Smooth spring-like animations on value changes
 * - Full accessibility (ARIA labels, focus indicators, keyboard support)
 *
 * **Usage:**
 * ```tsx
 * <Slider
 *   min={0}
 *   max={100}
 *   step={1}
 *   value={[currentValue]}
 *   defaultValue={[50]}
 *   onValueChange={([newValue]) => setValue(newValue)}
 *   onValueCommit={([finalValue]) => saveValue(finalValue)}
 * />
 * ```
 *
 * **Props:**
 * - `value`: Current value (array format: `[number]`)
 * - `defaultValue`: Original/reset value for the marker
 * - `min`, `max`, `step`: Range configuration
 * - `variant`: 'default' (rounded corners) or 'capsule' (fully rounded)
 * - `defaultMarkerStyle`: 'dot' (circular) or 'line' (vertical bar)
 * - `hideDefaultMarker`: Hide the reset marker
 *
 * **Keyboard Controls:**
 * - Arrow keys: Increment/decrement by `step`
 * - Shift + Arrows: Fine adjustment (0.1× step)
 * - PageUp/PageDown: Jump by 10% of range
 * - Home/End: Jump to min/max
 *
 * **Pointer Behavior:**
 * - Desktop (fine pointer): Click jumps to position, drag adjusts smoothly
 * - Mobile (coarse pointer): Relative drag from current position (no jumps)
 */
import * as React from 'react';
import * as SliderPrimitive from '@radix-ui/react-slider';

import { cn } from '@/lib/utils';

const Slider = React.forwardRef<
  React.ElementRef<typeof SliderPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof SliderPrimitive.Root> & {
    hideDefaultMarker?: boolean;
    variant?: 'default' | 'capsule';
    defaultMarkerStyle?: 'dot' | 'line';
  }
>(
  (
    {
      className,
      onValueChange,
      onValueCommit,
      value,
      min = 0,
      max = 100,
      step = 1,
      defaultValue,
      hideDefaultMarker = false,
      variant = 'default',
      defaultMarkerStyle = 'dot',
      ...props
    },
    ref,
  ) => {
    const [isDragging, setIsDragging] = React.useState(false);
    const [startX, setStartX] = React.useState(0);
    const [startValue, setStartValue] = React.useState(0);
    const [isAnimating, setIsAnimating] = React.useState(false);
    const [isHoveringTrack, setIsHoveringTrack] = React.useState(false);
    const [isHoveringMarker, setIsHoveringMarker] = React.useState(false);
    const trackRef = React.useRef<HTMLDivElement>(null);
    const thumbRef = React.useRef<HTMLDivElement>(null);
    const lastValueRef = React.useRef<number>(
      Array.isArray(value) ? (value?.[0] ?? 0) : (value ?? 0),
    );
    const [isCoarsePointer, setIsCoarsePointer] = React.useState(false);
    const interactionIsCoarseRef = React.useRef<boolean>(false);
    const isPointerDownRef = React.useRef<boolean>(false);
    const [isPointerDown, setIsPointerDown] = React.useState(false);
    const [smoothAnimate, setSmoothAnimate] = React.useState(false);
    const smoothAnimateTimeoutRef = React.useRef<number | null>(null);
    const animationTimeoutRef = React.useRef<number | null>(null);
    const markerAnimationTimeoutRef = React.useRef<number | null>(null);
    const pointerDownXRef = React.useRef<number>(0);
    const DRAG_DETECTION_PX = 4;

    // Cache track rect to avoid layout thrashing
    const trackRectRef = React.useRef<DOMRect | null>(null);
    const rafIdRef = React.useRef<number | null>(null);

    const currentValue = Array.isArray(value) ? value[0] : value || 0;
    const defaultVal = Array.isArray(defaultValue)
      ? defaultValue[0]
      : defaultValue || 0;

    // Calculate default value position as percentage
    const defaultPosition = ((defaultVal - min) / (max - min)) * 100;

    // Trigger animation when value changes to default (likely from reset)
    const prevValueRef = React.useRef(currentValue);
    React.useEffect(() => {
      if (
        prevValueRef.current !== currentValue &&
        currentValue === defaultVal &&
        !isDragging
      ) {
        setIsAnimating(true);
        // Clear any existing animation timeout
        if (animationTimeoutRef.current) {
          clearTimeout(animationTimeoutRef.current);
        }
        animationTimeoutRef.current = window.setTimeout(() => {
          setIsAnimating(false);
          animationTimeoutRef.current = null;
        }, 300);
      }
      prevValueRef.current = currentValue;
    }, [currentValue, defaultVal, isDragging]);

    // Cleanup effect to cancel any pending animation frames and timeouts
    React.useEffect(() => {
      return () => {
        if (rafIdRef.current) {
          cancelAnimationFrame(rafIdRef.current);
        }
        if (smoothAnimateTimeoutRef.current) {
          clearTimeout(smoothAnimateTimeoutRef.current);
        }
        if (animationTimeoutRef.current) {
          clearTimeout(animationTimeoutRef.current);
        }
        if (markerAnimationTimeoutRef.current) {
          clearTimeout(markerAnimationTimeoutRef.current);
        }
      };
    }, []);

    const handlePointerDown = (event: React.PointerEvent) => {
      if (!trackRef.current) return;

      // Cache the track rect once at the start of interaction to avoid layout thrashing
      trackRectRef.current = trackRef.current.getBoundingClientRect();

      // Don't mark as dragging yet on desktop. On mobile (coarse), we do.
      setIsDragging(false);
      isPointerDownRef.current = true;
      setIsPointerDown(true);
      // Detect pointer context on first interaction if not yet detected
      let coarse = isCoarsePointer;
      if (typeof window !== 'undefined') {
        coarse = !!(
          window.matchMedia && window.matchMedia('(pointer: coarse)').matches
        );
        setIsCoarsePointer(coarse);
      }
      interactionIsCoarseRef.current = coarse;

      pointerDownXRef.current = event.clientX;

      if (coarse) {
        setIsDragging(true);
        // Mobile: relative drag behavior
        setStartX(event.clientX);
        setStartValue(currentValue);
      } else {
        // Desktop: jump to cursor position with smooth animation.
        // Arm a brief smooth animation window so the range animates the width change
        if (smoothAnimateTimeoutRef.current) {
          window.clearTimeout(smoothAnimateTimeoutRef.current);
          smoothAnimateTimeoutRef.current = null;
        }
        setSmoothAnimate(true);
        smoothAnimateTimeoutRef.current = window.setTimeout(() => {
          setSmoothAnimate(false);
          smoothAnimateTimeoutRef.current = null;
        }, 180);
        // Use rAF so the transition class applies before width changes.
        const clientX = event.clientX;
        const rect = trackRectRef.current;
        window.requestAnimationFrame(() => {
          if (!rect) return;
          const trackWidth = rect.width;
          const clampedX = Math.min(Math.max(clientX, rect.left), rect.right);
          const ratio =
            trackWidth > 0 ? (clampedX - rect.left) / trackWidth : 0;
          const valueRange = max - min;
          let newValue = min + ratio * valueRange;
          if (step > 0) {
            newValue = Math.round(newValue / step) * step;
          }
          const decimals =
            step >= 1 ? 0 : Math.max(0, -Math.floor(Math.log10(step)));
          newValue =
            Math.round(newValue * Math.pow(10, decimals)) /
            Math.pow(10, decimals);
          lastValueRef.current = newValue;
          if (onValueChange) {
            onValueChange([newValue]);
          }
        });
      }

      // Capture pointer for smooth dragging
      event.currentTarget.setPointerCapture(event.pointerId);
    };

    const handlePointerMove = (event: React.PointerEvent) => {
      if (!trackRectRef.current) return;
      // Ignore hover-only movement (no buttons pressed) unless already dragging
      if (!isDragging && event.buttons === 0) return;

      // Cancel any pending animation frame to avoid multiple updates
      if (rafIdRef.current) {
        cancelAnimationFrame(rafIdRef.current);
      }

      // Use cached rect to avoid layout thrashing
      const rect = trackRectRef.current;
      const trackWidth = rect.width;
      const clientX = event.clientX;

      // Schedule update on next animation frame for smooth performance
      rafIdRef.current = requestAnimationFrame(() => {
        let newValue: number;
        if (interactionIsCoarseRef.current) {
          // Mobile: relative drag behavior
          const deltaX = clientX - startX;
          const valueRange = max - min;
          const deltaValue =
            trackWidth > 0 ? (deltaX / trackWidth) * valueRange : 0;
          newValue = startValue + deltaValue;
        } else {
          // Desktop
          if (!isDragging) {
            const moved = Math.abs(clientX - pointerDownXRef.current);
            if (moved < DRAG_DETECTION_PX) {
              // Treat as click: set value to absolute position immediately with a short smooth transition
              if (smoothAnimateTimeoutRef.current) {
                window.clearTimeout(smoothAnimateTimeoutRef.current);
                smoothAnimateTimeoutRef.current = null;
              }
              setSmoothAnimate(true);
              smoothAnimateTimeoutRef.current = window.setTimeout(() => {
                setSmoothAnimate(false);
                smoothAnimateTimeoutRef.current = null;
              }, 180);
              const clampedX = Math.min(
                Math.max(clientX, rect.left),
                rect.right,
              );
              const ratio =
                trackWidth > 0 ? (clampedX - rect.left) / trackWidth : 0;
              const valueRange = max - min;
              let clickValue = min + ratio * valueRange;
              if (step > 0) clickValue = Math.round(clickValue / step) * step;
              const decimals =
                step >= 1 ? 0 : Math.max(0, -Math.floor(Math.log10(step)));
              clickValue =
                Math.round(clickValue * Math.pow(10, decimals)) /
                Math.pow(10, decimals);
              lastValueRef.current = clickValue;
              onValueChange?.([clickValue]);
              return;
            }
            // Threshold crossed: enter dragging mode and disable smooth animation
            setIsDragging(true);
            if (smoothAnimate) {
              setSmoothAnimate(false);
              if (smoothAnimateTimeoutRef.current) {
                window.clearTimeout(smoothAnimateTimeoutRef.current);
                smoothAnimateTimeoutRef.current = null;
              }
            }
          }
          // Desktop: absolute position behavior
          const clampedX = Math.min(Math.max(clientX, rect.left), rect.right);
          const ratio =
            trackWidth > 0 ? (clampedX - rect.left) / trackWidth : 0;
          const valueRange = max - min;
          newValue = min + ratio * valueRange;
        }

        // Clamp to min/max bounds
        newValue = Math.max(min, Math.min(max, newValue));

        // Snap to step
        if (step > 0) {
          newValue = Math.round(newValue / step) * step;
        }

        // Round based on step size to avoid floating point precision issues
        const decimals =
          step >= 1 ? 0 : Math.max(0, -Math.floor(Math.log10(step)));
        newValue =
          Math.round(newValue * Math.pow(10, decimals)) /
          Math.pow(10, decimals);

        lastValueRef.current = newValue;
        if (onValueChange) {
          onValueChange([newValue]);
        }
      });
    };

    const handlePointerUp = (event: React.PointerEvent) => {
      if (!isDragging && !isPointerDownRef.current) return;

      setIsDragging(false);
      isPointerDownRef.current = false;
      setIsPointerDown(false);

      // Clear cached rect when interaction ends
      trackRectRef.current = null;

      // Cancel any pending animation frame
      if (rafIdRef.current) {
        cancelAnimationFrame(rafIdRef.current);
        rafIdRef.current = null;
      }

      if (onValueCommit) {
        onValueCommit([lastValueRef.current]);
      }

      event.currentTarget.releasePointerCapture(event.pointerId);
    };

    const handlePointerCancel = () => {
      setIsDragging(false);
      isPointerDownRef.current = false;
      setIsPointerDown(false);

      // Clear cached rect when interaction ends
      trackRectRef.current = null;

      // Cancel any pending animation frame
      if (rafIdRef.current) {
        cancelAnimationFrame(rafIdRef.current);
        rafIdRef.current = null;
      }
    };

    const handleDefaultMarkerClick = (event: React.MouseEvent) => {
      event.stopPropagation();

      // Trigger animation
      setIsAnimating(true);

      if (onValueChange) {
        onValueChange([defaultVal]);
      }
      if (onValueCommit) {
        onValueCommit([defaultVal]);
      }

      // Reset animation state after animation completes
      // Clear any existing marker animation timeout
      if (markerAnimationTimeoutRef.current) {
        clearTimeout(markerAnimationTimeoutRef.current);
      }
      markerAnimationTimeoutRef.current = window.setTimeout(() => {
        setIsAnimating(false);
        markerAnimationTimeoutRef.current = null;
      }, 300);
    };

    // Enhanced keyboard navigation
    const handleKeyDown = (event: React.KeyboardEvent) => {
      // Let Radix handle its default navigation, but intercept for enhancements
      const isHandledKey = [
        'ArrowRight',
        'ArrowUp',
        'ArrowLeft',
        'ArrowDown',
        'PageUp',
        'PageDown',
        'Home',
        'End',
      ].includes(event.key);

      if (!isHandledKey) return;

      // Prevent default to stop Radix's built-in behavior
      event.preventDefault();
      event.stopPropagation();

      let newValue = currentValue;
      const valueRange = max - min;
      const largeStep = valueRange * 0.1; // 10% for PageUp/PageDown
      const fineStep = step * 0.1; // Fine adjustment with Shift

      switch (event.key) {
        case 'ArrowRight':
        case 'ArrowUp':
          newValue = currentValue + (event.shiftKey ? fineStep : step);
          break;
        case 'ArrowLeft':
        case 'ArrowDown':
          newValue = currentValue - (event.shiftKey ? fineStep : step);
          break;
        case 'PageUp':
          newValue = currentValue + largeStep;
          break;
        case 'PageDown':
          newValue = currentValue - largeStep;
          break;
        case 'Home':
          newValue = min;
          break;
        case 'End':
          newValue = max;
          break;
      }

      // Clamp and snap to step
      newValue = Math.max(min, Math.min(max, newValue));
      if (step > 0) {
        newValue = Math.round(newValue / step) * step;
      }

      // Round based on step precision
      const decimals =
        step >= 1 ? 0 : Math.max(0, -Math.floor(Math.log10(step)));
      newValue =
        Math.round(newValue * Math.pow(10, decimals)) / Math.pow(10, decimals);

      lastValueRef.current = newValue;
      if (onValueChange) {
        onValueChange([newValue]);
      }
    };

    // Note: onValueChange is called on keydown to provide immediate visual feedback (slider movement).
    // This is cheap as it only updates local React state.
    // Expensive operations (like OpenSCAD recompilation) are handled in onKeyUp via onValueCommit.
    const handleKeyUp = (event: React.KeyboardEvent) => {
      const isHandledKey = [
        'ArrowRight',
        'ArrowUp',
        'ArrowLeft',
        'ArrowDown',
        'PageUp',
        'PageDown',
        'Home',
        'End',
      ].includes(event.key);

      if (isHandledKey && onValueCommit) {
        onValueCommit([lastValueRef.current]);
      }
    };

    // Prevent default Radix behavior
    const handleRadixValueChange = () => {
      // Do nothing - we handle our own value changes
    };

    return (
      <SliderPrimitive.Root
        ref={ref}
        className={cn(
          'group relative flex w-full touch-none select-none items-center',
          // Larger hit area: 44px minimum for touch accessibility
          'h-11 py-2.5',
          // Enhanced focus ring
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400 focus-visible:ring-offset-2',
          className,
        )}
        onValueChange={handleRadixValueChange}
        onKeyDown={handleKeyDown}
        onKeyUp={handleKeyUp}
        value={[currentValue]}
        min={min}
        max={max}
        step={step}
        {...props}
      >
        <SliderPrimitive.Track
          ref={trackRef}
          className={cn(
            'relative w-full grow cursor-pointer overflow-visible transition-all duration-200',
            // Base height: 24px, expands to 28px on interaction
            'h-6',
            variant === 'capsule'
              ? 'rounded-full bg-sky-500/20'
              : 'rounded-[8px] bg-sky-500/20',
            // Expand on drag or hover for better visual feedback
            (isDragging || isPointerDown) && 'h-7 bg-sky-500/25',
            isHoveringTrack && !isDragging && '[@media(hover:hover)]:h-[26px]',
          )}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerCancel}
          onMouseEnter={() => setIsHoveringTrack(true)}
          onMouseLeave={() => setIsHoveringTrack(false)}
        >
          <SliderPrimitive.Range
            className={cn(
              'absolute h-full overflow-hidden bg-sky-300/20',
              variant === 'capsule' ? 'rounded-full' : 'rounded-l-[8px]',
              isAnimating
                ? 'transition-all duration-300 ease-out'
                : smoothAnimate && !isDragging
                  ? 'transition-all duration-150 ease-out'
                  : 'transition-colors duration-200',
              // Progressive hover states
              !isDragging &&
                !isPointerDown &&
                isHoveringTrack &&
                '[@media(hover:hover)]:bg-sky-100/50',
              (isDragging || isPointerDown) && '!bg-sky-200/50',
              isAnimating && '!bg-sky-200/50',
            )}
          />

          {/* Visual thumb indicator for better targeting */}
          <div
            ref={thumbRef}
            className={cn(
              'absolute top-1/2 -translate-x-1/2 -translate-y-1/2',
              'h-5 w-5 rounded-full',
              'bg-white shadow-md',
              'pointer-events-none',
              'transition-all duration-200',
              // Scale up on hover or drag
              isHoveringTrack &&
                !isDragging &&
                !isPointerDown &&
                '[@media(hover:hover)]:scale-110',
              (isDragging || isPointerDown) && 'scale-125 shadow-lg',
              // Add subtle glow on active state
              (isDragging || isPointerDown) && 'ring-2 ring-sky-400/50',
              // Smooth spring-like animation on reset
              isAnimating && 'scale-110',
            )}
            style={{
              left: `${((currentValue - min) / (max - min)) * 100}%`,
            }}
            aria-hidden="true"
          />
          {/* Default value marker - Enhanced with pulse animation and better hover */}
          {!hideDefaultMarker &&
            currentValue !== defaultVal &&
            (defaultMarkerStyle === 'dot' ? (
              <div
                className={cn(
                  'group/marker absolute top-1/2 -translate-x-1/2 -translate-y-1/2 cursor-pointer',
                  'h-2.5 w-2.5 rounded-full bg-white',
                  'shadow-[0_0_10px_rgba(0,0,0,0.6)]',
                  'transition-all duration-200',
                  'opacity-70',
                  // Pulse animation to draw attention
                  'animate-pulse',
                  // Enhanced hover state
                  isHoveringMarker && [
                    'scale-150',
                    'opacity-100',
                    'shadow-[0_0_12px_rgba(14,165,233,0.6)]',
                    'ring-2 ring-sky-400/40',
                  ],
                )}
                style={{ left: `${defaultPosition}%` }}
                onClick={handleDefaultMarkerClick}
                onMouseEnter={() => setIsHoveringMarker(true)}
                onMouseLeave={() => setIsHoveringMarker(false)}
                title={`Reset to default (${defaultVal})`}
                role="button"
                aria-label={`Reset to default value ${defaultVal}`}
                tabIndex={-1}
              >
                {/* Larger hit area for easier clicking (16px touch target) */}
                <div
                  className="absolute -inset-2 cursor-pointer"
                  aria-hidden="true"
                />

                {/* Tooltip - Always rendered but hidden with opacity to prevent DOM thrashing */}
                <div className="pointer-events-none absolute -top-8 left-1/2 -translate-x-1/2 whitespace-nowrap rounded bg-gray-900 px-2 py-1 text-xs text-white opacity-0 shadow-lg transition-opacity duration-200 group-hover/marker:opacity-100">
                  Reset to {defaultVal}
                  <div className="absolute left-1/2 top-full h-0 w-0 -translate-x-1/2 border-4 border-transparent border-t-gray-900" />
                </div>
              </div>
            ) : (
              <div
                className={cn(
                  'group/marker absolute bottom-[2px] top-[2px] -translate-x-1/2 cursor-pointer',
                  'w-[2px] rounded-full bg-white',
                  'shadow-[0_0_10px_rgba(0,0,0,0.6)]',
                  'transition-all duration-200',
                  'opacity-50',
                  // Pulse animation
                  'animate-pulse',
                  // Enhanced hover state
                  isHoveringMarker && [
                    'w-1',
                    'opacity-100',
                    'shadow-[0_0_12px_rgba(14,165,233,0.6)]',
                  ],
                )}
                style={{ left: `${defaultPosition}%` }}
                onClick={handleDefaultMarkerClick}
                onMouseEnter={() => setIsHoveringMarker(true)}
                onMouseLeave={() => setIsHoveringMarker(false)}
                title={`Reset to default (${defaultVal})`}
                role="button"
                aria-label={`Reset to default value ${defaultVal}`}
                tabIndex={-1}
              >
                {/* Larger hit area */}
                <div
                  className="absolute -left-2 -right-2 bottom-0 top-0 cursor-pointer"
                  aria-hidden="true"
                />

                {/* Tooltip - Always rendered but hidden with opacity to prevent DOM thrashing */}
                <div className="pointer-events-none absolute -top-8 left-1/2 -translate-x-1/2 whitespace-nowrap rounded bg-gray-900 px-2 py-1 text-xs text-white opacity-0 shadow-lg transition-opacity duration-200 group-hover/marker:opacity-100">
                  Reset to {defaultVal}
                  <div className="absolute left-1/2 top-full h-0 w-0 -translate-x-1/2 border-4 border-transparent border-t-gray-900" />
                </div>
              </div>
            ))}
        </SliderPrimitive.Track>
        <SliderPrimitive.Thumb className="hidden" />
      </SliderPrimitive.Root>
    );
  },
);
Slider.displayName = SliderPrimitive.Root.displayName;

export { Slider };
