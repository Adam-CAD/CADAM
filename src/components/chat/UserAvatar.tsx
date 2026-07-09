import { useAuth } from '@/contexts/AuthContext';
import { useProfile, useAvatarUrl } from '@/services/profileService';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { getInitials } from '@/lib/utils';
import { accountUrl, ssoProvider } from '@/lib/supabase';

export function UserAvatar({ className }: { className?: string }) {
  const { user } = useAuth();
  const { data: profile } = useProfile();
  const { data: avatarUrl } = useAvatarUrl(profile?.avatar_path);

  // Supabase GoTrue stores the OIDC `picture` claim in user_metadata (as
  // `avatar_url`, and sometimes `picture`), so `providerAvatar` is the SSO
  // account's photo; `avatarUrl` is the CADAM-local, self-uploaded picture.
  // Provider-agnostic — works for any Supabase OAuth provider.
  const metadata = user?.user_metadata as
    | { avatar_url?: string; picture?: string }
    | undefined;
  const providerAvatar = metadata?.avatar_url || metadata?.picture;

  // When SSO owns the identity (same condition SettingsView uses to make the
  // account read-only), the provider photo is the single source of truth, so it
  // wins — a stale CADAM-local upload can no longer diverge from the Adam photo.
  // In self-host mode the self-uploaded avatar keeps winning.
  const ssoManaged = Boolean(ssoProvider && accountUrl);
  const src = ssoManaged
    ? providerAvatar || avatarUrl || undefined
    : avatarUrl || providerAvatar || undefined;

  return (
    <Avatar className={className}>
      <AvatarImage src={src} />
      <AvatarFallback>{getInitials(profile?.full_name || null)}</AvatarFallback>
    </Avatar>
  );
}
