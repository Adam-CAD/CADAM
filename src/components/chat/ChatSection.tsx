import { useCallback, useEffect, useMemo, useRef } from 'react';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Content, Message, Model } from '@shared/types';
import TextAreaChat from '@/components/TextAreaChat';
import { SuggestionPills } from '@/components/chat/SuggestionPills';
import { useIsMobile } from '@/hooks/useIsMobile';
import { AssistantMessage } from '@/components/chat/AssistantMessage';
import { UserMessage } from '@/components/chat/UserMessage';
import { ShareContent } from '@/components/ui/ShareContent';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/contexts/AuthContext';
import { useConversation } from '@/contexts/ConversationContext';
import { AssistantLoading } from '@/components/chat/AssistantLoading';
import { ChatTitle } from '@/components/chat/ChatTitle';
import { LimitReachedMessage } from '@/components/LimitReachedMessage';
import { LowPromptsWarningMessage } from '@/components/LowPromptsWarningMessage';
import { CreateIcon } from '@/components/icons/ui/CreateIcon';
import { ConditionalWrapper } from '@/components/ConditionalWrapper';
import { TreeNode } from '@shared/Tree';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { Share } from 'lucide-react';
import { useMeshData } from '@/hooks/useMeshData';

interface ChatSectionProps {
  messages: TreeNode<Message>[];
  isLoading: boolean;
  onSendMessage?: (content: Content) => void;
  onEdit?: (message: Message) => void;
  stopGenerating?: () => void;
  changeRating?: ({
    messageId,
    rating,
  }: {
    messageId: string;
    rating: number;
  }) => void;
  restoreMessage?: (message: Message) => void;
  retryMessage?: ({ model, id }: { model: Model; id: string }) => void;
  upscaleMessage?: ({
    meshId,
    parentMessageId,
  }: {
    meshId: string;
    parentMessageId: string | null;
  }) => void;
}

