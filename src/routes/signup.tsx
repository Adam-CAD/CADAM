import { createFileRoute, redirect } from '@tanstack/react-router';
import { SignUpView } from '@/views/SignUpView';
import { ssoProvider } from '@/lib/supabase';

export const Route = createFileRoute('/signup')({
  // With an SSO provider configured, root is the app's only auth surface —
  // the native auth routes bounce straight there without rendering.
  beforeLoad: () => {
    if (ssoProvider) {
      throw redirect({ to: '/', replace: true });
    }
  },
  component: SignUpView,
});
