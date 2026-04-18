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

  if (!userData.user) {
    logError(new Error('No user found in token'), {
      functionName: 'stripe-create-portal-session',
      statusCode: 401,
    });
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  if (userError) {
    logError(userError, {
      functionName: 'stripe-create-portal-session',
      statusCode: 401,
    });
    return new Response(JSON.stringify({ error: userError.message }), {
      status: 401,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const { data: subscriptionData, error: subscriptionError } =
    await supabaseClient
      .from('subscriptions')
      .select('*')
      .eq('user_id', userData.user.id)
      .limit(1)
      .maybeSingle();

  if (subscriptionError) {
    logError(subscriptionError, {
      functionName: 'stripe-create-portal-session',
      statusCode: 500,
      userId: userData.user?.id,
      additionalContext: { operation: 'fetch_subscription' },
    });
    return new Response(JSON.stringify({ error: subscriptionError.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  if (!subscriptionData) {
    logError(new Error('No subscription found'), {
      functionName: 'stripe-create-portal-session',
      statusCode: 404,
      userId: userData.user?.id,
    });
    return new Response(JSON.stringify({ error: 'No subscription found' }), {
      status: 404,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const session = await stripe.billingPortal.sessions.create({
    return_url: Deno.env.get('ADAM_URL') ?? 'https://adam.new/app',
    customer: subscriptionData.stripe_customer_id ?? '',
  });

  if (!session.url) {
    logApiError(new Error('No session URL in billing portal response'), {
      functionName: 'stripe-create-portal-session',
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
});
