import { useConversation } from '@/services/conversationService';
import { supabase } from '@/lib/supabase';
import {
  Content,
  Conversation,
  Message,
  Model,
  Parameter,
} from '@shared/types';
import { HistoryConversation } from '@/types/misc';
import {
  QueryClient,
  useIsMutating,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { updateParameter } from '@/utils/parameterUtils';
import { useCallback, useEffect, useRef } from 'react';
import { WorkerMessageType, WorkerResponseMessage } from '@/worker/types';

function messageSentConversationUpdate(
  newMessage: Message,
  conversationId: string,
) {
  return (
    oldConversations: Conversation[] | HistoryConversation[] | undefined,
  ) => {
    if (!oldConversations) return oldConversations;
    return oldConversations
      .map((conv) => {
        if (conv.id === conversationId) {
          return {
            ...conv,
            current_message_leaf_id: newMessage.id,
            updated_at: newMessage.created_at,
          };
        }
        return conv;
      })
      .sort((a: Conversation, b: Conversation) => {
        return (
          new Date(b.updated_at ?? '').getTime() -
          new Date(a.updated_at ?? '').getTime()
        );
      });
  };
}

function messageInsertedConversationUpdate(
  queryClient: QueryClient,
  newMessage: Message,
  conversationId: string,
) {
  // Update the current conversation optimistically
  queryClient.setQueryData(
    ['conversation', conversationId],
    (oldConversation: Conversation) => ({
      ...oldConversation,
      current_message_leaf_id: newMessage.id,
    }),
  );

  // Update messages optimistically
  queryClient.setQueryData(
    ['messages', conversationId],
    (oldMessages: Message[] | undefined) => {
      if (!oldMessages || oldMessages.length === 0) return [newMessage];
      if (oldMessages.find((msg) => msg.id === newMessage.id)) {
        return oldMessages.map((msg) =>
          msg.id === newMessage.id ? newMessage : msg,
        );
      }
      return [...oldMessages, newMessage];
    },
  );

  // Update conversations list optimistically instead of invalidating
  queryClient.setQueryData(
    ['conversations'],
    messageSentConversationUpdate(newMessage, conversationId),
  );

  // Also update the recent conversations in sidebar
  queryClient.setQueryData(
    ['conversations', 'recent'],
    messageSentConversationUpdate(newMessage, conversationId),
  );
}

export const useMessagesQuery = () => {
  const { conversation } = useConversation();
  return useQuery<Message[]>({
    enabled: !!conversation.id,
    queryKey: ['messages', conversation.id],
    initialData: [],
    queryFn: async () => {
      const { data: messagesData, error: messagesError } = await supabase
        .from('messages')
        .select('*')
        .eq('conversation_id', conversation.id)
        .order('created_at', { ascending: true })
        .overrideTypes<
          Array<{ content: Content; role: 'user' | 'assistant' }>
        >();

      if (messagesError) throw messagesError;

      return messagesData || [];
    },
  });
};

export function useInsertMessageMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (
      message: Omit<Message, 'id' | 'created_at' | 'rating'>,
    ) => {
      const { data, error } = await supabase
        .from('messages')
        .insert([{ ...message }])
        .select()
        .single()
        .overrideTypes<{ content: Content; role: 'user' | 'assistant' }>();

      if (error) throw error;

      return data;
    },
    onSuccess(newMessage) {
      messageInsertedConversationUpdate(
        queryClient,
        newMessage,
        newMessage.conversation_id,
      );
    },
    onError(error) {
      console.error(error);
    },
  });
}

