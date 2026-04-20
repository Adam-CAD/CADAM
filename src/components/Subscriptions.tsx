import { useNavigate } from 'react-router-dom';
import { Check, Loader2, Sparkles } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { getLevel, useAuth } from '@/contexts/AuthContext';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  useManageSubscription,
  useSubscriptionService,
  useTokenPackPurchase,
} from '@/services/subscriptionService';
import { useTokenPacks } from '@/hooks/useTokenPacks';
import {
  useSubscriptionProducts,
  type BillingProduct,
  type SubscriptionLevel,
} from '@/hooks/useBillingProducts';
import {
  PLAN_DISPLAY_NAMES,
  PLAN_FEATURES,
  type PlanLevel,
} from '@/config/plan-features';

type Cadence = 'monthly' | 'yearly';

type SubscriptionTier = {
  level: PlanLevel;
  displayName: string;
  price: string;
  oldPrice?: string;
  priceId: string | null;
  tokenAmount: number | null;
  popular: boolean;
};

const DISPLAY_ORDER: PlanLevel[] = ['free', 'pro', 'standard'];

function formatPrice(cents: number): string {
  const dollars = cents / 100;
  return dollars % 1 === 0 ? dollars.toFixed(0) : dollars.toFixed(2);
}

function monthlyEquivalent(product: BillingProduct): number {
  if (product.interval === 'year') return product.priceCents / 12;
  return product.priceCents;
}

function findProduct(
  products: BillingProduct[],
  level: SubscriptionLevel,
  interval: 'month' | 'year',
): BillingProduct | undefined {
  return products.find(
    (p) =>
      p.subscriptionLevel === level &&
      p.interval === interval &&
      p.productType === 'subscription' &&
      p.active,
  );
}

function buildTier(
  products: BillingProduct[],
  level: PlanLevel,
  cadence: Cadence,
): SubscriptionTier | null {
  if (level === 'free') {
    return {
      level: 'free',
      displayName: PLAN_DISPLAY_NAMES.free,
      price: '0',
      priceId: null,
      tokenAmount: null,
      popular: false,
    };
  }
  const interval: 'month' | 'year' = cadence === 'yearly' ? 'year' : 'month';
  const product = findProduct(products, level, interval);
  if (!product) return null;
  const monthly = findProduct(products, level, 'month');
  const tier: SubscriptionTier = {
    level,
    displayName: PLAN_DISPLAY_NAMES[level],
    price: formatPrice(monthlyEquivalent(product)),
    priceId: product.stripePriceId,
    tokenAmount: product.tokenAmount,
    popular: level === 'pro',
  };
  if (cadence === 'yearly' && monthly) {
    tier.oldPrice = formatPrice(monthly.priceCents);
  }
  return tier;
}

function creditsLine(tier: SubscriptionTier): string {
  if (tier.level === 'free') return '50 credits per day';
  const amount = tier.tokenAmount?.toLocaleString() ?? '';
  return `${amount} credits per month`;
}

