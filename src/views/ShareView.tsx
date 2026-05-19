import { ChatTitle } from '@/components/chat/ChatTitle';
import { MessageBubble } from '@/components/chat/MessageBubble';
import { ParameterSection } from '@/components/parameter/ParameterSection';
import { ScrollArea } from '@/components/ui/scroll-area';
import { MeshPreview } from '@/components/viewer/MeshPreview';
import { OpenSCADPreview } from '@/components/viewer/OpenSCADViewer';
import { ConversationContext } from '@/contexts/ConversationContext';
import { messageRowToChatMessage } from '@/lib/aiMessages';
import { supabase } from '@/lib/supabase';
import { updateParameter } from '@/lib/utils';
import parseParameters from '@shared/parseParameters';
import type { AppUIMessage } from '@shared/chatAi';
import { isParametricArtifact } from '@shared/parametricParts';
import Tree from '@shared/Tree';
import type {
  Conversation,
  Message,
  Parameter,
  ParametricArtifact,
} from '@shared/types';
import { useQuery } from '@tanstack/react-query';
import { useParams } from '@tanstack/react-router';
import { Loader2 } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ConversationView } from './ConversationView';

type ActivePreview =
  | { type: 'artifact'; messageId: string; artifact: ParametricArtifact }
  | { type: 'mesh'; messageId: string; meshId: string }
  | null;

/**
 * Read-only sibling of `EditorView`. Renders a public conversation tree
 * with the same layout chrome as the editor (chat / preview / parameters
 * panels), but mounts NO chat instance, no `useChat`, no mutations.
 *
 * Branch navigation works locally: the viewer can flip between sibling
 * branches by walking a local `leafId` state, which doesn't touch the
 * DB's `current_message_leaf_id` (they don't own the conversation).
 * Parameters can be tweaked for exploration but the changes stay in
 * memory.
 */
