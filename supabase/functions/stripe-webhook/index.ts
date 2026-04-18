import '@supabase/functions-js/edge-runtime.d.ts';
import Stripe from 'stripe';
import { getServiceRoleSupabaseClient } from '../_shared/supabaseClient.ts';
import { initSentry, logError, logApiError } from '../_shared/sentry.ts';

// Initialize Sentry for error logging
initSentry();

const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY') as string, {
  apiVersion: '2024-12-18.acacia',
  httpClient: Stripe.createFetchHttpClient(),
});
const cryptoProvider = Stripe.createSubtleCryptoProvider();

const supabaseClient = getServiceRoleSupabaseClient();

Deno.serve(async (request) => {
  const signature = request.headers.get('Stripe-Signature');
  const webhookSecret = Deno.env.get('STRIPE_WEBHOOK_SIGNING_SECRET');

  if (!signature) {
    return new Response('Missing Stripe signature', { status: 400 });
  }

  if (!webhookSecret) {
    logError(new Error('Missing STRIPE_WEBHOOK_SIGNING_SECRET'), {
      functionName: 'stripe-webhook',
      statusCode: 500,
    });
    return new Response('Webhook not configured', { status: 500 });
  }

  const body = await request.text();
  let event;
  try {
    event = await stripe.webhooks.constructEventAsync(
      body,
      signature,
      webhookSecret,
      undefined,
      cryptoProvider,
    );
  } catch (err) {
    logApiError(err, {
      functionName: 'stripe-webhook',
      apiName: 'Stripe webhook construct',
      statusCode: 400,
      requestData: { hasSignature: !!signature },
    });
    return new Response((err as Error).message, { status: 400 });
  }

  let retrievedEvent;
  try {
    retrievedEvent = await stripe.events.retrieve(event.id);
  } catch (err) {
    logApiError(err, {
      functionName: 'stripe-webhook',
      apiName: 'Stripe event retrieve',
      statusCode: 400,
      requestData: { eventId: event.id },
    });
    return new Response((err as Error).message, { status: 400 });
  }

  if (
    !(await claimStripeEvent(
      retrievedEvent.id,
      retrievedEvent.type,
      stripeTimestampToIso(retrievedEvent.created),
      getStripeObjectIdForEvent(retrievedEvent),
    ))
  ) {
    return new Response(JSON.stringify({ ok: true, duplicate: true }), {
      status: 200,
    });
  }

  try {
    let response: Response;
    switch (retrievedEvent.type) {
      case 'customer.subscription.updated':
        response = await handleCustomerSubscriptionUpdated(retrievedEvent);
        break;
      case 'customer.subscription.deleted':
        response = await handleCustomerSubscriptionDeleted(retrievedEvent);
        break;
      case 'checkout.session.completed':
        response = await handleCheckoutSessionCompleted(retrievedEvent);
        break;
      case 'invoice.paid':
        response = await handleInvoicePaid(retrievedEvent);
        break;
      default:
        response = new Response(JSON.stringify({ ok: true }), { status: 200 });
        break;
    }

    if (response.status >= 500) {
      await releaseStripeEvent(retrievedEvent.id);
    } else {
      await markStripeEventProcessed(retrievedEvent.id);
    }

    return response;
  } catch (error) {
    await releaseStripeEvent(retrievedEvent.id);
    logError(error, {
      functionName: 'stripe-webhook',
      statusCode: 500,
      additionalContext: { eventId: retrievedEvent.id },
    });
    return new Response(
      JSON.stringify({ error: 'Webhook processing failed' }),
      {
        status: 500,
      },
    );
  }
});

async function claimStripeEvent(
  eventId: string,
  eventType: string,
  eventCreatedAt: string,
  stripeObjectId: string | null,
) {
  const { error } = await supabaseClient.from('stripe_webhook_events').insert({
    event_id: eventId,
    event_type: eventType,
    status: 'processing',
    stripe_event_created_at: eventCreatedAt,
    stripe_object_id: stripeObjectId,
  });

  if (!error) return true;

  if (error.code === '23505') {
    return false;
  }

  throw error;
}

async function markStripeEventProcessed(eventId: string) {
  await supabaseClient
    .from('stripe_webhook_events')
    .update({ status: 'processed', processed_at: new Date().toISOString() })
    .eq('event_id', eventId);
}

async function releaseStripeEvent(eventId: string) {
  await supabaseClient
    .from('stripe_webhook_events')
    .delete()
    .eq('event_id', eventId);
}

