import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Content, Message, Parameter } from '@shared/types';
import { useIsMutating, useQueryClient } from '@tanstack/react-query';
import { updateParameter } from '@/lib/utils';
import ParametricView from './ParametricView';
import { useConversation } from '@/contexts/ConversationContext';
import OpenSCADError from '@/lib/OpenSCADError';
import { useCurrentMessage } from '@/contexts/CurrentMessageContext';
import {
  useEditMessageMutation,
  useMessagesQuery,
  useRestoreMessageMutation,
  useRetryMessageMutation,
  useSendContentMutation,
  useUpdateMessageOptimisticMutation,
  useChangeRatingMutation,
} from '@/services/messageService';
import { useAuth } from '@/contexts/AuthContext';
import Tree from '@shared/Tree';
import { useRequestCancellation } from '@/hooks/useRequestCancellation';
import posthog from 'posthog-js';
import { useMediaQuery } from '@/hooks/useMediaQuery';

export function ParametricEditorView() {
  const { conversation, updateConversationAsync } = useConversation();
  const queryClient = useQueryClient();
  const { currentMessage, setCurrentMessage } = useCurrentMessage();
  const { billing } = useAuth();
  const totalTokens = billing?.tokens.total ?? 0;
  const [currentOutput, setCurrentOutput] = useState<Blob | undefined>();
  // Brand fallback color used when OFF parsing fails and we drop back to
  // the single-color STL mesh.
  const color = '#00A6FF';
  const { cancelRequest } = useRequestCancellation();
  const isTabletOrMobile = useMediaQuery('(max-width: 1024px)');

  // Track the current processing message ID for cancellation
  const currentProcessingMessageRef = useRef<string | null>(null);

  const { mutate: updateMessageOptimistic } =
    useUpdateMessageOptimisticMutation();

  const { mutate: sendMessageMutation, isPending: isSendingMessage } =
    useSendContentMutation({
      conversation,
    });

  const { mutate: retryMessage, isPending: isRetryingMessage } =
    useRetryMessageMutation({
      conversation,
      updateConversationAsync,
    });

  const { mutate: editMessage, isPending: isEditingMessage } =
    useEditMessageMutation({ conversation });

  const { mutate: restoreMessage } = useRestoreMessageMutation();

  const { mutate: changeRating } = useChangeRatingMutation({
    conversationId: conversation.id,
  });

  const isSending = useIsMutating({
    mutationKey: ['parametric-chat', conversation.id],
  });

  const isLoading =
    !!isSending || isRetryingMessage || isSendingMessage || isEditingMessage;

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

  // Track the last user message to get the messageId for cancellation
  useEffect(() => {
    if (lastMessage?.role === 'user' && isLoading) {
      currentProcessingMessageRef.current = lastMessage.id;
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
    if (lastMessage?.role === 'assistant' && !isTabletOrMobile) {
      setCurrentMessage(lastMessage);
    }
  }, [lastMessage, setCurrentMessage, isTabletOrMobile]);

  const changeParameters = useCallback(
    (message: Message | null, updatedParameters: Parameter[]) => {
      if (!message) return;

      let newCode = message.content.artifact?.code ?? '';
      updatedParameters.forEach((param) => {
        if (param.name.length > 0) {
          newCode = updateParameter(newCode, param);
        }
      });

      const newContent: Content = {
        text: message.content.text ?? '',
        model: message.content.model ?? 'fast',
        artifact: {
          title: message.content.artifact?.title ?? '',
          version: message.content.artifact?.version ?? '',
          code: newCode,
          parameters: updatedParameters,
          suggestions: message.content.artifact?.suggestions ?? [],
        },
      };

      updateMessageOptimistic(
        {
          message: { ...message, content: newContent },
        },
        {
          onError(_error, _variables, context) {
            if (context?.oldMessages) {
              const oldMessage = context.oldMessages.find(
                (msg) => msg.id === message?.id,
              );
              queryClient.setQueryData(
                ['messages', conversation.id],
                context.oldMessages,
              );
              setCurrentMessage(oldMessage ?? null);
            }
          },
        },
      );
      setCurrentMessage({ ...message, content: newContent });
    },
    [updateMessageOptimistic, queryClient, conversation.id, setCurrentMessage],
  );

  const sendMessage = useCallback(
    (content: Content) => {
      posthog.capture('message_sent', {
        type: 'parametric',
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

  const fixError = useCallback(
    async (error: OpenSCADError) => {
      const newContent: Content = {
        text: 'Fix with AI',
        error: error.stdErr.join('\n'),
      };

      sendMessage(newContent);
    },
    [sendMessage],
  );

  return (
    <ParametricView
      messages={currentMessageBranch}
      sendMessage={sendMessage}
      editMessage={editMessage}
      retryMessage={retryMessage}
      isLoading={isLoading}
      currentOutput={currentOutput}
      setCurrentOutput={setCurrentOutput}
      color={color}
      changeParameters={changeParameters}
      stopGenerating={stopGenerating}
      fixError={currentMessage?.id === lastMessage?.id ? fixError : undefined}
      changeRating={changeRating}
      restoreMessage={restoreMessage}
      limitReached={totalTokens <= 0}
    />
  );
}
