// Setup type definitions for built-in Supabase Runtime APIs
import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { corsHeaders } from '../_shared/cors.ts';
import {
  getServiceRoleSupabaseClient,
  SupabaseClient,
} from '../_shared/supabaseClient.ts';
import { billing, BillingClientError } from '../_shared/billingClient.ts';
import { initSentry, logApiError, logError } from '../_shared/sentry.ts';

// Initialize Sentry for error logging
initSentry();

type CancellationFeedback =
  | 'customer_service'
  | 'low_quality'
  | 'missing_features'
  | 'other'
  | 'switched_service'
  | 'too_complex'
  | 'too_expensive'
  | 'unused';

const supabaseClient = getServiceRoleSupabaseClient();

/**
 * Deletes the authenticated user account.
 * - Cancels any active subscription via adam-billing (no-op if none)
 * - Removes storage items in the background
 * - Deletes the auth user via service role
 */
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

  const { reason }: { reason?: CancellationFeedback } = await req
    .json()
    .catch(() => ({}));

  const authHeader = req.headers.get('Authorization');
  const token = authHeader?.replace('Bearer ', '');

  const { data: userData, error: userError } =
    await supabaseClient.auth.getUser(token);

  if (userError || !userData.user || !userData.user.email) {
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
  const email = userData.user.email;

  try {
    await billing.cancelSubscription(email, { feedback: reason });
  } catch (err) {
    const status = err instanceof BillingClientError ? err.status : 502;
    logApiError(err, {
      functionName: 'delete-user',
      apiName: 'adam-billing cancel-subscription',
      statusCode: status,
      userId,
    });
    return new Response(
      JSON.stringify({ error: 'Failed to cancel subscription' }),
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
