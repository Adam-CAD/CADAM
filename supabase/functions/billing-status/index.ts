import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { corsHeaders } from '../_shared/cors.ts';
import { billing, BillingClientError } from '../_shared/billingClient.ts';
import { getAnonSupabaseClient } from '../_shared/supabaseClient.ts';
import { initSentry, logError } from '../_shared/sentry.ts';

initSentry();

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
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

  try {
    const status = await billing.getStatus(userData.user.email);
    return new Response(JSON.stringify(status), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    const status = err instanceof BillingClientError ? err.status : 502;
    logError(err, {
      functionName: 'billing-status',
      statusCode: status,
      userId: userData.user.id,
    });
    return new Response(JSON.stringify({ error: 'billing_unavailable' }), {
      status,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
