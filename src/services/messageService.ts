import { useConversation } from '@/contexts/ConversationContext';
import { supabase } from '@/lib/supabase';
import type { Message } from '@shared/types';
import { useQuery } from '@tanstack/react-query';

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
