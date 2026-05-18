import { supabase } from '@/lib/supabase';
import { Message } from '@shared/types';
import { useQuery } from '@tanstack/react-query';
import { CreativeView } from './CreativeView';
import { useEffect, useMemo } from 'react';
import { useConversation } from '@/contexts/ConversationContext';
import { useCurrentMessage } from '@/contexts/CurrentMessageContext';
import { useIsMobile } from '@/hooks/useIsMobile';
import Tree from '@shared/Tree';

export default function CreativeShareView() {
  const { conversation } = useConversation();
  const { setCurrentMessage } = useCurrentMessage();
  const isMobile = useIsMobile();

  const { data: messages } = useQuery<Message[]>({
    queryKey: ['share-messages', conversation.id],
    initialData: [],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('messages')
        .select('*')
        .eq('conversation_id', conversation.id)
        .order('created_at', { ascending: true });
      if (error) throw error;
      return data as Message[];
    },
  });

  const lastMessage = useMemo(() => {
    if (conversation.current_message_leaf_id) {
      return messages.find(
        (msg) => msg.id === conversation.current_message_leaf_id,
      );
    }
    return messages[messages.length - 1];
  }, [messages, conversation.current_message_leaf_id]);

  const messageTree = useMemo(() => {
    return new Tree<Message>(messages);
  }, [messages]);

  const currentMessageBranch = useMemo(() => {
    return messageTree.getPath(lastMessage?.id ?? '');
  }, [lastMessage, messageTree]);

  useEffect(() => {
    setCurrentMessage(null);
  }, [conversation.id, setCurrentMessage]);

  useEffect(() => {
    if (lastMessage?.role === 'assistant' && !isMobile) {
      setCurrentMessage(lastMessage);
    }
  }, [lastMessage, setCurrentMessage, isMobile]);

  return <CreativeView messages={currentMessageBranch} isLoading={false} />;
}