export default function ShareView() {
  const { id: conversationId } = useParams({ from: '/_layout/share/$id' });

  const { data: conversation, isLoading: isConversationLoading } = useQuery({
    queryKey: ['conversation', conversationId],
    enabled: !!conversationId,
    queryFn: async () => {
      if (!conversationId) throw new Error('Conversation ID is required');
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
      <ConversationShare conversation={conversation} messages={messages} />
    </ConversationContext.Provider>
  );
}

interface ConversationShareProps {
  conversation: Conversation;
  messages: Message[];
}

function ConversationShare({ conversation, messages }: ConversationShareProps) {
  // Local leaf — the share viewer can flip between branches without
  // touching `conversations.current_message_leaf_id` in the DB.
  const [localLeafId, setLocalLeafId] = useState<string>(
    conversation.current_message_leaf_id ?? messages.at(-1)?.id ?? '',
  );
  // Snap the local leaf to the conversation's current leaf when the DB
  // pointer changes (e.g. a refetch arrives). Only fires when the
  // upstream leaf actually changes — preserves the viewer's manual
  // branch nav otherwise.
  const prevLeafRef = useRef(conversation.current_message_leaf_id);
  useEffect(() => {
    if (prevLeafRef.current === conversation.current_message_leaf_id) return;
    prevLeafRef.current = conversation.current_message_leaf_id;
    if (conversation.current_message_leaf_id) {
      setLocalLeafId(conversation.current_message_leaf_id);
    }
  }, [conversation.current_message_leaf_id]);

  const chatMessages = useMemo(
    () => messages.map(messageRowToChatMessage),
    [messages],
  );
  const messageTree = useMemo(() => new Tree(chatMessages), [chatMessages]);
  const branch = useMemo(
    () => messageTree.getPath(localLeafId),
    [messageTree, localLeafId],
  );

  // Preview / parameters state — same shape as EditorView but with no
  // server-side persistence.
  const [activePreview, setActivePreview] = useState<ActivePreview>(null);
  const [parameters, setParameters] = useState<Parameter[]>([]);
  const [currentOutput, setCurrentOutput] = useState<Blob | undefined>();
  const baseCodeRef = useRef<string | null>(null);

  // Auto-switch the preview pane to the latest artifact / mesh in the
  // current branch when it changes.
  const lastAutoAppliedPreviewKeyRef = useRef<string | null>(null);
  useEffect(() => {
    const latest = findLatestPreview(branch);
    if (!latest) return;
    const key =
      latest.type === 'artifact'
        ? `artifact:${latest.messageId}:${latest.artifact.code.length}`
        : `mesh:${latest.messageId}:${latest.meshId}`;
    if (lastAutoAppliedPreviewKeyRef.current === key) return;
    lastAutoAppliedPreviewKeyRef.current = key;
    if (latest.type === 'artifact') {
      baseCodeRef.current = latest.artifact.code;
      setParameters(parseParameters(latest.artifact.code));
      setCurrentOutput(undefined);
      setActivePreview({
        type: 'artifact',
        messageId: latest.messageId,
        artifact: latest.artifact,
      });
    } else {
      setCurrentOutput(undefined);
      setActivePreview({
        type: 'mesh',
        messageId: latest.messageId,
        meshId: latest.meshId,
      });
    }
  }, [branch]);

  const handleViewArtifact = useCallback(
    (artifact: ParametricArtifact, messageId: string) => {
      baseCodeRef.current = artifact.code;
      setParameters(parseParameters(artifact.code));
      setCurrentOutput(undefined);
      setActivePreview({ type: 'artifact', messageId, artifact });
    },
    [],
  );
  const handleViewMesh = useCallback((meshId: string, messageId: string) => {
    setCurrentOutput(undefined);
    setActivePreview({ type: 'mesh', messageId, meshId });
  }, []);

  const changeParameters = useCallback(
    (nextParameters: Parameter[]) => {
      if (!baseCodeRef.current || activePreview?.type !== 'artifact') return;
      let nextCode = baseCodeRef.current;
      for (const parameter of nextParameters) {
        nextCode = updateParameter(nextCode, parameter);
      }
      setParameters(nextParameters);
      setActivePreview({
        ...activePreview,
        artifact: {
          ...activePreview.artifact,
          code: nextCode,
        },
      });
    },
    [activePreview],
  );

  const hasArtifact =
    activePreview?.type === 'artifact' && parameters.length > 0;

  return (
    <ConversationView
      hasParameters={hasArtifact}
      chatPanelSlot={
        <>
          <div className="flex w-full items-center justify-between bg-transparent p-3 pl-12">
            <div className="min-w-0 flex-1">
              <ChatTitle
                activeMeshId={
                  activePreview?.type === 'mesh'
                    ? activePreview.meshId
                    : undefined
                }
                activeOpenscadCode={
                  activePreview?.type === 'artifact'
                    ? activePreview.artifact.code
                    : undefined
                }
              />
            </div>
          </div>

          <ScrollArea className="min-h-0 flex-1 p-4">
            <div className="mx-auto flex max-w-3xl flex-col gap-4">
              {branch.map((node) => (
                <MessageBubble
                  key={node.id}
                  message={node}
                  isLoading={false}
                  onSelectLeaf={setLocalLeafId}
                  onViewArtifact={(artifact) =>
                    handleViewArtifact(artifact, node.id)
                  }
                  onViewMesh={(meshId) => handleViewMesh(meshId, node.id)}
                />
              ))}
            </div>
          </ScrollArea>
        </>
      }
      previewSlot={
        <div className="flex h-full w-full items-center justify-center bg-adam-neutral-700">
          {activePreview?.type === 'artifact' ? (
            <OpenSCADPreview
              scadCode={activePreview.artifact.code}
              color="#00A6FF"
              onOutputChange={setCurrentOutput}
            />
          ) : activePreview?.type === 'mesh' ? (
            <MeshPreview meshId={activePreview.meshId} />
          ) : (
            <div className="text-sm text-adam-text-secondary">
              Nothing to preview yet
            </div>
          )}
        </div>
      }
      parametersSlot={
        <div className="relative h-full">
          <ParameterSection
            parameters={parameters}
            onParameterChange={changeParameters}
            currentOutput={currentOutput}
            dxfExporter={null}
            code={
              activePreview?.type === 'artifact'
                ? activePreview.artifact.code
                : undefined
            }
          />
        </div>
      }
    />
  );
}

type LatestPreview =
  | { type: 'artifact'; messageId: string; artifact: ParametricArtifact }
  | { type: 'mesh'; messageId: string; meshId: string }
  | null;

function findLatestPreview(
  messages: { id: string; parts: AppUIMessage['parts'] }[],
): LatestPreview {
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
