import { createFileRoute, redirect } from '@tanstack/react-router';
import { SignUpEmailView } from '@/views/SignUpEmailView';
import { ssoProvider } from '@/lib/supabase';

export const Route = createFileRoute('/signup-email')({
  // With an SSO provider configured, root is the app's only auth surface —
  // the native auth routes bounce straight there without rendering.
  beforeLoad: () => {
    if (ssoProvider) {
      throw redirect({ to: '/', replace: true });
    }
  },
  component: SignUpEmailView,
});
