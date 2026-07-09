import { useAuth } from '@/contexts/AuthContext';
import { useProfile, useAvatarUrl } from '@/services/profileService';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { getInitials } from '@/lib/utils';
import { ssoManaged } from '@/lib/supabase';

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

  // When Adam owns the profile (shared `ssoManaged` flag) the provider photo is
  // the single source of truth and wins, so a stale CADAM-local upload can't
  // diverge from the Adam photo. In self-host mode the self-uploaded avatar wins.
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
