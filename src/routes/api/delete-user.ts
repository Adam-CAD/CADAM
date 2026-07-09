import { createFileRoute } from '@tanstack/react-router';
import { isRecord, json, methodNotAllowed, preflight } from '@/server/api';
import { getServiceRoleSupabaseClient } from '@/server/supabaseClient';
import {
  isCancellationFeedback,
  teardownUser,
} from '@/server/deleteUserTeardown';

export const Route = createFileRoute('/api/delete-user')({
  server: {
    handlers: {
      GET: methodNotAllowed,
      OPTIONS: preflight,
      POST: async ({ request }) => {
        const supabase = getServiceRoleSupabaseClient();
        const token = request.headers
          .get('Authorization')
          ?.replace('Bearer ', '');
        const body = await request.json().catch(() => ({}));
        const reason =
          isRecord(body) && isCancellationFeedback(body.reason)
            ? body.reason
            : undefined;
        const { data, error } = await supabase.auth.getUser(token);
        if (error || !data.user?.email)
          return json({ error: 'Unauthorized' }, 401);

        try {
          await teardownUser(
            supabase,
            { id: data.user.id, email: data.user.email },
            { reason },
          );
        } catch {
          return json({ error: 'Failed to delete user' }, 500);
        }
        return json({ success: true });
      },
    },
  },
});
