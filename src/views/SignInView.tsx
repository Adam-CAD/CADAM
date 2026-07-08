import { useState, useEffect, useRef } from 'react';
import { useNavigate, Link, useLocation } from '@tanstack/react-router';
import { ArrowLeft, Loader2, Mail } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  InputOTP,
  InputOTPGroup,
  InputOTPSlot,
  InputOTPSeparator,
} from '@/components/ui/input-otp';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/contexts/AuthContext';
import { AuthError } from '@supabase/supabase-js';
import {
  supabase,
  ssoProvider,
  ssoLabel,
  ssoSignedOutStorageKey,
} from '@/lib/supabase';
import { useMutation } from '@tanstack/react-query';
import { GoogleIcon } from '@/components/icons/CompanyIcons';
import { validateRedirectUrl } from '@/lib/utils';

function getAppRedirectUrl(path: string) {
  const basePath = import.meta.env.BASE_URL.replace(/\/$/, '');

  return `${window.location.origin}${basePath}${path}`;
}

function getRedirectNavigationOptions(path: string) {
  const url = new URL(path, window.location.origin);
  const search = Object.fromEntries(url.searchParams.entries());

  return {
    to: url.pathname,
    search,
    hash: url.hash ? url.hash.slice(1) : undefined,
  };
}

