import { CoreMessage } from '@shared/types.ts';
import { SupabaseClient } from './supabaseClient.ts';
import { ContentBlockParam } from 'https://esm.sh/@anthropic-ai/sdk@0.53.0/resources/messages.d.mts';

/**
 * Reformats a Supabase signed URL to use the correct host (local ngrok or production)
 * This is needed because signed URLs use the internal Supabase URL, but we need the external host
 */
export function reformatSignedUrl(signedUrl: string): string {
  const supabaseHost =
    (Deno.env.get('ENVIRONMENT') === 'local'
      ? Deno.env.get('NGROK_URL')
      : Deno.env.get('SUPABASE_URL')
    )?.trim() ?? '';

  const url = new URL(signedUrl);
  return `${supabaseHost}${url.pathname}${url.search}`;
}

export async function getSignedUrl(
  supabaseClient: SupabaseClient,
  bucket: string,
  path: string,
): Promise<string | null> {
  const { data: rawImageUrl } = await supabaseClient.storage
    .from(bucket)
    .createSignedUrl(path, 60 * 60);

  if (!rawImageUrl?.signedUrl) {
    return null;
  }

  return reformatSignedUrl(rawImageUrl.signedUrl);
}

export async function getSignedUrls(
  supabaseClient: SupabaseClient,
  bucket: string,
  paths: string[],
): Promise<string[]> {
  const { data: signedUrls } = await supabaseClient.storage
    .from(bucket)
    .createSignedUrls(paths, 60 * 60);

  return signedUrls
    ? signedUrls
        .filter((image) => !image.error && image.signedUrl)
        .map((image) => reformatSignedUrl(image.signedUrl))
    : [];
}

/**
 * Downloads images from Supabase Storage and converts them to base64 data URLs
 * This is needed for OpenRouter/OpenAI API which may not be able to fetch remote URLs
 */
export async function getBase64Images(
  supabaseClient: SupabaseClient,
  bucket: string,
  paths: string[],
): Promise<Array<{ data: string; mediaType: string }>> {
  const images = await Promise.all(
    paths.map(async (path) => {
      try {
        const { data, error } = await supabaseClient.storage
          .from(bucket)
          .download(path);

        if (error || !data) {
          console.error(`Failed to download image ${path}:`, error);
          return null;
        }

        // Convert Blob to ArrayBuffer to Uint8Array
        const arrayBuffer = await data.arrayBuffer();
        const uint8Array = new Uint8Array(arrayBuffer);

        // Convert to base64
        const base64 = btoa(String.fromCharCode(...uint8Array));

        // Determine media type from blob type or default to jpeg
        const mediaType = data.type || 'image/jpeg';

        return {
          data: `data:${mediaType};base64,${base64}`,
          mediaType,
        };
      } catch (err) {
        console.error(`Error processing image ${path}:`, err);
        return null;
      }
    }),
  );

  return images.filter(
    (img): img is { data: string; mediaType: string } => img !== null,
  );
}

// Format user message blocks (supports text, error context and signed image URLs)
export async function formatUserMessage(
  message: CoreMessage,
  supabaseClient: SupabaseClient,
  userId: string,
  conversationId: string,
): Promise<{
  role: 'user';
  content: ContentBlockParam[];
}> {
  const parts: ContentBlockParam[] = [];

  if (message.content.text) {
    parts.push({ type: 'text', text: message.content.text });
  }

  if (message.content.error) {
    parts.push({
      type: 'text',
      text: `The OpenSCAD code generated has failed to compile and has given the following error, fix any syntax, logic, parameter, library, or other issues: ${message.content.error}`,
    });
  }

  if (message.content.images?.length) {
    const imageFiles = message.content.images.map(
      (imageId) => `${userId}/${conversationId}/${imageId}`,
    );
    const base64Images = await getBase64Images(
      supabaseClient,
      'images',
      imageFiles,
    );

    if (base64Images.length > 0) {
      parts.push({
        type: 'text',
        text: `Reference images (IDs: ${message.content.images.join(', ')}):`,
      });
      parts.push(
        ...base64Images.map((image) => ({
          type: 'image' as const,
          source: {
            type: 'base64' as const,
            media_type: image.mediaType as
              | 'image/jpeg'
              | 'image/png'
              | 'image/gif'
              | 'image/webp',
            data: image.data.split(',')[1],
          },
        })),
      );
    } else {
      parts.push({
        type: 'text',
        text: `User uploaded ${message.content.images.length} reference image(s) with IDs: ${message.content.images.join(', ')}`,
      });
    }
  }

  return { role: 'user', content: parts };
}

export async function formatCreativeUserMessage(
  message: CoreMessage,
  supabaseClient: SupabaseClient,
  userId: string,
  conversationId: string,
): Promise<{
  role: 'user';
  content: ContentBlockParam[];
}> {
  const parts: ContentBlockParam[] = [];

  if (message.content.text) {
    parts.push({
      type: 'text',
      text: message.content.text,
    });
  }

  // Add images if they exist
  if (message.content.images?.length) {
    const imageFiles = message.content.images.map(
      (imageId) => `${userId}/${conversationId}/${imageId}`,
    );

    const imageInputs = await getSignedUrls(
      supabaseClient,
      'images',
      imageFiles,
    );

    if (imageInputs.length > 0) {
      parts.push({
        type: 'text',
        text: `Here are the image(s) with the following ID(s) respectively: ${message.content.images.join(', ')}`,
      });
      parts.push(
        ...imageInputs.map((image) => ({
          type: 'image' as const,
          source: {
            type: 'url' as const,
            url: image,
          },
        })),
      );
    } else {
      parts.push({
        type: 'text',
        text: `User uploaded image(s) with the ID(s) ${message.content.images.join(', ')}`,
      });
    }
  }

  // Add mesh if it exists
  if (message.content.mesh) {
    // Try to add mesh preview if it exists
    const previewSignedUrl = await getSignedUrl(
      supabaseClient,
      'images',
      `${userId}/${conversationId}/preview-${message.content.mesh.id}`,
    );

    if (previewSignedUrl) {
      parts.push({
        type: 'text',
        text: `Here is a preview of the mesh with the ID ${message.content.mesh.id}`,
      });
      parts.push({
        type: 'image',
        source: {
          type: 'url' as const,
          url: previewSignedUrl,
        },
      });
    } else {
      parts.push({
        type: 'text',
        text: `User uploaded mesh with the ID ${message.content.mesh.id}`,
      });
    }
  }

  return {
    role: 'user',
    content: parts,
  };
}
