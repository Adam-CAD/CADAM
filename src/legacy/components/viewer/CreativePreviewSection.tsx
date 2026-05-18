import { MeshPreview } from './MeshPreview';
import { ImageGallery } from './ImageGallery';
import { useCurrentMessage } from '@/contexts/CurrentMessageContext';
import { useConversation } from '@/contexts/ConversationContext';
import { CreativeLoadingBar } from './CreativeLoadingBar';
import { CreativeModel } from '@shared/types';

interface CreativePreviewSectionProps {
  isLoading: boolean;
}

export function CreativePreviewSection({
  isLoading,
}: CreativePreviewSectionProps) {
  const { currentMessage: message } = useCurrentMessage();
  const { conversation } = useConversation();

  return (
    <div className="flex h-full w-full items-center justify-center bg-adam-neutral-700">
      {isLoading ? (
        <div className="flex h-full w-full items-center justify-center">
          <CreativeLoadingBar
            modelName={
              (message?.content.model ??
                conversation.settings?.model ??
                'quality') as CreativeModel
            }
          />
        </div>
      ) : (
        <div className="flex h-full w-full flex-1 flex-col items-center justify-center gap-2">
          {message?.content.images && Array.isArray(message.content.images) && (
            <ImageGallery imageIds={message.content.images} />
          )}
          {message?.content.mesh && (
            <MeshPreview meshId={message.content.mesh.id} />
          )}
        </div>
      )}
    </div>
  );
}
