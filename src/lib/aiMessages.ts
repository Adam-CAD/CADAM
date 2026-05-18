import { supabase } from '@/lib/supabase';
import type { AppUIMessage } from '@shared/chatAi';
import type { Message } from '@shared/types';

export type ModernChatMessage = AppUIMessage & {
  conversation_id: string;
  parent_message_id: string | null;
  created_at: string;
  rating: number;
  isLegacy?: boolean;
  legacyContent?: unknown;
};

export function messageRowToUIMessage(message: Message): AppUIMessage {
  return {
    id: message.id,
    role: message.role,
    metadata:
      message.metadata &&
      typeof message.metadata === 'object' &&
      !Array.isArray(message.metadata)
        ? message.metadata
        : {},
    parts: Array.isArray(message.parts)
      ? (message.parts as AppUIMessage['parts'])
      : [],
  };
}

export function messageRowToModernMessage(message: Message): ModernChatMessage {
  const parts = Array.isArray(message.parts)
    ? (message.parts as AppUIMessage['parts'])
    : [];
  const legacyContent = (message as Message & { content?: unknown }).content;
  const isLegacy = parts.length === 0 && legacyContent != null;
  return {
    ...messageRowToUIMessage(message),
    conversation_id: message.conversation_id,
    parent_message_id: message.parent_message_id,
    created_at: message.created_at,
    rating: message.rating,
    ...(isLegacy ? { isLegacy: true, legacyContent } : {}),
  };
}

export function uiMessageToModernMessage({
  message,
  conversationId,
  parentMessageId,
}: {
  message: AppUIMessage;
  conversationId: string;
  parentMessageId: string | null;
}): ModernChatMessage {
  return {
    ...message,
    conversation_id: conversationId,
    parent_message_id: parentMessageId,
    created_at: new Date().toISOString(),
    rating: 0,
  };
}

/**
 * Walk a parts array and upsert any image/mesh rows the user attached, so the
 * supabase records exist before the chat stream references them.
 */
export async function ensureInputRecords({
  parts,
  conversationId,
  userId,
}: {
  parts: AppUIMessage['parts'];
  conversationId: string;
  userId: string;
}) {
  const imageIds = parts
    .filter(
      (
        part,
      ): part is Extract<AppUIMessage['parts'][number], { type: 'file' }> =>
        part.type === 'file' &&
        typeof part.mediaType === 'string' &&
        part.mediaType.startsWith('image/'),
    )
    .map((part) => part.filename?.replace(/\.[^.]+$/, ''))
    .filter((id): id is string => !!id);

  if (imageIds.length) {
    await Promise.all(
      imageIds.map(async (imageId) => {
        const { error } = await supabase.from('images').upsert(
          {
            id: imageId,
            prompt: { text: 'User uploaded image' },
            status: 'success',
            user_id: userId,
            conversation_id: conversationId,
          },
          { onConflict: 'id', ignoreDuplicates: true },
        );
        if (error) throw error;
      }),
    );
  }

  const meshContexts = parts.filter(
    (
      part,
    ): part is Extract<
      AppUIMessage['parts'][number],
      { type: 'data-mesh-context' }
    > => part.type === 'data-mesh-context',
  );

  for (const meshPart of meshContexts) {
    const { error } = await supabase.from('meshes').upsert(
      {
        id: meshPart.data.meshId,
        conversation_id: conversationId,
        user_id: userId,
        status: 'success',
        prompt: { text: 'User uploaded mesh' },
        file_type: meshPart.data.fileType,
      },
      { onConflict: 'id', ignoreDuplicates: true },
    );
    if (error) throw error;
  }
}
