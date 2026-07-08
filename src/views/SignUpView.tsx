import { Link, useNavigate, useLocation } from '@tanstack/react-router';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/contexts/AuthContext';
import {
  supabase,
  ssoProvider,
  ssoLabel,
  ssoSignedOutStorageKey,
} from '@/lib/supabase';
import { useMutation } from '@tanstack/react-query';
import { GoogleIcon } from '@/components/icons/CompanyIcons';
import { useEffect, useRef, useState } from 'react';
import { validateRedirectUrl } from '@/lib/utils';

function getAppRedirectUrl(path: string) {
  const basePath = import.meta.env.BASE_URL.replace(/\/$/, '');

  return `${window.location.origin}${basePath}${path}`;
}

export function SignUpView() {
  const { toast } = useToast();
  const navigate = useNavigate();
  const location = useLocation();
  const { session, user, isLoading: authLoading } = useAuth();

  // Get and validate redirect parameter from URL
  const searchParams = new URLSearchParams(location.searchStr);
  const rawRedirectPath = searchParams.get('redirect');
  const redirectPath = validateRedirectUrl(rawRedirectPath);

  // Redirect to home if already authenticated
  useEffect(() => {
    if (!authLoading && session && user) {
      navigate({ to: '/', replace: true });
    }
  }, [session, user, authLoading, navigate]);

  const { mutate: signInWithGoogle, isPending: isSigningInWithGoogle } =
    useMutation({
      mutationFn: async () => {
        // Use Supabase's built-in redirectTo parameter with validated URL
        const redirectTo =
          redirectPath !== '/'
            ? getAppRedirectUrl(redirectPath)
            : getAppRedirectUrl('/');

        await supabase.auth.signInWithOAuth({
          provider: 'google',
          options: {
            redirectTo,
          },
        });
      },
      onError: (error) => {
        toast({
          title: 'Whoopsies',
          description:
            error instanceof Error ? error.message : 'Something went wrong',
          variant: 'destructive',
        });
      },
    });

  const [showSsoFallback, setShowSsoFallback] = useState(false);
  const hasAutoFiredSso = useRef(false);

  const { mutate: signInWithSso } = useMutation({
    mutationFn: async () => {
      if (!ssoProvider) return;

      // Use Supabase's built-in redirectTo parameter with validated URL
      const redirectTo =
        redirectPath !== '/'
          ? getAppRedirectUrl(redirectPath)
          : getAppRedirectUrl('/');

      // signInWithOAuth reports provider/config failures via the returned
      // error rather than throwing — surface it so onError shows the toast.
      const { error } = await supabase.auth.signInWithOAuth({
        provider: ssoProvider,
        options: {
          redirectTo,
        },
      });
      if (error) {
        throw error;
      }
    },
    onError: (error) => {
      // The auto-redirect failed — leave the manual button on screen.
      setShowSsoFallback(true);
      toast({
        title: 'Whoopsies',
        description:
          error instanceof Error ? error.message : 'Something went wrong',
        variant: 'destructive',
      });
    },
  });

  // In SSO mode the redirect is the sign-in: fire it on mount, exactly once
  // (StrictMode re-runs effects in dev). Skip it right after an explicit
  // sign-out — otherwise the still-live provider session would sign the user
  // straight back in — and fall back to a manual button if the redirect
  // hasn't happened after a few seconds, so nobody is stranded.
  useEffect(() => {
    if (!ssoProvider) return;

    if (!hasAutoFiredSso.current) {
      hasAutoFiredSso.current = true;

      if (sessionStorage.getItem(ssoSignedOutStorageKey)) {
        sessionStorage.removeItem(ssoSignedOutStorageKey);
        setShowSsoFallback(true);
        return;
      }

      signInWithSso();
    }

    const fallbackTimer = setTimeout(() => setShowSsoFallback(true), 4000);
    return () => clearTimeout(fallbackTimer);
  }, [signInWithSso]);

  // With an SSO provider configured, the deployment delegates auth entirely
  // to that provider — the redirect is the sign-in. The view auto-fires it
  // on mount and only shows a manual button when the redirect is skipped
  // (right after sign-out) or didn't happen (error, blocked navigation).
  if (ssoProvider) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-adam-bg-dark p-4">
        <div className="w-full max-w-md">
          <div className="rounded-lg bg-adam-bg-secondary-dark p-8 shadow-md">
            <div className="mb-4 flex flex-col items-center justify-center gap-2">
              <img
                src={`${import.meta.env.BASE_URL}/cadam-logo.svg`}
                alt="CADAM Logo"
                className="h-8 w-auto"
              />
            </div>
            <div className="w-full py-2">
              {showSsoFallback ? (
                // Not disabled while pending: the mutation ends in a page
                // navigation, and a re-click just re-issues the same redirect.
                <Button onClick={() => signInWithSso()} className="w-full p-6">
                  {ssoLabel}
                </Button>
              ) : (
                <div className="flex items-center justify-center gap-2 p-6 text-sm text-gray-400">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Redirecting to sign in...
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-adam-bg-dark p-4">
      <div className="w-full max-w-md">
        <div className="rounded-lg bg-adam-bg-secondary-dark p-8 shadow-md">
          <div className="mb-4 flex flex-col items-center justify-center gap-2">
            <img
              src={`${import.meta.env.BASE_URL}/cadam-logo.svg`}
              alt="CADAM Logo"
              className="h-8 w-auto"
            />
          </div>
          <div className="w-full py-2">
            <Button
              onClick={() => signInWithGoogle()}
              className="flex w-full items-center gap-2 p-6 md:hover:bg-adam-blue/10"
              disabled={isSigningInWithGoogle}
            >
              <GoogleIcon className="w-4" />
              <span>Continue with Google</span>
            </Button>
          </div>
          <div className="pt-4 text-center text-sm text-adam-text-secondary">
            <Link
              to="/signup-email"
              className="text-adam-text-primary hover:underline"
            >
              Sign up with email
            </Link>
            {' or '}
            <Link to="/signin" className="text-adam-blue hover:underline">
              Sign in
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
