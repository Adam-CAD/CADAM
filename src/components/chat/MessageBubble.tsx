import { MeshImagePreview } from '@/components/viewer/MeshImagePreview';
import { StreamingCodeBlock } from '@/components/chat/StreamingCodeBlock';
import { ChatReasoning } from '@/components/chat/ChatReasoning';
import { UserAvatar } from '@/components/chat/UserAvatar';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { CREATIVE_MODELS, PARAMETRIC_MODELS } from '@/lib/utils';
import { Avatar, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { Textarea } from '@/components/ui/textarea';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { usePreview } from '@/hooks/usePreview';
import { useMeshData } from '@/hooks/useMeshData';
import { useOpenSCAD } from '@/hooks/useOpenSCAD';
import { generatePreview, generateColoredPreview } from '@/utils/meshUtils';
import type { ChatMessage } from '@/lib/aiMessages';
import type { ParametricArtifact } from '@shared/types';
import type { TreeNode } from '@shared/Tree';
import { isParametricArtifact } from '@shared/parametricParts';
import type React from 'react';
import {
  Box,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Copy,
  History,
  Loader2,
  Pencil,
  RefreshCw,
  ThumbsDown,
  ThumbsUp,
  X,
} from 'lucide-react';
import { useMemo, useRef, useState } from 'react';
import { Streamdown } from 'streamdown';
import type { Model } from '@shared/types';
import type { ModelConfig } from '@/types/misc';
import { useConversation } from '@/contexts/ConversationContext';

type MessageBubbleProps = {
  message: TreeNode<ChatMessage>;
  isLoading: boolean;
  isLastMessage?: boolean;
  currentModel?: Model;
  onSelectLeaf?: (messageId: string) => void;
  onEditUserText?: (message: ChatMessage, text: string) => void;
  onViewArtifact?: (artifact: ParametricArtifact) => void;
  onViewMesh?: (meshId: string) => void;
  onChangeRating?: (rating: number) => void;
  onRetry?: (model: Model) => void;
  onRestore?: () => void;
};

export function MessageBubble(props: MessageBubbleProps) {
  return props.message.role === 'user' ? (
    <UserBubble {...props} />
  ) : (
    <AssistantBubble {...props} />
  );
}

function UserBubble({
  message,
  isLoading,
  onSelectLeaf,
  onEditUserText,
}: MessageBubbleProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [hovering, setHovering] = useState(false);
  const [copied, setCopied] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const text = useMemo(
    () =>
      message.parts
        .filter((p) => p.type === 'text')
        .map((p) => p.text)
        .join(''),
    [message.parts],
  );
  const [input, setInput] = useState(text);

  const imageParts = useMemo(
    () =>
      message.parts.filter(
        (p): p is Extract<(typeof message.parts)[number], { type: 'file' }> =>
          p.type === 'file' &&
          typeof p.mediaType === 'string' &&
          p.mediaType.startsWith('image/'),
      ),
    [message.parts],
  );
  const meshContextParts = useMemo(
    () =>
      message.parts.filter(
        (
          p,
        ): p is Extract<
          (typeof message.parts)[number],
          { type: 'data-mesh-context' }
        > => p.type === 'data-mesh-context',
      ),
    [message.parts],
  );
  const meshPreferencesParts = useMemo(
    () =>
      message.parts.filter(
        (
          p,
        ): p is Extract<
          (typeof message.parts)[number],
          { type: 'data-mesh-preferences' }
        > => p.type === 'data-mesh-preferences',
      ),
    [message.parts],
  );

  const branchIndex = message.siblings.findIndex((b) => b.id === message.id);
  const leafNodes = useMemo(
    () =>
      message.siblings.map((branch) => {
        let current = branch;
        while (current.children.length > 0) current = current.children[0];
        return current;
      }),
    [message.siblings],
  );

  const handleEdit = () => {
    onEditUserText?.(message, input);
    setIsEditing(false);
  };
  const handleCancel = () => {
    setInput(text);
    setIsEditing(false);
  };
  const handleCopy = () => {
    if (!text) return;
    navigator.clipboard.writeText(text);
    setCopied(true);
  };
  const handleMouseEnter = () => {
    setHovering(true);
    if (textareaRef.current) textareaRef.current.focus();
  };
  const handleMouseLeave = () => {
    setHovering(false);
    setCopied(false);
  };

  const hasAttachments = imageParts.length > 0 || meshContextParts.length > 0;
  const hasBubble = isEditing || text.length > 0;
  const showActions =
    (hovering &&
      (onEditUserText ||
        text ||
        (onSelectLeaf && message.siblings.length > 1))) ||
    isEditing;

  return (
    <div className="flex justify-start">
      <div className="mr-2 mt-1">
        <UserAvatar className="h-9 w-9 border border-adam-neutral-700 bg-adam-neutral-950 p-0" />
      </div>
      <div
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
        className="relative flex flex-col gap-1"
      >
        {hasAttachments ? (
          <div className="flex flex-wrap gap-1">
            {imageParts.map((part, index) => (
              <img
                key={`img-${index}`}
                src={part.url}
                alt={part.filename ?? 'Uploaded image'}
                className="h-20 w-20 rounded-lg object-cover"
              />
            ))}
            {meshContextParts.map((part, index) => (
              <MeshContextChip
                key={`mesh-${index}`}
                meshId={part.data.meshId}
                filename={part.data.filename}
                fileType={part.data.fileType}
              />
            ))}
          </div>
        ) : null}

        {meshPreferencesParts.map((part, index) => (
          <span
            key={`pref-${index}`}
            className="w-fit rounded-full bg-adam-neutral-800 px-2 py-1 text-xs text-adam-text-secondary"
          >
            {part.data.topology} · {part.data.polygonCount.toLocaleString()}{' '}
            polys
          </span>
        ))}

        {hasBubble && (
          <div
            className={cn(
              'relative grid w-fit rounded-lg text-white',
              (hovering || hasAttachments) && 'bg-adam-neutral-800',
            )}
          >
            {isEditing && (
              <Textarea
                value={input}
                ref={textareaRef}
                onChange={(e) => setInput(e.target.value)}
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
              <span>{isEditing ? input : text}</span>
              <br />
            </div>
          </div>
        )}

        {showActions && (
          <div className="absolute bottom-[-1.5rem] right-2 flex items-center gap-0.5 rounded-sm border border-adam-neutral-700 bg-adam-bg-secondary-dark p-0.5">
            {!isEditing ? (
              <>
                {onEditUserText && (
                  <>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon"
                          className={cn(
                            'h-6 w-6 rounded-sm p-0',
                            isLoading
                              ? 'cursor-not-allowed opacity-50'
                              : 'hover:bg-adam-neutral-800',
                          )}
                          disabled={isLoading}
                          onClick={() => setIsEditing(true)}
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
                {text && (
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
                {onSelectLeaf && message.siblings.length > 1 && (
                  <>
                    <Separator
                      orientation="vertical"
                      className="h-4 bg-adam-neutral-700"
                    />
                    <BranchNavigation
                      branchCount={message.siblings.length}
                      branchIndex={branchIndex}
                      isLoading={isLoading}
                      onPrev={() => onSelectLeaf(leafNodes[branchIndex - 1].id)}
                      onNext={() => onSelectLeaf(leafNodes[branchIndex + 1].id)}
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
      </div>
    </div>
  );
}

function AssistantBubble({
  message,
  isLoading,
  isLastMessage = false,
  currentModel,
  onSelectLeaf,
  onViewArtifact,
  onViewMesh,
  onChangeRating,
  onRetry,
  onRestore,
}: MessageBubbleProps) {
  const { conversation } = useConversation();
  const modelOptions =
    conversation.type === 'creative' ? CREATIVE_MODELS : PARAMETRIC_MODELS;
  const [expandedTools, setExpandedTools] = useState<Set<number>>(new Set());

  const text = useMemo(
    () =>
      message.parts
        .filter((p) => p.type === 'text')
        .map((p) => p.text)
        .join(''),
    [message.parts],
  );
  const branchIndex = message.siblings.findIndex((b) => b.id === message.id);
  const leafNodes = useMemo(
    () =>
      message.siblings.map((branch) => {
        let current = branch;
        while (current.children.length > 0) current = current.children[0];
        return current;
      }),
    [message.siblings],
  );

  const toggleTool = (index: number) => {
    setExpandedTools((current) => {
      const next = new Set(current);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  };

  return (
    <div className="flex min-w-0 justify-start">
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
      <div className="flex w-[80%] min-w-0 flex-col gap-2">
        {message.parts.map((part, index) => {
          if (part.type === 'text') {
            if (!part.text) return null;
            return (
              <div
                key={index}
                className="rounded-lg bg-adam-neutral-800 px-3 py-2 text-sm text-adam-text-primary"
              >
                <Streamdown parseIncompleteMarkdown>{part.text}</Streamdown>
              </div>
            );
          }

          if (part.type === 'reasoning') {
            if (!part.text) return null;
            // CADAM-tailored wrapper around ai-elements' Reasoning primitive
            // — adds a capped-height scroll body with auto-pin-to-bottom
            // while the model is still streaming reasoning tokens.
            return (
              <ChatReasoning
                key={index}
                text={part.text}
                isStreaming={part.state === 'streaming'}
              />
            );
          }

          if (part.type === 'tool-build_parametric_model') {
            const artifact =
              part.state !== 'input-streaming' &&
              isParametricArtifact(part.input)
                ? part.input
                : undefined;
            const outputMessage =
              part.state === 'output-available'
                ? part.output.message
                : undefined;

            // While the model is mid-stream, render the SCAD code in a
            // typewriter-style block so the user sees something happening
            // (matches legacy AssistantMessage's StreamingCodeBlock branch).
            // `part.input` is a partial object during streaming — pull off
            // whatever `code` has arrived so far.
            const partialCode =
              part.state === 'input-streaming' &&
              part.input &&
              typeof (part.input as { code?: unknown }).code === 'string'
                ? (part.input as { code: string }).code
                : '';
            if (part.state === 'input-streaming') {
              return (
                <StreamingCodeBlock
                  key={index}
                  code={partialCode}
                  isStreaming={true}
                />
              );
            }

            const isOpen = expandedTools.has(index);
            // Once the tool's compile finishes (`output-available`), the
            // canonical preview at `images/{user}/{conv}/preview-{toolCallId}`
            // is either already uploaded (happy path) or about to be
            // generated client-side by `usePreview` — either way the
            // thumbnail keys off `toolCallId` and the artifact's `code`.
            const showThumbnail =
              part.state === 'output-available' && !!artifact;
            return (
              <ToolBlock
                key={index}
                icon={<Box className="h-4 w-4" />}
                title={
                  part.state === 'output-error'
                    ? 'CAD generation failed'
                    : artifact
                      ? artifact.title
                      : 'Building CAD...'
                }
                loading={part.state === 'input-available'}
                expanded={isOpen}
                onToggle={() => toggleTool(index)}
                onPrimary={
                  artifact ? () => onViewArtifact?.(artifact) : undefined
                }
                previewBody={
                  showThumbnail && artifact ? (
                    <button
                      type="button"
                      className="block w-full"
                      onClick={() => onViewArtifact?.(artifact)}
                    >
                      <ParametricImagePreview
                        toolCallId={part.toolCallId}
                        code={artifact.code}
                      />
                    </button>
                  ) : null
                }
              >
                {part.state === 'output-error' ? (
                  <div className="border-b border-adam-neutral-700 p-3 text-xs text-red-300">
                    {part.errorText}
                  </div>
                ) : outputMessage ? (
                  <div className="border-b border-adam-neutral-700 p-3 text-xs text-adam-neutral-300">
                    {outputMessage}
                  </div>
                ) : null}
                {artifact?.code ? (
                  <ScrollArea className="h-80 w-full">
                    <pre className="m-0 whitespace-pre-wrap break-words p-3 text-xs text-adam-neutral-200">
                      <code>{artifact.code}</code>
                    </pre>
                  </ScrollArea>
                ) : null}
              </ToolBlock>
            );
          }

          if (part.type === 'tool-create_mesh') {
            const output =
              part.state === 'output-available' ? part.output : undefined;
            const meshId = output?.id;
            return (
              <MeshToolBlock
                key={index}
                state={part.state}
                meshId={meshId}
                expanded={expandedTools.has(index)}
                onToggle={() => toggleTool(index)}
                onViewMesh={onViewMesh}
              />
            );
          }

          return null;
        })}

        {/* Suppress the rating/retry/copy/restore strip while the latest
            assistant message is still streaming — those controls don't
            make sense on a half-rendered response. Older messages keep
            their controls even during a new stream. */}
        {!(isLoading && isLastMessage) && (
          <div className="flex flex-wrap items-center gap-1 gap-y-2">
            {onChangeRating && (
              <div className="flex items-center">
                <Button
                  variant="outline"
                  size="icon"
                  onClick={() => onChangeRating(message.rating === 1 ? 0 : 1)}
                  className="h-6 w-6 rounded-lg rounded-r-none border-r-0 p-0 pl-0.5"
                  aria-label="Thumbs up"
                >
                  <ThumbsUp
                    className={cn(
                      'h-3 w-3',
                      message.rating === 1
                        ? 'text-adam-blue'
                        : 'text-adam-neutral-100',
                    )}
                  />
                </Button>
                <Separator
                  orientation="vertical"
                  className="h-6 bg-adam-neutral-700"
                />
                <Button
                  variant="outline"
                  size="icon"
                  onClick={() => onChangeRating(message.rating === -1 ? 0 : -1)}
                  className="h-6 w-6 rounded-lg rounded-l-none border-l-0 p-0 pr-0.5"
                  aria-label="Thumbs down"
                >
                  <ThumbsDown
                    className={cn(
                      'h-3 w-3',
                      message.rating === -1
                        ? 'text-adam-blue'
                        : 'text-adam-neutral-100',
                    )}
                  />
                </Button>
              </div>
            )}

            {text && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="outline"
                    size="icon"
                    className="h-6 w-6 rounded-lg p-0"
                    onClick={() => navigator.clipboard.writeText(text)}
                    aria-label="Copy"
                  >
                    <Copy className="h-3 w-3 text-adam-neutral-100" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Copy</TooltipContent>
              </Tooltip>
            )}

            {onRestore && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="outline"
                    size="icon"
                    onClick={onRestore}
                    disabled={isLoading}
                    className="h-6 w-6 rounded-lg p-0"
                    aria-label="Restore this version"
                  >
                    <History className="h-3 w-3 text-adam-neutral-100" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Restore</TooltipContent>
              </Tooltip>
            )}

            {onRetry && message.parent_message_id && (
              <div className="flex items-center">
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      size="icon"
                      variant="outline"
                      onClick={() =>
                        currentModel ? onRetry(currentModel) : undefined
                      }
                      disabled={isLoading || !currentModel}
                      className={cn(
                        'h-6 w-6 rounded-lg p-0',
                        modelOptions.length > 1 && 'rounded-r-none border-r-0',
                      )}
                      aria-label="Retry"
                    >
                      <RefreshCw className="h-3 w-3 text-adam-neutral-100" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>Retry</TooltipContent>
                </Tooltip>
                {modelOptions.length > 1 && (
                  <RetryModelDropdown
                    modelOptions={modelOptions}
                    selectedModelId={
                      (message.metadata?.model as Model | undefined) ??
                      currentModel
                    }
                    onRetry={onRetry}
                    disabled={isLoading}
                  />
                )}
              </div>
            )}

            {onSelectLeaf && message.siblings.length > 1 && (
              <div className="flex h-6 items-center gap-0.5 rounded-lg border border-adam-neutral-700 bg-adam-bg-secondary-dark">
                <BranchNavigation
                  branchCount={message.siblings.length}
                  branchIndex={branchIndex}
                  isLoading={isLoading}
                  onPrev={() => onSelectLeaf(leafNodes[branchIndex - 1].id)}
                  onNext={() => onSelectLeaf(leafNodes[branchIndex + 1].id)}
                />
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * Retry-with-another-model dropdown. Trigger shows the model that
 * produced THIS message (so the user can see what they're swapping
 * away from) with a chevron that rotates when the menu opens. Matches
 * the legacy `RetryModelSelector` shape.
 */
function RetryModelDropdown({
  modelOptions,
  selectedModelId,
  onRetry,
  disabled,
}: {
  modelOptions: ModelConfig[];
  selectedModelId: Model | undefined;
  onRetry: (model: Model) => void;
  disabled: boolean;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const selectedModel =
    modelOptions.find((option) => option.id === selectedModelId) ??
    modelOptions[0];
  return (
    <DropdownMenu open={isOpen} onOpenChange={setIsOpen}>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          disabled={disabled}
          className={cn(
            'h-6 w-fit gap-1 rounded-lg rounded-l-none px-2 text-xs text-adam-text-primary',
            isOpen && 'bg-adam-neutral-800',
          )}
          aria-label="Retry with another model"
        >
          <span>{selectedModel.name}</span>
          <ChevronDown
            className={cn(
              'h-3 w-3 transition-transform duration-100',
              isOpen && 'rotate-180',
            )}
          />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        className="w-48 rounded-lg border border-adam-neutral-700 bg-adam-neutral-800 p-1"
      >
        {modelOptions.map((option) => (
          <DropdownMenuItem
            key={option.id}
            className="cursor-pointer rounded-md bg-adam-neutral-800 px-2 py-1.5 text-xs text-adam-text-primary hover:bg-adam-neutral-700 focus:bg-adam-bg-secondary-dark"
            onClick={() => {
              onRetry(option.id);
              setIsOpen(false);
            }}
          >
            {option.name}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function BranchNavigation({
  branchCount,
  branchIndex,
  isLoading,
  onPrev,
  onNext,
}: {
  branchCount: number;
  branchIndex: number;
  isLoading: boolean;
  onPrev: () => void;
  onNext: () => void;
}) {
  return (
    <>
      <Button
        variant="ghost"
        size="icon"
        disabled={branchIndex === 0 || isLoading}
        className="h-6 w-6 rounded-sm p-0 hover:bg-adam-neutral-800"
        onClick={onPrev}
      >
        <ChevronLeft className="h-3 w-3 p-0 text-adam-neutral-100" />
      </Button>
      <span className="text-xs text-adam-neutral-300">
        {branchIndex + 1}/{branchCount}
      </span>
      <Button
        variant="ghost"
        size="icon"
        disabled={branchIndex === branchCount - 1 || isLoading}
        className="h-6 w-6 rounded-sm p-0 hover:bg-adam-neutral-800"
        onClick={onNext}
      >
        <ChevronRight className="h-3 w-3 p-0 text-adam-neutral-100" />
      </Button>
    </>
  );
}

function ToolBlock({
  icon,
  title,
  loading,
  expanded,
  onPrimary,
  onToggle,
  previewBody,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  loading: boolean;
  expanded: boolean;
  /** Whole-bar click — typically opens the artifact/mesh in the viewer pane. */
  onPrimary?: () => void;
  /** Toggles the expandable `children` body. The toggle affordance is the
   *  hover-revealed chevron on the right; clicking it does NOT bubble to the
   *  primary action. */
  onToggle: () => void;
  /** Always-visible body slot (e.g. a thumbnail preview). Independent of
   *  `expanded` — shown whenever it's provided. */
  previewBody?: React.ReactNode;
  /** Expandable body slot — only rendered when `expanded` is true. The
   *  chevron is hidden entirely when this is omitted. */
  children?: React.ReactNode;
}) {
  return (
    <div className="group min-w-0 overflow-hidden rounded-lg border border-adam-neutral-700 bg-adam-neutral-900 text-sm text-adam-text-primary">
      {previewBody ? <div>{previewBody}</div> : null}
      <div
        className={cn(
          'flex w-full items-stretch hover:bg-adam-neutral-800',
          previewBody && 'border-t border-adam-neutral-700',
        )}
      >
        <button
          type="button"
          className={cn(
            'flex min-w-0 flex-1 items-center gap-2 px-3 py-2 text-left',
            !onPrimary && 'cursor-default',
          )}
          onClick={onPrimary}
          disabled={!onPrimary}
        >
          {loading ? (
            <Loader2 className="h-4 w-4 shrink-0 animate-spin" />
          ) : (
            <span className="shrink-0">{icon}</span>
          )}
          <span className="min-w-0 flex-1 truncate">{title}</span>
        </button>
        {children ? (
          <button
            type="button"
            onClick={onToggle}
            aria-label={expanded ? 'Hide code' : 'Show code'}
            className={cn(
              'flex w-9 shrink-0 items-center justify-center transition-opacity focus-visible:opacity-100',
              expanded ? 'opacity-100' : 'opacity-0 group-hover:opacity-100',
            )}
          >
            {expanded ? (
              <ChevronUp className="h-4 w-4" />
            ) : (
              <ChevronDown className="h-4 w-4" />
            )}
          </button>
        ) : null}
      </div>
      {expanded && children ? (
        <div className="min-w-0 border-t border-adam-neutral-700">
          {children}
        </div>
      ) : null}
    </div>
  );
}

// Full AI SDK v6 tool-state union. The `approval-*` and `output-denied`
// states only fire when a tool opts into approval gating via
// `needsApproval` — our tools don't, so those branches are
// type-system-only. Still listed here so the prop type stays a
// superset of `ToolUIPart['state']` and we don't lose type safety the
// next time the SDK widens the union.
type ToolPartState =
  | 'input-streaming'
  | 'input-available'
  | 'approval-requested'
  | 'approval-responded'
  | 'output-available'
  | 'output-error'
  | 'output-denied';

function MeshToolBlock({
  state,
  meshId,
  expanded,
  onToggle,
  onViewMesh,
}: {
  state: ToolPartState;
  meshId: string | undefined;
  expanded: boolean;
  onToggle: () => void;
  onViewMesh?: (meshId: string) => void;
}) {
  const {
    data: { data: meshData },
    blob: { data: meshBlob },
  } = useMeshData({ id: meshId ?? '' });

  const meshStatus = meshData?.status;
  const isAwaitingMesh =
    state === 'output-available' &&
    !!meshId &&
    meshStatus !== 'success' &&
    meshStatus !== 'failure';
  const showPreview =
    state === 'output-available' &&
    !!meshId &&
    ((meshStatus === 'success' && !!meshBlob) || meshStatus === 'failure');

  const isError = state === 'output-error' || state === 'output-denied';
  const isPending =
    state === 'input-streaming' ||
    state === 'input-available' ||
    state === 'approval-requested' ||
    state === 'approval-responded';

  const title =
    isError || meshStatus === 'failure'
      ? 'Mesh generation failed'
      : meshStatus === 'success'
        ? '3D Object'
        : 'Generating mesh...';

  return (
    <ToolBlock
      icon={<Box className="h-4 w-4" />}
      title={title}
      loading={isPending || isAwaitingMesh}
      expanded={expanded}
      onToggle={onToggle}
      onPrimary={meshId ? () => onViewMesh?.(meshId) : undefined}
      previewBody={
        showPreview && meshId ? (
          <button
            type="button"
            className="block w-full p-2"
            onClick={() => onViewMesh?.(meshId)}
          >
            <MeshImagePreview meshId={meshId} />
          </button>
        ) : null
      }
    />
  );
}

function ParametricImagePreview({
  toolCallId,
  code,
}: {
  toolCallId: string;
  code: string;
}) {
  // Same get-or-generate path VisualCard uses: download cached PNG at
  // `images/{userId}/{convId}/preview-{toolCallId}`, otherwise compile
  // the SCAD via `previewScadColored` and render either the colored OFF
  // (preferred) or the plain STL. The tool execution uploads this preview
  // before `addToolOutput`, so on a healthy flow the download branch wins.
  const { conversation } = useConversation();
  const { previewScadColored } = useOpenSCAD();
  const { data: thumbnailUrl } = usePreview({
    id: toolCallId,
    conversationId: conversation.id,
    userId: conversation.user_id,
    generateBlob: async () => {
      const { stl, off } = await previewScadColored(code);
      if (off) {
        const colored = await generateColoredPreview(off);
        if (colored) return dataUrlToBlob(colored);
      }
      return dataUrlToBlob(await generatePreview(stl, 'stl'));
    },
  });
  if (!thumbnailUrl) return null;
  return (
    <div className="relative aspect-square w-full bg-adam-neutral-950">
      <img
        src={thumbnailUrl}
        alt=""
        className="h-full w-full object-cover"
        draggable={false}
      />
    </div>
  );
}

async function dataUrlToBlob(dataUrl: string): Promise<Blob> {
  const response = await fetch(dataUrl);
  return response.blob();
}

function MeshContextChip({
  meshId,
  filename,
  fileType,
}: {
  meshId: string;
  filename?: string;
  fileType: string;
}) {
  const label = filename ?? `mesh ${meshId.slice(0, 6)}`;
  return (
    <div className="flex items-center gap-2 overflow-hidden rounded-lg border border-adam-neutral-700 bg-adam-neutral-900 p-1.5">
      <div className="h-12 w-12 shrink-0 overflow-hidden rounded-md">
        <MeshImagePreview meshId={meshId} />
      </div>
      <div className="flex min-w-0 flex-col">
        <span className="truncate text-xs font-medium text-adam-text-primary">
          {label}
        </span>
        <span className="text-xs text-adam-text-secondary">
          {fileType.toUpperCase()}
        </span>
      </div>
    </div>
  );
}
