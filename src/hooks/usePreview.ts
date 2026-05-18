import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/lib/supabase';
import { useQuery, type UseQueryResult } from '@tanstack/react-query';

interface UsePreviewOptions {
  id: string | undefined;
  conversationId: string;
  generateBlob: () => Promise<Blob>;
  enabled?: boolean;
  userId?: string;
}

/**
 * "Get or create" cached preview image.
 * Checks Supabase storage at `images/{userId}/{convId}/preview-{id}` and
 * returns a data URL. Generates and uploads if not cached.
 */
export function usePreview({
  id,
  conversationId,
  generateBlob,
  enabled = true,
  userId: userIdProp,
}: UsePreviewOptions): UseQueryResult<string> {
  const { user } = useAuth();
  const userId = userIdProp ?? user?.id;

  return useQuery({
    queryKey: ['preview', conversationId, id],
    queryFn: async () => {
      if (!userId || !id) throw new Error('usePreview: missing userId or id');
      const storagePath = `${userId}/${conversationId}/preview-${id}`;

      const { data: existing } = await supabase.storage
        .from('images')
        .download(storagePath);

      if (existing) return blobToDataUrl(existing);

      const blob = await generateBlob();

      const { error: uploadError } = await supabase.storage
        .from('images')
        .upload(storagePath, blob, {
          contentType: 'image/png',
          upsert: true,
        });

      if (uploadError) {
        console.warn('[usePreview] upload failed, continuing:', uploadError);
      }

      return blobToDataUrl(blob);
    },
    enabled: enabled && !!userId && !!id,
    staleTime: Infinity,
    retry: false,
  });
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}
