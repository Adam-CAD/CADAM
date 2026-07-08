import { supabase, ssoProvider } from '@/lib/supabase';

// Build an absolute, same-frontend redirect URL for the OAuth return leg.
// Uses the current origin + Vite base path so the provider sends the user
// back to whichever frontend initiated the redirect (adam.new/cadam,
// app.adamcad.com, Vercel previews).
function getAppRedirectUrl(path: string) {
  const basePath = import.meta.env.BASE_URL.replace(/\/$/, '');

  return `${window.location.origin}${basePath}${path}`;
}

// Kick off the SSO provider redirect. `redirectPath` is the in-app path
// (router space, no base path) the user should land on after the provider
// round-trip. signInWithOAuth reports provider/config failures via the
// returned error rather than throwing — surface it so callers can react.
export async function signInWithSsoProvider(redirectPath: string = '/') {
  if (!ssoProvider) return;

  const { error } = await supabase.auth.signInWithOAuth({
    provider: ssoProvider,
    options: {
      redirectTo: getAppRedirectUrl(redirectPath),
    },
  });
  if (error) {
    throw error;
  }
}
