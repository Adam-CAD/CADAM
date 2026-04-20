import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { corsHeaders } from '../_shared/cors.ts';
import { billing, BillingClientError } from '../_shared/billingClient.ts';
import { getAnonSupabaseClient } from '../_shared/supabaseClient.ts';
import { initSentry, logError } from '../_shared/sentry.ts';

initSentry();

const appUrl = (): string => Deno.env.get('ADAM_URL') ?? 'https://adam.new/app';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const supabase = getAnonSupabaseClient({
    global: {
      headers: { Authorization: req.headers.get('Authorization') ?? '' },
    },
  });

  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError || !userData.user || !userData.user.email) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  let body: { priceId?: string; trialPeriodDays?: number };
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: 'invalid_body' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
  if (!body.priceId || typeof body.priceId !== 'string') {
    return new Response(JSON.stringify({ error: 'priceId required' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  try {
    const { url } = await billing.createCheckout(userData.user.email, {
      priceId: body.priceId,
      successUrl: appUrl(),
      cancelUrl: appUrl(),
      trialPeriodDays: body.trialPeriodDays,
    });
    return new Response(JSON.stringify({ url }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    const status = err instanceof BillingClientError ? err.status : 502;
    logError(err, {
      functionName: 'billing-checkout',
      statusCode: status,
      userId: userData.user.id,
      additionalContext: { priceId: body.priceId },
    });
    return new Response(JSON.stringify({ error: 'checkout_failed' }), {
      status,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
