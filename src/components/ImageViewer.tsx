import { Check, DownloadIcon, Frown, Loader2, PlusIcon } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useItemSelection } from '@/hooks/useItemSelection';
import { cn } from '@/lib/utils';
import { useImageData } from '@/hooks/useImageData';
import { useConversation } from '@/contexts/ConversationContext';
import { getSafeFilename } from '@/utils/file-utils';

export function ImageViewer({
  image,
  className,
  hoverable = true,
  clickable = true,
}: {
  image: string;
  className?: string;
  hoverable?: boolean;
  clickable?: boolean;
}) {
  const [loaded, setLoaded] = useState(false);
  const { images, selectItem } = useItemSelection();
  const { conversation } = useConversation();

  const {
    data: { data: imageData, isLoading: isImageDataLoading },
    url: { data: imageUrl, isLoading: isImageLoading },
  } = useImageData(image);

  const handleDownload = () => {
    const url = imageUrl?.url || '';
    // Parse MIME from the data URL (e.g. "data:image/jpeg;base64,...") so
    // the downloaded file's extension matches the actual bytes. GPT Image
    // generates jpeg, Gemini/Flux fallbacks generate png — hardcoding .png
    // would mislabel jpeg downloads and some viewers reject the mismatch.
    const mimeMatch = url.match(/^data:(image\/\w+);/);
    const mime = mimeMatch?.[1] ?? 'image/png';
    const ext =
      mime === 'image/jpeg' ? 'jpg' : mime === 'image/webp' ? 'webp' : 'png';
    const link = document.createElement('a');
    link.href = url;
    const name = getSafeFilename(conversation.title);
    link.download = `${name}.${ext}`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const isSelected = useMemo(
    () => images.some((img) => img.id === image),
    [images, image],
  );

  if (imageData?.status === 'failure') {
    return (
      <div
        className={cn(
          'flex aspect-square h-full w-full flex-col items-center justify-center gap-2 rounded-lg text-adam-text-primary',
          className,
        )}
      >
        <Frown className="h-10 w-10" />
        <span>Image generation failed</span>
      </div>
    );
  }

  if (isImageDataLoading || isImageLoading || imageData?.status === 'pending') {
    return (
      <div
        className={cn(
          'flex aspect-square w-full items-center justify-center rounded-lg text-adam-text-primary',
          className,
        )}
      >
        <Loader2 className="h-10 w-10 animate-spin" />
      </div>
    );
  }

  if (!imageUrl) {
    return (
      <div
        className={cn(
          'flex aspect-square h-full w-full items-center justify-center rounded-lg text-adam-text-primary',
          className,
        )}
      >
        <Frown className="h-10 w-10" />
        <span>Image not found</span>
      </div>
    );
  }

  return (
    <div className="flex h-full w-full items-center justify-center">
      <div
        className={cn(
          'group relative flex w-full max-w-2xl items-center justify-center overflow-hidden rounded-lg',
          className,
        )}
      >
        <img
          className="h-full w-full object-cover"
          src={imageUrl.url}
          alt="Image"
          onLoad={() => setLoaded(true)}
        />
        {!loaded && (
          <div className="absolute inset-0 flex items-center justify-center bg-adam-neutral-800/50 text-adam-text-primary">
            <Loader2 className="h-10 w-10 animate-spin" />
          </div>
        )}
        {clickable && (
          <>
            {/* Bottom shadow gradient that appears on hover */}
            <div
              className={`absolute inset-x-0 bottom-0 h-16 transition-opacity duration-300 ${hoverable ? 'opacity-0 group-hover:opacity-100' : 'opacity-100'}`}
              style={{
                background:
                  'linear-gradient(to top, rgba(0,0,0,0.48) 0%, rgba(0,0,0,0) 100%)',
              }}
            />
            {/* White download icon that appears on hover */}
            <div
              className={`absolute bottom-3 right-3 z-10 cursor-pointer transition-transform duration-200 hover:scale-110 ${hoverable ? 'opacity-0 group-hover:opacity-100' : 'opacity-100'}`}
              onClick={handleDownload}
            >
              <DownloadIcon className="h-5 w-5 text-white drop-shadow-[0px_2px_3px_rgba(0,0,0,0.4)]" />
            </div>
            {/* Selected Image Checkbox */}
            <div
              className={`absolute left-2 top-2 z-10 rounded-full p-1 ${isSelected ? 'bg-adam-blue' : 'bg-black'} cursor-pointer transition-transform duration-200 hover:scale-110 ${isSelected ? 'opacity-100' : hoverable ? 'opacity-0 group-hover:opacity-100' : 'opacity-100'}`}
              onClick={(e) => {
                e.stopPropagation();
                selectItem(
                  { id: image, source: 'selection', url: imageUrl.url },
                  'image',
                );
              }}
            >
              {isSelected && <Check className="h-4 w-4 text-white" />}
              {!isSelected && <PlusIcon className="h-4 w-4 text-white" />}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
