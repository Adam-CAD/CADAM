import { useNavigate, useParams } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { ParametricEditor } from '../components/ParametricEditor';
import { Message } from '@shared/types';
import { MessageItem } from '@/types/misc';
import { useEffect, useState } from 'react';
import { CurrentMessageContext } from '@/contexts/CurrentMessageContext';
import { SelectedItemsContext } from '@/contexts/SelectedItemsContext';
import {
  useConversation,
  usePublicConversation,
} from '@/services/conversationService';
import { BlobContext } from '@/contexts/BlobContext';
import { ColorContext } from '@/contexts/ColorContext';
import { useAuth } from '@/contexts/AuthContext';

export default function EditorView() {
  const { id: conversationId } = useParams();
  const [currentMessage, setCurrentMessage] = useState<Message | null>(null);
  const [images, setImages] = useState<MessageItem[]>([]);
  const [blob, setBlob] = useState<Blob | null>(null);
  const [color, setColor] = useState<string>('#00A6FF');
  const navigate = useNavigate();
  const { user } = useAuth();

  // Use appropriate hook based on authentication status
  // Authenticated users use useConversation (with user_id filter)
  // Anonymous users use usePublicConversation (public conversations only)
  const authenticatedData = useConversation({ enabled: !!user });
  const publicData = usePublicConversation(conversationId, { enabled: !user });

  const { conversation, isConversationLoading } = user
    ? authenticatedData
    : publicData;

  useEffect(() => {
    if (!conversationId) {
      navigate('/');
    }
  }, [conversationId, navigate]);

  if (isConversationLoading) {
    return (
      <div className="flex h-full w-full items-center justify-center bg-adam-bg-secondary-dark text-adam-text-primary">
        <Loader2 className="h-10 w-10 animate-spin" />
      </div>
    );
  }

  if (!conversation.id) {
    return (
      <div className="flex h-full w-full flex-col items-center justify-center bg-adam-bg-secondary-dark text-adam-text-primary">
        <span className="text-2xl font-medium">404</span>
        <span className="text-sm">Conversation not found</span>
      </div>
    );
  }

  return (
    <CurrentMessageContext.Provider
      value={{
        currentMessage,
        setCurrentMessage,
      }}
    >
      <BlobContext.Provider value={{ blob, setBlob }}>
        <ColorContext.Provider value={{ color, setColor }}>
          <SelectedItemsContext.Provider value={{ images, setImages }}>
            <ParametricEditor />
          </SelectedItemsContext.Provider>
        </ColorContext.Provider>
      </BlobContext.Provider>
    </CurrentMessageContext.Provider>
  );
}
