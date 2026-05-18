import { ChevronLeft, ChevronRight, Loader2 } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useCurrentMessage } from '@/contexts/CurrentMessageContext';
import { Carousel, CarouselContent, CarouselItem } from '../ui/carousel';
import type { CarouselApi } from '../ui/carousel';
import { cn } from '@/lib/utils';
import { ImageViewer } from '@/components/ImageViewer';
import { useIsMobile } from '@/hooks/useIsMobile';
import { useImagesData } from '@/hooks/useImageData';
import { CreativeLoadingBar } from '@/components/viewer/CreativeLoadingBar';
import { CreativeModel } from '@shared/types';

export function ImageGallery({ imageIds }: { imageIds: string[] }) {
  const { currentMessage, setCurrentMessage } = useCurrentMessage();
  const [currentIndex, setCurrentIndex] = useState(
    currentMessage?.content.index ?? 0,
  );
  const [api, setApi] = useState<CarouselApi>();
  const isMobile = useIsMobile();

  const { data: imagesData, url: imageUrls } = useImagesData(imageIds);

  const isLoading = useMemo(() => {
    const imagesLoading = imagesData.some((image) => image.isLoading);
    const imageUrlsLoading = imageUrls.some((image) => image.isLoading);
    return imagesLoading || imageUrlsLoading;
  }, [imagesData, imageUrls]);

  const isPending = useMemo(() => {
    return imagesData.some((image) => image.data?.status === 'pending');
  }, [imagesData]);

  const currentMessageIndex = currentMessage?.content.index ?? currentIndex;

  // // Sync currentIndex with initialIndex when it changes
  useEffect(() => {
    if (api && api.selectedScrollSnap() !== currentMessageIndex) {
      api.scrollTo(currentMessageIndex);
    }
  }, [api, currentMessageIndex]);

  // Update current index when carousel changes
  useEffect(() => {
    if (!api) return;

    const onSelect = () => {
      const newIndex = api.selectedScrollSnap();
      if (currentMessage) {
        setCurrentMessage({
          ...currentMessage,
          content: { ...currentMessage.content, index: newIndex },
        });
      }
    };

    const onSettle = () => {
      const newIndex = api.selectedScrollSnap();
      setCurrentIndex(newIndex);
    };

    api.on('select', onSelect);
    api.on('settle', onSettle);
    return () => {
      api.off('select', onSelect);
      api.off('settle', onSettle);
    };
  }, [api, currentMessage, setCurrentMessage]);

  const handleNext = () => {
    const newIndex = (currentMessageIndex + 1) % imageIds.length;
    if (api) {
      api.scrollTo(newIndex);
    }
  };

  const handlePrevious = () => {
    const newIndex =
      (currentMessageIndex - 1 + imageIds.length) % imageIds.length;
    if (api) {
      api.scrollTo(newIndex);
    }
  };

  if (isLoading) {
    return (
      <div className="flex aspect-square w-full items-center justify-center rounded-lg text-adam-text-primary">
        <Loader2 className="h-10 w-10 animate-spin" />
      </div>
    );
  }

  if (isPending) {
    return (
      <div className="flex h-full w-full items-center justify-center">
        <CreativeLoadingBar
          modelType="image"
          startTime={new Date(imagesData[0].data?.created_at ?? '').getTime()}
          modelName={
            (imagesData[0].data?.prompt?.model || 'quality') as CreativeModel
          }
        />
      </div>
    );
  }

  return (
    <div className="flex h-full w-full flex-col items-center justify-center gap-6 sm:p-8">
      <div className="relative flex w-full max-w-7xl flex-col items-center justify-center gap-2 sm:gap-6">
        <Carousel
          key={currentMessage?.id ?? 'initial'}
          opts={{
            align: 'center',
            loop: true,
            startIndex: currentIndex,
          }}
          setApi={setApi}
          className="w-full"
        >
          <CarouselContent
            className={imageIds.length > 1 ? '' : 'justify-center'}
          >
            {imageIds.map((imageId, index) => (
              <CarouselItem key={imageId} className="md:basis-2/3">
                <div
                  className={cn(
                    'group relative flex h-full w-full items-center justify-center overflow-hidden transition-all duration-200 ease-in-out',
                    currentMessageIndex !== index && 'scale-90 opacity-50',
                  )}
                >
                  <ImageViewer
                    image={imageId}
                    className="shadow-lg"
                    clickable={currentMessageIndex === index}
                    hoverable={!isMobile}
                  />
                </div>
              </CarouselItem>
            ))}
          </CarouselContent>
          {imageIds.length > 1 && (
            <>
              <button
                onClick={handleNext}
                className="absolute right-4 top-1/2 z-10 -translate-y-1/2 rounded-full bg-black/50 p-2 text-white transition-opacity hover:bg-black/70 md:right-8"
                aria-label="Next image"
              >
                <ChevronRight className="h-6 w-6" />
              </button>
              <button
                onClick={handlePrevious}
                className="absolute left-4 top-1/2 z-10 -translate-y-1/2 rounded-full bg-black/50 p-2 text-white transition-opacity hover:bg-black/70 md:left-8"
                aria-label="Previous image"
              >
                <ChevronLeft className="h-6 w-6" />
              </button>
            </>
          )}
        </Carousel>
        {/* Image counter */}
        <div className="text-sm text-adam-text-secondary">
          {currentMessageIndex + 1} / {imageIds.length}
        </div>
      </div>
    </div>
  );
}
