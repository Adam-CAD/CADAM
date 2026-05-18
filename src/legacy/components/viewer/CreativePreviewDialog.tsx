import { useCurrentMessage } from '@/contexts/CurrentMessageContext';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '../ui/dialog';
import { MeshPreview } from './MeshPreview';
import { ImageGallery } from './ImageGallery';

export function CreativePreviewDialog() {
  const { currentMessage, setCurrentMessage } = useCurrentMessage();

  return (
    <Dialog
      open={!!currentMessage}
      onOpenChange={(open) => {
        if (!open) {
          setCurrentMessage(null);
        }
      }}
    >
      <DialogContent className="mx-auto w-[calc(100%-4rem)] max-w-none border-none bg-transparent p-0 [&>button>svg]:h-6 [&>button>svg]:w-6 [&>button]:h-8 [&>button]:w-8 [&>button]:p-1 [&>button]:text-white [&>button]:opacity-70 [&>button]:hover:opacity-100">
        <DialogHeader className="hidden">
          <DialogTitle>Creative Preview</DialogTitle>
          <DialogDescription>Creative Preview</DialogDescription>
        </DialogHeader>
        <div className="flex h-full w-full flex-1 flex-col items-center justify-center gap-10">
          {currentMessage?.content.images && (
            <ImageGallery imageIds={currentMessage.content.images} />
          )}
          {currentMessage?.content.mesh && (
            <div className="aspect-square w-full">
              <MeshPreview meshId={currentMessage.content.mesh.id} />
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
