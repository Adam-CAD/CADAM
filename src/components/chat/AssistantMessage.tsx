import { Message, Model } from '@shared/types';
import {
  ArrowUpRight,
  Box,
  ChevronLeft,
  ChevronRight,
  History,
  ThumbsDown,
  ThumbsUp,
  ChevronDown,
  Loader2,
  ImageIcon,
  Sparkles,
} from 'lucide-react';
import { Streamdown } from 'streamdown';
import { StreamingCodeBlock } from '@/components/chat/StreamingCodeBlock';
import { Button } from '@/components/ui/button';
import { RefreshCw } from 'lucide-react';
import { Avatar, AvatarImage } from '@/components/ui/avatar';
import {
  cn,
  CREATIVE_MODELS,
  getBackupModel,
  PARAMETRIC_MODELS,
} from '@/lib/utils';
import { Link } from 'react-router-dom';
import { TrialDialog } from '@/components/auth/TrialDialog';
import { getLevel, useAuth } from '@/contexts/AuthContext';
import { ImageViewer } from '@/components/ImageViewer';
import { useConversation } from '@/contexts/ConversationContext';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { Separator } from '@/components/ui/separator';
import { useCurrentMessage } from '@/contexts/CurrentMessageContext';
import { useCallback, useMemo, useState } from 'react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useIsMobile } from '@/hooks/useIsMobile';
import { useMeshData } from '@/hooks/useMeshData';
import { MeshImagePreview } from '@/components/viewer/MeshImagePreview';
import { TreeNode } from '@shared/Tree';