export function Subscriptions() {
  const navigate = useNavigate();
  const { user, billing } = useAuth();
  const currentLevel = getLevel(billing);

  const { data: products = [] } = useSubscriptionProducts();

  const { mutate: handleSubscribeMutation, isPending: isSubscribeLoading } =
    useSubscriptionService();
  const { mutate: handleManageSubscription, isPending: isManageLoading } =
    useManageSubscription();
  const { data: tokenPacks = [] } = useTokenPacks();
  const {
    mutate: purchaseTokenPack,
    isPending: isPurchaseLoading,
    variables: purchaseVariables,
  } = useTokenPackPurchase();

  const buildTiers = (cadence: Cadence): SubscriptionTier[] =>
    DISPLAY_ORDER.map((level) => buildTier(products, level, cadence)).filter(
      (t): t is SubscriptionTier => t !== null,
    );

  const yearlyTiers = buildTiers('yearly');
  const monthlyTiers = buildTiers('monthly');

  const handleSubscribe = (priceId: string) => {
    if (!user) {
      navigate('/signin');
      return;
    }
    handleSubscribeMutation({ priceId, source: 'subscriptions' });
  };

  const renderTiers = (tiers: SubscriptionTier[]) => (
    <div className="flex flex-col items-center gap-4 px-4 md:flex-row md:items-stretch md:justify-center md:px-8">
      {tiers.map((tier) => (
        <SubscriptionCard
          key={tier.level}
          tier={tier}
          currentLevel={currentLevel}
          isLoading={isSubscribeLoading || isManageLoading}
          onSubscribe={handleSubscribe}
          onManage={() => handleManageSubscription()}
          totalCards={tiers.length}
        />
      ))}
    </div>
  );

  return (
    <div className="min-h-screen w-full bg-adam-bg-secondary-dark">
      <div className="flex min-h-screen w-full flex-col items-center justify-center py-12">
        <div className="w-full max-w-5xl">
          <div className="mb-8 px-8 text-center">
            <h1 className="mb-2 font-kumbh-sans text-3xl font-light text-white">
              Choose a plan that works for you
            </h1>
            <p className="text-sm text-adam-neutral-300">
              All plans include access to every AI feature. Upgrade for more
              tokens.
            </p>
          </div>

          <Tabs
            defaultValue="monthly"
            className="flex w-full flex-col items-center"
          >
            <TabsList className="mb-8 border border-adam-neutral-700 bg-adam-neutral-900">
              <TabsTrigger
                value="monthly"
                className="data-[state=active]:bg-adam-neutral-100 data-[state=active]:text-adam-neutral-900"
              >
                Monthly
              </TabsTrigger>
              <TabsTrigger
                value="yearly"
                className="pr-1.5 data-[state=active]:bg-adam-neutral-100 data-[state=active]:text-adam-neutral-900"
              >
                Annual
                <span className="ml-1.5 rounded-full bg-adam-blue/20 px-2 text-[10px] font-medium text-adam-blue">
                  -40%
                </span>
              </TabsTrigger>
            </TabsList>

            <TabsContent value="yearly" className="w-full">
              {renderTiers(yearlyTiers)}
            </TabsContent>
            <TabsContent value="monthly" className="w-full">
              {renderTiers(monthlyTiers)}
            </TabsContent>
          </Tabs>

          {/* Token Packs */}
          {tokenPacks.length > 0 && (
            <div className="mt-12 px-8">
              <div className="mx-auto max-w-2xl text-center">
                <h2 className="mb-2 text-xl font-light text-white">
                  Need more tokens?
                </h2>
                <p className="mb-6 text-sm text-adam-neutral-300">
                  Purchase token packs that never expire. Use them anytime.
                </p>
                <div className="flex flex-wrap justify-center gap-3">
                  {tokenPacks.map((pack) => {
                    const isThisPending =
                      isPurchaseLoading &&
                      purchaseVariables?.priceId === pack.stripePriceId;
                    return (
                      <Button
                        key={pack.id}
                        variant="dark"
                        className="rounded-full border border-adam-neutral-700 px-5 font-light"
                        disabled={isPurchaseLoading}
                        onClick={() =>
                          purchaseTokenPack({ priceId: pack.stripePriceId })
                        }
                      >
                        {isThisPending && (
                          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        )}
                        {`${pack.tokenAmount.toLocaleString()} tokens — $${formatPrice(pack.priceCents)}`}
                      </Button>
                    );
                  })}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function SubscriptionCard({
  tier,
  currentLevel,
  isLoading,
  onSubscribe,
  onManage,
  totalCards,
}: {
  tier: SubscriptionTier;
  currentLevel: PlanLevel;
  isLoading: boolean;
  onSubscribe: (priceId: string) => void;
  onManage: () => void;
  totalCards: number;
}) {
  const isCurrent = tier.level === currentLevel;
  const features = [creditsLine(tier), ...PLAN_FEATURES[tier.level]];

  return (
    <Card
      className={cn(
        'relative flex w-full flex-col border bg-adam-neutral-950 transition-all duration-200',
        totalCards === 2 ? 'md:max-w-[340px]' : 'md:max-w-[300px]',
        tier.popular
          ? 'border-adam-blue/50 bg-adam-blue/[0.04] shadow-[0_0_40px_-8px_rgba(0,166,255,0.2)]'
          : 'border-adam-neutral-800',
      )}
    >
      {tier.popular && (
        <div className="absolute -top-3 left-1/2 -translate-x-1/2">
          <span className="flex items-center gap-1 rounded-full bg-adam-blue px-3 py-1 text-xs font-medium text-white">
            <Sparkles className="h-3 w-3" />
            Most Popular
          </span>
        </div>
      )}

      <CardHeader className="pb-2 pt-6">
        <div className="mb-1 text-sm font-medium text-adam-neutral-300">
          {tier.displayName}
        </div>
        <div className="flex items-baseline gap-1">
          {tier.oldPrice && (
            <span className="text-sm text-adam-neutral-500 line-through">
              ${tier.oldPrice}
            </span>
          )}
          <span className="text-4xl font-light text-white">${tier.price}</span>
          <span className="text-sm text-adam-neutral-400">/mo</span>
        </div>
      </CardHeader>

      <CardContent className="flex-1 pb-4 pt-4">
        <ul className="flex flex-col gap-2.5">
          {features.map((feature) => (
            <li key={feature} className="flex items-start gap-2.5">
              <Check className="mt-0.5 h-4 w-4 flex-shrink-0 text-adam-blue" />
              <span className="text-sm text-adam-neutral-200">{feature}</span>
            </li>
          ))}
        </ul>
      </CardContent>

      <CardFooter className="pb-6 pt-2">
        {isCurrent ? (
          <Button
            className="h-10 w-full rounded-full bg-adam-neutral-800 text-sm font-medium text-adam-neutral-400"
            disabled
          >
            Current Plan
          </Button>
        ) : tier.level === 'free' && currentLevel !== 'free' ? (
          <Button
            className="h-10 w-full rounded-full bg-adam-neutral-800 text-sm font-medium text-adam-neutral-200 hover:bg-adam-neutral-700"
            onClick={onManage}
          >
            Manage Plan
          </Button>
        ) : (
          <Button
            className={cn(
              'h-10 w-full rounded-full text-sm font-medium transition-all',
              tier.popular
                ? 'bg-adam-blue text-white hover:bg-adam-blue/90'
                : 'bg-adam-neutral-100 text-adam-neutral-900 hover:bg-white',
            )}
            onClick={() =>
              currentLevel !== 'free'
                ? onManage()
                : tier.priceId && onSubscribe(tier.priceId)
            }
            disabled={isLoading || (!tier.priceId && currentLevel === 'free')}
          >
            {isLoading ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Loading...
              </>
            ) : currentLevel !== 'free' ? (
              'Manage Plan'
            ) : (
              `Get ${tier.displayName}`
            )}
          </Button>
        )}
      </CardFooter>
    </Card>
  );
}
