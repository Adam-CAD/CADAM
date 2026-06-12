import { useEffect, useState } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import type { MotionProps } from 'framer-motion';
import { MessageSquare, Plus, LayoutGrid, List } from 'lucide-react';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Input } from '@/components/ui/input';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { format } from 'date-fns';
import { useToast } from '@/hooks/use-toast';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as Sentry from '@sentry/react';
import { Conversation, ConversationSettings } from '@shared/types';
import type { AppUIMessage } from '@shared/chatAi';
import { asParametricParts } from '@shared/parametricParts';
import { HistoryConversation } from '../types/misc.ts';
import { ConversationCard } from '@/components/history/ConversationCard';
import { VisualCard } from '@/components/history/VisualCard';
import { RenameDialogDrawer } from '@/components/history/RenameDialogDrawer';
import {
  useDeleteConversation,
  useRenameConversation,
} from '@/services/conversationService';
import { cn } from '@/lib/utils';

const VIEW_TRANSITION_PROPS = {
  initial: { opacity: 0, y: 10, filter: 'blur(2px)' },
  animate: { opacity: 1, y: 0, filter: 'blur(0px)' },
  exit: { opacity: 0, y: -8, filter: 'blur(2px)' },
  transition: { duration: 0.22, ease: [0.22, 1, 0.36, 1] },
} satisfies Pick<MotionProps, 'initial' | 'animate' | 'exit' | 'transition'>;

const REDUCED_VIEW_TRANSITION_PROPS = {
  initial: { opacity: 0 },
  animate: { opacity: 1 },
  exit: { opacity: 0 },
  transition: { duration: 0 },
} satisfies Pick<MotionProps, 'initial' | 'animate' | 'exit' | 'transition'>;

