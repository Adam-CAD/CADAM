import { supabase } from '@/lib/supabase';
import { useToast } from '@/hooks/use-toast';
import { useMutation } from '@tanstack/react-query';
import posthog from 'posthog-js';
import * as Sentry from '@sentry/react';

type CheckoutResponse = { url: string };

async function invokeCheckout(body: {
  priceId: string;
  trialPeriodDays?: number;
}): Promise<CheckoutResponse> {
  const { data, error } = await supabase.functions.invoke('billing-checkout', {
    body,
  });
  if (error) throw error;
  if (!data?.url) throw new Error('No checkout URL returned');
  return data as CheckoutResponse;
}

export const useSubscriptionService = () => {
  const { toast } = useToast();

  return useMutation({
    mutationFn: async ({
      priceId,
      trialPeriodDays,
      source,
    }: {
      priceId: string;
      trialPeriodDays?: number;
      source: string;
    }) => {
      posthog.capture('subscribe_clicked', {
        source,
        price_id: priceId,
      });
      return invokeCheckout({ priceId, trialPeriodDays });
    },
    onSuccess: (data) => {
      window.location.href = data.url;
    },
    onError: (error, variables) => {
      Sentry.captureException(error, { extra: { variables } });
      toast({
        title: 'Error',
        description: 'Failed to start checkout process. Please try again.',
        variant: 'destructive',
      });
    },
  });
};

export const useTokenPackPurchase = () => {
  const { toast } = useToast();

  return useMutation({
    mutationFn: async ({ priceId }: { priceId: string }) => {
      posthog.capture('token_pack_purchase_clicked', { price_id: priceId });
      return invokeCheckout({ priceId });
    },
    onSuccess: (data) => {
      window.location.href = data.url;
    },
    onError: (error, variables) => {
      Sentry.captureException(error, { extra: { variables } });
      toast({
        title: 'Error',
        description: 'Failed to start token purchase. Please try again.',
        variant: 'destructive',
      });
    },
  });
};

export const useManageSubscription = () => {
  const { toast } = useToast();

  return useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke('billing-portal');
      if (error) throw error;
      if (!data?.url) throw new Error('No portal URL returned');
      return data as { url: string };
    },
    onSuccess: (data) => {
      window.location.href = data.url;
    },
    onError: (error, variables) => {
      Sentry.captureException(error, { extra: { variables } });
      toast({
        title: 'Error',
        description:
          'Failed to open subscription management. Please try again.',
        variant: 'destructive',
      });
    },
  });
};
