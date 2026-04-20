import { supabase } from '@/lib/supabase';
import { useQuery } from '@tanstack/react-query';

export type SubscriptionLevel = 'standard' | 'pro';

export type BillingProduct = {
  id: string;
  stripeProductId: string;
  stripePriceId: string;
  productType: 'subscription' | 'pack';
  subscriptionLevel: SubscriptionLevel | null;
  tokenAmount: number;
  name: string;
  priceCents: number;
  interval: string | null;
  active: boolean;
};

export function useSubscriptionProducts() {
  return useQuery<BillingProduct[]>({
    queryKey: ['billing', 'products', 'subscription'],
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke(
        'billing-products?type=subscription',
        { method: 'GET' },
      );
      if (error) throw error;
      return (data as BillingProduct[]) ?? [];
    },
  });
}