export function HistoryView() {
  const [searchQuery, setSearchQuery] = useState('');
  const [viewMode, setViewMode] = useState<'list' | 'visual'>('list');
  const [editingConversation, setEditingConversation] =
    useState<Conversation | null>(null);
  const [newTitle, setNewTitle] = useState('');
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const shouldReduceMotion = useReducedMotion();

  const deleteConversation = useDeleteConversation();
  const renameConversation = useRenameConversation({
    onRenamed: () => {
      setEditingConversation(null);
      setOpen(false);
    },
  });

  const handleOpenChange = (open: boolean) => {
    setOpen(open);
    if (!open) {
      setEditingConversation(null);
    }
  };

  const conversationQuery = useQuery<HistoryConversation[]>({
    queryKey: ['conversations'],
    enabled: !!user,
    queryFn: async () => {
      const { data: conversationsData, error: conversationsError } =
        await supabase
          .from('conversations')
          .select(
            `*, first_message:messages(parts), messagesCount:messages(count)`,
          )
          .eq('user_id', user?.id ?? '')
          .order('updated_at', { ascending: false })
          .order('created_at', { ascending: false })
          .limit(1, { referencedTable: 'first_message' })
          .overrideTypes<Array<{ settings: ConversationSettings }>>();

      if (conversationsError) throw conversationsError;

      const formattedConversations = conversationsData.map((conv) => {
        const parts = conv.first_message?.[0]?.parts;
        const messageCount = conv.messagesCount?.[0]?.count ?? 0;

        const formattedFirstMessage = {
          text: textFromParts(parts),
          images: imageIdsFromParts(parts),
        };

        return {
          ...conv,
          created_at: conv.created_at || new Date().toISOString(),
          updated_at:
            conv.updated_at || conv.created_at || new Date().toISOString(),
          message_count: messageCount,
          first_message: formattedFirstMessage,
        };
      });

      return formattedConversations;
    },
  });

  useEffect(() => {
    if (conversationQuery.isError) {
      toast({
        title: 'Error',
        description: 'Failed to load conversations',
        variant: 'destructive',
      });
    }
  }, [conversationQuery.isError, toast]);

  const togglePrivacy = useMutation({
    mutationFn: async ({
      conversationId,
      newPrivacy,
    }: {
      conversationId: string;
      newPrivacy: 'public' | 'private';
    }) => {
      const { error } = await supabase
        .from('conversations')
        .update({ privacy: newPrivacy })
        .eq('id', conversationId);

      if (error) throw error;
    },
    onMutate: async ({ conversationId, newPrivacy }) => {
      await queryClient.cancelQueries({ queryKey: ['conversations'] });
      const previousConversations = queryClient.getQueryData(['conversations']);
      queryClient.setQueryData(
        ['conversations'],
        (old: HistoryConversation[]) =>
          old.map((conv) =>
            conv.id === conversationId
              ? { ...conv, privacy: newPrivacy }
              : conv,
          ),
      );
      return { previousConversations };
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['conversations'] });
      toast({
        title: 'Success',
        description: `Conversation is now ${variables.newPrivacy === 'public' ? 'public' : 'private'}`,
      });
    },
    onError: (error: unknown, _variables, context) => {
      console.error('Error toggling privacy:', error);
      queryClient.setQueryData(
        ['conversations'],
        context?.previousConversations,
      );
      toast({
        title: 'Error',
        description: 'Failed to change conversation privacy',
        variant: 'destructive',
      });
    },
  });

  const handleRename = () => {
    if (!editingConversation) return;
    if (!newTitle.trim()) {
      toast({
        title: 'Title cannot be empty',
        variant: 'default',
      });
      return;
    }
    renameConversation.mutate({
      conversationId: editingConversation.id,
      newTitle: newTitle.trim(),
    });
  };

  const filteredConversations =
    conversationQuery.data?.filter((conv: HistoryConversation) => {
      const messageText = conv.first_message.text ?? '';
      const title = conv.title?.toLowerCase() ?? '';
      const searchTerm = searchQuery.toLowerCase();

      return (
        title.includes(searchTerm) ||
        messageText.toLowerCase().includes(searchTerm)
      );
    }) ?? [];

  const groupConversationsByDate = () => {
    const groups: { [key: string]: HistoryConversation[] } = {};

    filteredConversations.forEach((conv: HistoryConversation) => {
      const localDate = new Date(
        conv.updated_at || conv.created_at,
      ).toLocaleDateString('en-CA');
      if (!groups[localDate]) {
        groups[localDate] = [];
      }
      groups[localDate].push(conv);
    });

    return groups;
  };

  const conversationGroups = groupConversationsByDate();
  const viewTransitionProps = shouldReduceMotion
    ? REDUCED_VIEW_TRANSITION_PROPS
    : VIEW_TRANSITION_PROPS;

  return (
    <>
      <div className="flex h-full min-w-0 flex-1 flex-col bg-adam-background-1 pt-8 md:pt-0">
        <div className="mx-auto w-full max-w-6xl px-6 pb-4 pt-10 md:px-20 md:py-4">
          <div className="flex items-center justify-between py-3">
            <h1 className="flex items-center gap-2 px-2 text-2xl font-medium text-adam-neutral-10">
              Past Creations
            </h1>

            {/* View Toggle */}
            <div
              role="group"
              aria-label="View mode"
              className="relative grid grid-cols-2 items-center rounded-lg border border-adam-neutral-700 bg-adam-background-2 p-1"
            >
              <span
                className={cn(
                  'pointer-events-none absolute inset-y-1 left-1 w-[calc(50%-0.25rem)] rounded-md bg-adam-neutral-950 shadow-[0_1px_10px_rgba(0,0,0,0.22)] transition-transform ease-out',
                  shouldReduceMotion ? 'duration-0' : 'duration-300',
                  viewMode === 'visual' && 'translate-x-full',
                )}
              />
              <Button
                variant="ghost"
                size="sm"
                aria-pressed={viewMode === 'list'}
                aria-label="List view"
                onClick={() => setViewMode('list')}
                className={`relative z-10 h-8 px-3 transition-colors duration-200 ${
                  viewMode === 'list'
                    ? 'text-adam-neutral-50 hover:bg-transparent hover:text-adam-neutral-50'
                    : 'text-adam-neutral-400 hover:bg-adam-neutral-950/40 hover:text-adam-neutral-50'
                }`}
              >
                <List className="mr-2 h-4 w-4" />
                List
              </Button>
              <Button
                variant="ghost"
                size="sm"
                aria-pressed={viewMode === 'visual'}
                aria-label="Visual view"
                onClick={() => setViewMode('visual')}
                className={`relative z-10 h-8 px-3 transition-colors duration-200 ${
                  viewMode === 'visual'
                    ? 'text-adam-neutral-50 hover:bg-transparent hover:text-adam-neutral-50'
                    : 'text-adam-neutral-400 hover:bg-adam-neutral-950/40 hover:text-adam-neutral-50'
                }`}
              >
                <LayoutGrid className="mr-2 h-4 w-4" />
                Visual
              </Button>
            </div>
          </div>

          <div className="relative mt-4">
            <Input
              placeholder="Search generations..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="border-0 bg-adam-background-2 pl-6 text-base shadow-[inset_0_0_10px_0_rgba(0,0,0,0.32),0_0_0_2px_rgba(0,0,0,0)] ring-0 transition-shadow duration-300 ease-in-out hover:shadow-[inset_0_0_4px_0_rgba(0,0,0,0.16),0_0_0_2px_rgba(60,60,60,1)] focus:shadow-[inset_0_0_4px_0_rgba(0,0,0,0.16),0_0_0_2px_#00A6FF] focus:outline-none sm:text-sm"
            />
          </div>
        </div>

        <ScrollArea className="flex-1">
          <div className="mx-auto w-full max-w-6xl px-6 md:px-20">
            {conversationQuery.isLoading ? (
              <div className="space-y-4 py-4">
                {[...Array(5)].map((_, i) => (
                  <div key={i} className="flex items-center space-x-4">
                    <Skeleton className="h-12 w-12 rounded-lg" />
                    <div className="flex-1 space-y-2">
                      <Skeleton className="h-4 w-[250px]" />
                      <Skeleton className="h-4 w-[200px]" />
                    </div>
                  </div>
                ))}
              </div>
            ) : filteredConversations.length === 0 ? (
              <div className="flex h-full flex-col items-center justify-center py-8 text-gray-500">
                <MessageSquare className="mb-4 h-12 w-12 opacity-50" />
                {searchQuery ? (
                  <>
                    <p className="mb-2 text-lg font-medium">
                      No matching conversations found
                    </p>
                    <p className="mb-4 text-sm">Try a different search term</p>
                  </>
                ) : (
                  <>
                    <p className="mb-2 text-lg font-medium">
                      No conversations yet
                    </p>
                    <p className="mb-4 text-sm">
                      Start a new chat to begin building CAD
                    </p>
                    <Button onClick={() => navigate({ to: '/' })}>
                      Start New Chat
                    </Button>
                  </>
                )}
              </div>
            ) : (
              <AnimatePresence mode="wait" initial={false}>
                {viewMode === 'visual' ? (
                  <motion.div
                    key="visual"
                    {...viewTransitionProps}
                    className="grid gap-6 py-4 pb-48 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4"
                  >
                    {filteredConversations.map((conversation) => (
                      <VisualCard
                        key={conversation.id}
                        conversation={conversation}
                        onDelete={(id) => deleteConversation.mutate(id)}
                        onRename={(_id, title) => {
                          setEditingConversation(conversation);
                          setNewTitle(title);
                          setOpen(true);
                        }}
                        onTogglePrivacy={(id, privacy) =>
                          togglePrivacy.mutate({
                            conversationId: id,
                            newPrivacy: privacy,
                          })
                        }
                      />
                    ))}
                  </motion.div>
                ) : (
                  <motion.div
                    key="list"
                    {...viewTransitionProps}
                    className="space-y-8 py-4 pb-48"
                  >
                    {Object.entries(conversationGroups).map(([date, convs]) => {
                      let dateString;
                      try {
                        const [year, month, day] = date.split('-').map(Number);
                        dateString = format(
                          new Date(year, month - 1, day),
                          'MMMM d, yyyy',
                        );
                      } catch (error) {
                        Sentry.captureException(error, { extra: { date } });
                      }

                      return (
                        <div key={date} className="space-y-2">
                          {dateString && (
                            <h2 className="bg-adam-background-1 px-3 py-2 text-sm font-medium text-adam-neutral-100">
                              {dateString}
                            </h2>
                          )}
                          <div className="space-y-2">
                            {convs.map((conversation) => (
                              <ConversationCard
                                key={conversation.id}
                                conversation={conversation}
                                onDelete={(id) => deleteConversation.mutate(id)}
                                onRename={(_id, title) => {
                                  setEditingConversation(conversation);
                                  setNewTitle(title);
                                  setOpen(true);
                                }}
                                onTogglePrivacy={(id, privacy) =>
                                  togglePrivacy.mutate({
                                    conversationId: id,
                                    newPrivacy: privacy,
                                  })
                                }
                                isEditing={!!editingConversation}
                              />
                            ))}
                          </div>
                        </div>
                      );
                    })}
                  </motion.div>
                )}
              </AnimatePresence>
            )}
          </div>
        </ScrollArea>
      </div>

      <RenameDialogDrawer
        open={open}
        onOpenChange={handleOpenChange}
        newTitle={newTitle}
        onNewTitleChange={setNewTitle}
        onRename={handleRename}
      />

      <button
        type="button"
        aria-label="Create new item"
        onClick={() => navigate({ to: '/' })}
        className="fixed bottom-8 right-8 flex h-14 w-14 items-center justify-center rounded-full bg-adam-neutral-100 text-adam-neutral-950 shadow-[0_4px_32px_rgba(0,0,0,0.48)] md:hidden"
      >
        <Plus className="h-10 w-10 stroke-[2px]" />
      </button>
    </>
  );
}

function textFromParts(parts: unknown) {
  return asParametricParts(parts)
    .filter((part) => part.type === 'text')
    .map((part) => part.text)
    .join('')
    .trim();
}

function imageIdsFromParts(parts: unknown) {
  return asParametricParts(parts)
    .filter(
      (
        part,
      ): part is Extract<AppUIMessage['parts'][number], { type: 'file' }> =>
        part.type === 'file' &&
        typeof part.mediaType === 'string' &&
        part.mediaType.startsWith('image/'),
    )
    .map((part) => part.filename?.replace(/\.[^.]+$/, '') ?? '')
    .filter(Boolean);
}
