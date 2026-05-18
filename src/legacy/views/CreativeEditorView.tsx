import { useEffect, useMemo, useRef, useCallback } from 'react';
import { Content, Message } from '@shared/types';
import { CreativeView } from './CreativeView';
import { useConversation } from '@/contexts/ConversationContext';
import { useCurrentMessage } from '@/contexts/CurrentMessageContext';
import {
  useMessagesQuery,
  useSendContentMutation,
  useEditMessageMutation,
  useRetryMessageMutation,
  useRestoreMessageMutation,
  useChangeRatingMutation,
  useUpscaleMutation,
} from '@/services/messageService';
import { useIsMobile } from '@/hooks/useIsMobile';
import Tree from '@shared/Tree';
import { useIsMutating } from '@tanstack/react-query';
import { useRequestCancellation } from '@/hooks/useRequestCancellation';
import posthog from 'posthog-js';

export function CreativeEditorView() {
  const { conversation, updateConversationAsync } = useConversation();
  const { setCurrentMessage } = useCurrentMessage();
  const isMobile = useIsMobile();
  const { cancelRequest } = useRequestCancellation();

  // Track the current processing message ID for cancellation
  const currentProcessingMessageRef = useRef<string | null>(null);

  const { mutate: sendMessageMutation, isPending: isSendingMessage } =
    useSendContentMutation({
      conversation,
    });

  const { mutate: editMessage, isPending: isEditingMessage } =
    useEditMessageMutation({ conversation });

  const { mutate: retryMessage, isPending: isRetryingMessage } =
    useRetryMessageMutation({
      conversation,
      updateConversationAsync,
    });

  const { mutate: restoreMessage } = useRestoreMessageMutation();

  const { mutate: changeRating } = useChangeRatingMutation({
    conversationId: conversation.id,
  });

  const { mutate: upscaleMessage, isPending: isUpscalingMessage } =
    useUpscaleMutation({ conversation, updateConversationAsync });

  const isSending = useIsMutating({
    mutationKey: ['creative-chat', conversation.id],
  });

  const isLoading =
    !!isSending ||
    isSendingMessage ||
    isRetryingMessage ||
    isEditingMessage ||
    isUpscalingMessage;

  const { data: messages = [] } = useMessagesQuery();

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

  // Track the current request's user message ID for cancellation
  useEffect(() => {
    if (isLoading && lastMessage) {
      // If assistant is streaming, use its parent (the user message)
      const cancellationId =
        lastMessage.role === 'assistant'
          ? lastMessage.parent_message_id || null
          : lastMessage.id;
      currentProcessingMessageRef.current = cancellationId;
    } else if (!isLoading) {
      currentProcessingMessageRef.current = null;
    }
  }, [lastMessage, isLoading]);

  const stopGenerating = useCallback(async () => {
    if (currentProcessingMessageRef.current) {
      try {
        await cancelRequest(currentProcessingMessageRef.current);
        currentProcessingMessageRef.current = null;
      } catch (error) {
        console.error('Failed to cancel request:', error);
      }
    }
  }, [cancelRequest]);

  useEffect(() => {
    setCurrentMessage(null);
  }, [conversation.id, setCurrentMessage]);

  useEffect(() => {
    if (lastMessage?.role === 'assistant' && !isMobile) {
      setCurrentMessage(lastMessage);
    }
  }, [lastMessage, setCurrentMessage, isMobile]);

  const sendMessage = useCallback(
    (content: Content) => {
      posthog.capture('message_sent', {
        type: 'creative',
        model_name: conversation.settings?.model ?? 'none',
        text: content.text ?? '',
        image_count: content.images?.length ?? 0,
        mesh_count: content.mesh ? 1 : 0,
        conversation_id: conversation.id,
      });
      sendMessageMutation(content);
    },
    [sendMessageMutation, conversation.id, conversation.settings?.model],
  );

  return (
    <CreativeView
      messages={currentMessageBranch}
      isLoading={isLoading}
      sendMessage={sendMessage}
      stopGenerating={stopGenerating}
      restoreMessage={restoreMessage}
      retryMessage={retryMessage}
      editMessage={editMessage}
      changeRating={changeRating}
      upscaleMessage={upscaleMessage}
    />
  );
}