async function grantSubscriptionTokens(
  userId: string,
  tokenAmount: number,
  expiresAt: string,
  referenceId: string,
  force = false,
) {
  const { error } = await supabaseClient.rpc('grant_subscription_tokens', {
    p_user_id: userId,
    p_token_amount: tokenAmount,
    p_expires_at: expiresAt,
    p_reference_id: referenceId,
    p_force: force,
  });

  if (error) throw error;
}

function stripeTimestampToIso(timestamp: number) {
  return new Date(timestamp * 1000).toISOString();
}

function getStripeObjectIdForEvent(event: Stripe.Event) {
  switch (event.type) {
    case 'customer.subscription.updated':
    case 'customer.subscription.deleted':
      return event.data.object.id;
    case 'checkout.session.completed': {
      const subscription = event.data.object.subscription;
      return typeof subscription === 'string'
        ? subscription
        : (subscription?.id ?? null);
    }
    case 'invoice.paid': {
      const subscription = event.data.object.subscription;
      return typeof subscription === 'string'
        ? subscription
        : (subscription?.id ?? null);
    }
    default:
      return null;
  }
}

function getSubscriptionPeriodEnd(subscription: Stripe.Subscription) {
  return stripeTimestampToIso(subscription.current_period_end);
}

function isNewerStripeEvent(
  existingEventCreatedAt: string | null | undefined,
  eventCreatedAt: string,
) {
  return (
    !!existingEventCreatedAt &&
    new Date(existingEventCreatedAt).getTime() >
      new Date(eventCreatedAt).getTime()
  );
}

async function getSubscriptionRecord(subscriptionId: string) {
  const { data, error } = await supabaseClient
    .from('subscriptions')
    .select(
      'id,user_id,status,level,stripe_event_created_at,current_period_end',
    )
    .eq('stripe_subscription_id', subscriptionId)
    .maybeSingle();

  if (error) throw error;

  return data;
}

async function hasNewerSubscriptionLedgerEvent(
  subscriptionId: string,
  eventId: string,
  eventCreatedAt: string,
) {
  const { data, error } = await supabaseClient
    .from('stripe_webhook_events')
    .select('event_id')
    .eq('stripe_object_id', subscriptionId)
    .neq('event_id', eventId)
    .gt('stripe_event_created_at', eventCreatedAt)
    .limit(1)
    .maybeSingle();

  if (error) throw error;

  return !!data;
}

async function handleCustomerSubscriptionUpdated(
  event: Stripe.CustomerSubscriptionUpdatedEvent,
) {
  const subscription = event.data.object;
  const eventCreatedAt = stripeTimestampToIso(event.created);
  const currentPeriodEnd = getSubscriptionPeriodEnd(subscription);

  const price = await stripe.prices.retrieve(
    subscription.items.data[0].price.id,
  );

  const customerId =
    typeof subscription.customer === 'string'
      ? subscription.customer
      : subscription.customer.id;

  // Don't change this unless you update the lookup keys in Stripe
  const level =
    price.lookup_key === 'pro_yearly' || price.lookup_key === 'pro_monthly'
      ? 'pro'
      : 'standard';

  const existingSubscription = await getSubscriptionRecord(subscription.id);

  if (!existingSubscription) {
    logError(new Error('No subscription data found for update'), {
      functionName: 'stripe-webhook',
      statusCode: 200,
      additionalContext: {
        operation: 'update_subscription',
        subscriptionId: subscription.id,
        customerId,
        level,
        handler: 'handleCustomerSubscriptionUpdated',
      },
    });
    return new Response(JSON.stringify({ error: 'No subscription data' }), {
      // We don't need this getting resent if it doesn't exist
      // We do new subscriptions in the table with the checkout.session.completed webhook
      status: 200,
    });
  }

  if (
    isNewerStripeEvent(
      existingSubscription.stripe_event_created_at,
      eventCreatedAt,
    ) ||
    (await hasNewerSubscriptionLedgerEvent(
      subscription.id,
      event.id,
      eventCreatedAt,
    ))
  ) {
    return new Response(JSON.stringify({ ok: true, stale: true }), {
      status: 200,
    });
  }

  // Update the subscription status
  const { data: subscriptionData, error: subscriptionError } =
    await supabaseClient
      .from('subscriptions')
      .update({
        status: subscription.status,
        stripe_customer_id: customerId,
        current_period_end: currentPeriodEnd,
        stripe_event_created_at: eventCreatedAt,
        level,
      })
      .eq('stripe_subscription_id', subscription.id)
      .select()
      .maybeSingle();

  if (subscriptionError) {
    logError(subscriptionError, {
      functionName: 'stripe-webhook',
      statusCode: 500,
      additionalContext: {
        operation: 'update_subscription',
        subscriptionId: subscription.id,
        customerId,
        level,
        handler: 'handleCustomerSubscriptionUpdated',
      },
    });
    return new Response(JSON.stringify({ error: subscriptionError.message }), {
      status: 500,
    });
  }

  if (!subscriptionData) {
    return new Response(JSON.stringify({ ok: true, stale: true }), {
      status: 200,
    });
  }

  // Grant subscription tokens based on level
  const tokenAmount = level === 'pro' ? 10000 : 2000;

  await grantSubscriptionTokens(
    subscriptionData.user_id,
    tokenAmount,
    currentPeriodEnd,
    `${subscription.id}:${subscription.current_period_end}`,
  );

  return new Response(JSON.stringify({ ok: true }), { status: 200 });
}

