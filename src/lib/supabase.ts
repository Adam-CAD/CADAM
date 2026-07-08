import { createClient, Provider } from '@supabase/supabase-js';
import { Database } from '@shared/database';

const rawSupabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const rawSupabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

// Flag used by the UI to show a helpful message instead of crashing
export const isSupabaseConfigMissing = !rawSupabaseUrl || !rawSupabaseKey;

// Optional SSO-only mode. Set VITE_SSO_PROVIDER to any Supabase OAuth
// provider slug (e.g. 'custom:my-idp' for a custom OIDC provider configured
// in the Supabase dashboard) and the app root becomes the only auth surface:
// its existing signed-out UI stays as-is, but every sign-in/sign-up
// affordance redirects to the provider instead of the native auth routes
// (which bounce back to root), and unauthenticated deep links redirect
// straight to the provider. Leave it unset to keep the native auth UI —
// the local Supabase CLI stack can't host custom OIDC providers, so it
// stays unset in local dev.
export const ssoProvider = (import.meta.env.VITE_SSO_PROVIDER ||
  null) as Provider | null;

// Fallback values keep the client constructable so imports don't throw
// when env vars are missing. The app should gate on isSupabaseConfigMissing
// and avoid making real requests in this state.
const supabaseUrl = rawSupabaseUrl || 'http://localhost';
const supabaseKey = rawSupabaseKey || 'public-anon-key';

export const supabase = createClient<Database>(supabaseUrl, supabaseKey);
