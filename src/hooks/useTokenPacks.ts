import { supabase } from '@/lib/supabase';
import { useQuery } from '@tanstack/react-query';
import type { BillingProduct } from '@/hooks/useBillingProducts';

export function useTokenPacks() {
  return useQuery<BillingProduct[]>({
    queryKey: ['billing', 'products', 'pack'],
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke(
        'billing-products?type=pack',
        { method: 'GET' },
      );
      if (error) throw error;
      const products = (data as BillingProduct[]) ?? [];
      return [...products].sort((a, b) => a.tokenAmount - b.tokenAmount);
    },
  });
}