async function handleCustomerSubscriptionDeleted(
  event: Stripe.CustomerSubscriptionDeletedEvent,
) {
  const subscription = event.data.object;
  const eventCreatedAt = stripeTimestampToIso(event.created);
  const currentPeriodEnd = getSubscriptionPeriodEnd(subscription);

  const existingSubscription = await getSubscriptionRecord(subscription.id);

  if (!existingSubscription) {
    logError(new Error('No subscription data found for deletion'), {
      functionName: 'stripe-webhook',
      statusCode: 200,
      additionalContext: {
        operation: 'delete_subscription',
        subscriptionId: subscription.id,
        handler: 'handleCustomerSubscriptionDeleted',
      },
    });
    return new Response(JSON.stringify({ error: 'No subscription data' }), {
      // We don't need this getting resent if it doesn't exist
      status: 200,
    });
  }

  if (
    isNewerStripeEvent(
      existingSubscription.stripe_event_created_at,
      eventCreatedAt,
    ) ||
    (await hasNewerSubscriptionLedgerEvent(
      subscription.id,
      event.id,
      eventCreatedAt,
    ))
  ) {
    return new Response(JSON.stringify({ ok: true, stale: true }), {
      status: 200,
    });
  }

  const { data: subscriptionData, error: subscriptionError } =
    await supabaseClient
      .from('subscriptions')
      .update({
        status: subscription.status,
        current_period_end: currentPeriodEnd,
        stripe_event_created_at: eventCreatedAt,
      })
      .eq('stripe_subscription_id', subscription.id)
      .select()
      .maybeSingle();

  if (subscriptionError) {
    logError(subscriptionError, {
      functionName: 'stripe-webhook',
      statusCode: 500,
      additionalContext: {
        operation: 'delete_subscription',
        subscriptionId: subscription.id,
        handler: 'handleCustomerSubscriptionDeleted',
      },
    });
    return new Response(JSON.stringify({ error: subscriptionError.message }), {
      status: 500,
    });
  }

  if (!subscriptionData) {
    return new Response(JSON.stringify({ ok: true, stale: true }), {
      status: 200,
    });
  }

  // Reset to free tier tokens (50 tokens, 1-day expiry)
  const freeTierExpiry = new Date(
    Date.now() + 24 * 60 * 60 * 1000,
  ).toISOString();

  await grantSubscriptionTokens(
    subscriptionData.user_id,
    50,
    freeTierExpiry,
    `${subscription.id}:deleted:${event.id}`,
    true,
  );

  return new Response(JSON.stringify({ ok: true }), { status: 200 });
}

