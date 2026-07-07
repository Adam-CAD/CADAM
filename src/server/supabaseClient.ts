import {
  createClient,
  type SupabaseClientOptions,
} from '@supabase/supabase-js';
import type { Database } from '@shared/database';
import { requiredEnv } from './env';

export type SupabaseClient = ReturnType<typeof getAnonSupabaseClient>;

export function getAnonSupabaseClient(
  options?: SupabaseClientOptions<'public'>,
) {
  return createClient<Database, 'public'>(
    requiredEnv('VITE_SUPABASE_URL'),
    requiredEnv('VITE_SUPABASE_ANON_KEY'),
    options,
  );
}

export function getServiceRoleSupabaseClient(
  options?: SupabaseClientOptions<'public'>,
) {
  return createClient<Database, 'public'>(
    requiredEnv('VITE_SUPABASE_URL'),
    requiredEnv('SUPABASE_SERVICE_ROLE_KEY'),
    {
      ...options,
      auth: { autoRefreshToken: false, persistSession: false },
    },
  );
}
