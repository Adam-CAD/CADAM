import { Message, Model } from '@shared/types';
import {
  ArrowUpRight,
  Box,
  ChevronLeft,
  ChevronRight,
  History,
  ChevronDown,
  Loader2,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { RefreshCw } from 'lucide-react';
import { Avatar, AvatarImage } from '@/components/ui/avatar';
import { cn, PARAMETRIC_MODELS } from '@/lib/utils';
import { useConversation } from '@/services/conversationService';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { useCurrentMessage } from '@/contexts/CurrentMessageContext';
import { useCallback, useMemo, useState } from 'react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { TreeNode } from '@shared/Tree';
import {
  useRestoreMessageMutation,
  useRetryMessageMutation,
  useIsLoading,
} from '@/services/messageService';

interface AssistantMessageProps {
  message: TreeNode<Message>;
  currentVersion: number;
}

export function AssistantMessage({
  message,
  currentVersion,
}: AssistantMessageProps) {
  const { conversation, updateConversation } = useConversation();
  const { currentMessage, setCurrentMessage } = useCurrentMessage();
  const { mutate: restoreMessage } = useRestoreMessageMutation();
  const { mutate: retryMessage } = useRetryMessageMutation();
  const isLoading = useIsLoading();
  const model = message.content.model ?? 'anthropic/claude-sonnet-4.5';

  const changeLeaf = useCallback(
    (messageId: string) => {
      updateConversation?.({
        ...conversation,
        current_message_leaf_id: messageId,
      });
    },
    [updateConversation, conversation],
  );

  const branchIndex = useMemo(
    () => message.siblings.findIndex((branch) => branch.id === message.id),
    [message.siblings, message.id],
  );

  const leafNodes = useMemo(
    () =>
      message.siblings.map((branch) => {
        let current = branch;
        while (current.children && current.children.length > 0) {
          current = current.children[0];
        }
        return current;
      }),
    [message.siblings],
  );

  // Check if this message is the last one in the conversation
  const isLastMessage = conversation.current_message_leaf_id === message.id;

  return (
    <div className="flex justify-start">
      {message.role === 'assistant' && (
        <div className="mr-2 mt-1">
          <Avatar className="h-9 w-9 border border-adam-neutral-700 bg-adam-neutral-950">
            <div style={{ padding: '0.6rem 0.5rem 0.5rem 0.55rem' }}>
              <AvatarImage
                src={`${import.meta.env.BASE_URL}/adam-logo.svg`}
                alt="Adam"
              />
            </div>
          </Avatar>
        </div>
      )}
      <div className="w-[80%] rounded-lg bg-adam-neutral-800">
        <div className="flex flex-col gap-3 p-3 text-sm text-adam-text-primary">
          {message.content.error ? (
            <span className="px-1">
              We ran into some trouble with your prompt
            </span>
          ) : (
            <>
              {message.content.text && (
                <span className="px-1">{message.content.text}</span>
              )}
              {message.content.toolCalls &&
                message.content.toolCalls.length > 0 && (
                  <div className="flex w-full flex-col gap-2">
                    {message.content.toolCalls.map((toolCall) => (
                      <div
                        key={toolCall.id ?? `${toolCall.name}`}
                        className="flex h-10 w-full items-center justify-between overflow-hidden rounded-md bg-adam-neutral-950 px-3 hover:bg-adam-neutral-900"
                      >
                        <div className="flex h-full items-center justify-center gap-2">
                          <Box className="h-4 w-4 text-white" />
                          {toolCall.status === 'pending' && (
                            <span>Building CAD...</span>
                          )}
                          {toolCall.status === 'error' && (
                            <span>Failed to generate CAD</span>
                          )}
                        </div>
                        {toolCall.status === 'pending' && (
                          <Loader2 className="h-4 w-4 animate-spin text-white" />
                        )}
                      </div>
                    ))}
                  </div>
                )}
              {message.content.artifact && (
                <ObjectButton
                  message={message}
                  currentMessage={currentMessage}
                  setCurrentMessage={setCurrentMessage}
                  currentVersion={currentVersion}
                />
              )}
            </>
          )}

          {(message.siblings.length > 1 ||
            !isLastMessage ||
            message.parent_message_id) && (
            <div className="flex items-center gap-1">
              {!isLastMessage && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="outline"
                      size="icon"
                      onClick={() => restoreMessage(message)}
                      disabled={isLoading}
                      className="h-6 w-6 rounded-lg p-0"
                    >
                      <History className="h-3 w-3 p-0 text-adam-neutral-100" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>
                    <span>Restore</span>
                  </TooltipContent>
                </Tooltip>
              )}

              {message.parent_message_id && (
                <div className="flex items-center">
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        size="icon"
                        variant="outline"
                        onClick={() => {
                          retryMessage({
                            model,
                            id: message.parent_message_id!,
                          });
                        }}
                        disabled={isLoading}
                        className={cn(
                          'h-6 w-6 rounded-lg rounded-r-none border-r-0 p-0',
                        )}
                      >
                        <RefreshCw className="h-3 w-3 p-0 text-adam-neutral-100" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>
                      <span>Retry</span>
                    </TooltipContent>
                  </Tooltip>
                  {model && (
                    <RetryModelSelector
                      message={message}
                      onRetry={(model) =>
                        retryMessage({ model, id: message.parent_message_id! })
                      }
                      disabled={isLoading}
                      className="h-6 w-fit rounded-l-none"
                    />
                  )}
                </div>
              )}
              {message.siblings.length > 1 && (
                <div className="flex h-6 items-center gap-0.5 rounded-lg border border-adam-neutral-700 bg-adam-bg-secondary-dark">
                  <Button
                    disabled={branchIndex === 0 || isLoading}
                    variant="outline"
                    size="icon"
                    onClick={() => {
                      changeLeaf(leafNodes[branchIndex - 1].id);
                    }}
                    className="h-full w-6 rounded-lg rounded-r-none border-none p-0"
                  >
                    <ChevronLeft className="h-3 w-3 p-0 text-adam-neutral-100" />
                  </Button>
                  <span className="text-xs tracking-widest text-adam-neutral-100">
                    {branchIndex + 1}/{message.siblings.length}
                  </span>
                  <Button
                    disabled={
                      branchIndex === message.siblings.length - 1 || isLoading
                    }
                    variant="outline"
                    size="icon"
                    onClick={() => {
                      changeLeaf(leafNodes[branchIndex + 1].id);
                    }}
                    className="h-full w-6 rounded-lg rounded-l-none border-none p-0"
                  >
                    <ChevronRight className="h-3 w-3 p-0 text-adam-neutral-100" />
                  </Button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function ObjectButton({
  message,
  currentMessage,
  setCurrentMessage,
  currentVersion,
}: {
  message: Message;
  currentMessage: Message | null;
  setCurrentMessage: (message: Message) => void;
  currentVersion: number;
}) {
  const [isHovered, setIsHovered] = useState(false);
  let title = 'Adam Object';
  if (message.content.artifact) {
    title = message.content.artifact.title;
  }

  return (
    <Button
      variant="outline"
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      className={cn(
        'group relative bg-black p-2 hover:bg-adam-bg-dark',
        currentMessage && currentMessage.id === message.id
          ? 'border-adam-blue'
          : 'border-gray-200/20 dark:border-gray-700',
      )}
      onClick={() => setCurrentMessage(message)}
    >
      <div className="flex w-full items-center justify-between border-gray-200/20 pr-16 dark:border-gray-700">
        <div className="flex items-center space-x-2">
          <Box className="h-4 w-4 text-adam-text-primary" />
          <span className="font-medium text-adam-text-primary">{title}</span>
        </div>
        <span
          className={cn(
            'absolute right-2 flex h-6 items-center overflow-hidden rounded-md border border-adam-neutral-700 bg-adam-bg-secondary-dark px-1 text-xs transition-all duration-100 ease-in-out hover:bg-black',
            isHovered
              ? 'w-14 text-adam-text-primary'
              : `w-${6 + (currentVersion.toString().length - 1)} text-adam-neutral-300`,
          )}
        >
          {isHovered ? (
            <div className="flex items-center gap-1">
              Open
              <ArrowUpRight className="h-3 w-3" />
            </div>
          ) : (
            <>v{currentVersion}</>
          )}
        </span>
      </div>
    </Button>
  );
}

function RetryModelSelector({
  message,
  onRetry,
  disabled,
  className,
}: {
  message: Message;
  onRetry: (modelId: Model) => void;
  disabled?: boolean;
  className?: string;
}) {
  const [isOpen, setIsOpen] = useState(false);

  const models = PARAMETRIC_MODELS;

  const selectedModelConfig =
    models.find((model) => model.id === message.content.model) ?? models[0];

  // Filter out current model and handle multiple images case
  const availableModels = models.filter(
    (model) => model.id !== selectedModelConfig.id,
  );

  if (availableModels.length === 0) {
    return (
      <Button
        variant="outline"
        disabled={true}
        className={cn(
          'h-6 w-fit gap-1 rounded-lg px-2 text-xs text-adam-text-primary opacity-50',
          className,
        )}
      >
        <span>{selectedModelConfig.name}</span>
      </Button>
    );
  }

  return (
    <DropdownMenu open={isOpen} onOpenChange={setIsOpen}>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          disabled={disabled}
          className={cn(
            'h-6 w-fit gap-1 rounded-lg px-2 text-xs text-adam-text-primary',
            isOpen && 'bg-adam-neutral-800',
            className,
          )}
        >
          <span>{selectedModelConfig.name}</span>
          <ChevronDown
            className={cn(
              'h-3 w-3 transition-transform duration-100',
              isOpen && 'rotate-180',
            )}
          />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        className="w-48 rounded-lg border border-adam-neutral-700 bg-adam-neutral-800 p-1"
        align="start"
      >
        {availableModels.map((model) => (
          <DropdownMenuItem
            key={model.id}
            className={cn(
              'cursor-pointer rounded-md bg-adam-neutral-800 px-2 py-1.5 text-xs text-adam-text-primary hover:bg-adam-neutral-700 focus:bg-adam-bg-secondary-dark',
            )}
            onClick={() => {
              if (onRetry) {
                onRetry(model.id);
                setIsOpen(false);
              }
            }}
          >
            Retry with {model.name}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
