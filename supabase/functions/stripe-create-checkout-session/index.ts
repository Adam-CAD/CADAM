// Setup type definitions for built-in Supabase Runtime APIs
import '@supabase/functions-js/edge-runtime.d.ts';
import Stripe from 'stripe';
import { getCorsHeaders } from '../_shared/cors.ts';
import { getAnonSupabaseClient } from '../_shared/supabaseClient.ts';
import { initSentry, logError, logApiError } from '../_shared/sentry.ts';

// Initialize Sentry for error logging
initSentry();

const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY') ?? '', {
  apiVersion: '2024-12-18.acacia',
  httpClient: Stripe.createFetchHttpClient(),
});

const SUBSCRIPTION_LOOKUP_KEYS: Record<string, 'pro' | 'standard'> = {
  standard_monthly: 'standard',
  standard_yearly: 'standard',
  pro_monthly: 'pro',
  pro_yearly: 'pro',
};

function jsonResponse(
  body: unknown,
  corsHeaders: ReturnType<typeof getCorsHeaders>,
  status = 200,
) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

Deno.serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);

  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const supabaseClient = getAnonSupabaseClient({
    global: {
      headers: { Authorization: req.headers.get('Authorization') ?? '' },
    },
  });

  const { data: userData, error: userError } =
    await supabaseClient.auth.getUser();

  const {
    lookupKey,
    trial,
    mode,
  }: {
    lookupKey: string;
    trial: boolean;
    mode?: 'subscription' | 'token_pack';
  } = await req.json();

  if (!userData.user) {
    logError(new Error('No user found in token'), {
      functionName: 'stripe-create-checkout-session',
      statusCode: 401,
    });
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  if (userError) {
    logError(userError, {
      functionName: 'stripe-create-checkout-session',
      statusCode: 401,
    });
    return new Response(JSON.stringify({ error: userError.message }), {
      status: 401,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const { data: profileData, error: profileError } = await supabaseClient
    .from('profiles')
    .select('*')
    .eq('user_id', userData.user.id)
    .limit(1)
    .single();

  if (profileError || !profileData) {
    logError(profileError, {
      functionName: 'stripe-create-checkout-session',
      statusCode: 500,
      userId: userData.user?.id,
      additionalContext: { operation: 'fetch_profile' },
    });

    return new Response(JSON.stringify({ error: profileError.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const email = userData.user.email;

  const { data: subscriptionData, error: subscriptionError } =
    await supabaseClient
      .from('subscriptions')
      .select('*')
      .eq('user_id', userData.user.id)
      .limit(1)
      .maybeSingle();

  if (subscriptionError) {
    logError(subscriptionError, {
      functionName: 'stripe-create-checkout-session',
      statusCode: 500,
      userId: userData.user?.id,
      additionalContext: { operation: 'fetch_subscription' },
    });
    return new Response(JSON.stringify({ error: subscriptionError.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  // For subscription-related requests, redirect existing subscribers to billing portal
  if (
    mode !== 'token_pack' &&
    subscriptionData &&
    subscriptionData.stripe_customer_id
  ) {
    const session = await stripe.billingPortal.sessions.create({
      return_url: Deno.env.get('ADAM_URL') ?? 'https://adam.new/app',
      customer: subscriptionData.stripe_customer_id,
    });

    if (!session.url) {
      logApiError(new Error('No session URL in billing portal response'), {
        functionName: 'stripe-create-checkout-session',
        apiName: 'Stripe billing portal',
        statusCode: 500,
        userId: userData.user?.id,
        requestData: { customerId: subscriptionData.stripe_customer_id },
      });
      return new Response(JSON.stringify({ error: 'No session URL' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({ url: session.url }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  // Resolve Stripe customer ID: use existing from subscription, or find/create
  let customerId = subscriptionData?.stripe_customer_id ?? '';

  if (!customerId) {
    const customer = await stripe.customers.list({ email });

    if (customer.data.length === 0) {
      const newCustomer = await stripe.customers.create({
        name: profileData.full_name,
        email,
        metadata: { user_id: userData.user.id },
      });

      customerId = newCustomer.id;
    } else {
      customerId = customer.data[0].id;
    }
  }

  if (typeof lookupKey !== 'string' || lookupKey.trim() === '') {
    return jsonResponse({ error: 'Invalid lookup key' }, corsHeaders, 400);
  }

  if (mode && !['subscription', 'token_pack'].includes(mode)) {
    return jsonResponse({ error: 'Invalid checkout mode' }, corsHeaders, 400);
  }

  let tokenPack: {
    stripe_lookup_key: string;
    token_amount: number;
    price_cents: number;
  } | null = null;

  if (mode === 'token_pack') {
    const { data: packData, error: packError } = await supabaseClient
      .from('token_pack_products')
      .select('stripe_lookup_key, token_amount, price_cents')
      .eq('stripe_lookup_key', lookupKey)
      .eq('active', true)
      .maybeSingle();

    if (packError || !packData) {
      logError(packError ?? new Error(`Invalid token pack: ${lookupKey}`), {
        functionName: 'stripe-create-checkout-session',
        statusCode: 400,
        userId: userData.user?.id,
        additionalContext: { lookupKey },
      });
      return jsonResponse({ error: 'Invalid token pack' }, corsHeaders, 400);
    }

    tokenPack = packData;
  } else if (!SUBSCRIPTION_LOOKUP_KEYS[lookupKey]) {
    logError(new Error(`Invalid subscription lookup key: ${lookupKey}`), {
      functionName: 'stripe-create-checkout-session',
      statusCode: 400,
      userId: userData.user?.id,
      additionalContext: { lookupKey },
    });
    return jsonResponse(
      { error: 'Invalid subscription lookup key' },
      corsHeaders,
      400,
    );
  }

  // Resolve price via lookup key after server-side allowlist validation.
  const price = await stripe.prices.list({ lookup_keys: [lookupKey] });

  if (price.data.length === 0) {
    logError(new Error(`Invalid lookup key: ${lookupKey}`), {
      functionName: 'stripe-create-checkout-session',
      statusCode: 400,
      userId: userData.user?.id,
      additionalContext: { lookupKey },
    });
    return new Response(JSON.stringify({ error: 'Invalid lookup key' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const selectedPrice = price.data[0];
  if (
    !selectedPrice.active ||
    selectedPrice.lookup_key !== lookupKey ||
    (mode === 'token_pack' && selectedPrice.type !== 'one_time') ||
    (mode !== 'token_pack' && selectedPrice.type !== 'recurring')
  ) {
    return jsonResponse(
      { error: 'Invalid price configuration' },
      corsHeaders,
      400,
    );
  }

  if (
    mode === 'token_pack' &&
    tokenPack &&
    selectedPrice.unit_amount !== tokenPack.price_cents
  ) {
    return jsonResponse(
      { error: 'Token pack price mismatch' },
      corsHeaders,
      400,
    );
  }

  // Handle token pack one-time purchases
  if (mode === 'token_pack') {
    const tokenPackSession = await stripe.checkout.sessions.create({
      line_items: [{ price: selectedPrice.id, quantity: 1 }],
      mode: 'payment',
      success_url: Deno.env.get('ADAM_URL') ?? 'https://adam.new/app',
      cancel_url: Deno.env.get('ADAM_URL') ?? 'https://adam.new/app',
      customer: customerId,
      client_reference_id: userData.user.id,
    });

    if (!tokenPackSession.url) {
      logApiError(new Error('No session URL in token pack checkout response'), {
        functionName: 'stripe-create-checkout-session',
        apiName: 'Stripe checkout session (token pack)',
        statusCode: 500,
        userId: userData.user?.id,
        requestData: { customerId, lookupKey },
      });
      return new Response(JSON.stringify({ error: 'No session URL' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({ url: tokenPackSession.url }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const level = SUBSCRIPTION_LOOKUP_KEYS[lookupKey];

  let hasTrialed = false;
  const { data: trialData } = await supabaseClient
    .from('trial_users')
    .select('*')
    .eq('user_id', userData.user.id);

  if (trialData && trialData.length > 0) {
    hasTrialed = true;
  }

  const session = await stripe.checkout.sessions.create({
    line_items: [{ price: selectedPrice.id, quantity: 1 }],
    mode: 'subscription',
    allow_promotion_codes: true,
    success_url: Deno.env.get('ADAM_URL') ?? 'https://adam.new/app',
    cancel_url: Deno.env.get('ADAM_URL') ?? 'https://adam.new/app',
    customer: customerId,
    client_reference_id: userData.user.id,
    metadata: { level },
    ...(!hasTrialed &&
      trial && { subscription_data: { trial_period_days: 7 } }),
  });

  if (!session.url) {
    logApiError(new Error('No session URL in checkout session response'), {
      functionName: 'stripe-create-checkout-session',
      apiName: 'Stripe checkout session',
      statusCode: 500,
      userId: userData.user?.id,
      requestData: { customerId, lookupKey, trial, hasTrialed, level },
    });
    return new Response(JSON.stringify({ error: 'No session URL' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  return new Response(JSON.stringify({ url: session.url }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
});
