import { useAuth } from '@/contexts/AuthContext';
import { Conversation, Content } from '@shared/types';
import { supabase } from '@/lib/supabase';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useParams } from 'react-router-dom';

const defaultConversation: Conversation = {
  id: '',
  title: '',
  current_message_leaf_id: null,
  user_id: '',
  created_at: '',
  updated_at: '',
  is_public: null,
  share_token: null,
};

export function useConversation(options?: { enabled?: boolean }) {
  const { id: conversationId } = useParams();
  const { user } = useAuth();
  const queryClient = useQueryClient();

  const { data: conversation, isLoading: isConversationLoading } =
    useQuery<Conversation>({
      queryKey: ['conversation', conversationId],
      enabled: !!conversationId && (options?.enabled ?? true),
      refetchOnMount: false,
      queryFn: async () => {
        if (!conversationId) {
          throw new Error('Conversation ID is required');
        }
        if (!user?.id) {
          throw new Error('User must be authenticated');
        }

        const { data, error } = await supabase
          .from('conversations')
          .select('*')
          .eq('id', conversationId)
          .eq('user_id', user.id)
          .limit(1)
          .single();

        if (error) {
          throw error;
        }
        return data;
      },
    });

  const { mutate: updateConversation, mutateAsync: updateConversationAsync } =
    useMutation({
      mutationFn: async (conversation: Conversation) => {
        const { data, error } = await supabase
          .from('conversations')
          .update(conversation)
          .eq('id', conversation.id)
          .select()
          .single();

        if (error) {
          throw error;
        }

        return data;
      },
      onMutate: async (conversation) => {
        // Cancel any outgoing refetches
        await queryClient.cancelQueries({
          queryKey: ['conversation', conversation.id],
        });

        // Snapshot the previous value
        const oldConversation = queryClient.getQueryData<Conversation>([
          'conversation',
          conversation.id,
        ]);

        // Optimistically update to the new value
        queryClient.setQueryData(
          ['conversation', conversation.id],
          conversation,
        );

        // Return a context object with the snapshotted value
        return { oldConversation };
      },
      onSuccess: (data) => {
        // Update the cache with the server response
        queryClient.setQueryData(['conversation', conversationId], data);

        // Only invalidate the conversations list, not the individual conversation
        // This prevents unnecessary refetch of the conversation we just updated
        queryClient.invalidateQueries({
          queryKey: ['conversations'],
        });
      },
      onError: (_error, conversation, context) => {
        // If the mutation fails, use the context returned from onMutate to roll back
        queryClient.setQueryData(
          ['conversation', conversation.id],
          context?.oldConversation,
        );
      },
    });

  return {
    conversation: conversation ?? defaultConversation,
    isConversationLoading,
    updateConversation,
    updateConversationAsync,
  };
}

/**
 * Hook for accessing public conversations via ID (for shared links)
 * Does not require authentication - relies on RLS policies for security
 */
export function usePublicConversation(
  conversationId: string | undefined,
  options?: { enabled?: boolean },
) {
  const { data: conversation, isLoading: isConversationLoading } =
    useQuery<Conversation>({
      queryKey: ['public-conversation', conversationId],
      enabled: !!conversationId && (options?.enabled ?? true),
      refetchOnMount: false,
      queryFn: async () => {
        if (!conversationId) {
          throw new Error('Conversation ID is required');
        }

        // Fetch by ID only - RLS policies will enforce public access rules
        const { data, error } = await supabase
          .from('conversations')
          .select('*')
          .eq('id', conversationId)
          .eq('is_public', true)
          .limit(1)
          .single();

        if (error) {
          throw error;
        }
        return data;
      },
    });

  return {
    conversation: conversation ?? defaultConversation,
    isConversationLoading,
  };
}

/**
 * Hook that unifies authenticated and public conversation fetching
 * Automatically selects the appropriate method based on auth status
 */
export function useUnifiedConversation(conversationId?: string) {
  const { user } = useAuth();
  const { id: paramId } = useParams();
  const targetId = conversationId || paramId;

  const authenticatedData = useConversation({ enabled: !!user });
  const publicData = usePublicConversation(targetId, { enabled: !user });

  return user ? authenticatedData : publicData;
}

export async function generateConversationTitle(
  conversationId: string,
  content: Content,
): Promise<string> {
  const {
    data: { session },
  } = await supabase.auth.getSession();

  if (!session?.access_token) {
    throw new Error('No active session');
  }

  const response = await fetch(
    `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/title-generator`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({
        content,
        conversationId,
      }),
    },
  );

  if (!response.ok) {
    throw new Error(`Failed to generate title: ${response.statusText}`);
  }

  const data = await response.json();
  return data.title || 'New Conversation';
}