async function handleCheckoutSessionCompleted(
  event: Stripe.CheckoutSessionCompletedEvent,
) {
  const session = event.data.object;
  // Handle token pack one-time purchases
  if (session.mode === 'payment') {
    return await handleTokenPackPurchase(session);
  }

  const customer = session.customer;

  const client_reference_id = session.client_reference_id ?? '';
  const { data: userData, error: userError } =
    await supabaseClient.auth.admin.getUserById(client_reference_id);

  if (userError) {
    logError(userError, {
      functionName: 'stripe-webhook',
      statusCode: 500,
      additionalContext: {
        operation: 'get_user_by_id',
        clientReferenceId: client_reference_id,
        handler: 'handleCheckoutSessionCompleted',
      },
    });
    return new Response(JSON.stringify({ error: userError.message }), {
      status: 500,
    });
  }

  const { data: profileData, error: profileError } = await supabaseClient
    .from('profiles')
    .select('*')
    .eq('user_id', userData.user.id)
    .limit(1)
    .single();

  if (profileError) {
    logError(profileError, {
      functionName: 'stripe-webhook',
      statusCode: 500,
      userId: userData.user?.id,
      additionalContext: { operation: 'fetch_profile' },
    });
    return new Response(JSON.stringify({ error: profileError.message }), {
      status: 500,
    });
  }

  if (!profileData) {
    logError(new Error('No profile data found for user'), {
      functionName: 'stripe-webhook',
      statusCode: 500,
      userId: userData.user?.id,
      additionalContext: { operation: 'fetch_profile' },
    });
    return new Response(JSON.stringify({ error: 'No profile data' }), {
      status: 500,
    });
  }

  const customerId = typeof customer === 'string' ? customer : customer?.id;

  if (!customerId) {
    logError(new Error('No customer ID provided in session'), {
      functionName: 'stripe-webhook',
      statusCode: 404,
      additionalContext: {
        operation: 'extract_customer_id',
        sessionId: session.id,
        handler: 'handleCheckoutSessionCompleted',
      },
    });
    return new Response(JSON.stringify({ error: 'No customer given' }), {
      status: 404,
    });
  }

  const subscriptionId =
    typeof session.subscription === 'string'
      ? session.subscription
      : session.subscription?.id;

  if (!subscriptionId) {
    logError(new Error('No subscription ID provided in session'), {
      functionName: 'stripe-webhook',
      statusCode: 404,
      additionalContext: {
        operation: 'extract_subscription_id',
        sessionId: session.id,
        customerId,
        handler: 'handleCheckoutSessionCompleted',
      },
    });
    return new Response(JSON.stringify({ error: 'No subscription ID' }), {
      status: 404,
    });
  }

  // This will tell us if they are trialing right away instead of having to wait for the subscription to be updated
  const subscription = await stripe.subscriptions.retrieve(subscriptionId);
  const eventCreatedAt = stripeTimestampToIso(event.created);
  const currentPeriodEnd = getSubscriptionPeriodEnd(subscription);

  const level = session.metadata?.level ?? 'standard';

  const existingSubscription = await getSubscriptionRecord(subscriptionId);

  if (
    isNewerStripeEvent(
      existingSubscription?.stripe_event_created_at,
      eventCreatedAt,
    ) ||
    (await hasNewerSubscriptionLedgerEvent(
      subscriptionId,
      event.id,
      eventCreatedAt,
    ))
  ) {
    return new Response(JSON.stringify({ ok: true, stale: true }), {
      status: 200,
    });
  }

  const subscriptionPayload = {
    status: subscription.status,
    stripe_customer_id: customerId,
    user_id: userData.user.id,
    stripe_subscription_id: subscriptionId,
    current_period_end: currentPeriodEnd,
    stripe_event_created_at: eventCreatedAt,
    level: level as 'pro' | 'standard',
  };

  const { error: subscriptionError } = existingSubscription
    ? await supabaseClient
        .from('subscriptions')
        .update(subscriptionPayload)
        .eq('stripe_subscription_id', subscriptionId)
        .select()
    : await supabaseClient
        .from('subscriptions')
        .insert(subscriptionPayload)
        .select();

  if (subscriptionError) {
    logError(subscriptionError, {
      functionName: 'stripe-webhook',
      statusCode: 500,
      additionalContext: {
        operation: 'insert_subscription',
        subscriptionId,
        customerId,
        userId: userData.user.id,
        level,
        handler: 'handleCheckoutSessionCompleted',
      },
    });
    return new Response(JSON.stringify({ error: subscriptionError.message }), {
      status: 500,
    });
  }

  // So that they can't start a trial again
  await supabaseClient.from('trial_users').upsert(
    {
      user_id: userData.user.id,
    },
    {
      onConflict: 'user_id',
      ignoreDuplicates: true,
    },
  );

  // Grant subscription tokens
  const tokenAmount = level === 'pro' ? 10000 : 2000;

  await grantSubscriptionTokens(
    userData.user.id,
    tokenAmount,
    currentPeriodEnd,
    `${subscription.id}:${subscription.current_period_end}`,
  );

  return new Response(JSON.stringify({ ok: true }), { status: 200 });
}

