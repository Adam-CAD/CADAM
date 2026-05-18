import { useConversation } from '@/contexts/ConversationContext';
import { supabase } from '@/lib/supabase';
import { apiUrl } from '@/services/api';
import type { Conversation, Message } from '@shared/types';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

export const useMessagesQuery = () => {
  const { conversation } = useConversation();

  return useQuery<Message[]>({
    enabled: !!conversation.id,
    queryKey: ['messages', conversation.id],
    initialData: [],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('messages')
        .select('*')
        .eq('conversation_id', conversation.id)
        .order('created_at', { ascending: true })
        .overrideTypes<Message[]>();

      if (error) throw error;
      return data ?? [];
    },
  });
};

/**
 * Optimistically update a message row's rating column. The chat tree is
 * read straight from Supabase via useMessagesQuery; this writes both the
 * cache and the DB so the thumb fills in instantly.
 */
export function useChangeRatingMutation({
  conversationId,
}: {
  conversationId: string;
}) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationKey: ['change-rating', conversationId],
    mutationFn: async ({
      messageId,
      rating,
    }: {
      messageId: string;
      rating: number;
    }) => {
      queryClient.setQueryData<Message[]>(
        ['messages', conversationId],
        (oldMessages) =>
          oldMessages?.map((m) => (m.id === messageId ? { ...m, rating } : m)),
      );
      const { error } = await supabase
        .from('messages')
        .update({ rating })
        .eq('id', messageId);
      if (error) throw error;
    },
  });
}

/**
 * "Restore" an old assistant message — matches the legacy CADAM behavior
 * exactly: insert a fresh row that COPIES the message's role, parts,
 * metadata, and `parent_message_id`, then point the conversation's
 * `current_message_leaf_id` at the new copy. Because the copy shares the
 * original's parent, the two messages become siblings, so BranchNavigation
 * keeps working (the user can flip back to whichever version they want).
 *
 * The previous implementation just retargeted `current_message_leaf_id`
 * to the existing message — that "worked" superficially but broke the
 * sibling story for any subsequent retry, because the assistant being
 * restored already had its own children in the tree.
 */
export function useRestoreMessageMutation({
  conversation,
  updateConversationAsync,
}: {
  conversation: Conversation;
  updateConversationAsync?: (conversation: Conversation) => Promise<unknown>;
}) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationKey: ['restore-message', conversation.id],
    mutationFn: async ({
      message,
    }: {
      message: Pick<
        Message,
        'role' | 'parts' | 'metadata' | 'parent_message_id'
      >;
    }) => {
      const newId = crypto.randomUUID();
      const { error } = await supabase.from('messages').insert({
        id: newId,
        conversation_id: conversation.id,
        role: message.role,
        parts: JSON.parse(JSON.stringify(message.parts)),
        metadata: JSON.parse(JSON.stringify(message.metadata ?? {})),
        parent_message_id: message.parent_message_id,
        rating: 0,
      });
      if (error) throw error;

      if (updateConversationAsync) {
        await updateConversationAsync({
          ...conversation,
          current_message_leaf_id: newId,
        });
      }

      // Pull the freshly inserted row into the messages query so the
      // tree merge sees it as a sibling immediately.
      queryClient.invalidateQueries({
        queryKey: ['messages', conversation.id],
      });
    },
  });
}

/**
 * Submit an upscale job for an existing mesh. The server creates a fresh
 * ultra-quality mesh entry and streams progress through the standard
 * mesh-status polling path; the caller is expected to navigate to the
 * parent user message so the new mesh shows up in the right slot.
 */
export function useUpscaleMutation({
  conversation,
  updateConversationAsync,
}: {
  conversation: Conversation;
  updateConversationAsync?: (conversation: Conversation) => Promise<unknown>;
}) {
  return useMutation({
    mutationKey: ['upscale', conversation.id],
    mutationFn: async ({
      meshId,
      parentMessageId,
    }: {
      meshId: string;
      parentMessageId: string | null;
    }) => {
      if (parentMessageId && updateConversationAsync) {
        await updateConversationAsync({
          ...conversation,
          current_message_leaf_id: parentMessageId,
        });
      }
      const token = (await supabase.auth.getSession()).data.session
        ?.access_token;
      const response = await fetch(apiUrl('mesh'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          action: 'upscale',
          meshId,
          conversationId: conversation.id,
          parentMessageId,
        }),
      });
      if (!response.ok) {
        const text = await response.text();
        throw new Error(`Upscale failed: ${text}`);
      }
    },
  });
}
