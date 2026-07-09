import { useAuth } from '@/contexts/AuthContext';
import { useProfile, useAvatarUrl } from '@/services/profileService';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { getInitials } from '@/lib/utils';
import { ssoClaims, ssoManaged } from '@/lib/supabase';

export function UserAvatar({ className }: { className?: string }) {
  const { user } = useAuth();
  const { data: profile } = useProfile();
  const { data: avatarUrl } = useAvatarUrl(profile?.avatar_path);

  // The provider photo. Under SSO read it from the fresh identity claims (the
  // same source as the name) — NOT user_metadata, which GoTrue leaves stale. In
  // self-host, fall back to whatever the OAuth provider put in user_metadata.
  const claims = ssoClaims(user);
  const metadata = user?.user_metadata as
    | { avatar_url?: string; picture?: string }
    | undefined;
  const providerAvatar = claims
    ? claims.picture || claims.avatar_url
    : metadata?.avatar_url || metadata?.picture;

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