const linkParametricMode = (text: string) =>
  text.replace(
    /(```[\s\S]*?```|`[^`\n]*`)|parametric mode/gi,
    (match, codeSpan) => codeSpan ?? `[${match}](https://adam.new/cadam)`,
  );

interface AssistantMessageProps {
  message: TreeNode<Message>;
  isLoading: boolean;
  currentVersion: number;
  changeRating?: ({
    messageId,
    rating,
  }: {
    messageId: string;
    rating: number;
  }) => void;
  onRetry?: ({ model, id }: { model: Model; id: string }) => void;
  onUpscale?: ({
    meshId,
    parentMessageId,
  }: {
    meshId: string;
    parentMessageId: string | null;
  }) => void;
  restoreMessage?: (message: Message) => void;
  limitReached?: boolean;
}

const paymentRequiredMessages = {
  insufficient_tokens: <InsufficientTokensMessage />,
  trial_user_E9ueHIgpei2JvFUDeJLEnwzDhy7GF38a: <TrialUserMessage />,
  free_user_E9ueHIgpei2JvFUDeJLEnwzDhy7GF38a: <FreeUserMessage />,
  limit_reached_E9ueHIgpei2JvFUDeJLEnwzDhy7GF38a: <LimitReachedMessage />,
  limit_reached_image_E9ueHIgpei2JvFUDeJLEnwzDhy7GF38a: (
    <ImageLimitReachedMessage />
  ),
  limit_reached_mesh_E9ueHIgpei2JvFUDeJLEnwzDhy7GF38a: (
    <MeshLimitReachedMessage />
  ),
};

export function AssistantMessage({
  message,
  isLoading,
  currentVersion,
  changeRating,
  restoreMessage,
  onRetry,
  onUpscale,
  limitReached,
}: AssistantMessageProps) {
  const { conversation, updateConversation } = useConversation();
  const { currentMessage, setCurrentMessage } = useCurrentMessage();
  const isMobile = useIsMobile();
  const model = getBackupModel({
    message,
    parentMessage: message.parent ?? undefined,
    type: conversation.type,
  });

  // Removed parameter diff banner from assistant message

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

  // Fetch mesh data to check status
  const { data: meshDataQuery } = useMeshData({
    id: message.content.mesh?.id ?? '',
  });

  // Upscale functionality for quality/draft meshes - only show when mesh is complete
  const canUpscale =
    model === 'quality' &&
    message.content.mesh &&
    meshDataQuery.data?.status === 'success';

  const handleUpscale = useCallback(() => {
    if (!message.content.mesh || !onUpscale) return;

    onUpscale({
      meshId: message.content.mesh.id,
      parentMessageId: message.parent_message_id,
    });
  }, [message.content.mesh, message.parent_message_id, onUpscale]);

  // Check if this message is the last one in the conversation
  const isLastMessage = conversation.current_message_leaf_id === message.id;

  const markdownText = useMemo(
    () =>
      message.content.text ? linkParametricMode(message.content.text) : '',
    [message.content.text],
  );

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
      <div
        className={cn(
          'w-[80%] rounded-lg bg-adam-neutral-800',
          isMobile && message.content.mesh && 'w-full',
        )}
      >
        <div className="flex flex-col gap-3 p-3 text-sm text-adam-text-primary">
          {message.content.error ? (
            <>
              {message.content.error in paymentRequiredMessages ? (
                paymentRequiredMessages[
                  message.content.error as keyof typeof paymentRequiredMessages
                ]
              ) : message.content.text &&
                message.content.text in paymentRequiredMessages ? (
                paymentRequiredMessages[
                  message.content.text as keyof typeof paymentRequiredMessages
                ]
              ) : (
                <span className="px-1">
                  We ran into some trouble with your prompt
                </span>
              )}
            </>
          ) : (
            <>
              {conversation.type === 'parametric' &&
                !message.content.text &&
                (!message.content.toolCalls ||
                  message.content.toolCalls.length === 0) &&
                !message.content.artifact &&
                !message.content.mesh &&
                (!message.content.images ||
                  message.content.images.length === 0) && (
                  <div className="flex h-10 w-full items-center justify-between overflow-hidden rounded-md bg-adam-neutral-950 px-3">
                    <div className="flex h-full items-center justify-center gap-2">
                      <Box className="h-4 w-4 text-white" />
                      <span>Building CAD...</span>
                    </div>
                    <Loader2 className="h-4 w-4 animate-spin text-white" />
                  </div>
                )}
              {message.content.text ? (
                <Streamdown
                  className="px-1 [&_:not(pre)>code]:rounded [&_:not(pre)>code]:bg-adam-neutral-950 [&_:not(pre)>code]:px-1 [&_:not(pre)>code]:py-0.5 [&_a]:text-adam-blue [&_a]:underline hover:[&_a]:opacity-80 [&_h1]:mt-2 [&_h1]:text-xl [&_h1]:font-semibold [&_h2]:mt-2 [&_h2]:text-lg [&_h2]:font-semibold [&_h3]:mt-1 [&_h3]:font-semibold [&_ol]:list-decimal [&_ol]:pl-5 [&_p:not(:last-child)]:mb-2 [&_p]:leading-relaxed [&_pre]:overflow-x-auto [&_pre]:rounded [&_pre]:bg-adam-neutral-950 [&_pre]:p-3 [&_pre_code]:bg-transparent [&_pre_code]:p-0 [&_ul]:list-disc [&_ul]:pl-5"
                  parseIncompleteMarkdown
                >
                  {markdownText}
                </Streamdown>
              ) : null}
              {message.content.toolCalls &&
                message.content.toolCalls.length > 0 && (
                  <div className="flex w-full flex-col gap-2">
                    {message.content.toolCalls.map((toolCall) => {
                      // For a pending parametric build, once code starts
                      // streaming swap the generic status row for the live
                      // code. Before the first chunk we keep the original
                      // "Building CAD..." row so the thinking state is clear.
                      const streamingCode =
                        message.content.artifact?.code ?? '';
                      if (
                        toolCall.name === 'build_parametric_model' &&
                        toolCall.status === 'pending' &&
                        streamingCode.length > 0
                      ) {
                        return (
                          <StreamingCodeBlock
                            key={toolCall.id ?? `${toolCall.name}`}
                            code={streamingCode}
                            isStreaming={true}
                          />
                        );
                      }

                      return (
                        <div
                          key={toolCall.id ?? `${toolCall.name}`}
                          className="flex h-10 w-full items-center justify-between overflow-hidden rounded-md bg-adam-neutral-950 px-3 hover:bg-adam-neutral-900"
                        >
                          <div className="flex h-full items-center justify-center gap-2">
                            {toolCall.name === 'create_image' && (
                              <ImageIcon className="h-4 w-4 text-white" />
                            )}
                            {toolCall.name === 'create_mesh' && (
                              <Box className="h-4 w-4 text-white" />
                            )}
                            {(toolCall.name === 'build_parametric_model' ||
                              toolCall.name === 'apply_parameter_changes') && (
                              <Box className="h-4 w-4 text-white" />
                            )}
                            {toolCall.status === 'pending' && (
                              <span>
                                {toolCall.name === 'create_image'
                                  ? 'Queuing image...'
                                  : toolCall.name === 'create_mesh'
                                    ? 'Queuing mesh...'
                                    : toolCall.name ===
                                          'build_parametric_model' ||
                                        toolCall.name ===
                                          'apply_parameter_changes'
                                      ? 'Building CAD...'
                                      : `${toolCall.name}...`}
                              </span>
                            )}
                            {toolCall.status === 'error' && (
                              <span>
                                {toolCall.name === 'create_image'
                                  ? 'Failed to start image generation'
                                  : toolCall.name === 'create_mesh'
                                    ? 'Failed to start mesh generation'
                                    : toolCall.name ===
                                          'build_parametric_model' ||
                                        toolCall.name ===
                                          'apply_parameter_changes'
                                      ? 'Failed to generate CAD'
                                      : `${toolCall.name}...`}
                              </span>
                            )}
                          </div>
                          {toolCall.status === 'pending' && (
                            <Loader2 className="h-4 w-4 animate-spin text-white" />
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              <AssistantMessageImagesViewer message={message} />
              {message.content.mesh && (
                <div
                  onClick={() => {
                    if (currentMessage && message.id === currentMessage?.id) {
                      setCurrentMessage(null);
                    } else {
                      setCurrentMessage(message);
                    }
                  }}
                  className={cn(
                    'cursor-pointer overflow-hidden rounded-md',
                    currentMessage?.id === message.id &&
                      'outline outline-2 outline-adam-blue',
                  )}
                >
                  <MeshImagePreview meshId={message.content.mesh.id} />
                </div>
              )}
              {message.content.artifact &&
                !message.content.toolCalls?.some(
                  (c) =>
                    c.name === 'build_parametric_model' &&
                    c.status === 'pending',
                ) && (
                  <ObjectButton
                    message={message}
                    currentMessage={currentMessage}
                    setCurrentMessage={setCurrentMessage}
                    currentVersion={currentVersion}
                  />
                )}
            </>
          )}

          {(updateConversation ||
            changeRating ||
            (message.siblings.length > 1 && updateConversation) ||
            (restoreMessage && !isLastMessage)) && (
            <div className="flex flex-wrap items-center gap-1 gap-y-2">
              {changeRating && (
                <div className="flex items-center">
                  <Button
                    variant="outline"
                    size="icon"
                    onClick={() =>
                      changeRating({
                        messageId: message.id,
                        rating: 1,
                      })
                    }
                    className="h-6 w-6 rounded-lg rounded-r-none border-r-0 p-0 pl-0.5"
                  >
                    <ThumbsUp
                      className={`h-3 w-3 ${message.rating === 1 ? 'text-adam-blue' : 'text-adam-neutral-100'}`}
                    />
                  </Button>
                  <Separator
                    orientation="vertical"
                    className="h-6 bg-adam-neutral-700"
                  />
                  <Button
                    variant="outline"
                    size="icon"
                    onClick={() =>
                      changeRating({
                        messageId: message.id,
                        rating: -1,
                      })
                    }
                    className="h-6 w-6 rounded-lg rounded-l-none border-l-0 p-0 pr-0.5"
                  >
                    <ThumbsDown
                      className={`h-3 w-3 ${message.rating === -1 ? 'text-adam-blue' : 'text-adam-neutral-100'}`}
                    />
                  </Button>
                </div>
              )}
              {restoreMessage && !isLastMessage && (
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

              {message.parent_message_id && onRetry && (
                <div className="flex items-center">
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        size="icon"
                        variant="outline"
                        onClick={() => {
                          onRetry({ model, id: message.parent_message_id! });
                        }}
                        disabled={isLoading || limitReached}
                        className={cn(
                          'h-6 w-6 rounded-lg rounded-r-none border-r-0 p-0',
                          limitReached && 'cursor-not-allowed opacity-50',
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
                      parentMessage={message.parent ?? undefined}
                      onRetry={(model) =>
                        onRetry({ model, id: message.parent_message_id! })
                      }
                      disabled={isLoading || limitReached}
                      className={cn(
                        'h-6 w-fit',
                        limitReached && 'cursor-not-allowed opacity-50',
                        updateConversation && 'rounded-l-none',
                      )}
                    />
                  )}
                </div>
              )}
              {canUpscale && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={handleUpscale}
                      disabled={isLoading || limitReached}
                      className={cn(
                        'h-6 gap-1 rounded-lg px-2 text-xs',
                        limitReached && 'cursor-not-allowed opacity-50',
                      )}
                    >
                      <Sparkles className="h-3 w-3" />
                      <span>Upscale</span>
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>
                    <span>
                      {limitReached
                        ? 'No generations remaining'
                        : 'Upscale your 3D asset quality'}
                    </span>
                  </TooltipContent>
                </Tooltip>
              )}
              {message.siblings.length > 1 && updateConversation && (
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
        <div className="flex min-w-0 items-center space-x-2">
          <Box className="h-4 w-4 shrink-0 text-adam-text-primary" />
          <span className="truncate font-medium text-adam-text-primary">
            {title}
          </span>
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

function FreeUserMessage() {
  return (
    <span>
      You are on a free plan!{' '}
      <Link to="/subscription" className="text-adam-blue hover:underline">
        Upgrade
      </Link>{' '}
      to a paid plan to experience all the features Adam has to offer.
    </span>
  );
}

function TrialUserMessage() {
  return (
    <span>
      <TrialDialog>
        <span className="cursor-pointer text-adam-blue hover:underline">
          Start a trial
        </span>
      </TrialDialog>{' '}
      to experience all Pro features for 7 days, completely free.
    </span>
  );
}

function LimitReachedMessage() {
  return (
    <span>
      You have reached the limit of parametric generations in your current plan.{' '}
      <Link to="/subscription" className="text-adam-blue hover:underline">
        Upgrade
      </Link>{' '}
      for more parametric generations :)
    </span>
  );
}

function ImageLimitReachedMessage() {
  return (
    <span>
      You have reached the limit of image generations in your current plan.{' '}
      <Link to="/subscription" className="text-adam-blue hover:underline">
        Upgrade
      </Link>{' '}
      for more image generations :)
    </span>
  );
}

function InsufficientTokensMessage() {
  const { billing } = useAuth();
  const level = getLevel(billing);
  return (
    <span>
      You don't have enough tokens for this operation.{' '}
      <Link to="/settings" className="text-adam-blue hover:underline">
        Buy more tokens
      </Link>
      {level === 'free' && (
        <>
          {' '}
          or{' '}
          <Link to="/subscription" className="text-adam-blue hover:underline">
            upgrade your plan
          </Link>
        </>
      )}
      .
    </span>
  );
}

function MeshLimitReachedMessage() {
  const { billing } = useAuth();
  const level = getLevel(billing);
  if (level === 'free') {
    return (
      <span>
        You have reached the limit of 3 creative generations per day. Please
        upgrade to{' '}
        <Link to="/subscription" className="text-adam-blue hover:underline">
          a paid plan
        </Link>{' '}
        for more creative generations :)
      </span>
    );
  }

  if (level === 'standard') {
    return (
      <span>
        You have reached the limit of 100 creative generations per month. Please
        upgrade to{' '}
        <Link to="/subscription" className="text-adam-blue hover:underline">
          Pro
        </Link>{' '}
        for more creative generations :)
      </span>
    );
  }

  if (level === 'pro') {
    return (
      <span>
        You have reached the limit of 1500 generations per month. Let us know if
        you need more!
      </span>
    );
  }
}

function RetryModelSelector({
  message,
  parentMessage,
  onRetry,
  disabled,
  className,
}: {
  message: Message;
  parentMessage?: Message;
  onRetry: (modelId: Model) => void;
  disabled?: boolean;
  className?: string;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const { conversation } = useConversation();

  // Get the appropriate model list based on conversation type and content
  const models =
    conversation.type === 'parametric' ? PARAMETRIC_MODELS : CREATIVE_MODELS;

  const selectedModelConfig =
    models.find(
      (model) =>
        model.id ===
        getBackupModel({
          message,
          parentMessage,
          type: conversation.type,
        }),
    ) ?? models[0];

  // Filter out current model and handle multiple images case
  const availableModels = models
    .filter((model) => model.id !== selectedModelConfig.id)
    .map((model) => {
      if (
        parentMessage?.content.images &&
        parentMessage.content.images.length > 1
      ) {
        return { ...model, disabled: model.id !== 'quality' };
      }
      return model;
    });

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
              model.disabled && 'cursor-not-allowed opacity-50',
            )}
            onClick={() => {
              if (!model.disabled && onRetry) {
                onRetry(model.id);
                setIsOpen(false);
              }
            }}
            disabled={model.disabled}
          >
            Retry with {model.name}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function AssistantMessageImagesViewer({ message }: { message: Message }) {
  const { currentMessage, setCurrentMessage } = useCurrentMessage();
  const isMobile = useIsMobile();

  if (!message.content.images) {
    return null;
  }

  return (
    <div
      className={cn(
        message.content.images.length > 1 && 'grid-cols-2',
        'grid gap-3',
      )}
    >
      {message.content.images.map((image: string, index: number) => (
        <div
          key={image}
          onClick={() => {
            if (
              currentMessage &&
              message.id === currentMessage?.id &&
              currentMessage?.content.index === index
            ) {
              setCurrentMessage(null);
            } else {
              setCurrentMessage({
                ...message,
                content: { ...message.content, index },
              });
            }
          }}
        >
          <ImageViewer
            className={cn(
              'aspect-square h-fit cursor-pointer',
              currentMessage?.id === message.id &&
                currentMessage?.content.index === index &&
                'outline outline-2 outline-adam-blue',
            )}
            image={image}
            clickable={!isMobile}
          />
        </div>
      ))}
    </div>
  );
}
