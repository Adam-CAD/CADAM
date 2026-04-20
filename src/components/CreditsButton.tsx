import { useEffect, useRef, useState } from 'react';
import { Zap } from 'lucide-react';
import { Link } from 'react-router-dom';

import { Button } from '@/components/ui/button';
import { UpgradeModal } from '@/components/UpgradeModal';
import { useIsMobile } from '@/hooks/useIsMobile';
import { getLevel, useAuth } from '@/contexts/AuthContext';
import { cn } from '@/lib/utils';

function formatCompact(n: number): string {
  if (n >= 1_000_000) {
    const v = n / 1_000_000;
    return `${v >= 10 ? v.toFixed(0) : v.toFixed(1)}M`;
  }
  if (n >= 1_000) {
    const v = n / 1_000;
    return `${v >= 100 ? v.toFixed(0) : v.toFixed(1)}K`;
  }
  return n.toLocaleString();
}

function formatFull(n: number): string {
  return n.toLocaleString();
}

function formatPeriodEnd(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export function CreditsButton() {
  const isMobile = useIsMobile();
  const { user, billing } = useAuth();
  const level = getLevel(billing);
  const totalTokens = billing?.tokens.total ?? 0;
  const freeTokens = billing?.tokens.free ?? 0;
  const subscriptionTokens = billing?.tokens.subscription ?? 0;
  const purchasedTokens = billing?.tokens.purchased ?? 0;
  const periodEnd = formatPeriodEnd(
    billing?.subscription?.currentPeriodEnd ?? null,
  );

  const [open, setOpen] = useState(false);
  // Card opened by click stays pinned — mouse-leave alone won't dismiss it.
  // Only outside-click (or an explicit close action) clears this.
  const [pinnedByClick, setPinnedByClick] = useState(false);
  const [upgradeOpen, setUpgradeOpen] = useState(false);
  const openTimer = useRef<number | null>(null);
  const closeTimer = useRef<number | null>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);

  // Close when clicking outside while open (dismisses both hover + click open states)
  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      if (e.target instanceof Node && wrapperRef.current?.contains(e.target)) {
        return;
      }
      setOpen(false);
      setPinnedByClick(false);
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [open]);

  // Clear any in-flight hover timers when the component unmounts (e.g. the
  // user navigates away from `/` while a 300ms open-delay is still pending).
  useEffect(() => {
    return () => {
      if (openTimer.current) window.clearTimeout(openTimer.current);
      if (closeTimer.current) window.clearTimeout(closeTimer.current);
    };
  }, []);

  // Drop any pinned/hover state when crossing into the mobile renderer so
  // resizing back to desktop doesn't re-surface a stale popover.
  useEffect(() => {
    if (!isMobile) return;
    setOpen(false);
    setPinnedByClick(false);
    if (openTimer.current) {
      window.clearTimeout(openTimer.current);
      openTimer.current = null;
    }
    if (closeTimer.current) {
      window.clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
  }, [isMobile]);

  if (!user) return null;

  if (isMobile) {
    return (
      <Link
        to="/subscription"
        aria-label="View credits"
        className={cn(
          'inline-flex items-center gap-1.5 rounded-full',
          'bg-adam-neutral-950 px-3 py-1.5 text-sm font-medium',
          'text-adam-neutral-10 shadow-sm',
          'border border-white/5',
        )}
      >
        <Zap className="h-3.5 w-3.5" fill="currentColor" />
        <span>{formatCompact(totalTokens)}</span>
      </Link>
    );
  }

  const isFree = level === 'free';
  const headerLabel = isFree
    ? 'Daily credits'
    : periodEnd
      ? `Renews ${periodEnd}`
      : 'Current credits';

  const handleEnter = () => {
    if (closeTimer.current) {
      window.clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
    if (open) return;
    // slight hover-intent delay so brushing past the pill doesn't pop the card
    if (openTimer.current) window.clearTimeout(openTimer.current);
    openTimer.current = window.setTimeout(() => setOpen(true), 300);
  };

  const handleLeave = () => {
    if (openTimer.current) {
      window.clearTimeout(openTimer.current);
      openTimer.current = null;
    }
    // If the user explicitly clicked to pin the card, don't auto-close on
    // mouse-leave — they'll dismiss it themselves via outside-click.
    if (pinnedByClick) return;
    // small delay so moving between pill and card doesn't flicker the card closed
    closeTimer.current = window.setTimeout(() => setOpen(false), 120);
  };

  const handlePillClick = () => {
    setOpen(true);
    setPinnedByClick(true);
    if (openTimer.current) {
      window.clearTimeout(openTimer.current);
      openTimer.current = null;
    }
    if (closeTimer.current) {
      window.clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
  };

  return (
    <>
      <UpgradeModal open={upgradeOpen} onOpenChange={setUpgradeOpen} />
      <div
        ref={wrapperRef}
        className="relative"
        onMouseEnter={handleEnter}
        onMouseLeave={handleLeave}
      >
        <button
          type="button"
          onClick={handlePillClick}
          aria-haspopup="dialog"
          aria-expanded={open}
          aria-label="View credits"
          className={cn(
            'inline-flex items-center gap-1.5 rounded-full',
            'bg-adam-neutral-950 px-3 py-1.5 text-sm font-medium',
            'text-adam-neutral-10 shadow-sm',
            'border border-white/5',
            'transition-colors',
            '[@media(hover:hover)]:hover:bg-adam-neutral-900',
          )}
        >
          <Zap className="h-3.5 w-3.5" fill="currentColor" />
          <span>{formatCompact(totalTokens)}</span>
        </button>

        {open && (
          <div
            className={cn(
              'absolute right-0 top-full z-50 mt-2 w-[320px]',
              'rounded-md border border-adam-neutral-800 bg-adam-bg-secondary-dark text-adam-neutral-10 shadow-lg',
              'animate-in fade-in-0 zoom-in-95',
            )}
            onMouseEnter={handleEnter}
            onMouseLeave={handleLeave}
          >
            {/* Header */}
            <div className="flex items-start justify-between gap-3 px-4 pb-3 pt-4">
              <div className="text-base font-semibold leading-tight">
                {headerLabel}
              </div>
              <Button
                size="sm"
                onClick={() => {
                  setOpen(false);
                  setPinnedByClick(false);
                  setUpgradeOpen(true);
                }}
                className="h-8 rounded-full bg-adam-neutral-10 px-4 text-xs font-medium text-adam-bg-dark [@media(hover:hover)]:hover:bg-white [@media(hover:hover)]:hover:text-adam-bg-dark"
              >
                Upgrade
              </Button>
            </div>

            <div className="h-px bg-adam-neutral-800" />

            {/* Credits breakdown */}
            <div className="px-4 py-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Zap
                    className="h-4 w-4 text-adam-neutral-10"
                    fill="currentColor"
                  />
                  <span className="text-sm font-medium">Credits</span>
                </div>
                <span className="text-sm font-semibold tabular-nums">
                  {formatFull(totalTokens)}
                </span>
              </div>

              <div className="mt-2 space-y-1 pl-6 text-xs text-adam-neutral-400">
                {isFree && (
                  <div className="flex items-center justify-between">
                    <span>Daily credits</span>
                    <span className="tabular-nums">
                      {formatFull(freeTokens)}
                    </span>
                  </div>
                )}
                {!isFree && (
                  <div className="flex items-center justify-between">
                    <span>Monthly credits</span>
                    <span className="tabular-nums">
                      {formatFull(subscriptionTokens)}
                    </span>
                  </div>
                )}
                <div className="flex items-center justify-between">
                  <span>Add-on credits</span>
                  <span className="tabular-nums">
                    {formatFull(purchasedTokens)}
                  </span>
                </div>
              </div>
            </div>

            <div className="h-px bg-adam-neutral-800" />

            {/* Footer link */}
            <Link
              to="/subscription"
              className="flex w-full items-center justify-between px-4 py-3 text-sm text-adam-neutral-10 [@media(hover:hover)]:hover:bg-adam-neutral-900"
            >
              <span>View plans</span>
              <span aria-hidden>→</span>
            </Link>
          </div>
        )}
      </div>
    </>
  );
}
