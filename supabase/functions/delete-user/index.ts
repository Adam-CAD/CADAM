// Setup type definitions for built-in Supabase Runtime APIs
import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import Stripe from 'npm:stripe@17.5.0';
import { getCorsHeaders } from '../_shared/cors.ts';
import {
  getServiceRoleSupabaseClient,
  SupabaseClient,
} from '../_shared/supabaseClient.ts';
import { initSentry, logApiError, logError } from '../_shared/sentry.ts';

// Initialize Sentry for error logging
initSentry();

type StripeFeedback =
  Stripe.SubscriptionCancelParams.CancellationDetails.Feedback;

const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY') ?? '', {
  apiVersion: '2024-12-18.acacia',
  httpClient: Stripe.createFetchHttpClient(),
});

const supabaseClient = getServiceRoleSupabaseClient();

/**
 * Deletes the authenticated user account.
 * - Cancels any active Stripe subscription so the user is not charged again
 * - Removes the subscription row
 * - Deletes the auth user via service role
 */
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

  const { reason }: { reason: StripeFeedback } = await req.json();

  const authHeader = req.headers.get('Authorization');
  const token = authHeader?.replace('Bearer ', '');

  const { data: userData, error: userError } =
    await supabaseClient.auth.getUser(token);

  if (userError || !userData.user) {
    logError(userError ?? new Error('No user in request token'), {
      functionName: 'delete-user',
      statusCode: 401,
    });
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const userId = userData.user.id;

  // Fetch subscription for user (if any)
  const { data: subscription, error: subscriptionFetchError } =
    await supabaseClient
      .from('subscriptions')
      .select('*')
      .eq('user_id', userId)
      .maybeSingle();

  if (subscriptionFetchError) {
    logError(subscriptionFetchError, {
      functionName: 'delete-user',
      statusCode: 500,
      userId,
      additionalContext: { step: 'fetch_subscription' },
    });
    return new Response(
      JSON.stringify({ error: 'Failed to fetch subscription' }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      },
    );
  }

  // Cancel active Stripe subscription if exists
  if (subscription?.stripe_subscription_id) {
    try {
      await stripe.subscriptions.cancel(subscription.stripe_subscription_id, {
        cancellation_details: {
          feedback: reason,
        },
      });
    } catch (err) {
      logApiError(err, {
        functionName: 'delete-user',
        apiName: 'Stripe cancel subscription',
        statusCode: 500,
        userId,
        requestData: { subscriptionId: subscription.stripe_subscription_id },
      });
      // Continue – we still want to attempt user deletion; but return error to client
      return new Response(
        JSON.stringify({ error: 'Failed to cancel Stripe subscription' }),
        {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        },
      );
    }
  }

  // Remove local subscription record
  const { error: deleteSubError } = await supabaseClient
    .from('subscriptions')
    .delete()
    .eq('user_id', userId);

  if (deleteSubError) {
    logError(deleteSubError, {
      functionName: 'delete-user',
      statusCode: 500,
      userId,
      additionalContext: { step: 'delete_subscription_row' },
    });
    return new Response(
      JSON.stringify({ error: 'Failed to delete subscription row' }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      },
    );
  }

  // Kick off storage deletion in the background to avoid blocking the response
  EdgeRuntime.waitUntil(deleteUserStorageItems(userId));

  // Delete the auth user via service role
  const { error: deleteUserError } =
    await supabaseClient.auth.admin.deleteUser(userId);
  if (deleteUserError) {
    console.error(deleteUserError);
    logError(deleteUserError, {
      functionName: 'delete-user',
      statusCode: 500,
      userId,
      additionalContext: { step: 'auth_admin_delete' },
    });
    return new Response(JSON.stringify({ error: 'Failed to delete user' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  return new Response(JSON.stringify({ success: true }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
});

// Helper: delete all files for this user from storage buckets
async function deleteUserStorageItems(userIdToDelete: string) {
  const buckets = ['images', 'meshes', 'previews'];
  for (const bucket of buckets) {
    try {
      const paths = await listAllPaths(supabaseClient, bucket, userIdToDelete);
      if (paths.length > 0) {
        const batchSize = 1000;
        for (let i = 0; i < paths.length; i += batchSize) {
          const slice = paths.slice(i, i + batchSize);
          const { error: removeError } = await supabaseClient.storage
            .from(bucket)
            .remove(slice);
          if (removeError) throw removeError;
        }
      }
    } catch (err) {
      // Log to Sentry but do not block the main request
      logError(err, {
        functionName: 'delete-user',
        statusCode: 500,
        userId: userIdToDelete,
        additionalContext: { step: 'delete_storage', bucket },
      });
    }
  }
}

// Helper: recursively list all file paths under a folder for a bucket
async function listAllPaths(
  client: SupabaseClient,
  bucket: string,
  folder: string,
): Promise<string[]> {
  const paths: string[] = [];
  let offset = 0;
  const limit = 1000;

  while (true) {
    const { data, error } = await client.storage.from(bucket).list(folder, {
      limit,
      offset,
      sortBy: { column: 'name', order: 'asc' },
    });
    if (error) {
      throw error;
    }
    if (!data || data.length === 0) break;

    for (const item of data) {
      const currentPath = folder ? `${folder}/${item.name}` : item.name;
      // If item has an id, it's a file. If not, it's a folder
      if ((item as unknown as { id?: string }).id) {
        paths.push(currentPath);
      } else {
        const nested = await listAllPaths(client, bucket, currentPath);
        paths.push(...nested);
      }
    }

    if (data.length < limit) break;
    offset += limit;
  }

  return paths;
}
