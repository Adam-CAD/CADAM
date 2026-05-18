import { supabase } from '@/lib/supabase';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useParams } from '@tanstack/react-router';
import { useAuth } from '@/contexts/AuthContext';
import { Loader2 } from 'lucide-react';
import { ModernConversationView } from './ModernConversationView';
import { ConversationContext } from '@/contexts/ConversationContext';
import { Conversation } from '@shared/types';
import { MessageItem } from '../types/misc.ts';
import { useEffect, useState } from 'react';
import { SelectedItemsContext } from '@/contexts/SelectedItemsContext';

export default function EditorView() {
  const { id: conversationId } = useParams({
    from: '/_layout/_auth/editor/$id',
  });
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [images, setImages] = useState<MessageItem[]>([]);
  const [mesh, setMesh] = useState<MessageItem | null>(null);
  const navigate = useNavigate();

  const { data: conversation, isLoading: isConversationLoading } = useQuery({
    queryKey: ['conversation', conversationId],
    enabled: !!conversationId,
    queryFn: async () => {
      if (!conversationId) {
        throw new Error('Conversation ID is required');
      }
      const { data, error } = await supabase
        .from('conversations')
        .select('*')
        .eq('id', conversationId)
        .eq('user_id', user?.id ?? '')
        .limit(1)
        .single();

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
          .single()
          .overrideTypes<Conversation>();

        if (error) {
          throw error;
        }

        return data;
      },
      onMutate(conversation) {
        const oldConversation = queryClient.getQueryData<Conversation>([
          'conversation',
          conversation.id,
        ]);
        queryClient.setQueryData(
          ['conversation', conversation.id],
          conversation,
        );
        return { oldConversation };
      },
      onSuccess() {
        queryClient.invalidateQueries({
          queryKey: ['conversation', conversationId],
        });
        queryClient.invalidateQueries({
          queryKey: ['conversations'],
        });
      },
      onError(_error, conversation, context) {
        queryClient.setQueryData(
          ['conversation', conversation.id],
          context?.oldConversation,
        );
      },
    });

  useEffect(() => {
    if (!conversationId) {
      navigate({ to: '/' });
    }
  }, [conversationId, navigate]);

  if (isConversationLoading) {
    return (
      <div className="flex h-full w-full items-center justify-center bg-adam-bg-secondary-dark text-adam-text-primary">
        <Loader2 className="h-10 w-10 animate-spin" />
      </div>
    );
  }

  if (!conversation) {
    return (
      <div className="flex h-full w-full flex-col items-center justify-center bg-adam-bg-secondary-dark text-adam-text-primary">
        <span className="text-2xl font-medium">404</span>
        <span className="text-sm">Conversation not found</span>
      </div>
    );
  }

  return (
    <ConversationContext.Provider
      value={{
        conversation,
        updateConversation,
        updateConversationAsync,
      }}
    >
      <SelectedItemsContext.Provider
        value={{ images, setImages, mesh, setMesh }}
      >
        {/* `ModernConversationView` resets activePreview/parameters/etc.
            internally via an effect keyed on conversation.id — we deliberately
            avoid `key={conversation.id}` here because TanStack Router's lazy
            Outlet resolves async and would otherwise discard the keyed subtree
            mid-hydration, causing a tree-wide remount cycle. */}
        <ModernConversationView />
      </SelectedItemsContext.Provider>
    </ConversationContext.Provider>
  );
}
