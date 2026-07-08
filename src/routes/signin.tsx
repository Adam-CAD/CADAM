import { createFileRoute, redirect } from '@tanstack/react-router';
import { SignInView } from '@/views/SignInView';
import { ssoProvider } from '@/lib/supabase';

export const Route = createFileRoute('/signin')({
  // With an SSO provider configured, root is the app's only auth surface —
  // the native auth routes bounce straight there without rendering.
  beforeLoad: () => {
    if (ssoProvider) {
      throw redirect({ to: '/', replace: true });
    }
  },
  component: SignInView,
});