export function useParametricChatMutation({
  conversationId,
}: {
  conversationId: string;
}) {
  const queryClient = useQueryClient();
  const { mutateAsync: insertMessageAsync } = useInsertMessageMutation();

  return useMutation({
    mutationKey: ['parametric-chat', conversationId],
    mutationFn: async ({
      model,
      messageId,
      conversationId,
    }: {
      model: Model;
      messageId: string;
      conversationId: string;
    }) => {
      const newMessageId = crypto.randomUUID();
      let initialized = false;

      // Start streaming request
      const response = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/chat`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${
              (await supabase.auth.getSession()).data.session?.access_token
            }`,
          },
          body: JSON.stringify({
            conversationId,
            messageId,
            model,
            newMessageId,
          }),
        },
      );

      if (!response.ok) {
        throw new Error(
          `Network response was not ok: ${response.status} ${response.statusText}`,
        );
      }

      if (response.headers.get('Content-Type')?.includes('application/json')) {
        const data = await response.json();
        if (data.message) {
          return data.message;
        } else {
          throw new Error('No message received');
        }
      }

      async function initialize() {
        // Cancel any pending queries and update conversation leaf ID
        await queryClient.cancelQueries({
          queryKey: ['conversation', conversationId],
        });
        queryClient.setQueryData(
          ['conversation', conversationId],
          (oldConversation: Conversation) => ({
            ...oldConversation,
            current_message_leaf_id: newMessageId,
          }),
        );
      }

      const reader = response.body?.getReader();
      if (!reader) {
        throw new Error('No reader available');
      }

      const decoder = new TextDecoder();
      let leftover = '';

      let finalMessage: Message | null = null;

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          // Append decoded chunk to leftover buffer
          leftover += decoder.decode(value, { stream: true });

          // Split into lines; keep the last partial line in leftover
          const lines = leftover.split('\n');
          leftover = lines.pop() ?? '';

          for (const rawLine of lines) {
            const line = rawLine.trim();
            if (!line) continue;
            try {
              const data: Message = JSON.parse(line);

              finalMessage = data;

              // Update existing streaming message
              queryClient.setQueryData(
                ['messages', conversationId],
                (oldMessages: Message[] | undefined) => {
                  if (!oldMessages || oldMessages.length === 0) {
                    return [data];
                  }
                  if (oldMessages.find((msg) => msg.id === data.id)) {
                    return oldMessages.map((msg) =>
                      msg.id === data.id ? data : msg,
                    );
                  } else {
                    return [...oldMessages, data];
                  }
                },
              );

              if (!initialized) {
                await initialize();
                initialized = true;
              }
            } catch (parseError) {
              console.error('Error parsing streaming data:', parseError);
            }
          }
        }

        // Flush decoder and process any remaining buffered content
        const flushRemainder = decoder.decode();
        if (flushRemainder) leftover += flushRemainder;
        const tail = leftover.trim();
        if (tail) {
          try {
            const data: Message = JSON.parse(tail);
            finalMessage = data;
            queryClient.setQueryData(
              ['messages', conversationId],
              (oldMessages: Message[] | undefined) => {
                if (!oldMessages || oldMessages.length === 0) {
                  return [data];
                }
                if (oldMessages.find((msg) => msg.id === data.id)) {
                  return oldMessages.map((msg) =>
                    msg.id === data.id ? data : msg,
                  );
                } else {
                  return [...oldMessages, data];
                }
              },
            );
          } catch (parseError) {
            console.error('Error parsing final streaming data:', parseError);
          }
        }
      } finally {
        reader.releaseLock();
      }

      if (!finalMessage) {
        throw new Error('No final message received');
      }

      return finalMessage;
    },
    onSuccess: (newMessage) => {
      messageInsertedConversationUpdate(
        queryClient,
        newMessage,
        conversationId,
      );
    },
    onError: async (error, { messageId }) => {
      console.error(error);
      try {
        await insertMessageAsync({
          role: 'assistant',
          content: {
            text: 'An error occurred while processing your request.',
          },
          parent_message_id: messageId,
          conversation_id: conversationId,
        });
      } catch (error) {
        console.error(error);
      }
    },
  });
}

export function useSendContentMutation({
  conversation,
}: {
  conversation: Pick<
    Conversation,
    'id' | 'current_message_leaf_id' | 'user_id'
  >;
}) {
  const { mutateAsync: insertMessageAsync } = useInsertMessageMutation();

  const { mutateAsync: sendToParametricChat } = useParametricChatMutation({
    conversationId: conversation.id,
  });

  return useMutation({
    mutationKey: ['send-content', conversation.id],
    mutationFn: async (content: Content) => {
      const userMessage = await insertMessageAsync({
        role: 'user',
        content,
        parent_message_id: conversation.current_message_leaf_id ?? null,
        conversation_id: conversation.id,
      });

      await sendToParametricChat({
        model: content.model ?? 'fast',
        messageId: userMessage.id,
        conversationId: conversation.id,
      });
    },
  });
}

export function useUpdateMessageOptimisticMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ message }: { message: Message }) => {
      const { data: updatedMessage, error: messageError } = await supabase
        .from('messages')
        .update({
          // only content gets updated
          content: message.content,
        })
        .eq('id', message.id)
        .eq('conversation_id', message.conversation_id)
        .select()
        .single();

      if (messageError) throw messageError;

      return updatedMessage as Message;
    },
    onMutate: async ({ message }) => {
      await queryClient.cancelQueries({
        queryKey: ['messages', message.conversation_id],
      });
      const oldMessages = queryClient.getQueryData<Message[]>([
        'messages',
        message.conversation_id,
      ]);
      queryClient.setQueryData(
        ['messages', message.conversation_id],
        oldMessages?.map((msg) =>
          msg.id === message.id ? { ...msg, ...message } : msg,
        ),
      );
      return { oldMessages };
    },
    onSettled(_data, _error, { message }) {
      queryClient.invalidateQueries({
        queryKey: ['messages', message.conversation_id],
      });
    },
    onError(error, { message }, context) {
      console.error(error);
      queryClient.setQueryData(
        ['messages', message.conversation_id],
        context?.oldMessages,
      );
    },
  });
}

export function useEditMessageMutation() {
  const { conversation } = useConversation();

  const { mutateAsync: insertMessageAsync } = useInsertMessageMutation();

  const { mutateAsync: sendToParametricChat } = useParametricChatMutation({
    conversationId: conversation.id,
  });

  return useMutation({
    mutationKey: ['edit-message', conversation.id],
    mutationFn: async (updatedMessage: Message) => {
      const userMessage = await insertMessageAsync({
        role: updatedMessage.role,
        content: updatedMessage.content,
        parent_message_id: updatedMessage.parent_message_id ?? null,
        conversation_id: conversation.id,
      });

      sendToParametricChat({
        model: updatedMessage.content.model ?? 'fast',
        messageId: userMessage.id,
        conversationId: conversation.id,
      });
    },
    onError: (error) => {
      console.error(error);
    },
  });
}

export function useRetryMessageMutation() {
  const { conversation, updateConversationAsync } = useConversation();

  const { mutateAsync: sendToParametricChat } = useParametricChatMutation({
    conversationId: conversation.id,
  });

  return useMutation({
    mutationKey: ['retry-message', conversation.id],
    mutationFn: async ({ model, id }: { model: Model; id: string }) => {
      if (!updateConversationAsync) {
        throw new Error('Cannot update conversation');
      }

      await updateConversationAsync({
        ...conversation,
        current_message_leaf_id: id,
      });

      sendToParametricChat({
        model: model,
        messageId: id,
        conversationId: conversation.id,
      });
    },
    onError: (error) => {
      console.error(error);
    },
  });
}

export function useRestoreMessageMutation() {
  const { mutateAsync: insertMessageAsync } = useInsertMessageMutation();

  return useMutation({
    mutationFn: async (messageToRestore: Message) => {
      await insertMessageAsync({
        role: messageToRestore.role,
        content: messageToRestore.content,
        parent_message_id: messageToRestore.parent_message_id ?? null,
        conversation_id: messageToRestore.conversation_id,
      });
    },
    onError: (error) => {
      console.error(error);
    },
  });
}

