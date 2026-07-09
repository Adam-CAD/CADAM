import { createFileRoute } from '@tanstack/react-router';
import { timingSafeEqual } from 'node:crypto';
import { isRecord, json, methodNotAllowed, preflight } from '@/server/api';
import { env } from '@/server/env';
import { logApiError } from '@/server/serverLog';
import { getServiceRoleSupabaseClient } from '@/server/supabaseClient';
import { findAuthUserByEmail, teardownUser } from '@/server/deleteUserTeardown';

const FN = 'internal-account-delete';

/**
 * Constant-time comparison of the presented bearer token against the
 * configured purge secret. Never logs either value. Returns false on any
 * length mismatch (comparing unequal-length buffers with `timingSafeEqual`
 * throws, so we guard the length first — the length itself is not secret).
 */
function bearerMatches(presented: string, expected: string): boolean {
  const a = Buffer.from(presented);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/**
 * Internal, server-to-server account purge endpoint. Called by the workspace
 * account-purge worker once a user's 30-day grace window elapses to erase that
 * user's data in this satellite.
 *
 * Contract:
 *   - POST only.
 *   - `Authorization: Bearer <ACCOUNT_PURGE_SECRET>` (constant-time compare).
 *     503 if the secret is unconfigured; 401 if missing/mismatched.
 *   - Body: { email: string, subject?: string }. `email` is the cross-system
 *     join key; `subject` is the Adam user id, logging only.
 *   - Idempotent: 200 { deleted: false } when no matching user exists,
 *     200 { deleted: true } when a user was found and erased. Never 404.
 *   - 500 only on a genuine failure so the worker retries.
 *
 * This endpoint is provider-agnostic: the shared secret and the service-role
 * Supabase credentials are entirely env-driven, with no hardcoded host or
 * tenant-specific value.
 */
export const Route = createFileRoute('/api/internal/account/delete')({
  server: {
    handlers: {
      GET: methodNotAllowed,
      OPTIONS: preflight,
      POST: async ({ request }) => {
        // Unconfigured secret must hard-fail every request; never authorize
        // when there is nothing to compare against.
        const secret = env('ACCOUNT_PURGE_SECRET');
        if (!secret) {
          return json({ error: 'not_configured' }, 503);
        }

        const presented = request.headers
          .get('Authorization')
          ?.replace(/^Bearer /, '');
        if (!presented || !bearerMatches(presented, secret)) {
          return json({ error: 'Unauthorized' }, 401);
        }

        const body = await request.json().catch(() => ({}));
        const email =
          isRecord(body) && typeof body.email === 'string' ? body.email : '';
        const subject =
          isRecord(body) && typeof body.subject === 'string'
            ? body.subject
            : undefined;
        if (!email.trim()) {
          return json({ error: 'email_required' }, 400);
        }

        try {
          const supabase = getServiceRoleSupabaseClient();
          const user = await findAuthUserByEmail(supabase, email);
          if (!user) {
            // Already gone — idempotent success, not a 404.
            return json({ deleted: false });
          }
          // awaitStorage: a background purge with no user waiting — block on
          // storage-first deletion so a 200 means the blobs are actually gone
          // and any failure is retryable.
          await teardownUser(supabase, user, { awaitStorage: true });
          return json({ deleted: true });
        } catch (error) {
          logApiError(error, {
            functionName: FN,
            apiName: 'internal-account-delete',
            statusCode: 500,
            // `subject` is the Adam user id (logging only). Email is a PII
            // join key and is intentionally not logged here.
            requestData: subject ? { subject } : undefined,
          });
          return json({ error: 'internal_error' }, 500);
        }
      },
    },
  },
});
