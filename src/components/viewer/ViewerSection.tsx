import { ImageGallery } from './ImageGallery';
import { useCurrentMessage } from '@/contexts/CurrentMessageContext';
import Loader from './Loader';
import { OpenSCADViewer } from './OpenSCADViewer';
import { useIsLoading } from '@/services/messageService';

type ViewerSectionProps = {
  code?: string;
};

export function ViewerSection({ code }: ViewerSectionProps) {
  const isLoading = useIsLoading();
  const { currentMessage: message } = useCurrentMessage();

  return (
    <div className="flex h-full w-full items-center justify-center bg-adam-neutral-700">
      {isLoading ? (
        <div className="flex h-full items-center justify-center">
          <Loader message="Generating model" />
        </div>
      ) : (
        <div className="flex h-full w-full flex-1 flex-col items-center justify-center gap-2">
          {message?.content.images && Array.isArray(message.content.images) && (
            <ImageGallery imageIds={message.content.images} />
          )}
          {(code || message?.content.artifact?.code) && (
            <OpenSCADViewer code={code} />
          )}
        </div>
      )}
    </div>
  );
}
