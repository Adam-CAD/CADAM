import { AdamLoading as _AdamLoading } from '@/components/viewer/AdamLoading';
import { MeshImagePreview } from '@/components/viewer/MeshImagePreview';
import { UserAvatar } from '@/components/chat/UserAvatar';
import { Avatar, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { Textarea } from '@/components/ui/textarea';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import type { ModernChatMessage } from '@/lib/aiMessages';
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
  Eye,
  Loader2,
  Pencil,
  X,
} from 'lucide-react';
import { useMemo, useRef, useState } from 'react';
import { Streamdown } from 'streamdown';

// Suppress unused-import warning while we keep the option to swap in the
// shared AdamLoading component for the full-canvas variant later.
void _AdamLoading;

type ModernMessageBubbleProps = {
  message: TreeNode<ModernChatMessage>;
  isLoading: boolean;
  onSelectLeaf?: (messageId: string) => void;
  onEditUserText?: (message: ModernChatMessage, text: string) => void;
  onViewArtifact?: (artifact: ParametricArtifact) => void;
  onViewMesh?: (meshId: string) => void;
};

export function ModernMessageBubble(props: ModernMessageBubbleProps) {
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
}: ModernMessageBubbleProps) {
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
  onSelectLeaf,
  onViewArtifact,
  onViewMesh,
}: ModernMessageBubbleProps) {
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
    <div className="flex justify-start">
      <div className="mr-2 mt-1">
        <Avatar className="h-9 w-9 border border-adam-neutral-700 bg-adam-neutral-950">
          <div style={{ padding: '0.6rem 0.5rem 0.5rem 0.55rem' }}>
            <AvatarImage
              src={`${import.meta.env.BASE_URL}adam-logo.svg`}
              alt="Adam"
            />
          </div>
        </Avatar>
      </div>
      <div className="flex w-[80%] flex-col gap-2">
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
            const isOpen = expandedTools.has(index);
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
                loading={
                  part.state === 'input-streaming' ||
                  part.state === 'input-available'
                }
                loadingVariant="adam"
                expanded={isOpen}
                onToggle={() => toggleTool(index)}
                action={
                  artifact ? (
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-7 w-7 rounded-md"
                          onClick={(event) => {
                            event.stopPropagation();
                            onViewArtifact?.(artifact);
                          }}
                        >
                          <Eye className="h-4 w-4" />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>View CAD</TooltipContent>
                    </Tooltip>
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
                  <pre className="max-h-80 overflow-auto p-3 text-xs text-adam-neutral-200">
                    <code>{artifact.code}</code>
                  </pre>
                ) : null}
              </ToolBlock>
            );
          }

          if (part.type === 'tool-create_mesh') {
            const output =
              part.state === 'output-available' ? part.output : undefined;
            const meshId = output?.id;
            return (
              <ToolBlock
                key={index}
                icon={<Box className="h-4 w-4" />}
                title={
                  part.state === 'output-error'
                    ? 'Mesh generation failed'
                    : meshId
                      ? 'Mesh submitted'
                      : 'Generating mesh...'
                }
                loading={
                  part.state === 'input-streaming' ||
                  part.state === 'input-available'
                }
                expanded={expandedTools.has(index)}
                onToggle={() => toggleTool(index)}
                action={
                  meshId ? (
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-7 w-7 rounded-md"
                          onClick={(event) => {
                            event.stopPropagation();
                            onViewMesh?.(meshId);
                          }}
                        >
                          <Eye className="h-4 w-4" />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>View Mesh</TooltipContent>
                    </Tooltip>
                  ) : null
                }
              >
                {meshId ? (
                  <button
                    type="button"
                    className="block w-full p-2"
                    onClick={() => onViewMesh?.(meshId)}
                  >
                    <MeshImagePreview meshId={meshId} />
                  </button>
                ) : null}
              </ToolBlock>
            );
          }

          return null;
        })}

        <div className="flex items-center gap-1">
          {text && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-6 w-6 rounded-md"
                  onClick={() => navigator.clipboard.writeText(text)}
                >
                  <Copy className="h-3.5 w-3.5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Copy</TooltipContent>
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
        </div>
      </div>
    </div>
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
  loadingVariant = 'spinner',
  expanded,
  action,
  onToggle,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  loading: boolean;
  loadingVariant?: 'spinner' | 'adam';
  expanded: boolean;
  action?: React.ReactNode;
  onToggle: () => void;
  children?: React.ReactNode;
}) {
  const loadingNode =
    loadingVariant === 'adam' ? (
      <img
        src={`${import.meta.env.BASE_URL}adam-logo.svg`}
        alt=""
        className="animate-adam-bounce h-4 w-4"
      />
    ) : (
      <Loader2 className="h-4 w-4 animate-spin" />
    );

  return (
    <div className="overflow-hidden rounded-lg border border-adam-neutral-700 bg-adam-neutral-900 text-sm text-adam-text-primary">
      <div className="flex w-full items-center gap-1 px-3 py-2 hover:bg-adam-neutral-800">
        <button
          type="button"
          className="flex min-w-0 flex-1 items-center gap-2 text-left"
          onClick={onToggle}
        >
          {loading ? loadingNode : icon}
          <span className="min-w-0 flex-1 truncate">{title}</span>
          {expanded ? (
            <ChevronUp className="h-4 w-4 shrink-0" />
          ) : (
            <ChevronDown className="h-4 w-4 shrink-0" />
          )}
        </button>
        {action}
      </div>
      {expanded && children ? (
        <div className="border-t border-adam-neutral-700">{children}</div>
      ) : null}
    </div>
  );
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