async function handleTokenPackPurchase(session: Stripe.Checkout.Session) {
  const client_reference_id = session.client_reference_id ?? '';

  const { data: userData, error: userError } =
    await supabaseClient.auth.admin.getUserById(client_reference_id);

  if (userError || !userData.user) {
    logError(userError || new Error('User not found'), {
      functionName: 'stripe-webhook',
      statusCode: 500,
      additionalContext: {
        operation: 'token_pack_get_user',
        clientReferenceId: client_reference_id,
        handler: 'handleTokenPackPurchase',
      },
    });
    return new Response(
      JSON.stringify({ error: userError?.message || 'User not found' }),
      { status: 500 },
    );
  }

  // Get line items to find the price, then resolve its lookup key
  const lineItems = await stripe.checkout.sessions.listLineItems(session.id);
  const priceId = lineItems.data[0]?.price?.id;

  if (!priceId) {
    logError(new Error('No price ID in token pack checkout'), {
      functionName: 'stripe-webhook',
      statusCode: 400,
      additionalContext: {
        sessionId: session.id,
        handler: 'handleTokenPackPurchase',
      },
    });
    return new Response(JSON.stringify({ error: 'No price ID found' }), {
      status: 400,
    });
  }

  const priceObj = await stripe.prices.retrieve(priceId);
  const lookupKey = priceObj.lookup_key;

  if (!lookupKey) {
    logError(new Error('No lookup key on token pack price'), {
      functionName: 'stripe-webhook',
      statusCode: 400,
      additionalContext: {
        priceId,
        handler: 'handleTokenPackPurchase',
      },
    });
    return new Response(JSON.stringify({ error: 'No lookup key found' }), {
      status: 400,
    });
  }

  // Look up token amount from our products table by lookup key
  const { data: packData, error: packError } = await supabaseClient
    .from('token_pack_products')
    .select('token_amount, price_cents, active')
    .eq('stripe_lookup_key', lookupKey)
    .eq('active', true)
    .single();

  if (packError || !packData) {
    logError(packError || new Error('Token pack product not found'), {
      functionName: 'stripe-webhook',
      statusCode: 400,
      additionalContext: {
        priceId,
        handler: 'handleTokenPackPurchase',
      },
    });
    return new Response(
      JSON.stringify({ error: 'Token pack product not found' }),
      { status: 400 },
    );
  }

  if (priceObj.unit_amount !== packData.price_cents) {
    return new Response(
      JSON.stringify({ error: 'Token pack price mismatch' }),
      {
        status: 400,
      },
    );
  }

  const { error: creditError } = await supabaseClient.rpc(
    'credit_purchased_tokens',
    {
      p_user_id: userData.user.id,
      p_amount: packData.token_amount,
      p_reference_id: session.id,
    },
  );

  if (creditError) {
    throw creditError;
  }

  return new Response(JSON.stringify({ ok: true }), { status: 200 });
}

async function handleInvoicePaid(event: Stripe.InvoicePaidEvent) {
  const invoice = event.data.object;
  const eventCreatedAt = stripeTimestampToIso(event.created);

  // Only handle subscription invoices (not one-time)
  if (!invoice.subscription) {
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  }

  const subscriptionId =
    typeof invoice.subscription === 'string'
      ? invoice.subscription
      : invoice.subscription.id;

  if (
    await hasNewerSubscriptionLedgerEvent(
      subscriptionId,
      event.id,
      eventCreatedAt,
    )
  ) {
    return new Response(JSON.stringify({ ok: true, stale: true }), {
      status: 200,
    });
  }

  // Get the subscription to find the user and period end
  const subscription = await stripe.subscriptions.retrieve(subscriptionId);

  // Find the user from our subscriptions table
  const { data: subData, error: subError } = await supabaseClient
    .from('subscriptions')
    .select('user_id, level, status, current_period_end')
    .eq('stripe_subscription_id', subscriptionId)
    .maybeSingle();

  if (subError || !subData) {
    // May not exist yet (first invoice), checkout.session.completed handles that
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  }

  if (subData.status !== 'active' && subData.status !== 'trialing') {
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  }

  // Grant tokens for the new billing period
  const tokenAmount = subData.level === 'pro' ? 10000 : 2000;
  const expiresAt = getSubscriptionPeriodEnd(subscription);

  if (
    subData.current_period_end &&
    new Date(subData.current_period_end).getTime() >
      new Date(expiresAt).getTime()
  ) {
    return new Response(JSON.stringify({ ok: true, stale: true }), {
      status: 200,
    });
  }

  await grantSubscriptionTokens(
    subData.user_id,
    tokenAmount,
    expiresAt,
    `${subscription.id}:${subscription.current_period_end}`,
  );

  return new Response(JSON.stringify({ ok: true }), { status: 200 });
}
