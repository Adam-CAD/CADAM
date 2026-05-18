import { ModernMessageBubble } from '@/components/chat/ModernMessageBubble';
import { ScrollArea } from '@/components/ui/scroll-area';
import { MeshPreview } from '@/components/viewer/MeshPreview';
import { OpenSCADPreview } from '@/components/viewer/OpenSCADViewer';
import { ConversationContext } from '@/contexts/ConversationContext';
import { messageRowToModernMessage } from '@/lib/aiMessages';
import { cn } from '@/lib/utils';
import { supabase } from '@/lib/supabase';
import { useQuery } from '@tanstack/react-query';
import { useParams } from '@tanstack/react-router';
import Tree from '@shared/Tree';
import { isParametricArtifact } from '@shared/parametricParts';
import type { Conversation, Message, ParametricArtifact } from '@shared/types';
import { Loader2, PanelRightOpen } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';

type ActivePreview =
  | { type: 'artifact'; messageId: string; artifact: ParametricArtifact }
  | { type: 'mesh'; messageId: string; meshId: string }
  | null;

export default function ShareView() {
  const { id: conversationId } = useParams({ from: '/_layout/share/$id' });
  const [activePreview, setActivePreview] = useState<ActivePreview>(null);

  const { data: conversation, isLoading: isConversationLoading } = useQuery({
    queryKey: ['conversation', conversationId],
    enabled: !!conversationId,
    queryFn: async () => {
      if (!conversationId) {
        throw new Error('Conversation ID is required');
      }
      const { data, error } = await supabase
        .from('conversations')
        .select('*')
        .eq('id', conversationId)
        .limit(1)
        .single()
        .overrideTypes<Conversation>();

      if (error) throw error;
      return data;
    },
  });

  const { data: messages = [], isLoading: areMessagesLoading } = useQuery({
    queryKey: ['share-messages', conversationId],
    enabled: !!conversationId && !!conversation,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('messages')
        .select('*')
        .eq('conversation_id', conversationId)
        .order('created_at', { ascending: true })
        .overrideTypes<Message[]>();

      if (error) throw error;
      return data ?? [];
    },
  });

  const messageTree = useMemo(
    () => new Tree(messages.map(messageRowToModernMessage)),
    [messages],
  );
  const selectedLeafId =
    conversation?.current_message_leaf_id ?? messages.at(-1)?.id ?? '';
  const currentBranch = useMemo(
    () => messageTree.getPath(selectedLeafId),
    [messageTree, selectedLeafId],
  );
  const latestPreview = useMemo(
    () => findLatestPreview(currentBranch),
    [currentBranch],
  );

  useEffect(() => {
    if (!latestPreview) return;
    if (
      activePreview?.messageId === latestPreview.messageId &&
      activePreview.type === latestPreview.type
    ) {
      return;
    }
    setActivePreview(latestPreview);
  }, [latestPreview, activePreview]);

  if (isConversationLoading || areMessagesLoading) {
    return (
      <div className="flex h-full w-full items-center justify-center bg-adam-bg-secondary-dark text-adam-text-primary">
        <Loader2 className="h-10 w-10 animate-spin" />
      </div>
    );
  }

  if (!conversation) {
    return (
      <div className="flex h-full w-full flex-col items-center justify-center bg-adam-bg-secondary-dark text-adam-text-primary">
        <span className="text-2xl font-medium">404</span>
        <span className="text-sm">Conversation not found</span>
      </div>
    );
  }

  return (
    <ConversationContext.Provider value={{ conversation }}>
      <div className="flex h-full w-full overflow-hidden bg-adam-bg-secondary-dark">
        <div
          className={cn(
            'flex min-w-0 flex-col border-r border-adam-neutral-700',
            activePreview ? 'w-[390px] shrink-0' : 'flex-1',
          )}
        >
          <div className="flex h-14 items-center border-b border-adam-neutral-700 px-4">
            <div className="min-w-0 truncate text-sm font-medium text-adam-text-primary">
              {conversation.title}
            </div>
          </div>
          <ScrollArea className="min-h-0 flex-1 p-4">
            <div className="mx-auto flex max-w-3xl flex-col gap-4">
              {currentBranch.map((message) => (
                <ModernMessageBubble
                  key={message.id}
                  message={message}
                  isLoading={false}
                  onViewArtifact={(artifact) =>
                    setActivePreview({
                      type: 'artifact',
                      messageId: message.id,
                      artifact,
                    })
                  }
                  onViewMesh={(meshId) =>
                    setActivePreview({
                      type: 'mesh',
                      messageId: message.id,
                      meshId,
                    })
                  }
                />
              ))}
            </div>
          </ScrollArea>
        </div>

        {activePreview ? (
          <div className="min-w-0 flex-1 bg-adam-neutral-700">
            <div className="flex h-14 items-center justify-between border-b border-adam-neutral-800 px-4 text-sm font-medium text-adam-text-primary">
              <span>
                {activePreview.type === 'artifact'
                  ? activePreview.artifact.title
                  : '3D Mesh'}
              </span>
              <Button
                size="icon"
                variant="ghost"
                className="h-8 w-8 rounded-md"
                onClick={() => setActivePreview(null)}
              >
                <PanelRightOpen className="h-4 w-4" />
              </Button>
            </div>
            <div className="h-[calc(100%-3.5rem)]">
              {activePreview.type === 'artifact' ? (
                <OpenSCADPreview
                  scadCode={activePreview.artifact.code}
                  color="#00A6FF"
                />
              ) : (
                <MeshPreview meshId={activePreview.meshId} />
              )}
            </div>
          </div>
        ) : null}
      </div>
    </ConversationContext.Provider>
  );
}

function findLatestPreview(messages: MessageLike[]): ActivePreview {
  for (
    let messageIndex = messages.length - 1;
    messageIndex >= 0;
    messageIndex -= 1
  ) {
    const message = messages[messageIndex];
    for (
      let partIndex = message.parts.length - 1;
      partIndex >= 0;
      partIndex -= 1
    ) {
      const part = message.parts[partIndex];
      if (
        part.type === 'tool-build_parametric_model' &&
        part.state !== 'input-streaming' &&
        isParametricArtifact(part.input)
      ) {
        return {
          type: 'artifact',
          messageId: message.id,
          artifact: part.input,
        };
      }
      if (
        part.type === 'tool-create_mesh' &&
        part.state === 'output-available'
      ) {
        return {
          type: 'mesh',
          messageId: message.id,
          meshId: part.output.id,
        };
      }
    }
  }
  return null;
}

type MessageLike = {
  id: string;
  parts: ReturnType<typeof messageRowToModernMessage>['parts'];
};
