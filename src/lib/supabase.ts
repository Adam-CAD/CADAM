import { createClient, Provider } from '@supabase/supabase-js';
import { Database } from '@shared/database';

const rawSupabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const rawSupabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

// Flag used by the UI to show a helpful message instead of crashing
export const isSupabaseConfigMissing = !rawSupabaseUrl || !rawSupabaseKey;

// Optional SSO-only mode for the auth views. Set VITE_SSO_PROVIDER to any
// Supabase OAuth provider slug (e.g. 'custom:my-idp' for a custom OIDC
// provider configured in the Supabase dashboard) and the auth views drop the
// native sign-in/sign-up UI and redirect straight to that provider. Leave it
// unset to keep the native auth UI — the local Supabase CLI stack can't host
// custom OIDC providers, so it stays unset in local dev.
export const ssoProvider = (import.meta.env.VITE_SSO_PROVIDER ||
  null) as Provider | null;
export const ssoLabel: string = import.meta.env.VITE_SSO_LABEL || 'Sign in';

// Set on explicit sign-out and consumed by the auth views: in SSO mode the
// views normally redirect to the provider on mount, but right after signing
// out that would sign the user straight back in via the still-live provider
// session — the marker makes the views wait for an explicit click instead.
export const ssoSignedOutStorageKey = 'ssoSignedOut';

// Fallback values keep the client constructable so imports don't throw
// when env vars are missing. The app should gate on isSupabaseConfigMissing
// and avoid making real requests in this state.
const supabaseUrl = rawSupabaseUrl || 'http://localhost';
const supabaseKey = rawSupabaseKey || 'public-anon-key';

export const supabase = createClient<Database>(supabaseUrl, supabaseKey);