export function useChangeParameters() {
  const { mutate: updateMessageOptimistic } =
    useUpdateMessageOptimisticMutation();
  const queryClient = useQueryClient();
  const { conversation } = useConversation();
  const { mutateAsync: sendContentAsync } = useSendContentMutation({
    conversation,
  });
  const preflightWorkerRef = useRef<Worker | null>(null);
  const latestRequestRef = useRef<string | null>(null);
  const createRequestId = useCallback(
    () =>
      typeof crypto !== 'undefined' && 'randomUUID' in crypto
        ? crypto.randomUUID()
        : Math.random().toString(36).slice(2),
    [],
  );

  const ensurePreflightWorker = useCallback(() => {
    if (typeof window === 'undefined' || typeof Worker === 'undefined') {
      return null;
    }
    if (!preflightWorkerRef.current) {
      preflightWorkerRef.current = new Worker(
        new URL('../worker/worker.ts', import.meta.url),
        { type: 'module' },
      );
    }
    return preflightWorkerRef.current;
  }, []);

  useEffect(
    () => () => {
      preflightWorkerRef.current?.terminate();
      preflightWorkerRef.current = null;
    },
    [],
  );

  const runPreflight = useCallback(
    async (code: string) => {
      if (typeof window === 'undefined') {
        return Promise.resolve();
      }
      const worker = ensurePreflightWorker();
      if (!worker) {
        return Promise.resolve();
      }

      const requestId = createRequestId();
      return await new Promise<void>((resolve, reject) => {
        let timeoutId = 0;

        const handleMessage = (event: MessageEvent<WorkerResponseMessage>) => {
          if (event.data.id !== requestId) return;
          cleanup();
          if (event.data.err) {
            reject(event.data.err);
          } else {
            resolve();
          }
        };

        const handleError = (event: ErrorEvent) => {
          cleanup();
          reject(event.error ?? new Error(event.message));
        };

        const cleanup = () => {
          window.clearTimeout(timeoutId);
          worker.removeEventListener('message', handleMessage);
          worker.removeEventListener('error', handleError);
        };

        worker.addEventListener('message', handleMessage);
        worker.addEventListener('error', handleError);

        timeoutId = window.setTimeout(() => {
          cleanup();
          reject(new Error('OpenSCAD preflight timed out'));
        }, 5000);

        worker.postMessage({
          id: requestId,
          type: WorkerMessageType.PREVIEW,
          data: {
            code,
            params: [],
            fileType: 'stl',
          },
        });
      });
    },
    [ensurePreflightWorker, createRequestId],
  );

  return useCallback(
    (message: Message | null, updatedParameters: Parameter[]) => {
      if (!message) return;

      const previousContent = message.content;
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
        },
      };

      updateMessageOptimistic(
        {
          message: { ...message, content: newContent },
        },
        {
          onError(_error, _variables, context) {
            if (context?.oldMessages) {
              queryClient.setQueryData(
                ['messages', conversation.id],
                context.oldMessages,
              );
            }
          },
        },
      );

      const artifactCode = newContent.artifact?.code;
      if (!artifactCode) {
        return;
      }

      const requestId = createRequestId();
      latestRequestRef.current = requestId;

      runPreflight(artifactCode)
        .then(() => {
          if (latestRequestRef.current === requestId) {
            latestRequestRef.current = null;
          }
        })
        .catch(async (error) => {
          if (latestRequestRef.current !== requestId) return;
          latestRequestRef.current = null;
          console.error('OpenSCAD preflight failed', error);

          updateMessageOptimistic(
            {
              message: { ...message, content: previousContent },
            },
            {
              onError(revertError, _variables, context) {
                if (revertError) {
                  console.error(
                    'Failed to revert message after preflight error',
                    revertError,
                  );
                }
                if (context?.oldMessages) {
                  queryClient.setQueryData(
                    ['messages', conversation.id],
                    context.oldMessages,
                  );
                }
              },
            },
          );

          const formattedError =
            typeof error === 'object' && error !== null && 'stdErr' in error
              ? Array.isArray((error as { stdErr?: string[] }).stdErr)
                ? (error as { stdErr?: string[] }).stdErr!.join('\n')
                : String((error as { stdErr?: string }).stdErr ?? '')
              : error instanceof Error
                ? error.message
                : 'Unknown OpenSCAD error';

          try {
            await sendContentAsync({
              text: 'Fix parameter adjustment',
              error: formattedError,
              model: message.content.model ?? 'fast',
            });
          } catch (sendError) {
            console.error('Failed to send auto-fix request', sendError);
          }
        });
    },
    [
      updateMessageOptimistic,
      queryClient,
      conversation.id,
      runPreflight,
      sendContentAsync,
      createRequestId,
    ],
  );
}

export function useIsLoading() {
  const { conversation } = useConversation();
  const isSendingChat = useIsMutating({
    mutationKey: ['parametric-chat', conversation.id],
  });
  const isSendingMessage = useIsMutating({
    mutationKey: ['send-content', conversation.id],
  });
  const isEditingMessage = useIsMutating({
    mutationKey: ['edit-message', conversation.id],
  });
  const isRetryingMessage = useIsMutating({
    mutationKey: ['retry-message', conversation.id],
  });
  const isSending =
    !!isSendingChat ||
    !!isSendingMessage ||
    !!isEditingMessage ||
    !!isRetryingMessage;
  return isSending;
}
