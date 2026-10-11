import { supabase } from '@/lib/supabase';
import { messageRowToChatMessage } from '@/lib/aiMessages';
import type { Message } from '@shared/types';

export interface MeshAttachment {
  meshId: string;
  filename: string;
  fileType: string;
}

/**
 * Extracts canonical mesh attachment descriptors from persisted message rows.
 */
export function extractMeshAttachments(messages: Message[]): MeshAttachment[] {
  const attachments: MeshAttachment[] = [];
  const seen = new Set<string>();

  for (const message of messages) {
    const chatMessage = messageRowToChatMessage(message);
    if (!Array.isArray(chatMessage.parts)) continue;

    for (const part of chatMessage.parts) {
      if (part.type === 'data-mesh-context' && part.data) {
        const { meshId, fileType = 'stl' } = part.data;
        const filename = part.data.filename || `${meshId}.${fileType}`;
        const key = `${meshId}:${filename}`;
        if (!seen.has(key)) {
          seen.add(key);
          attachments.push({ meshId, filename, fileType });
        }
      }
    }
  }

  return attachments;
}

/**
 * Download a mesh attachment blob from Supabase storage for a specific conversation.
 */
export async function downloadMeshAttachment({
  userId,
  conversationId,
  meshId,
  fileType,
}: {
  userId: string;
  conversationId: string;
  meshId: string;
  fileType: string;
}): Promise<Blob | null> {
  const path = `${userId}/${conversationId}/${meshId}.${fileType}`;
  const { data, error } = await supabase.storage.from('meshes').download(path);
  if (error || !data) {
    console.warn(`[meshService] Failed to download mesh "${path}":`, error);
    return null;
  }
  return data;
}