export function SignInView() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [mode, setMode] = useState<'password' | 'magiclink'>('password');
  const [magicLinkSent, setMagicLinkSent] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();
  const location = useLocation();
  const {
    signIn,
    signInWithMagicLink,
    verifyOtp,
    session,
    user,
    isLoading: authLoading,
  } = useAuth();
  const { toast } = useToast();

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

  const handleSignIn = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setError(null);

    try {
      await signIn(email, password);
      // Navigate to validated redirect path
      navigate(getRedirectNavigationOptions(redirectPath));
    } catch (err) {
      const error = err as AuthError;
      const message =
        error.message === 'Invalid login credentials'
          ? 'Invalid email or password'
          : 'An error occurred while signing in';
      setError(message);
      toast({
        title: 'Whoopsies',
        description: message,
        variant: 'destructive',
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handleMagicLink = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setError(null);

    try {
      await signInWithMagicLink(email);
      setMagicLinkSent(true);
    } catch (err) {
      const error = err as AuthError;
      setError(error.message);
      toast({
        title: 'Whoopsies',
        description: error.message,
        variant: 'destructive',
      });
    } finally {
      setIsLoading(false);
    }
  };

  const [otp, setOtp] = useState('');
  const [isVerifying, setIsVerifying] = useState(false);

  const handleVerifyOtp = async () => {
    if (otp.length !== 6) return;
    setIsVerifying(true);
    setError(null);
    try {
      await verifyOtp(email, otp);
      navigate(getRedirectNavigationOptions(redirectPath));
    } catch (err) {
      const error = err as AuthError;
      setError(error.message);
      toast({
        title: 'Whoopsies',
        description: error.message,
        variant: 'destructive',
      });
    } finally {
      setIsVerifying(false);
    }
  };

  // With an SSO provider configured, the deployment delegates auth entirely
  // to that provider — the redirect is the sign-in. The view auto-fires it
  // on mount and only shows a manual button when the redirect is skipped
  // (right after sign-out) or didn't happen (error, blocked navigation).
  if (ssoProvider) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-adam-bg-dark p-4">
        <div className="w-full max-w-md">
          <div className="flex flex-col gap-4 rounded-lg bg-adam-bg-secondary-dark p-8 shadow-md">
            <div className="mb-4 flex flex-col items-center justify-center">
              <div>
                <img
                  src={`${import.meta.env.BASE_URL}/cadam-logo.svg`}
                  alt="CADAM Logo"
                  className="w-32"
                />
              </div>
            </div>
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
    );
  }

  if (magicLinkSent) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-adam-bg-dark p-4">
        <div className="w-full max-w-md">
          <div className="flex flex-col gap-4 rounded-lg bg-adam-bg-secondary-dark p-8 shadow-md">
            <button
              onClick={() => {
                setMagicLinkSent(false);
                setOtp('');
                setError(null);
                setMode('password');
              }}
              className="flex items-center gap-1 text-sm text-gray-400 transition-colors hover:text-white"
            >
              <ArrowLeft className="h-4 w-4" />
              Back
            </button>

            <div className="flex flex-col items-center gap-2 py-2">
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-adam-blue/20">
                <Mail className="h-6 w-6 text-adam-blue" />
              </div>
              <h3 className="text-lg font-semibold text-white">
                Check your email
              </h3>
              <p className="text-center text-sm text-gray-400">
                We sent a magic link to{' '}
                <span className="font-medium text-white">{email}</span>
              </p>
            </div>

            {error && (
              <div className="rounded-md bg-red-900/50 p-3 text-sm text-red-200">
                {error}
              </div>
            )}

            <div className="relative flex items-center gap-3 py-2">
              <div className="h-px flex-1 bg-gray-700" />
              <span className="text-xs text-gray-500">
                or enter code manually
              </span>
              <div className="h-px flex-1 bg-gray-700" />
            </div>

            <form
              onSubmit={(e) => {
                e.preventDefault();
                handleVerifyOtp();
              }}
              className="flex flex-col gap-4"
            >
              <div className="flex justify-center">
                <InputOTP
                  maxLength={6}
                  value={otp}
                  onChange={setOtp}
                  onComplete={handleVerifyOtp}
                  className="gap-2"
                >
                  <InputOTPGroup className="text-white">
                    <InputOTPSlot
                      index={0}
                      className="h-11 w-11 border-gray-700 bg-adam-bg-dark"
                    />
                    <InputOTPSlot
                      index={1}
                      className="h-11 w-11 border-gray-700 bg-adam-bg-dark"
                    />
                    <InputOTPSlot
                      index={2}
                      className="h-11 w-11 border-gray-700 bg-adam-bg-dark"
                    />
                  </InputOTPGroup>
                  <InputOTPSeparator className="text-gray-500" />
                  <InputOTPGroup className="text-white">
                    <InputOTPSlot
                      index={3}
                      className="h-11 w-11 border-gray-700 bg-adam-bg-dark"
                    />
                    <InputOTPSlot
                      index={4}
                      className="h-11 w-11 border-gray-700 bg-adam-bg-dark"
                    />
                    <InputOTPSlot
                      index={5}
                      className="h-11 w-11 border-gray-700 bg-adam-bg-dark"
                    />
                  </InputOTPGroup>
                </InputOTP>
              </div>

              <Button
                type="submit"
                variant="outline"
                className="w-full"
                disabled={otp.length !== 6 || isVerifying}
              >
                {isVerifying ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Verifying...
                  </>
                ) : (
                  'Verify Code'
                )}
              </Button>
            </form>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-adam-bg-dark p-4">
      <div className="w-full max-w-md">
        <div className="flex flex-col gap-4 rounded-lg bg-adam-bg-secondary-dark p-8 shadow-md">
          <div className="mb-4 flex flex-col items-center justify-center">
            <div>
              <img
                src={`${import.meta.env.BASE_URL}/cadam-logo.svg`}
                alt="CADAM Logo"
                className="w-32"
              />
            </div>
          </div>
          <div className="w-full">
            <Button
              onClick={() => signInWithGoogle()}
              className="flex w-full items-center gap-2 hover:bg-adam-blue/10"
              disabled={isSigningInWithGoogle}
            >
              <GoogleIcon className="w-4" />
              <span>Continue with Google</span>
            </Button>
          </div>

          <form
            onSubmit={mode === 'password' ? handleSignIn : handleMagicLink}
            className="space-y-6"
          >
            {error && (
              <div className="rounded-md bg-red-50 p-3 text-sm text-red-600 dark:bg-red-900/50 dark:text-red-200">
                {error}
              </div>
            )}

            <div className="space-y-2">
              <Label htmlFor="email" className="text-white">
                Email
              </Label>
              <Input
                id="email"
                type="email"
                placeholder="Enter your email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                className="border-gray-700 bg-adam-bg-dark px-4 text-white placeholder:text-gray-400 max-[430px]:text-base"
              />
            </div>

            {mode === 'password' && (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label htmlFor="password" className="text-white">
                    Password
                  </Label>
                  <Link
                    to="/reset-password"
                    className="text-sm text-adam-blue hover:text-adam-blue/80"
                  >
                    Forgot password?
                  </Link>
                </div>
                <Input
                  id="password"
                  type="password"
                  placeholder="Enter your password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  className="border-gray-700 bg-adam-bg-dark px-4 text-white placeholder:text-gray-400 max-[430px]:text-base"
                />
              </div>
            )}

            <div className="text-center">
              <button
                type="button"
                className="text-sm text-adam-blue hover:text-adam-blue/80"
                onClick={() => {
                  setMode(mode === 'password' ? 'magiclink' : 'password');
                  setError(null);
                }}
              >
                {mode === 'password'
                  ? 'Sign in with magic link instead'
                  : 'Sign in with password instead'}
              </button>
            </div>

            <Button type="submit" className="w-full p-6" disabled={isLoading}>
              {isLoading ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  {mode === 'password' ? 'Signing in...' : 'Sending...'}
                </>
              ) : mode === 'password' ? (
                'Sign In'
              ) : (
                'Send Magic Link'
              )}
            </Button>

            <div className="text-center text-sm text-white">
              Don't have an account?{' '}
              <Link
                to="/signup"
                className="text-adam-blue hover:text-adam-blue/80"
              >
                Sign up
              </Link>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
