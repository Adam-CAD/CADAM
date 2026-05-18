import { useCurrentMessage } from '@/contexts/CurrentMessageContext';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { ImageGallery } from '@/components/viewer/ImageGallery';
import { OpenSCADPreview } from './OpenSCADViewer';
import OpenSCADError from '@/lib/OpenSCADError';
import {
  Sheet,
  SheetDescription,
  SheetTitle,
  SheetHeader,
} from '@/components/ui/sheet';
import { useEffect, useState, useRef } from 'react';
import { ParameterSheetContent } from '@/components/parameter/ParameterSheetContent';
import { Message, Parameter } from '@shared/types';
import * as SheetPrimitive from '@radix-ui/react-dialog';
import { cn } from '@/lib/utils';
import { Separator } from '@/components/ui/separator';
import { DxfExporter } from '@/utils/downloadUtils';

interface ParametricPreviewDialogProps {
  onSubmit: (message: Message | null, parameters: Parameter[]) => void;
  currentOutput?: Blob;
  dxfExporter?: DxfExporter | null;
  onOutputChange?: (output: Blob | undefined) => void;
  onDxfExportChange?: (exporter: DxfExporter | null) => void;
  fixError?: (error: OpenSCADError) => void;
}

export function ParametricPreviewDialog({
  onSubmit,
  currentOutput,
  dxfExporter,
  onOutputChange,
  onDxfExportChange,
  fixError,
}: ParametricPreviewDialogProps) {
  const { currentMessage, setCurrentMessage } = useCurrentMessage();
  const [open, setOpen] = useState(true);
  const [isDragging, setIsDragging] = useState(false);
  const [dragDistance, setDragDistance] = useState(0);
  const touchStartY = useRef<number>(0);

  useEffect(() => {
    setOpen(!!currentMessage);
  }, [currentMessage]);

  const handleOpenChange = () => {
    if (open) {
      setOpen(false);
      setTimeout(() => {
        setCurrentMessage(null);
        setDragDistance(0);
        setIsDragging(false);
      }, 150);
    }
  };

  const handleTouchStart = (e: React.TouchEvent) => {
    touchStartY.current = e.touches[0].clientY;
    setIsDragging(true);
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (!isDragging) return;

    const currentY = e.touches[0].clientY;
    const distance = currentY - touchStartY.current;
    setDragDistance(distance);
  };

  const handleTouchEnd = () => {
    if (!isDragging) return;

    if (dragDistance > 0) {
      handleOpenChange();
    }
  };

  // Calculate dynamic height based on drag distance
  const calculateHeight = () => {
    if (!isDragging) {
      return 'calc(100dvh - 56px)';
    }

    // If dragging down (positive distance), reduce height
    if (dragDistance > 0) {
      const newHeight = Math.max(56, window.innerHeight - 56 - dragDistance);
      return `${newHeight}px`;
    }

    // If dragging up (negative distance), keep at original height
    return 'calc(100dvh - 56px)';
  };

  if (!currentMessage) {
    return null;
  }

  return (
    <>
      {currentMessage.content.images && (
        <Dialog open={open} onOpenChange={handleOpenChange}>
          <DialogContent className="mx-auto w-[calc(100%-4rem)] max-w-none border-none bg-transparent p-0 [&>button>svg]:h-6 [&>button>svg]:w-6 [&>button]:h-8 [&>button]:w-8 [&>button]:p-1 [&>button]:text-white [&>button]:opacity-70 [&>button]:hover:opacity-100">
            <DialogHeader className="hidden">
              <DialogTitle>Parametric Preview</DialogTitle>
              <DialogDescription>Parametric Preview</DialogDescription>
            </DialogHeader>
            <div className="flex h-full w-full flex-1 flex-col items-center justify-center gap-10">
              <ImageGallery imageIds={currentMessage.content.images} />
            </div>
          </DialogContent>
        </Dialog>
      )}
      {currentMessage.content.artifact && (
        <Sheet open={open} onOpenChange={handleOpenChange}>
          <SheetPrimitive.Portal>
            <SheetPrimitive.Content
              className={cn(
                'fixed z-50 shadow-[0_0_10px_rgba(0,0,0,0.5)] transition ease-in-out data-[state=closed]:duration-300 data-[state=open]:duration-500 data-[state=open]:animate-in data-[state=closed]:animate-out',
                'inset-x-0 bottom-0 data-[state=closed]:slide-out-to-bottom data-[state=open]:slide-in-from-bottom',
                'rounded-t-3xl bg-adam-bg-secondary-dark',
              )}
              style={{
                height: calculateHeight(),
              }}
            >
              <SheetHeader className="hidden">
                <SheetTitle>Parametric Preview</SheetTitle>
                <SheetDescription>Parametric Preview</SheetDescription>
              </SheetHeader>
              <SheetPrimitive.Close
                onTouchStart={handleTouchStart}
                onTouchMove={handleTouchMove}
                onTouchEnd={handleTouchEnd}
                className="flex w-full justify-center rounded-sm opacity-70 transition-opacity hover:opacity-100"
              >
                <svg
                  width="32"
                  height="32"
                  viewBox="0 0 24 24"
                  fill="none"
                  xmlns="http://www.w3.org/2000/svg"
                >
                  <path
                    d="M21.5262 10.75L11.9999 16L2.47363 10.75"
                    stroke="currentColor"
                    strokeLinecap="round"
                    strokeWidth="2"
                    className="text-adam-neutral-400"
                  />
                </svg>
              </SheetPrimitive.Close>
              <div className="mx-auto flex h-full max-w-xl flex-col items-center pb-6">
                <div className="h-[40dvh] min-h-[40dvh] w-full px-4">
                  <div className="h-full w-full overflow-hidden rounded-xl">
                    <OpenSCADPreview
                      scadCode={currentMessage.content.artifact.code}
                      color="#F8248A"
                      onOutputChange={onOutputChange}
                      onDxfExportChange={onDxfExportChange}
                      fixError={fixError}
                      isMobile={true}
                      backgroundColor="#212121"
                    />
                  </div>
                </div>
                <div className="w-full px-4">
                  <Separator className="w-full bg-adam-neutral-700" />
                </div>
                <ParameterSheetContent
                  parameters={currentMessage.content.artifact.parameters ?? []}
                  onSubmit={onSubmit}
                  currentOutput={currentOutput}
                  dxfExporter={dxfExporter}
                />
              </div>
            </SheetPrimitive.Content>
          </SheetPrimitive.Portal>
        </Sheet>
      )}
    </>
  );
}
