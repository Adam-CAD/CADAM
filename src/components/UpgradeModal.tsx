import { useState } from 'react';
import { Check, Loader2, Zap } from 'lucide-react';

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { getLevel, useAuth } from '@/contexts/AuthContext';
import {
  useManageSubscription,
  useSubscriptionService,
} from '@/services/subscriptionService';
import { cn } from '@/lib/utils';
import {
  useSubscriptionProducts,
  type BillingProduct,
} from '@/hooks/useBillingProducts';
import {
  PLAN_DISPLAY_NAMES,
  PLAN_FEATURES,
  PLAN_ORDER,
  type PlanLevel,
} from '@/config/plan-features';

interface UpgradeModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

function formatPrice(cents: number): string {
  const dollars = cents / 100;
  return dollars % 1 === 0 ? dollars.toFixed(0) : dollars.toFixed(2);
}

function findMonthly(
  products: BillingProduct[],
  level: Exclude<PlanLevel, 'free'>,
): BillingProduct | undefined {
  return products.find(
    (p) =>
      p.subscriptionLevel === level &&
      p.interval === 'month' &&
      p.productType === 'subscription' &&
      p.active,
  );
}

function creditsBadge(level: PlanLevel, product: BillingProduct | undefined) {
  if (level === 'free') return '50 / day';
  const amount = product?.tokenAmount ?? 0;
  return `${amount.toLocaleString()} / mo`;
}

export function UpgradeModal({ open, onOpenChange }: UpgradeModalProps) {
  const { billing } = useAuth();
  const currentLevel = getLevel(billing);
  const { data: products = [] } = useSubscriptionProducts();
  const { mutate: subscribe, isPending: isSubscribing } =
    useSubscriptionService();
  const { mutate: manage, isPending: isManaging } = useManageSubscription();

  // Track which tier's button was clicked so only that one shows a spinner.
  const [activeLevel, setActiveLevel] = useState<PlanLevel | null>(null);
  const isAnyBusy = isSubscribing || isManaging;

  const handleClick = (level: PlanLevel, priceId: string | null) => {
    if (level === currentLevel) return;
    setActiveLevel(level);
    if (currentLevel === 'free' && priceId) {
      subscribe(
        { priceId, source: 'upgrade_modal' },
        { onSettled: () => setActiveLevel(null) },
      );
    } else if (currentLevel !== 'free') {
      manage(undefined, { onSettled: () => setActiveLevel(null) });
    } else {
      setActiveLevel(null);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] w-[95vw] max-w-6xl overflow-y-auto border-adam-neutral-800 bg-adam-bg-secondary-dark p-10 text-adam-neutral-10 sm:rounded-xl">
        <DialogHeader>
          <DialogTitle className="text-xl font-semibold">
            Upgrade your plan
          </DialogTitle>
          <DialogDescription className="text-sm text-adam-neutral-400">
            All plans include every AI feature. Upgrade for more credits.
          </DialogDescription>
        </DialogHeader>

        <div className="mt-2 grid grid-cols-1 gap-3 md:grid-cols-3">
          {PLAN_ORDER.map((level) => {
            const product =
              level === 'free' ? undefined : findMonthly(products, level);
            const isCurrent = level === currentLevel;
            const priceId = product?.stripePriceId ?? null;
            const isThisBusy = activeLevel === level && isAnyBusy;
            const popular = level === 'pro';
            const displayName = PLAN_DISPLAY_NAMES[level];

            return (
              <div
                key={level}
                className={cn(
                  'relative flex flex-col rounded-lg border p-5',
                  popular
                    ? 'border-adam-blue/60 bg-adam-neutral-950'
                    : 'border-adam-neutral-800 bg-adam-neutral-950/60',
                )}
              >
                {popular && (
                  <span className="absolute right-3 top-3 rounded-full bg-adam-blue/20 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-adam-blue">
                    Popular
                  </span>
                )}

                <div className="text-sm font-medium text-adam-neutral-10">
                  {displayName}
                </div>

                <div className="mt-3 flex items-baseline gap-1">
                  <span className="text-2xl font-semibold">
                    $
                    {level === 'free'
                      ? '0'
                      : formatPrice(product?.priceCents ?? 0)}
                  </span>
                  <span className="text-xs text-adam-neutral-400">/mo</span>
                </div>

                <div className="mt-3 flex items-center gap-1.5 rounded-md bg-adam-neutral-900 px-2 py-1.5 text-xs font-medium">
                  <Zap className="h-3 w-3" fill="currentColor" />
                  <span>{creditsBadge(level, product)}</span>
                </div>

                <ul className="mt-3 space-y-1.5 text-xs text-adam-neutral-300">
                  {PLAN_FEATURES[level].features.map((feature) => (
                    <li key={feature} className="flex items-start gap-1.5">
                      <Check className="mt-0.5 h-3 w-3 shrink-0 text-adam-neutral-400" />
                      <span>{feature}</span>
                    </li>
                  ))}
                </ul>

                <div className="mt-auto pt-4">
                  <Button
                    disabled={
                      isCurrent ||
                      isAnyBusy ||
                      (level !== 'free' && !priceId && currentLevel === 'free')
                    }
                    onClick={() => handleClick(level, priceId)}
                    className={cn(
                      'h-9 w-full rounded-full text-xs font-medium',
                      isCurrent
                        ? 'bg-adam-neutral-900 text-adam-neutral-400 [@media(hover:hover)]:hover:bg-adam-neutral-900 [@media(hover:hover)]:hover:text-adam-neutral-400'
                        : popular
                          ? 'bg-adam-neutral-10 text-adam-bg-dark [@media(hover:hover)]:hover:bg-white [@media(hover:hover)]:hover:text-adam-bg-dark'
                          : 'bg-adam-neutral-800 text-adam-neutral-10 [@media(hover:hover)]:hover:bg-adam-neutral-700 [@media(hover:hover)]:hover:text-adam-neutral-10',
                    )}
                  >
                    {isThisBusy ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : isCurrent ? (
                      'Current plan'
                    ) : level === 'free' ? (
                      'Downgrade'
                    ) : (
                      `Get ${displayName}`
                    )}
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      </DialogContent>
    </Dialog>
  );
}
