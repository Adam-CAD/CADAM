import { useEffect, useRef } from 'react';
import { useNavigate, useLocation } from '@tanstack/react-router';
import { useAuth } from '@/contexts/AuthContext';
// The module-level `toast`, not the hook: the SSO error handler lives inside
// the guard's redirect effect, and a hook-returned reference would have to
// join the effect's dependency array. The module function is identity-stable
// by construction, keeping the deps — and the non-SSO re-run behavior —
// exactly as they were before SSO mode existed.
import { toast } from '@/hooks/use-toast';
import { Loader2 } from 'lucide-react';
import { ssoProvider } from '@/lib/supabase';
import { signInWithSsoProvider } from '@/lib/ssoAuth';

interface AuthGuardProps {
  children: React.ReactNode;
}

export function AuthGuard({ children }: AuthGuardProps) {
  const { session, user, isLoading } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  // In SSO mode the guard fires the provider redirect itself — once per
  // mount (StrictMode re-runs effects in dev).
  const hasFiredSsoRedirect = useRef(false);

  useEffect(() => {
    if (!isLoading && !session && !user) {
      // Capture current path for redirect after authentication
      // Only include pathname and search to avoid security issues
      const currentPath = location.pathname + location.searchStr;

      if (ssoProvider) {
        // The provider redirect IS the sign-in: send the browser straight
        // there with the intended URL preserved — no intermediate route.
        // Only the spinner below renders while the redirect happens.
        if (hasFiredSsoRedirect.current) return;
        hasFiredSsoRedirect.current = true;

        signInWithSsoProvider(currentPath).catch((error) => {
          toast({
            title: 'Whoopsies',
            description:
              error instanceof Error ? error.message : 'Something went wrong',
            variant: 'destructive',
          });
          // The redirect failed — fall back to root, whose signed-out state
          // offers the manual sign-in affordances.
          navigate({ to: '/', replace: true });
        });
        return;
      }

      const search = currentPath !== '/' ? { redirect: currentPath } : {};

      navigate({ to: '/signin', search, replace: true });
    }
  }, [
    session,
    user,
    navigate,
    isLoading,
    location.pathname,
    location.searchStr,
  ]);

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-blue-500" />
      </div>
    );
  }

  if (!session || !user) {
    // In SSO mode the effect above is redirecting the browser to the
    // provider — keep the spinner up instead of flashing a blank frame.
    if (ssoProvider) {
      return (
        <div className="flex min-h-screen items-center justify-center">
          <Loader2 className="h-8 w-8 animate-spin text-blue-500" />
        </div>
      );
    }

    return null;
  }

  return <>{children}</>;
}
