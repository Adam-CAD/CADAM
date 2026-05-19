import { useEffect, useRef, useState } from 'react';
import { Link } from '@tanstack/react-router';
import {
  Clock,
  MessageSquare,
  MoreVertical,
  Trash2,
  Pencil,
  Box,
  LockKeyhole,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { formatDistanceToNow } from 'date-fns';
import { HistoryConversation } from '../../types/misc.ts';
import { GoodEarth } from '../icons/ui/GoodEarth';
import { supabase } from '@/lib/supabase';
import { useOpenSCAD } from '@/hooks/useOpenSCAD';
import { usePreview } from '@/hooks/usePreview';
import { generatePreview, generateColoredPreview } from '@/utils/meshUtils';
import { useQuery } from '@tanstack/react-query';
import {
  asParametricParts,
  getBuildParametricModelOutput,
} from '@shared/parametricParts';
import type { MeshFileType } from '@shared/types';

interface VisualCardProps {
  conversation: HistoryConversation;
  onDelete: (conversationId: string) => void;
  onRename: (conversationId: string, newTitle: string) => void;
  onTogglePrivacy: (
    conversationId: string,
    newPrivacy: 'public' | 'private',
  ) => void;
}

type VisualPreview =
  | { type: 'artifact'; key: string; code: string }
  | { type: 'mesh'; key: string; meshId: string; fileType: MeshFileType }
  | null;

export function VisualCard({
  conversation,
  onDelete,
  onRename,
  onTogglePrivacy,
}: VisualCardProps) {
  const [isVisible, setIsVisible] = useState(false);
  const cardRef = useRef<HTMLDivElement>(null);
  const { previewScadColored } = useOpenSCAD();

  useEffect(() => {
    const observer = new IntersectionObserver(
      ([entry]) => setIsVisible(entry.isIntersecting),
      { rootMargin: '100px' },
    );
    if (cardRef.current) observer.observe(cardRef.current);
    return () => observer.disconnect();
  }, []);

  const { data: preview } = useQuery<VisualPreview>({
    queryKey: ['conversation-latest-preview', conversation.id],
    enabled: isVisible,
    queryFn: async () => {
      const { data: messages, error } = await supabase
        .from('messages')
        .select('id, parts')
        .eq('conversation_id', conversation.id)
        .eq('role', 'assistant')
        .order('created_at', { ascending: false })
        .limit(50);
      if (error) throw error;
      for (const message of messages ?? []) {
        const latest = findLatestVisualPreview(message.parts, message.id);
        if (latest) return latest;
      }
      return null;
    },
    staleTime: 60_000,
  });

  const { data: thumbnailUrl } = usePreview({
    id: preview?.key,
    conversationId: conversation.id,
    userId: conversation.user_id,
    enabled: !!preview,
    generateBlob: async () => {
      if (!preview) throw new Error('No preview');
      if (preview.type === 'mesh') {
        const { data: meshBlob, error } = await supabase.storage
          .from('meshes')
          .download(
            `${conversation.user_id}/${conversation.id}/${preview.meshId}.${preview.fileType}`,
          );
        if (error || !meshBlob) throw error ?? new Error('Mesh blob missing');
        return dataUrlToBlob(await generatePreview(meshBlob, preview.fileType));
      }
      // Use the PREVIEW path (not EXPORT) so we get the OFF companion file
      // with per-face color() data alongside the STL — matches what the live
      // editor renders. Fall back to the gray-ish STL render only when OFF
      // is unavailable or empty.
      const { stl, off } = await previewScadColored(preview.code);
      if (off) {
        const colored = await generateColoredPreview(off);
        if (colored) return dataUrlToBlob(colored);
      }
      return dataUrlToBlob(await generatePreview(stl, 'stl'));
    },
  });

  return (
    <div
      ref={cardRef}
      className="group relative overflow-hidden rounded-xl border-2 border-adam-neutral-700 bg-adam-background-2 transition-all duration-200 hover:border-adam-blue hover:shadow-[0_0_20px_rgba(0,166,255,0.3)]"
    >
      <Link to="/editor/$id" params={{ id: conversation.id }}>
        <div className="relative aspect-square w-full overflow-hidden bg-gradient-to-br from-adam-background-1 to-adam-background-2">
          {thumbnailUrl ? (
            <img
              src={thumbnailUrl}
              alt={conversation.title}
              className="h-full w-full object-cover"
              loading="lazy"
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center">
              <Box className="text-adam-neutral-600 h-16 w-16 opacity-30" />
            </div>
          )}
          <div className="absolute inset-0 bg-gradient-to-t from-adam-background-2/90 via-transparent to-transparent opacity-0 transition-opacity duration-200 group-hover:opacity-100" />
        </div>

        <div className="p-4">
          <div className="mb-2 flex items-center gap-2">
            <h3 className="line-clamp-2 text-base font-medium text-adam-neutral-50">
              {conversation.title}
            </h3>
            {conversation.privacy === 'public' ? (
              <GoodEarth className="h-3.5 w-3.5 shrink-0 text-adam-neutral-400" />
            ) : (
              <LockKeyhole className="h-3.5 w-3.5 shrink-0 text-adam-neutral-400" />
            )}
          </div>
          <div className="flex items-center gap-3 text-xs text-adam-neutral-400">
            <span className="flex items-center">
              <Clock className="mr-1 h-3 w-3" />
              {formatDistanceToNow(new Date(conversation.updated_at), {
                addSuffix: true,
              })}
            </span>
            <span className="flex items-center">
              <MessageSquare className="mr-1 h-3 w-3" />
              {conversation.message_count}
            </span>
          </div>
        </div>
      </Link>

      <div className="absolute right-2 top-2">
        <AlertDialog>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                className="h-8 w-8 rounded-full bg-adam-background-1/80 p-0 backdrop-blur-sm transition-colors duration-200 hover:bg-adam-neutral-950"
                onClick={(e) => e.stopPropagation()}
              >
                <MoreVertical className="h-4 w-4 text-adam-neutral-50" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="bg-[#191A1A]">
              <DropdownMenuItem
                onClick={(e) => {
                  e.stopPropagation();
                  onRename(conversation.id, conversation.title);
                }}
                className="text-adam-neutral-50 hover:cursor-pointer hover:bg-adam-neutral-950 focus:bg-adam-neutral-950"
              >
                <Pencil className="mr-2 h-4 w-4" />
                Rename
              </DropdownMenuItem>
              {conversation.privacy === 'private' ? (
                <DropdownMenuItem
                  onClick={(e) => {
                    e.stopPropagation();
                    onTogglePrivacy(conversation.id, 'public');
                  }}
                  className="text-adam-neutral-50 hover:cursor-pointer hover:bg-adam-neutral-950 focus:bg-adam-neutral-950"
                >
                  <GoodEarth className="mr-2 h-4 w-4" />
                  Make Public
                </DropdownMenuItem>
              ) : (
                <DropdownMenuItem
                  onClick={(e) => {
                    e.stopPropagation();
                    onTogglePrivacy(conversation.id, 'private');
                  }}
                  className="text-adam-neutral-50 hover:cursor-pointer hover:bg-adam-neutral-950 focus:bg-adam-neutral-950"
                >
                  <LockKeyhole className="mr-2 h-4 w-4" />
                  Make Private
                </DropdownMenuItem>
              )}
              <AlertDialogTrigger asChild onClick={(e) => e.stopPropagation()}>
                <DropdownMenuItem className="text-adam-neutral-50 hover:cursor-pointer hover:bg-adam-neutral-950 hover:text-red-500 focus:bg-adam-neutral-950 focus:text-red-500">
                  <Trash2 className="mr-2 h-4 w-4" />
                  Delete
                </DropdownMenuItem>
              </AlertDialogTrigger>
            </DropdownMenuContent>
          </DropdownMenu>
          <AlertDialogContent className="border-[2px] border-adam-neutral-700 bg-adam-background-1">
            <AlertDialogHeader>
              <AlertDialogTitle className="text-adam-neutral-100">
                Delete Creation
              </AlertDialogTitle>
              <AlertDialogDescription>
                Are you sure you want to delete this creation? This action
                cannot be undone.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel onClick={(e) => e.stopPropagation()}>
                Cancel
              </AlertDialogCancel>
              <AlertDialogAction
                onClick={(e) => {
                  e.stopPropagation();
                  onDelete(conversation.id);
                }}
                className="bg-red-600 hover:bg-red-700"
              >
                Delete
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </div>
  );
}

function findLatestVisualPreview(
  parts: unknown,
  messageId: string,
): VisualPreview {
  const messageParts = asParametricParts(parts);
  for (let index = messageParts.length - 1; index >= 0; index -= 1) {
    const part = messageParts[index];
    if (part.type === 'tool-create_mesh' && part.state === 'output-available') {
      return {
        type: 'mesh',
        key: part.output.id,
        meshId: part.output.id,
        fileType: part.output.fileType,
      };
    }
    if (part.type === 'tool-build_parametric_model') {
      const artifact = getBuildParametricModelOutput([part]);
      if (artifact?.code) {
        const key =
          'toolCallId' in part && typeof part.toolCallId === 'string'
            ? part.toolCallId
            : messageId;
        return { type: 'artifact', key, code: artifact.code };
      }
    }
  }
  return null;
}

async function dataUrlToBlob(dataUrl: string): Promise<Blob> {
  const response = await fetch(dataUrl);
  return response.blob();
}