export function ChatSection({
  messages,
  isLoading,
  onSendMessage,
  onEdit,
  stopGenerating,
  changeRating,
  restoreMessage,
  retryMessage,
  upscaleMessage,
}: ChatSectionProps) {
  const isMobile = useIsMobile();
  const scrollAreaRef = useRef<HTMLDivElement>(null);
  const { conversation, updateConversation } = useConversation();
  const { session, billing } = useAuth();
  const totalTokens = billing?.tokens.total ?? 0;
  const navigate = useNavigate();

  const scrollToBottom = useCallback(() => {
    if (scrollAreaRef.current) {
      const scrollContainer = scrollAreaRef.current.querySelector(
        '[data-radix-scroll-area-viewport]',
      );
      if (scrollContainer) {
        scrollContainer.scrollTop = scrollContainer.scrollHeight;
      }
    }
  }, []);

  const model =
    conversation.settings?.model ??
    (conversation.type === 'parametric' ? 'fast' : 'quality');

  const lowPrompts = useMemo(() => {
    return totalTokens > 0 && totalTokens <= 10;
  }, [totalTokens]);

  const limitReached = useMemo(() => {
    return totalTokens <= 0;
  }, [totalTokens]);

  // Scroll to bottom when messages change
  useEffect(() => {
    scrollToBottom();
  }, [messages, scrollToBottom]);

  // Also scroll when generating state changes
  useEffect(() => {
    if (isLoading) {
      scrollToBottom();
    }
  }, [isLoading, scrollToBottom]);

  const lastMessage = useMemo(() => {
    if (conversation.current_message_leaf_id) {
      return messages.find(
        (msg) => msg.id === conversation.current_message_leaf_id,
      );
    }
    return messages[messages.length - 1];
  }, [messages, conversation.current_message_leaf_id]);

  // Get the current version number based on assistant messages only
  const getCurrentVersion = useCallback(
    (index: number) => {
      return messages.slice(0, index + 1).filter((m) => m.role === 'assistant')
        .length;
    },
    [messages],
  );

  // Check mesh loading status if the last message has a mesh
  const { data: meshData } = useMeshData({
    id: lastMessage?.content?.mesh?.id || '',
  });

  // Only show suggestions when mesh is fully loaded or if there's no mesh
  const shouldShowSuggestions = useMemo(() => {
    const suggestions =
      lastMessage?.content?.artifact?.suggestions ||
      lastMessage?.content?.suggestions ||
      [];

    // No suggestions to show
    if (suggestions.length === 0) return false;

    // If there's no mesh, show suggestions immediately
    if (!lastMessage?.content?.mesh) return true;

    // If there's a mesh, only show suggestions when it's fully loaded
    return meshData?.status === 'success';
  }, [lastMessage, meshData]);

  const suggestions = shouldShowSuggestions
    ? lastMessage?.content?.artifact?.suggestions ||
      lastMessage?.content?.suggestions ||
      []
    : [];

  const handleSuggestionSelect = useCallback(
    (suggestion: string) => {
      onSendMessage?.({
        text: suggestion,
        model: conversation.settings?.model,
      });
    },
    [conversation.settings?.model, onSendMessage],
  );

  const handleModelChange = useCallback(
    (model: Model) => {
      if (!updateConversation) return;
      updateConversation({
        ...conversation,
        settings: {
          ...(typeof conversation.settings === 'object'
            ? conversation.settings
            : {}),
          model: model,
        },
      });
    },
    [conversation, updateConversation],
  );

  return (
    <div className="flex h-full w-full flex-col items-center overflow-hidden border-r border-neutral-700 bg-adam-bg-secondary-dark dark:border-gray-800">
      <div className="flex w-full items-center justify-between bg-transparent p-3 pl-12 dark:border-gray-800">
        <ConditionalWrapper
          condition={!isMobile}
          wrapper={(children) => (
            <div className="flex min-w-0 flex-1 items-center space-x-2">
              {children}
            </div>
          )}
        >
          <div className="min-w-0 flex-1">
            <ChatTitle />
          </div>
        </ConditionalWrapper>
        <div className="flex items-center gap-3">
          {isMobile ? (
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 bg-transparent p-0 hover:bg-transparent"
              onClick={() => {
                navigate('/');
              }}
              aria-label="New Creation"
            >
              <CreateIcon className="h-5 w-5 text-adam-text-primary" />
            </Button>
          ) : (
            <>
              {updateConversation && (
                <Popover>
                  <PopoverTrigger asChild>
                    <Button
                      variant="ghost"
                      className="flex h-8 items-center gap-2 rounded-full px-3 text-adam-text-primary hover:bg-adam-neutral-950 hover:text-adam-neutral-10 focus-visible:ring-0"
                    >
                      <Share className="h-[14px] w-[14px] min-w-[14px]" />
                      <span>Share</span>
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent
                    align="end"
                    className="w-72 rounded-xl bg-adam-background-1 p-3"
                  >
                    <ShareContent />
                  </PopoverContent>
                </Popover>
              )}
            </>
          )}
        </div>
      </div>
      <ScrollArea
        className="relative w-full max-w-xl flex-1 px-2 py-0"
        ref={scrollAreaRef}
      >
        <div className="pointer-events-none sticky left-0 top-0 z-50 mr-4 h-3 bg-gradient-to-b from-adam-bg-secondary-dark/90 to-transparent" />
        <div className="space-y-4 pb-6">
          {messages.map((message, index) => {
            return (
              <div className="p-1" key={message.id}>
                {message.role === 'assistant' ? (
                  <AssistantMessage
                    message={message}
                    changeRating={changeRating}
                    isLoading={isLoading}
                    currentVersion={getCurrentVersion(index)}
                    restoreMessage={restoreMessage}
                    limitReached={limitReached}
                    onRetry={retryMessage}
                    onUpscale={upscaleMessage}
                  />
                ) : (
                  <UserMessage
                    message={message}
                    onEdit={onEdit}
                    isLoading={isLoading}
                    limitReached={limitReached}
                  />
                )}
              </div>
            );
          })}
          {isLoading && lastMessage?.role !== 'assistant' && (
            <AssistantLoading />
          )}
          {/* Made the Low Prompt Warning not Sticky */}
          {session && session.user && limitReached && <LimitReachedMessage />}
          {session && session.user && lowPrompts && !limitReached && (
            <LowPromptsWarningMessage
              tokensRemaining={totalTokens}
              layout="stacked"
            />
          )}
        </div>
      </ScrollArea>
      {onSendMessage && (
        <div className="w-full min-w-52 max-w-xl bg-transparent px-4 pb-6">
          <SuggestionPills
            disabled={limitReached}
            suggestions={suggestions}
            onSelect={handleSuggestionSelect}
          />
          <TextAreaChat
            stopGenerating={stopGenerating}
            onSubmit={onSendMessage}
            placeholder="Keep iterating with Adam..."
            isLoading={isLoading}
            disabled={limitReached}
            type={conversation.type}
            model={model}
            setModel={handleModelChange}
            conversation={conversation}
          />
        </div>
      )}
    </div>
  );
}
