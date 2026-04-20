import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { corsHeaders } from '../_shared/cors.ts';
import { billing, BillingClientError } from '../_shared/billingClient.ts';
import { initSentry, logError } from '../_shared/sentry.ts';

initSentry();

// Products are public (pricing page is shown to unauthenticated users too).
// No session check here — the billing service enforces API-key auth.
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  const url = new URL(req.url);
  const typeParam = url.searchParams.get('type');
  const type =
    typeParam === 'subscription' || typeParam === 'pack' ? typeParam : null;

  try {
    const data = type
      ? await billing.getProductsByType(type)
      : await billing.getAllProducts();
    return new Response(JSON.stringify(data), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    const status = err instanceof BillingClientError ? err.status : 502;
    logError(err, {
      functionName: 'billing-products',
      statusCode: status,
      additionalContext: { type },
    });
    return new Response(JSON.stringify({ error: 'products_unavailable' }), {
      status,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
