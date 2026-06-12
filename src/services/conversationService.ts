import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/hooks/use-toast';
import { HistoryConversation } from '@/types/misc';
import { Conversation } from '@shared/types';
import { supabase } from '@/lib/supabase';
import {
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
} from '@tanstack/react-query';
import { useParams } from '@tanstack/react-router';

type ConversationListItem = Pick<Conversation, 'id' | 'title'> &
  Partial<Conversation>;

async function removeConversationImages(
  userId: string,
  conversationId: string,
) {
  const { data: list } = await supabase.storage
    .from('images')
    .list(`${userId}/${conversationId}`);
  if (list?.length) {
    await supabase.storage
      .from('images')
      .remove(list.map((file) => `${userId}/${conversationId}/${file.name}`));
  }
}

function patchConversationListCaches(
  queryClient: QueryClient,
  conversationId: string,
  mode: 'remove' | { rename: string },
) {
  const patch = <T extends ConversationListItem>(items: T[] | undefined) => {
    if (!items) return items;
    if (mode === 'remove') {
      return items.filter((item) => item.id !== conversationId);
    }
    return items.map((item) =>
      item.id === conversationId ? { ...item, title: mode.rename } : item,
    );
  };

  queryClient.setQueryData(
    ['conversations'],
    (old: HistoryConversation[] | undefined) => patch(old),
  );
  queryClient.setQueryData(
    ['conversations', 'recent'],
    (old: Conversation[] | undefined) => patch(old),
  );
  if (mode !== 'remove') {
    queryClient.setQueryData(
      ['conversation', conversationId],
      (old: Conversation | undefined) =>
        old ? { ...old, title: mode.rename } : old,
    );
  } else {
    queryClient.removeQueries({ queryKey: ['conversation', conversationId] });
    queryClient.removeQueries({ queryKey: ['messages', conversationId] });
  }
}

export function useDeleteConversation(options?: {
  onDeleted?: (conversationId: string) => void;
}) {
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (conversationId: string) => {
      const { error } = await supabase
        .from('conversations')
        .delete()
        .eq('id', conversationId);

      if (error) throw error;

      if (user?.id) {
        void removeConversationImages(user.id, conversationId);
      }
    },
    onMutate: async (conversationId) => {
      await queryClient.cancelQueries({ queryKey: ['conversations'] });
      await queryClient.cancelQueries({
        queryKey: ['conversations', 'recent'],
      });
      const previousConversations = queryClient.getQueryData(['conversations']);
      const previousRecent = queryClient.getQueryData([
        'conversations',
        'recent',
      ]);
      patchConversationListCaches(queryClient, conversationId, 'remove');
      return { previousConversations, previousRecent };
    },
    onSuccess: (_data, conversationId) => {
      queryClient.invalidateQueries({ queryKey: ['conversations'] });
      queryClient.invalidateQueries({ queryKey: ['conversations', 'recent'] });
      options?.onDeleted?.(conversationId);
      toast({
        title: 'Creation deleted',
        description: 'The conversation was removed successfully.',
      });
    },
    onError: (error, _conversationId, context) => {
      console.error('Error deleting conversation:', error);
      queryClient.setQueryData(
        ['conversations'],
        context?.previousConversations,
      );
      queryClient.setQueryData(
        ['conversations', 'recent'],
        context?.previousRecent,
      );
      toast({
        title: 'Error',
        description: 'Failed to delete conversation',
        variant: 'destructive',
      });
    },
  });
}

export function useRenameConversation(options?: { onRenamed?: () => void }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      conversationId,
      newTitle,
    }: {
      conversationId: string;
      newTitle: string;
    }) => {
      const { error } = await supabase
        .from('conversations')
        .update({ title: newTitle })
        .eq('id', conversationId);

      if (error) throw error;
    },
    onMutate: async ({ conversationId, newTitle }) => {
      await queryClient.cancelQueries({ queryKey: ['conversations'] });
      await queryClient.cancelQueries({
        queryKey: ['conversations', 'recent'],
      });
      const previousConversations = queryClient.getQueryData(['conversations']);
      const previousRecent = queryClient.getQueryData([
        'conversations',
        'recent',
      ]);
      const previousConversation = queryClient.getQueryData([
        'conversation',
        conversationId,
      ]);
      patchConversationListCaches(queryClient, conversationId, {
        rename: newTitle,
      });
      return { previousConversations, previousRecent, previousConversation };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['conversations'] });
      queryClient.invalidateQueries({ queryKey: ['conversations', 'recent'] });
      options?.onRenamed?.();
      toast({
        title: 'Creation renamed',
        description: 'The conversation title was updated.',
      });
    },
    onError: (error, { conversationId }, context) => {
      console.error('Error renaming conversation:', error);
      queryClient.setQueryData(
        ['conversations'],
        context?.previousConversations,
      );
      queryClient.setQueryData(
        ['conversations', 'recent'],
        context?.previousRecent,
      );
      queryClient.setQueryData(
        ['conversation', conversationId],
        context?.previousConversation,
      );
      toast({
        title: 'Error',
        description: 'Failed to rename conversation',
        variant: 'destructive',
      });
    },
  });
}

const defaultConversation: Conversation = {
  id: '',
  title: '',
  current_message_leaf_id: null,
  user_id: '',
  created_at: '',
  updated_at: '',
  privacy: 'private',
  type: 'parametric',
  settings: null,
};

export function useConversation() {
  const { id: conversationId } = useParams({
    from: '/_layout/_auth/editor/$id',
  });
  const { user } = useAuth();
  const queryClient = useQueryClient();

  const { data: conversation, isLoading: isConversationLoading } =
    useQuery<Conversation>({
      queryKey: ['conversation', conversationId],
      enabled: !!conversationId,
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
          .single()
          .overrideTypes<Conversation>();

        if (error) {
          throw error;
        }
        return data as Conversation;
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
