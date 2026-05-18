import { useRef, useState } from 'react';
import { Message } from '@shared/types';
import {
  ChevronLeft,
  ChevronRight,
  Check,
  Copy,
  Pencil,
  X,
  Wrench,
  Box,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { Textarea } from '@/components/ui/textarea';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { useConversation } from '@/contexts/ConversationContext';
import { useIsMobile } from '@/hooks/useIsMobile';
import { useCurrentMessage } from '@/contexts/CurrentMessageContext';
import { ImageViewer } from '@/components/ImageViewer';
import { MeshImagePreview } from '@/components/viewer/MeshImagePreview';
import { TreeNode } from '@shared/Tree';
import { UserAvatar } from '@/components/chat/UserAvatar';

interface UserMessageProps {
  isLoading: boolean;
  message: TreeNode<Message>;
  onEdit?: (message: Message) => void;
  limitReached?: boolean;
}

export function UserMessage({
  message,
  onEdit,
  isLoading,
  limitReached,
}: UserMessageProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [hovering, setHovering] = useState(false);
  const [copied, setCopied] = useState(false);
  const [input, setInput] = useState(message.content.text);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const { conversation, updateConversation } = useConversation();

  const changeLeaf = (messageId: string) => {
    updateConversation?.({
      ...conversation,
      current_message_leaf_id: messageId,
    });
  };

  const branchIndex = message.siblings.findIndex(
    (branch) => branch.id === message.id,
  );

  const leafNodes = message.siblings.map((branch) => {
    let current = branch;
    while (current.children && current.children.length > 0) {
      current = current.children[0];
    }
    return current;
  });

  const handleEdit = () => {
    onEdit?.({
      ...message,
      content: {
        ...message.content,
        text: input,
      },
    });
    setIsEditing(false);
  };

  const handleCancel = () => {
    setInput(message.content.text);
    setIsEditing(false);
  };

  const handleMouseEnter = () => {
    setHovering(true);
    if (textareaRef.current) {
      textareaRef.current.focus();
    }
  };

  const handleMouseLeave = () => {
    setHovering(false);
    setCopied(false);
  };

  const handleCopy = () => {
    if (message.content.text) {
      navigator.clipboard.writeText(message.content.text);
      setCopied(true);
    }
  };

  return (
    <div className="flex justify-start">
      {message.role === 'user' && (
        <div className="mr-2 mt-1">
          <UserAvatar className="h-9 w-9 border border-adam-neutral-700 bg-adam-neutral-950 p-0" />
        </div>
      )}
      <div
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
        className="relative flex flex-col gap-1"
      >
        {message.content.error ? (
          <div className="rounded-lg bg-adam-bg-secondary-dark">
            <div
              className={cn(
                'group relative flex items-center gap-2 rounded-lg border',
                'bg-gradient-to-br from-adam-blue/20 to-adam-neutral-800/70 p-3',
                'border-adam-blue/30 text-adam-text-primary',
                'transition-all duration-300 ease-in-out',
                'hover:border-adam-blue/30 hover:bg-adam-blue/20 hover:text-white',
                'focus:outline-none focus:ring-2 focus:ring-adam-blue/20',
              )}
            >
              <Wrench className="h-4 w-4 transition-all duration-300 group-hover:rotate-12" />
              <span className="text-xs">Fix with AI</span>
            </div>
            {hovering && updateConversation && message.siblings.length > 1 && (
              <div className="absolute bottom-[-1.5rem] right-2 flex items-center gap-0.5 rounded-sm border border-adam-neutral-700 bg-adam-bg-secondary-dark p-0.5">
                <BranchNavigation
                  branches={message.siblings}
                  branchIndex={branchIndex}
                  isLoading={isLoading}
                  leafNodes={leafNodes}
                  changeLeaf={changeLeaf}
                />
              </div>
            )}
          </div>
        ) : (
          <>
            <div className="flex flex-wrap gap-1">
              <UserMessageMeshViewer message={message} />
              <UserMessageImagesViewer message={message} />
            </div>
            {(isEditing || (input && input.length > 0)) && (
              <div
                className={cn(
                  'relative grid w-fit rounded-lg text-white',
                  (hovering ||
                    message.content.images ||
                    message.content.mesh) &&
                    'bg-adam-neutral-800',
                )}
              >
                {isEditing && (
                  <Textarea
                    value={input}
                    ref={textareaRef}
                    onChange={(e) => {
                      setInput(e.target.value);
                    }}
                    className="block h-auto min-h-0 w-full resize-none overflow-hidden whitespace-pre-line break-words border-none bg-adam-neutral-800 px-3 py-2 text-sm sm:px-4"
                    rows={1}
                    style={{ gridArea: '1 / -1' }}
                  />
                )}
                <div
                  className={cn(
                    'pointer-events-none col-start-1 row-start-1 overflow-hidden whitespace-pre-wrap break-words px-3 py-2 text-sm sm:px-4',
                    isEditing ? 'opacity-0' : '',
                  )}
                >
                  <span>{input}</span>
                  <br />
                </div>
              </div>
            )}
            {((hovering &&
              (onEdit ||
                message.content.text ||
                (updateConversation && message.siblings.length > 1))) ||
              isEditing) && (
              <div className="absolute bottom-[-1.5rem] right-2 flex items-center gap-0.5 rounded-sm border border-adam-neutral-700 bg-adam-bg-secondary-dark p-0.5">
                {!isEditing ? (
                  <>
                    {onEdit && (
                      <>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button
                              variant="ghost"
                              size="icon"
                              className={cn(
                                'h-6 w-6 rounded-sm p-0',
                                limitReached || isLoading
                                  ? 'cursor-not-allowed opacity-50'
                                  : 'hover:bg-adam-neutral-800',
                              )}
                              onClick={() => {
                                setIsEditing(true);
                              }}
                              disabled={limitReached || isLoading}
                            >
                              <Pencil className="h-3 w-3 p-0 text-adam-neutral-100" />
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent>Edit</TooltipContent>
                        </Tooltip>
                        <Separator
                          orientation="vertical"
                          className="h-4 bg-adam-neutral-700"
                        />
                      </>
                    )}
                    {message.content.text && (
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-6 w-6 rounded-sm p-0 hover:bg-adam-neutral-800"
                            onClick={handleCopy}
                          >
                            {copied ? (
                              <Check className="h-3 w-3 p-0 text-adam-neutral-100" />
                            ) : (
                              <Copy className="h-3 w-3 p-0 text-adam-neutral-100" />
                            )}
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>Copy Prompt</TooltipContent>
                      </Tooltip>
                    )}
                    {updateConversation && message.siblings.length > 1 && (
                      <>
                        <Separator
                          orientation="vertical"
                          className="h-4 bg-adam-neutral-700"
                        />
                        <BranchNavigation
                          branches={message.siblings}
                          branchIndex={branchIndex}
                          isLoading={isLoading}
                          leafNodes={leafNodes}
                          changeLeaf={changeLeaf}
                        />
                      </>
                    )}
                  </>
                ) : (
                  <>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={handleEdit}
                      className="h-6 w-6 rounded-sm p-0 hover:bg-adam-blue"
                    >
                      <Check className="h-3 w-3 p-0 text-adam-neutral-100" />
                    </Button>
                    <Separator
                      orientation="vertical"
                      className="h-4 bg-adam-neutral-700"
                    />
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6 rounded-sm p-0 hover:bg-adam-neutral-800"
                      onClick={handleCancel}
                    >
                      <X className="h-3 w-3 p-0 text-adam-neutral-100" />
                    </Button>
                  </>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

// Branch navigation component to eliminate code duplication
function BranchNavigation({
  branches,
  branchIndex,
  isLoading,
  leafNodes,
  changeLeaf,
}: {
  branches: TreeNode<Message>[];
  branchIndex: number;
  isLoading: boolean;
  leafNodes: TreeNode<Message>[];
  changeLeaf: (messageId: string) => void;
}) {
  if (branches.length <= 1) return null;

  return (
    <div className="flex items-center gap-0.5">
      <Button
        disabled={branchIndex === 0 || isLoading}
        variant="ghost"
        size="icon"
        className="h-6 w-6 rounded-sm p-0 hover:bg-adam-neutral-800"
        onClick={() => {
          changeLeaf(leafNodes[branchIndex - 1].id);
        }}
      >
        <ChevronLeft className="h-3 w-3 p-0 text-adam-neutral-100" />
      </Button>
      <span className="text-xs tracking-widest text-adam-neutral-100">
        {branchIndex + 1}/{branches.length}
      </span>
      <Button
        disabled={branchIndex === branches.length - 1 || isLoading}
        variant="ghost"
        size="icon"
        className="h-6 w-6 rounded-sm p-0 hover:bg-adam-neutral-800"
        onClick={() => {
          changeLeaf(leafNodes[branchIndex + 1].id);
        }}
      >
        <ChevronRight className="h-3 w-3 p-0 text-adam-neutral-100" />
      </Button>
    </div>
  );
}

function UserMessageMeshViewer({ message }: { message: Message }) {
  const { currentMessage, setCurrentMessage } = useCurrentMessage();

  if (!message.content.mesh) {
    return null;
  }

  return (
    <div className="relative">
      <div
        onClick={() => {
          if (
            currentMessage &&
            message.id === currentMessage?.id &&
            currentMessage?.content.mesh === message.content.mesh
          ) {
            setCurrentMessage(null);
          } else {
            // Only set the mesh part of the message, not the images
            setCurrentMessage({
              ...message,
              content: {
                mesh: message.content.mesh,
              },
            });
          }
        }}
        className={cn(
          'h-24 w-24 cursor-pointer overflow-hidden rounded-md',
          currentMessage?.id === message.id &&
            currentMessage?.content.mesh === message.content.mesh &&
            'outline outline-2 outline-adam-blue',
        )}
      >
        <MeshImagePreview meshId={message.content.mesh.id} />
        <div className="absolute bottom-1 right-1 rounded-full border border-adam-neutral-500 bg-adam-neutral-500 text-white transition-colors duration-200 hover:border-adam-neutral-700 hover:bg-adam-neutral-700">
          <Box className="h-4 w-4 text-white" />
        </div>
      </div>
    </div>
  );
}

/**
 * UserMessageImagesViewer is a component that displays a grid of images from a message.
 * It's used within UserMessage to show any images attached to a user's message.
 *
 * Features:
 * - Displays images in a responsive grid layout
 * - Supports hover effects to highlight images
 * - Allows clicking images to open them in a larger view
 * - Integrates with CurrentMessageContext to track which image is being viewed
 *
 * @param message - The message object containing the images to display
 */
export function UserMessageImagesViewer({ message }: { message: Message }) {
  const { currentMessage, setCurrentMessage } = useCurrentMessage();
  const isMobile = useIsMobile();

  if (!message.content.images) {
    return null;
  }

  return (
    <div className="flex flex-wrap gap-1">
      {message.content.images.map((image: string, index: number) => (
        <div
          key={`${image}-${index}`}
          onClick={() => {
            if (
              currentMessage &&
              message.id === currentMessage?.id &&
              currentMessage?.content.index === index
            ) {
              setCurrentMessage(null);
            } else {
              // Only set the images part of the message, not the mesh
              setCurrentMessage({
                ...message,
                content: {
                  images: message.content.images,
                  index,
                },
              });
            }
          }}
          className="h-24 w-24"
        >
          <ImageViewer
            image={image}
            clickable={!isMobile}
            className={cn(
              'aspect-square cursor-pointer',
              currentMessage?.id === message.id &&
                currentMessage?.content.index === index &&
                'outline outline-2 outline-adam-blue',
            )}
          />
        </div>
      ))}
    </div>
  );
}
