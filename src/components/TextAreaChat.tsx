import React, {
  useState,
  useRef,
  ChangeEvent,
  KeyboardEvent,
  useEffect,
} from 'react';
import { ArrowUp, ImagePlus, Images, Loader2, CircleX } from 'lucide-react';
import { cn, PARAMETRIC_MODELS } from '@/lib/utils';
import { Content, Conversation, Model } from '@shared/types';
import { MessageItem } from '@/types/misc';
import { useToast } from '@/hooks/use-toast';
import { useMutation } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { ModelSelector } from './ModelSelector';
import { Button } from './ui/button';
import { Textarea } from './ui/textarea';
import { Avatar } from './ui/avatar';
import { useItemSelection } from '@/hooks/useItemSelection';
import { AnimatePresence, motion } from 'framer-motion';

interface TextAreaChatProps {
  onSubmit: (content: Content) => void;
  placeholder?: string;
  disabled?: boolean;
  model: Model;
  setModel: (model: Model) => void;
  conversation: Pick<Conversation, 'id' | 'user_id'>;
}

const VALID_IMAGE_FORMATS = [
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/webp',
];

function TextAreaChat({
  onSubmit,
  placeholder = 'What can Adam help you build today?',
  disabled = false,
  model,
  setModel,
  conversation,
}: TextAreaChatProps) {
  const [isFocused, setIsFocused] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [input, setInput] = useState('');
  const [isDragging, setIsDragging] = useState(false);
  const [isDragHover, setIsDragHover] = useState(false);
  const [dropMessageOpacityClass, setDropMessageOpacityClass] = useState(
    'opacity-0 pointer-events-none',
  );
  const [dropMessageTransitionClass, setDropMessageTransitionClass] =
    useState('');
  const prevIsDraggingRef = useRef(isDragging);
  const { toast } = useToast();
  const { images, setImages } = useItemSelection();

  // Check if current model supports thinking
  const selectedModelConfig = PARAMETRIC_MODELS.find((m) => m.id === model);
  const supportsThinking = selectedModelConfig?.supportsThinking ?? false;

  // Refs for the two hot-zones
  const topDropZoneRef = useRef<HTMLDivElement>(null);
  const textAreaContainerZoneRef = useRef<HTMLDivElement>(null);

  // Animation variants for image thumbnails
  const itemAnimationVariants = {
    initial: { opacity: 0, scale: 0.8 },
    animate: {
      opacity: 1,
      scale: 1,
    },
    exit: {
      opacity: 0,
      scale: 0.8,
    },
  };

  // The text currently shown in the placeholder (animates)
  const [placeholderAnim, setPlaceholderAnim] = useState('');
  const [placeholderOpacity, setPlaceholderOpacity] = useState(1);
  const placeholderRef = useRef('');

  // Shared helper that performs the crossfade animation
  const startCrossfade = (target: string) => {
    placeholderRef.current = target;

    // Start fade out
    setPlaceholderOpacity(0);

    // After fade out, update text and fade in
    setTimeout(() => {
      setPlaceholderAnim(target);
      setPlaceholderOpacity(1);
    }, 150);
  };

  // Kick off crossfade effect whenever the target placeholder changes
  useEffect(() => {
    startCrossfade(placeholder);
  }, [placeholder, placeholderAnim]);

  const handleSubmit = async () => {
    // Debug the early return conditions
    const hasNoContent = images.length === 0 && !input?.trim();
    const hasUploadingImages = images.some((img) => img.isUploading);

    if (hasNoContent || disabled || hasUploadingImages) {
      return;
    }
    const content: Content = {
      ...(input.trim() !== '' && { text: input.trim() }),
      ...(images.length > 0 && { images: images.map((img) => img.id) }),
      model: model,
      thinking: supportsThinking, // Automatically enable thinking for models that support it
    };
    onSubmit(content);
    setInput('');
    setImages([]);
  };

  const { mutateAsync: uploadImageAsync } = useMutation({
    mutationFn: async ({ file, id }: { file: File; id: string }) => {
      const { error } = await supabase.storage
        .from('images')
        .upload(`${conversation.user_id}/${conversation.id}/${id}`, file);

      if (error) throw error;

      const reader = new FileReader();
      const urlPromise = new Promise((resolve) => {
        reader.onload = () => {
          resolve(reader.result as string);
        };
      });
      reader.readAsDataURL(file);
      const url = (await urlPromise) as string;

      return url;
    },
    onError: () => {
      toast({
        title: 'Error',
        description: 'Failed to upload image',
        variant: 'destructive',
      });
    },
  });

  const addItems = async (files: FileList) => {
    const newItems = Array.from(files);
    let hasSmallImages = false;
    let hasLargeImages = false;
    let hasInvalidImages = false;
    const MAX_FILE_SIZE = 100 * 1024 * 1024; // 100MB limit

    const validImages = await Promise.all(
      newItems.map(async (file) => {
        // First check file type Must be jpeg, png, gif, or webp.
        if (!file.type.includes('image')) {
          return null;
        }

        if (!VALID_IMAGE_FORMATS.includes(file.type)) {
          hasInvalidImages = true;
          return null;
        }

        // Check file size
        if (file.size > MAX_FILE_SIZE) {
          hasLargeImages = true;
          return null;
        }

        // Check dimensions asynchronously
        return new Promise<File | null>((resolve) => {
          const img = new Image();
          img.src = URL.createObjectURL(file);
          img.onload = () => {
            if (img.naturalWidth < 256 || img.naturalHeight < 256) {
              hasSmallImages = true;
              resolve(null); // Image too small
            } else {
              resolve(file); // Valid image
            }
            URL.revokeObjectURL(img.src);
          };
          img.onerror = () => {
            resolve(null); // Invalid image
            URL.revokeObjectURL(img.src);
          };
        });
      }),
    );

    // Filter out null values (invalid images)
    const filteredImages = validImages.filter(
      (img): img is File => img !== null,
    );

    // Show specific errors first, then generic error only if there are truly invalid file types
    if (hasSmallImages) {
      toast({
        title: 'Image too small',
        description:
          'Some images were not added because they are smaller than 256x256 pixels.',
      });
    } else if (hasLargeImages) {
      toast({
        title: 'Image too large',
        description:
          'Some images were not added because they are larger than 100MB.',
      });
    } else if (hasInvalidImages) {
      toast({
        title: 'Invalid image format',
        description:
          'Some images were not added because they are not valid image formats. Must be jpeg, png, or webp.',
      });
    }

    // Upload each valid image immediately
    filteredImages.forEach(async (file) => {
      const tempId = crypto.randomUUID();
      const url = URL.createObjectURL(file);
      setImages((prevImages) => [
        ...prevImages,
        { id: tempId, isUploading: true, source: 'upload', url },
      ]);
      try {
        const signedUrl = await uploadImageAsync({ file, id: tempId });
        URL.revokeObjectURL(url);
        setImages((prevImages) =>
          prevImages.map((img) =>
            img.id === tempId
              ? { ...img, isUploading: false, url: signedUrl }
              : img,
          ),
        );
      } catch (error) {
        console.error('Error uploading image:', error);
        setImages((prevImages) =>
          prevImages.filter((img) => img.id !== tempId),
        );
      }
    });
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  const handlePaste = (event: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const files = event.clipboardData.files;
    if (files && files.length > 0) {
      event.preventDefault();
      addItems(files);
    }
  };

  const handleDrop = async (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault(); // Signal that this component handled the drop
    const droppedFiles = event.dataTransfer?.files;

    let shouldAddItems = false;
    const target = event.target as Node;

    if (
      topDropZoneRef.current?.contains(target) ||
      textAreaContainerZoneRef.current?.contains(target)
    ) {
      shouldAddItems = true;
    }

    if (shouldAddItems && droppedFiles && droppedFiles.length > 0) {
      await addItems(droppedFiles);
    }

    // Always reset drag states, regardless of whether files were added
    setIsDragging(false);
    setIsDragHover(false);
  };

  const handleItemsChange = (event: ChangeEvent<HTMLInputElement>) => {
    const selectedItems = event.target.files;
    if (selectedItems && selectedItems.length > 0) {
      addItems(selectedItems);
    }
  };

  const handleImageRemoved = async (image: MessageItem) => {
    if (!image.isUploading) {
      // Only try to remove from storage if the item has been uploaded
      if (image.source === 'upload') {
        try {
          await supabase.storage
            .from('images')
            .remove([`${conversation.user_id}/${conversation.id}/${image.id}`]);
        } catch (error) {
          console.error('Error removing image:', error);
        }
      }
      setImages((prevImages) =>
        prevImages.filter((img) => img.id !== image.id),
      );
    }
  };

  // Add global drag-and-drop listeners so that dropping files anywhere on the page is handled.
  useEffect(() => {
    // Prevent default browser behaviour (e.g. opening the image in a new tab)
    const preventDefaults = (e: DragEvent) => {
      e.preventDefault();
    };

    const handleDragEnter = (e: DragEvent) => {
      e.preventDefault();
      setIsDragging(true);
      // When a drag operation newly enters the window, assume it's not hovering
      // over a specific component's hot-zone yet. Hot-zones will override this.
      setIsDragHover(false);
    };

    const handleDragLeave = (e: DragEvent) => {
      e.preventDefault();
      // When leaving the window entirely (relatedTarget is null), reset dragging state
      if (
        (e as unknown as { relatedTarget: Node | null }).relatedTarget === null
      ) {
        setIsDragging(false);
        setIsDragHover(false);
      }
    };

    const handleDropGlobal = async (e: DragEvent) => {
      // If a more specific drop handler (like in TextAreaChat) already handled this event
      // and called e.preventDefault(), the global handler should not interfere.
      if (e.defaultPrevented) {
        return;
      }

      // If we're here, the drop occurred outside a component that handled it.
      // Prevent the browser's default action (e.g., opening the file).
      e.preventDefault();

      // For a global drop outside handled areas, we don't add items.
      // We just clear the overall drag UI state.
      setIsDragging(false);
      setIsDragHover(false);
      // NO call to addItems() here.
    };

    window.addEventListener('dragenter', handleDragEnter);
    window.addEventListener('dragover', preventDefaults);
    window.addEventListener('dragleave', handleDragLeave);
    window.addEventListener('drop', handleDropGlobal);

    return () => {
      window.removeEventListener('dragenter', handleDragEnter);
      window.removeEventListener('dragover', preventDefaults);
      window.removeEventListener('dragleave', handleDragLeave);
      window.removeEventListener('drop', handleDropGlobal);
    };
  }, []);

  useEffect(() => {
    if (images.length === 0) {
      // Case 1: No items are present in the drop zone
      if (isDragging) {
        // If dragging, the message should be visible and can transition
        setDropMessageOpacityClass('opacity-100');
        setDropMessageTransitionClass(
          'transition-opacity duration-200 ease-in-out',
        );
      } else {
        // Not dragging. Message should be hidden.
        if (prevIsDraggingRef.current) {
          // If it WAS dragging and now it's not, it should fade out.
          setDropMessageTransitionClass(
            'transition-opacity duration-200 ease-in-out',
          );
          setDropMessageOpacityClass('opacity-0 pointer-events-none');
        } else {
          // If it was NOT dragging and still isn't (e.g., mounting fresh after image removal),
          // it should be instantly hidden, no transition.
          setDropMessageTransitionClass('');
          setDropMessageOpacityClass('opacity-0 pointer-events-none');
        }
      }
    } else {
      // Case 2: Items ARE present in the drop zone, message should be instantly hidden.
      setDropMessageTransitionClass('');
      setDropMessageOpacityClass('opacity-0 pointer-events-none');
    }
    prevIsDraggingRef.current = isDragging;
  }, [isDragging, images.length]);

  return (
    <div
      className="group relative"
      onDrop={handleDrop}
      onDragEnter={(event) => {
        event.preventDefault();
        setIsDragging(true);
      }}
      onDragOver={(event) => {
        event.preventDefault();
        setIsDragging(true);
      }}
      onDragLeave={(event) => {
        event.preventDefault();
        // If the drag operation leaves the bounds of this entire component,
        // then isDragHover should definitely be false.
        if (!event.currentTarget.contains(event.relatedTarget as Node)) {
          setIsDragHover(false);
        }
      }}
      onClick={() => {
        textareaRef.current?.focus();
      }}
    >
      <div
        ref={topDropZoneRef}
        className={cn(
          'mx-auto flex w-[95%] min-w-52 overflow-hidden rounded-t-xl border-x-2 border-t-2',
          'transition-[height,opacity,border-color,background-color] duration-200 ease-in-out',
          disabled
            ? 'h-0 border-transparent bg-transparent opacity-0'
            : !isDragging && images.length === 0
              ? 'h-0 border-transparent bg-transparent opacity-0'
              : isDragging
                ? isDragHover
                  ? 'h-20 border-[#00A6FF] bg-[rgba(0,166,255,0.24)] opacity-100' // Blue, full height
                  : 'h-20 border-[#0077B7] bg-[rgba(0,166,255,0.12)] opacity-100' // Intermediate blue, full height
                : images.length > 0
                  ? 'h-20 border-adam-neutral-700 bg-adam-neutral-950 opacity-100'
                  : 'h-0 border-transparent bg-transparent opacity-0',
        )}
        onDragEnter={(event) => {
          if (isDragging) {
            event.preventDefault();
            setIsDragHover(true);
          }
        }}
        onDragOver={(event) => {
          if (isDragging) {
            event.preventDefault();
            setIsDragHover(true);
          }
        }}
        onDragLeave={(event) => {
          if (isDragging) {
            event.preventDefault();
            if (!event.currentTarget.contains(event.relatedTarget as Node)) {
              setIsDragHover(false);
            }
          }
        }}
      >
        {!disabled && (
          <>
            {/* Case 1: Dragging, and items are ALREADY present -> Show "Add more images" prompt */}
            {isDragging && images.length > 0 ? (
              <div
                className={cn(
                  'flex h-full w-full flex-row items-center justify-center gap-2', // Ensure it fills parent
                  // Opacity is handled by the parent's transition when it appears/disappears due to isDragging
                )}
              >
                <Images
                  className="h-5 w-5"
                  style={{
                    color: isDragHover ? '#00A6FF' : 'rgba(0, 166, 255, 0.85)',
                  }}
                />
                <p
                  className="text-sm font-normal"
                  style={{
                    color: isDragHover ? '#00A6FF' : 'rgba(0, 166, 255, 0.85)',
                  }}
                >
                  Add more images here
                </p>
              </div>
            ) : /* Case 2: No items (images are zero) -> Show original "Drop images and 3D models here" logic */
            images.length === 0 ? (
              <div
                className={cn(
                  'flex h-full w-full flex-row items-center justify-center gap-2', // Ensure it fills parent
                  dropMessageTransitionClass,
                  dropMessageOpacityClass,
                )}
              >
                <Images
                  className="h-5 w-5"
                  style={{
                    color: isDragHover ? '#00A6FF' : 'rgba(0, 166, 255, 0.85)',
                  }}
                />
                <p
                  className="text-sm font-normal"
                  style={{
                    color: isDragHover ? '#00A6FF' : 'rgba(0, 166, 255, 0.85)',
                  }}
                >
                  Drop images and 3D models here
                </p>
              </div>
            ) : (
              /* Case 3: Items are present, and NOT dragging -> Show thumbnails */
              images.length > 0 && (
                <div
                  className={cn(
                    'flex w-full items-center gap-4 overflow-x-auto overflow-y-hidden p-4',
                    // Opacity dimming logic can remain if desired, or be simplified
                    isDragging && images.length > 0
                      ? 'opacity-60'
                      : 'opacity-100',
                    'transition-opacity duration-150',
                  )}
                >
                  <AnimatePresence>
                    {' '}
                    {images.map((image) => (
                      <motion.div
                        key={`image-${image.id}`}
                        className="relative h-12 w-12 flex-shrink-0"
                        variants={itemAnimationVariants}
                        initial="initial"
                        animate="animate"
                        exit="exit"
                        layout
                      >
                        <img
                          src={image.url}
                          alt="Image"
                          className="h-12 w-12 rounded-md object-cover"
                        />
                        {image.isUploading && (
                          <div className="absolute inset-0 flex items-center justify-center rounded-md bg-black/50">
                            <Loader2 className="h-4 w-4 animate-spin text-white" />
                          </div>
                        )}
                        <button
                          onClick={() => handleImageRemoved(image)}
                          disabled={image.isUploading}
                          className={cn(
                            'absolute right-[-0.50rem] top-[-0.50rem] rounded-full border border-adam-neutral-500 bg-adam-neutral-500 text-white transition-colors duration-200 hover:border-adam-neutral-700 hover:bg-adam-neutral-700',
                            image.isUploading && 'opacity-50',
                          )}
                        >
                          <CircleX className="h-4 w-4 stroke-[1.5]" />
                        </button>
                      </motion.div>
                    ))}
                  </AnimatePresence>
                </div>
              )
            )}
          </>
        )}
      </div>
      <div
        ref={textAreaContainerZoneRef}
        className={cn(
          'relative rounded-2xl border-2',
          isFocused
            ? 'border-adam-blue shadow-[inset_0px_0px_8px_0px_rgba(0,0,0,0.08)]'
            : 'border-adam-neutral-700 shadow-[inset_0px_0px_8px_0px_rgba(0,0,0,0.08)] hover:border-adam-neutral-400',
          'bg-adam-background-2 transition-all duration-300',
        )}
        onDragEnter={(event) => {
          if (isDragging) {
            event.preventDefault();
            setIsDragHover(true);
          }
        }}
        onDragOver={(event) => {
          if (isDragging) {
            event.preventDefault();
            setIsDragHover(true);
          }
        }}
        onDragLeave={(event) => {
          if (isDragging) {
            event.preventDefault();
            if (!event.currentTarget.contains(event.relatedTarget as Node)) {
              setIsDragHover(false);
            }
          }
        }}
      >
        <div className="flex select-none items-center justify-between p-2">
          <Avatar className="h-8 w-8">
            <div className="h-full w-full p-1.5">
              <img
                src={`${import.meta.env.BASE_URL}/Adam-Logo.png`}
                alt="Adam Logo"
                className="h-full w-full object-contain"
              />
            </div>
          </Avatar>
          <div className="relative grid w-full">
            <Textarea
              disabled={disabled}
              value={input}
              ref={textareaRef}
              translate="no"
              onKeyDown={handleKeyDown}
              onPaste={handlePaste}
              onBlur={() => setIsFocused(false)}
              onFocus={() => setIsFocused(true)}
              onChange={(e) => {
                setInput(e.target.value);
              }}
              placeholder={placeholderAnim}
              className="hide-scrollbar z-40 block h-auto min-h-0 w-full resize-none overflow-hidden whitespace-pre-line break-words border-none bg-adam-neutral-800 bg-transparent px-3 py-2 text-base text-adam-text-primary outline-none transition-all duration-500 placeholder:text-adam-text-secondary placeholder:opacity-[var(--placeholder-opacity)] placeholder:transition-all placeholder:duration-300 placeholder:ease-in-out hover:placeholder:blur-[0.2px] focus:border-0 focus:shadow-none focus:outline-none focus:ring-0 focus-visible:outline-none focus-visible:ring-0 focus-visible:ring-offset-0 dark:text-gray-200 sm:px-4 sm:text-sm"
              style={
                {
                  '--placeholder-opacity': placeholderOpacity,
                  gridArea: '1 / -1',
                } as React.CSSProperties
              }
              rows={1}
            />
            <div
              className="pointer-events-none col-start-1 row-start-1 w-full overflow-hidden whitespace-pre-wrap break-words px-3 py-2 text-sm opacity-0 sm:px-4"
              style={{ gridArea: '1 / -1' }}
            >
              <span>{input}</span>
              <br />
            </div>
          </div>
        </div>
        <div className="flex items-center justify-between border-t border-[#2a2a2a] p-3">
          <div className="flex items-center gap-3">
            <div
              className={cn(
                'transition-all duration-300 ease-out',
                'pointer-events-auto scale-100 opacity-100',
              )}
            >
              <Button
                variant="outline"
                className="flex h-8 w-8 items-center gap-2 rounded-lg border border-[#2a2a2a] bg-adam-background-2 p-0 text-sm text-adam-text-secondary hover:bg-adam-bg-secondary-dark"
                onClick={(e) => {
                  e.stopPropagation();
                  const input = document.createElement('input');
                  input.type = 'file';
                  input.accept = VALID_IMAGE_FORMATS.join(', ');
                  input.onchange = (event) => {
                    handleItemsChange(
                      event as unknown as ChangeEvent<HTMLInputElement>,
                    );
                  };
                  input.click();
                }}
                disabled={disabled}
              >
                <ImagePlus className="h-5 w-5" />
              </Button>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <ModelSelector
              disabled={disabled}
              models={PARAMETRIC_MODELS}
              selectedModel={model}
              onModelChange={setModel}
              focused={isFocused}
            />
            {/* Enhanced submit button */}
            <button
              onClick={() => {
                handleSubmit();
              }}
              className={cn(
                'flex h-8 w-8 transform items-center justify-center rounded-lg bg-adam-neutral-700 p-1 text-white transition-all duration-300 hover:scale-105 hover:bg-adam-blue/90 disabled:opacity-50 disabled:hover:scale-100 disabled:hover:bg-adam-blue',
                images.some((img) => img.isUploading) && 'opacity-50',
              )}
              disabled={
                (images.length === 0 && !input?.trim()) ||
                images.some((img) => img.isUploading) ||
                disabled
              }
            >
              <ArrowUp className="h-5 w-5" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default TextAreaChat;
