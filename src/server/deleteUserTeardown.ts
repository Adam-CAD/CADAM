import { billing, BillingClientError } from '@/server/billingClient';
import { isRecord } from '@/server/api';
import {
  getServiceRoleSupabaseClient,
  type SupabaseClient,
} from '@/server/supabaseClient';

export type CancellationFeedback =
  | 'customer_service'
  | 'low_quality'
  | 'missing_features'
  | 'other'
  | 'switched_service'
  | 'too_complex'
  | 'too_expensive'
  | 'unused';

export function isCancellationFeedback(
  value: unknown,
): value is CancellationFeedback {
  switch (value) {
    case 'customer_service':
    case 'low_quality':
    case 'missing_features':
    case 'other':
    case 'switched_service':
    case 'too_complex':
    case 'too_expensive':
    case 'unused':
      return true;
    default:
      return false;
  }
}

export type TeardownOptions = {
  reason?: CancellationFeedback;
  /**
   * Await storage deletion BEFORE removing the auth user, and let a storage
   * failure propagate. Used by the server-to-server purge route so its 200
   * only means "actually erased" and a failure leaves the auth user intact for
   * a safe retry (the retry re-lists and finishes the job). The default
   * (session-initiated delete) removes the auth user first and cleans storage
   * in the background, for a fast user-facing response.
   */
  awaitStorage?: boolean;
};

/**
 * Runs the full teardown for a single user: cancels the email-keyed billing
 * subscription, deletes the Supabase auth user (which cascades sessions,
 * accounts, and user-keyed rows via FK / RLS cascade), and removes the user's
 * storage buckets. Both the session-authed `delete-user` route and the
 * internal server-to-server `internal/account/delete` route call this so the
 * teardown behavior stays identical.
 *
 * Billing cancellation is always best-effort (logged, never fatal). Storage
 * ordering depends on `awaitStorage` (see TeardownOptions).
 */
export async function teardownUser(
  supabase: SupabaseClient,
  user: { id: string; email: string },
  options: TeardownOptions = {},
): Promise<void> {
  try {
    const subscription = await billing.cancelSubscription(user.email, {
      feedback: options.reason,
    });
    if (!subscription.canceled) {
      switch (subscription.reason) {
        case 'no_subscription':
        case 'already_canceled':
          break;
        default: {
          const unknownReason: never = subscription.reason;
          throw new Error(
            `Unknown subscription cancellation reason: ${unknownReason}`,
          );
        }
      }
    }
  } catch (subscriptionError) {
    if (subscriptionError instanceof BillingClientError) {
      console.error('Failed to cancel user subscription:', {
        status: subscriptionError.status,
        body: subscriptionError.body,
      });
    } else {
      console.error('Failed to cancel user subscription:', subscriptionError);
    }
  }

  if (options.awaitStorage) {
    // Storage-first, awaited: if this throws the auth user still exists, so the
    // caller's retry re-lists and completes — no silently-orphaned blobs.
    await deleteUserStorageItems(supabase, user.id);
    const { error: deleteError } = await supabase.auth.admin.deleteUser(
      user.id,
    );
    if (deleteError) {
      throw new Error(`Failed to delete auth user: ${deleteError.message}`);
    }
    return;
  }

  // Default user-facing path: delete the auth user now, clean storage in the
  // background so the response is fast.
  const { error: deleteError } = await supabase.auth.admin.deleteUser(user.id);
  if (deleteError) {
    throw new Error(`Failed to delete auth user: ${deleteError.message}`);
  }
  runBackgroundTask(deleteUserStorageItems(supabase, user.id));
}

/**
 * Look up a Supabase auth user by email (case-insensitive, trimmed). Returns
 * null when no user matches. Uses the admin `listUsers` pagination because the
 * installed auth-js does not expose a direct get-by-email admin method.
 */
export async function findAuthUserByEmail(
  supabase: SupabaseClient,
  email: string,
): Promise<{ id: string; email: string } | null> {
  const normalized = email.trim().toLowerCase();
  if (!normalized) return null;

  const perPage = 1000;
  for (let page = 1; ; page += 1) {
    const { data, error } = await supabase.auth.admin.listUsers({
      page,
      perPage,
    });
    if (error) {
      throw new Error(`Failed to list auth users: ${error.message}`);
    }
    for (const candidate of data.users) {
      if (candidate.email?.trim().toLowerCase() === normalized) {
        return { id: candidate.id, email: candidate.email };
      }
    }
    if (data.users.length < perPage) break;
  }
  return null;
}

export { getServiceRoleSupabaseClient };

function runBackgroundTask(task: Promise<unknown>) {
  const loggedTask = task.catch((error) => {
    console.error('Failed to delete user storage items:', error);
  });
  const requestContext = Reflect.get(
    globalThis,
    Symbol.for('@vercel/request-context'),
  );
  if (isRecord(requestContext) && typeof requestContext.get === 'function') {
    const context = requestContext.get();
    if (isRecord(context) && typeof context.waitUntil === 'function') {
      context.waitUntil(loggedTask);
      return;
    }
  }
  void loggedTask;
}

/**
 * Delete every object the user owns across the storage buckets. Errors
 * PROPAGATE (they used to be swallowed): the background caller wraps this in
 * runBackgroundTask (which logs), while the awaited purge caller relies on the
 * throw to retry. Idempotent — a retry re-lists and removes only what remains.
 */
async function deleteUserStorageItems(
  supabase: SupabaseClient,
  userId: string,
): Promise<void> {
  for (const bucket of ['images', 'meshes', 'previews']) {
    const paths = await listAllPaths(supabase, bucket, userId);
    for (let i = 0; i < paths.length; i += 1000) {
      const { error } = await supabase.storage
        .from(bucket)
        .remove(paths.slice(i, i + 1000));
      if (error) throw error;
    }
  }
}

async function listAllPaths(
  supabase: SupabaseClient,
  bucket: string,
  folder: string,
): Promise<string[]> {
  const paths: string[] = [];
  const limit = 1000;
  for (let offset = 0; ; offset += limit) {
    const { data, error } = await supabase.storage.from(bucket).list(folder, {
      limit,
      offset,
      sortBy: { column: 'name', order: 'asc' },
    });
    if (error) throw error;
    if (!data.length) break;
    for (const item of data) {
      const path = `${folder}/${item.name}`;
      if ('id' in item && item.id) paths.push(path);
      else paths.push(...(await listAllPaths(supabase, bucket, path)));
    }
    if (data.length < limit) break;
  }
  return paths;
}
