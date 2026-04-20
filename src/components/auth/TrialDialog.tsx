import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { Check } from 'lucide-react';
import FreeTrialButton from '@/components/ui/FreeTrialButton';
import { useSubscriptionService } from '@/services/subscriptionService';
import { useSubscriptionProducts } from '@/hooks/useBillingProducts';

export function TrialDialog({
  open,
  onOpenChange,
  children,
}: {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  children?: React.ReactNode;
}) {
  const { user } = useAuth();
  const navigate = useNavigate();

  const { data: products = [] } = useSubscriptionProducts();
  const { mutate: createCheckoutSession, isPending } = useSubscriptionService();

  const proMonthly = products.find(
    (p) =>
      p.subscriptionLevel === 'pro' &&
      p.interval === 'month' &&
      p.productType === 'subscription' &&
      p.active,
  );

  const handleSubscribe = () => {
    if (!user) {
      navigate('/signin');
      return;
    }
    if (!proMonthly) return;
    createCheckoutSession({
      priceId: proMonthly.stripePriceId,
      trialPeriodDays: 7,
      source: 'trial_dialog',
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {children && <DialogTrigger asChild>{children}</DialogTrigger>}
      <DialogContent
        className="flex w-[350px] max-w-md flex-col items-center rounded-lg px-10 py-8 text-center md:w-full md:p-16"
        onOpenAutoFocus={(e) => {
          e.preventDefault(); // Prevent any focus behavior when dialog opens
        }}
      >
        <DialogHeader className="w-full">
          <DialogTitle className="text-center text-xl text-adam-text-primary md:text-2xl">
            Here's 7 days of <span className="text-adam-blue">Adam Pro</span>
          </DialogTitle>
        </DialogHeader>
        <DialogDescription className="w-full text-sm text-adam-neutral-100">
          Experience all Pro features for 7 days, completely free.
        </DialogDescription>

        <div className="my-6 flex w-full justify-center">
          <FreeTrialButton
            text="Start your Free Trial"
            onClick={handleSubscribe}
            isPending={isPending}
            disabled={isPending || !proMonthly}
          />
        </div>

        <ul className="space-y-3 text-sm md:text-base">
          <li className="flex items-center gap-2">
            <Check className="h-4 w-4 text-adam-neutral-100" />
            <span className="text-adam-neutral-100">
              5,000 tokens per month
            </span>
          </li>
          <li className="flex items-center gap-2">
            <Check className="h-4 w-4 text-adam-neutral-100" />
            <span className="text-adam-neutral-100">
              Phone number of founders
            </span>
          </li>
          <li className="flex items-center gap-2">
            <Check className="h-4 w-4 text-adam-neutral-100" />
            <span className="text-adam-neutral-100">
              Exclusive access to new features
            </span>
          </li>
          <li className="flex items-center gap-2">
            <Check className="h-4 w-4 text-adam-neutral-100" />
            <span className="text-adam-neutral-100">Good vibes</span>
          </li>
        </ul>
        <p className="mt-4 w-full text-center text-xs text-adam-neutral-200">
          Cancel anytime
        </p>
      </DialogContent>
    </Dialog>
  );
}
