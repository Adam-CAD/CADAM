import React, {
  useState,
  useRef,
  KeyboardEvent,
  useEffect,
  useMemo,
  useCallback,
} from 'react';
import {
  ArrowUp,
  ImagePlus,
  Images,
  Loader2,
  Square,
  CircleX,
  Wand2,
  Box,
  X,
} from 'lucide-react';
import {
  cn,
  CREATIVE_MODELS,
  PARAMETRIC_MODELS,
  parametricModelSupportsVision,
} from '@/lib/utils';
import { CreativeModel, MeshFileType, Model } from '@shared/types';
import type { AppUIMessage } from '@shared/chatAi';
import { imageFilePartUrl } from '@shared/imageRefs';
import {
  shouldShowPolygonControls,
  getModelDefaultPolygonCount,
  getMaxPolygonCount,
  isCreativeModel,
} from '@/constants/meshConstants';
import { MessageItem } from '../types/misc.ts';
import { useToast } from '@/hooks/use-toast';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { Slider } from '@/components/ui/slider';
import { Input } from '@/components/ui/input';
import { useMutation } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { ModelSelector } from '@/components/ModelSelector';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Avatar } from '@/components/ui/avatar';
import { useItemSelection } from '@/hooks/useItemSelection';
import {
  generatePreview,
  parseSTL,
  renderMultipleAngles,
  BoundingBox,
} from '@/utils/meshUtils';
import { useMeshFiles } from '@/contexts/MeshFilesContext';
import { AnimatePresence, motion } from 'framer-motion';
import { apiJson } from '@/services/api';
import { z } from 'zod';

const promptResponseSchema = z.object({ prompt: z.string().optional() });

interface TextAreaChatProps {
  type: 'parametric' | 'creative';
  onSubmit: (parts: AppUIMessage['parts']) => void;
  onFocus?: () => void;
  isLoading?: boolean;
  placeholder?: string;
  stopGenerating?: () => void;
  disabled?: boolean;
  model: Model;
  setModel: (model: Model) => void;
  showPromptGenerator?: boolean;
  showFullLabels?: boolean; // Controls whether to show full text labels on buttons
  onTypeChange?: (type: 'parametric' | 'creative') => void;
  conversation: {
    id: string;
    user_id: string;
  };
}

// SVG Icon component for the quads/polys toggle
const QuadsPolysSvg = ({ color = '#D7D7D7' }: { color?: string }) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width="16"
    height="16"
    viewBox="0 0 16 16"
    fill="none"
  >
    <path
      d="M8 2V14"
      stroke={color}
      strokeLinecap="round"
      strokeLinejoin="round"
    />
    <path
      d="M2 8H14"
      stroke={color}
      strokeLinecap="round"
      strokeLinejoin="round"
    />
    <path
      d="M12.6667 2H3.33333C2.59695 2 2 2.59695 2 3.33333V12.6667C2 13.403 2.59695 14 3.33333 14H12.6667C13.403 14 14 13.403 14 12.6667V3.33333C14 2.59695 13.403 2 12.6667 2Z"
      stroke={color}
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

// SVG Icon component for the polygon count toggle
const PolygonCountSvg = ({ color = '#D7D7D7' }: { color?: string }) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width="16"
    height="16"
    viewBox="0 0 16 16"
    fill="none"
  >
    <g clipPath="url(#clip0_17634_35890)">
      <path
        d="M1.66651 11.2524C1.58733 11.2062 1.51853 11.1441 1.46442 11.0701C1.41031 10.9961 1.37205 10.9117 1.35203 10.8222C1.33201 10.7328 1.33065 10.6401 1.34806 10.5501C1.36546 10.4601 1.40125 10.3746 1.45317 10.2991L7.45317 1.61908C7.51461 1.53106 7.5964 1.45917 7.69157 1.40954C7.78675 1.3599 7.8925 1.33398 7.99984 1.33398C8.10718 1.33398 8.21294 1.3599 8.30811 1.40954C8.40329 1.45917 8.48507 1.53106 8.54651 1.61908L14.5465 10.2924C14.5996 10.3682 14.6363 10.4542 14.6543 10.5449C14.6723 10.6356 14.6712 10.7291 14.6512 10.8194C14.6311 10.9097 14.5925 10.9948 14.5377 11.0693C14.483 11.1439 14.4133 11.2062 14.3332 11.2524L8.65984 14.4924C8.45874 14.607 8.23128 14.6672 7.99984 14.6672C7.7684 14.6672 7.54094 14.607 7.33984 14.4924L1.66651 11.2524Z"
        stroke={color}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M8 1.33398V14.6673"
        stroke={color}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </g>
    <defs>
      <clipPath id="clip0_17634_35890">
        <rect width="16" height="16" fill="white" />
      </clipPath>
    </defs>
  </svg>
);

// Polygon Input State Machine
type PolygonInputState = { type: 'idle' } | { type: 'editing'; value: string };

// Polygon Button Component
interface PolygonButtonProps {
  polygonCount: number;
  meshTopology: 'quads' | 'polys';
  model: CreativeModel;
  showFullLabels: boolean;
  isLoading: boolean;
  disabled: boolean;
  onPolygonCountChange: (count: number) => void;
  onReset: () => void;
}

// Quads Button Component
interface QuadsButtonProps {
  meshTopology: 'quads' | 'polys';
  showFullLabels: boolean;
  isLoading: boolean;
  disabled: boolean;
  onToggle: () => void;
}

const QuadsButton = ({
  meshTopology,
  showFullLabels,
  isLoading,
  disabled,
  onToggle,
}: QuadsButtonProps) => {
  const isQuadsEnabled = meshTopology === 'quads';

  const buttonContent = (
    <button
      onClick={onToggle}
      disabled={isLoading || disabled}
      aria-pressed={isQuadsEnabled}
      className={cn(
        'flex h-8 items-center gap-2 rounded-full border px-2 text-sm transition-colors duration-200',
        'hover:bg-adam-bg-secondary-dark focus:outline-none focus-visible:outline-none focus-visible:ring-0',
        'items-center justify-center',
        isQuadsEnabled
          ? 'border-transparent bg-adam-blue-dark/15 hover:bg-adam-blue-dark/20'
          : 'border-[#2a2a2a] bg-transparent',
        showFullLabels && 'pr-[8px]',
      )}
    >
      <QuadsPolysSvg color={isQuadsEnabled ? '#00A6FF' : '#D7D7D7'} />
      {showFullLabels && (
        <span
          className={cn(
            'hidden text-xs text-adam-text-primary lg:inline',
            isQuadsEnabled && 'text-[#00A6FF]',
          )}
        >
          Quads
        </span>
      )}
    </button>
  );

  // Component abstraction instead of nested ternaries
  if (showFullLabels) {
    return buttonContent;
  }

  return (
    <Tooltip>
      <TooltipTrigger asChild>{buttonContent}</TooltipTrigger>
      <TooltipContent>
        {isQuadsEnabled ? 'Quad topology enabled' : 'Enable quad topology'}
      </TooltipContent>
    </Tooltip>
  );
};

const PolygonButton = ({
  polygonCount,
  meshTopology,
  model,
  showFullLabels,
  isLoading,
  disabled,
  onPolygonCountChange,
  onReset,
}: PolygonButtonProps) => {
  // Computed values - no useState needed
  const maxPolygonCount = getMaxPolygonCount(model, meshTopology);
  // Use model-specific default for determining if value is custom
  const defaultPolygonCount = getModelDefaultPolygonCount(model, meshTopology);
  const maxInputValue = Math.floor(maxPolygonCount / 1000);
  const isCustom = polygonCount !== defaultPolygonCount;

  // Only state needed - popover open/closed and input editing
  const [isPopoverOpen, setIsPopoverOpen] = useState(false);
  const [isSliderDragging, setIsSliderDragging] = useState(false);
  const [closeGuardUntil, setCloseGuardUntil] = useState<number>(0);
  const [inputState, setInputState] = useState<PolygonInputState>({
    type: 'idle',
  });

  const formatPolygonCount = (count: number) => {
    return count >= 1000 ? `${Math.floor(count / 1000)}K` : count.toString();
  };

  const handleSliderChange = (value: number[]) => {
    onPolygonCountChange(value[0]);
  };

  const handleInputStart = (e: React.FocusEvent<HTMLInputElement>) => {
    setInputState({
      type: 'editing',
      value: Math.floor(polygonCount / 1000).toString(),
    });
    // Auto-select all text when focused
    e.target.select();
  };

  const handleInputChange = (value: string) => {
    if (inputState.type === 'editing') {
      if (value === '' || (/^\d+$/.test(value) && parseInt(value, 10) >= 0)) {
        setInputState({ type: 'editing', value });
      }
    }
  };

  const handleInputComplete = () => {
    if (inputState.type === 'editing') {
      const numValue = parseInt(inputState.value, 10);
      if (!isNaN(numValue) && numValue >= 1 && numValue <= maxInputValue) {
        onPolygonCountChange(numValue * 1000);
      }
      setInputState({ type: 'idle' });
    }
  };

  const handleInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleInputComplete();
      setIsPopoverOpen(false); // Close the popover
    }
  };

  const buttonContent = (
    <button
      onClick={() => setIsPopoverOpen(true)}
      disabled={isLoading || disabled}
      className={cn(
        'flex h-8 items-center gap-[6px] rounded-full border px-2 text-sm transition-colors duration-200',
        'hover:bg-adam-bg-secondary-dark focus:outline-none focus-visible:outline-none focus-visible:ring-0',
        'items-center justify-center',
        // When popover is open and value is at model-specific default or input is empty while editing,
        // highlight with neutral-800 background
        isPopoverOpen &&
          (!isCustom ||
            (inputState.type === 'editing' && inputState.value === ''))
          ? 'border-transparent bg-adam-neutral-800 hover:bg-adam-neutral-700'
          : isCustom
            ? 'border-transparent bg-adam-blue-dark/15 hover:bg-adam-blue-dark/20'
            : 'border-[#2a2a2a] bg-transparent',
        isCustom && 'pr-[10px]',
      )}
    >
      <PolygonCountSvg color={isCustom ? '#00A6FF' : '#D7D7D7'} />
      {showFullLabels && (
        <span
          className={cn(
            'hidden text-xs lg:inline',
            isCustom ? 'text-[#00A6FF]' : 'text-adam-text-primary',
          )}
        >
          {isCustom ? formatPolygonCount(polygonCount) : 'Polygons'}
        </span>
      )}
      {isCustom && (
        <span
          className="ml-0.5 flex h-3.5 w-3.5 items-center justify-center"
          title={`Reset to default (${formatPolygonCount(defaultPolygonCount)})`}
        >
          <X
            className="h-3.5 w-3.5 cursor-pointer text-[#00A6FF] transition-opacity hover:opacity-70"
            onClick={(e) => {
              e.stopPropagation();
              onReset();
            }}
          />
        </span>
      )}
    </button>
  );

  const popoverContent = (
    <PopoverContent
      align="start"
      className="flex w-56 flex-col items-start gap-3 self-stretch rounded-full border-0 bg-adam-neutral-700 p-2 shadow-none"
      onOpenAutoFocus={(e) => e.preventDefault()}
      onInteractOutside={(e) => {
        // Keep popover open if user is dragging or within post-drag guard window
        if (isSliderDragging || Date.now() < closeGuardUntil) {
          e.preventDefault();
        }
      }}
    >
      <div className="flex w-full flex-col gap-3">
        <div
          className="flex h-6 items-center gap-3"
          data-polygon-popover-interactive
        >
          <Slider
            value={[Math.max(1000, polygonCount)]}
            defaultValue={[defaultPolygonCount]}
            onValueChange={handleSliderChange}
            onValueCommit={handleSliderChange}
            max={maxPolygonCount}
            min={1000}
            step={1000}
            hideDefaultMarker
            variant="capsule"
            className="flex-1"
            onPointerDown={() => setIsSliderDragging(true)}
            onPointerUp={() => {
              setIsSliderDragging(false);
              setCloseGuardUntil(Date.now() + 150);
            }}
          />
          <div className="flex items-center gap-1 pr-2">
            <Input
              type="text"
              value={
                inputState.type === 'editing'
                  ? inputState.value
                  : Math.floor(polygonCount / 1000).toString()
              }
              onChange={(e) => handleInputChange(e.target.value)}
              onFocus={(e) => handleInputStart(e)}
              onBlur={handleInputComplete}
              onKeyDown={handleInputKeyDown}
              onClick={(e) => {
                e.stopPropagation();
                // Also select all text when clicking on the input
                (e.target as HTMLInputElement).select();
              }}
              onMouseDown={(e) => e.stopPropagation()}
              className="h-6 w-12 rounded-md border border-adam-neutral-700 bg-adam-neutral-800 px-1 py-0 text-center text-xs text-adam-text-primary selection:bg-[#70B8FF7A] selection:text-white focus:ring-1 focus:ring-adam-blue/20"
            />
            <span className="text-xs">k</span>
          </div>
        </div>
      </div>
    </PopoverContent>
  );

  // Component abstraction instead of nested ternaries
  if (showFullLabels) {
    return (
      <div className="flex items-center gap-1">
        <Popover open={isPopoverOpen} onOpenChange={setIsPopoverOpen}>
          <PopoverTrigger asChild>{buttonContent}</PopoverTrigger>
          {popoverContent}
        </Popover>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-1">
      <Tooltip>
        <TooltipTrigger asChild>
          <div>
            <Popover open={isPopoverOpen} onOpenChange={setIsPopoverOpen}>
              <PopoverTrigger asChild>{buttonContent}</PopoverTrigger>
              {popoverContent}
            </Popover>
          </div>
        </TooltipTrigger>
        <TooltipContent>Adjust poly count</TooltipContent>
      </Tooltip>
    </div>
  );
};

const SUPPORTED_MESH_EXTENSIONS = ['.glb', '.stl', '.obj', '.fbx'] as const;

const VALID_IMAGE_FORMATS = [
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/webp',
];

const getMeshFileType = (filename: string): MeshFileType => {
  const lowerFilename = filename.toLowerCase();
  if (lowerFilename.endsWith('.stl')) return 'stl';
  if (lowerFilename.endsWith('.obj')) return 'obj';
  if (lowerFilename.endsWith('.fbx')) return 'fbx';
  return 'glb';
};

const isSupportedMeshFile = (
  filename: string,
  type: 'creative' | 'parametric',
): boolean => {
  const lowerFilename = filename.toLowerCase();
  if (type === 'creative') {
    return SUPPORTED_MESH_EXTENSIONS.some((ext) => lowerFilename.endsWith(ext));
  }
  // Parametric mode only supports STL (for OpenSCAD import)
  return lowerFilename.endsWith('.stl');
};

function TextAreaChat({
  onSubmit,
  onFocus,
  isLoading = false,
  placeholder = 'What can Adam help you build today?',
  type,
  stopGenerating,
  disabled = false,
  model,
  setModel,
  showPromptGenerator = false,
  showFullLabels = false,
  onTypeChange,
  conversation,
}: TextAreaChatProps) {
  const [isFocused, setIsFocused] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [input, setInput] = useState('');
  const [isDragging, setIsDragging] = useState(false);
  const [isDragHover, setIsDragHover] = useState(false);
  const [isGeneratingPrompt, setIsGeneratingPrompt] = useState(false);
  const [dropMessageOpacityClass, setDropMessageOpacityClass] = useState(
    'opacity-0 pointer-events-none',
  );
  const [dropMessageTransitionClass, setDropMessageTransitionClass] =
    useState('');
  const prevIsDraggingRef = useRef(isDragging);
  const { toast } = useToast();
  const { session } = useAuth();
  const { images, mesh, setImages, setMesh } = useItemSelection();
  const meshFiles = useMeshFiles();
  const creativeModel =
    type === 'creative' && isCreativeModel(model) ? model : null;
  const showPolygonControls = creativeModel
    ? shouldShowPolygonControls(creativeModel)
    : false;

  // Parametric mode: bounding box and filename from STL parsing
  const [meshBoundingBox, setMeshBoundingBox] = useState<BoundingBox | null>(
    null,
  );
  const [meshFilename, setMeshFilename] = useState<string | null>(null);

  // Quads vs Polys toggle state (only for ultra model)
  const [meshTopology, setMeshTopology] = useState<'quads' | 'polys'>(() => {
    // Default to 'polys' (quads disabled by default)
    // Only use localStorage if it's explicitly set to 'quads'
    if (typeof window !== 'undefined') {
      const stored = localStorage.getItem('adam-mesh-topology');
      // Only return 'quads' if explicitly stored, otherwise default to 'polys'
      return stored === 'quads' ? 'quads' : 'polys';
    }
    return 'polys';
  });

  // Polygon count state - single source of truth for user overrides
  const [polygonOverrides, setPolygonOverrides] = useState<
    Record<string, number>
  >(() => {
    if (typeof window !== 'undefined') {
      try {
        const stored = localStorage.getItem('adam-polygon-overrides');
        if (stored) {
          const parsed = JSON.parse(stored);
          // Validate that it's an object with number values
          if (typeof parsed === 'object' && parsed !== null) {
            const isValid = Object.entries(parsed).every(
              ([key, value]) =>
                typeof key === 'string' && typeof value === 'number',
            );
            return isValid ? parsed : {};
          }
        }
      } catch (error) {
        console.warn(
          'Failed to parse polygon overrides from localStorage, resetting:',
          error,
        );
        localStorage.removeItem('adam-polygon-overrides');
      }
    }
    return {};
  });

  // Set polygon count for current model+topology combination
  const setPolygonCountForCurrentModel = useCallback(
    (count: number) => {
      if (!creativeModel) return;
      const modelTopologyKey = `${creativeModel}-${meshTopology}`;
      const defaultCount = getModelDefaultPolygonCount(
        creativeModel,
        meshTopology,
      );

      // If setting to default, remove the override instead of storing it
      if (count === defaultCount) {
        setPolygonOverrides((prev) => {
          const { [modelTopologyKey]: _, ...rest } = prev;
          return rest;
        });
      } else {
        setPolygonOverrides((prev) => ({
          ...prev,
          [modelTopologyKey]: count,
        }));
      }
    },
    [creativeModel, meshTopology],
  );

  // Persist meshTopology changes to localStorage
  const handleMeshTopologyChange = useCallback(
    (newTopology: 'quads' | 'polys') => {
      setMeshTopology(newTopology);
      if (!creativeModel) return;

      // Reset polygon count to the model-specific default for the new topology.
      const modelTopologyKey = `${creativeModel}-${newTopology}`;
      setPolygonOverrides((prev) => {
        const { [modelTopologyKey]: _, ...rest } = prev;
        return rest;
      });
    },
    [creativeModel],
  );

  // Derived polygon count - no useState needed, calculated from model + topology + overrides
  const polygonCount = useMemo(() => {
    if (!creativeModel) return 0;
    const modelTopologyKey = `${creativeModel}-${meshTopology}`;
    const userOverride = polygonOverrides[modelTopologyKey];
    return (
      userOverride ?? getModelDefaultPolygonCount(creativeModel, meshTopology)
    );
  }, [creativeModel, meshTopology, polygonOverrides]);

  // Persist polygon overrides to localStorage
  useEffect(() => {
    if (typeof window !== 'undefined') {
      localStorage.setItem(
        'adam-polygon-overrides',
        JSON.stringify(polygonOverrides),
      );
    }
  }, [polygonOverrides]);

  // Persist mesh topology to localStorage
  useEffect(() => {
    if (typeof window !== 'undefined') {
      localStorage.setItem('adam-mesh-topology', meshTopology);
    }
  }, [meshTopology]);

  // Reset polygon count to default for current model and topology
  const resetPolygonCount = useCallback(() => {
    if (!creativeModel) return;
    const modelTopologyKey = `${creativeModel}-${meshTopology}`;
    setPolygonOverrides((prev) => {
      const { [modelTopologyKey]: _, ...rest } = prev;
      return rest;
    });
  }, [creativeModel, meshTopology]);

  // When model changes, clear any polygon overrides to use the new model's defaults
  useEffect(() => {
    if (!creativeModel) return;

    // Clear all overrides when switching models to ensure we use the new model's defaults
    setPolygonOverrides({});
  }, [creativeModel]);

  // Computed polygon values for server submission
  const maxPolygonCount = creativeModel
    ? getMaxPolygonCount(creativeModel, meshTopology)
    : 0;

  // Refs for the two hot-zones
  const topDropZoneRef = useRef<HTMLDivElement>(null);
  const textAreaContainerZoneRef = useRef<HTMLDivElement>(null);

  // Animation variants for image/mesh thumbnails
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

  const memoizedModels = useMemo(() => {
    if (type === 'creative') {
      return CREATIVE_MODELS;
    }
    return PARAMETRIC_MODELS;
  }, [type]);

  // ------------------------------------------------------------
  // Placeholder – Typed-out Animation
  // When the target placeholder (based on mode & image state)
  // changes, we progressively reveal each character so it looks
  // like it's being typed in real-time. This gives users a more
  // delightful sense of state change without abrupt flashes.
  // ------------------------------------------------------------

  // Helper to decide which placeholder we're targeting right now
  const computeTargetPlaceholder = useCallback(() => {
    if (type === 'creative') {
      if (images.length > 0) return 'Edit uploaded image...';
      // Model-specific placeholders
      if (model === 'quality') return 'Make a rough 3D asset...';
      if (model === 'fast') return 'Make a textureless 3D asset...';
      if (model === 'ultra') return 'Make a production ready 3D asset...';
      return 'Speak anything into existence...';
    }
    return placeholder;
  }, [type, images.length, placeholder, model]);

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
    const target = computeTargetPlaceholder();

    // If nothing has changed, make sure we're synced and bail.
    if (target === placeholderRef.current) {
      if (placeholderAnim !== target) {
        setPlaceholderAnim(target);
      }
      return;
    }

    startCrossfade(target);
  }, [
    type,
    images.length,
    placeholder,
    model,
    computeTargetPlaceholder,
    placeholderAnim,
  ]);

  useEffect(() => {
    if (type === 'creative' && images.length > 1) {
      if (model !== 'quality') {
        setModel('quality');
      }
    }
  }, [images, setModel, model, type]);

  const handleSubmit = async () => {
    const hasNoInput = images.length === 0 && !input?.trim() && !mesh;
    const hasUploadingImages = images.some((img) => img.isUploading);

    if (hasNoInput || isLoading || hasUploadingImages) {
      return;
    }
    const text = input.trim();
    const parts: AppUIMessage['parts'] = [];

    if (text) {
      parts.push({ type: 'text', text });
    }

    for (const image of images) {
      if (!image.url || image.isUploading) continue;
      parts.push({
        type: 'file',
        mediaType: 'image/png',
        // Reference the storage object, NOT the base64 preview. The bytes were
        // already uploaded to `images/${user}/${conv}/${id}`; persisting the
        // data URL here would balloon `messages.parts` with the whole image.
        // Display + model-feeding resolve the bytes from storage by id.
        url: imageFilePartUrl(conversation.user_id, conversation.id, image.id),
        filename: `${image.id}.png`,
      });
    }

    const submittedMesh = mesh
      ? { id: mesh.id, fileType: mesh.fileType || ('glb' as MeshFileType) }
      : undefined;

    if (creativeModel) {
      if (submittedMesh) {
        parts.push({
          type: 'data-mesh-context',
          data: {
            meshId: submittedMesh.id,
            fileType: submittedMesh.fileType,
          },
        });
      }
      if (showPolygonControls) {
        parts.push({
          type: 'data-mesh-preferences',
          data: {
            topology: meshTopology,
            polygonCount: Math.min(polygonCount, maxPolygonCount),
          },
        });
      }
    } else if (type === 'parametric' && mesh) {
      parts.push({
        type: 'data-mesh-context',
        data: {
          meshId: mesh.id,
          fileType: 'stl',
          filename: meshFilename || 'model.stl',
          ...(meshBoundingBox ? { boundingBox: meshBoundingBox } : {}),
        },
      });
    }
    onSubmit(parts);
    setInput('');
    setImages([]);
    setMesh(null);
    setMeshBoundingBox(null);
    setMeshFilename(null);
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

  const { mutateAsync: uploadMeshAsync } = useMutation({
    mutationFn: async ({ file, id }: { file: File; id: string }) => {
      // Determine file extension
      const fileExtension = getMeshFileType(file.name);

      const { error } = await supabase.storage
        .from('meshes')
        .upload(
          `${conversation.user_id}/${conversation.id}/${id}.${fileExtension}`,
          file,
        );

      if (error) throw error;

      // Check if preview exists in storage
      const previewPath = `${conversation.user_id}/${conversation.id}/preview-${id}`;

      const { data } = await supabase.storage
        .from('images')
        .createSignedUrl(previewPath, 60 * 60); // 1 hour expiry

      if (data && data.signedUrl) {
        return data.signedUrl;
      }

      // If preview doesn't exist, generate it with the correct file type
      const preview = await generatePreview(file, fileExtension);

      // Only upload if the current user is the conversation owner
      if (session?.user.id === conversation.user_id) {
        // Convert data URL to Blob
        const response = await fetch(preview);
        const blob = await response.blob();

        // Save the preview to storage
        const { error: uploadError } = await supabase.storage
          .from('images')
          .upload(previewPath, blob, {
            contentType: 'image/png',
            upsert: true,
          });

        if (uploadError) {
          console.error('Error uploading preview:', uploadError);
          return preview; // Return the preview anyway even if upload fails
        }

        // Get the signed URL of the uploaded preview
        const { data } = await supabase.storage
          .from('images')
          .createSignedUrl(previewPath, 60 * 60); // 1 hour expiry
        return data?.signedUrl;
      }

      // If not the owner, just return the generated preview
      return preview;
    },
    onError: () => {
      toast({
        title: 'Error',
        description: 'Failed to upload mesh',
        variant: 'destructive',
      });
    },
  });

  const addItems = async (files: FileList) => {
    const newItems = Array.from(files);
    let hasSmallImages = false;
    let hasLargeImages = false;
    let hasInvalidImages = false;
    let hasInvalidItems = false;
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

    const validMeshes = newItems.map((file) => {
      if (!isSupportedMeshFile(file.name, type)) {
        return null;
      }

      return file;
    });

    // Filter out null values (invalid images)
    const filteredImages = validImages.filter(
      (img): img is File => img !== null,
    );

    const filteredMeshes = validMeshes.filter(
      (mesh): mesh is File => mesh !== null,
    );

    hasInvalidItems =
      newItems.length > filteredImages.length + filteredMeshes.length;

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
    } else if (hasInvalidItems) {
      toast({
        title: 'Invalid file format',
        description:
          type === 'creative'
            ? 'Some files were not added because they are not valid file formats. Must be jpeg, png, webp, glb, stl, or obj.'
            : 'Some files were not added because they are not valid file formats. Must be jpeg, png, webp, or stl.',
      });
    }

    filteredMeshes.forEach(async (file) => {
      const tempId = crypto.randomUUID();
      const fileType = getMeshFileType(file.name);
      setMesh({ id: tempId, isUploading: true, source: 'upload', fileType });
      try {
        // For parametric mode STL files, extract bounding box and generate multi-angle renders
        if (type === 'parametric' && fileType === 'stl') {
          const { geometry, boundingBox } = await parseSTL(file);
          setMeshBoundingBox(boundingBox);
          setMeshFilename(file.name);

          // Store STL blob in context for WASM filesystem access
          meshFiles.setMeshFile(file.name, file);

          // Generate multi-angle renders and upload as images
          const renders = await renderMultipleAngles(geometry, boundingBox);
          for (const renderBlob of renders) {
            const renderId = crypto.randomUUID();
            const renderFile = new File(
              [renderBlob],
              `render-${renderId}.png`,
              {
                type: 'image/png',
              },
            );
            const url = URL.createObjectURL(renderBlob);
            setImages((prevImages) => [
              ...prevImages,
              { id: renderId, isUploading: true, source: 'upload', url },
            ]);
            try {
              const signedUrl = await uploadImageAsync({
                file: renderFile,
                id: renderId,
              });
              URL.revokeObjectURL(url);
              setImages((prevImages) =>
                prevImages.map((img) =>
                  img.id === renderId
                    ? { ...img, isUploading: false, url: signedUrl }
                    : img,
                ),
              );
            } catch (renderError) {
              console.error('Error uploading render:', renderError);
              setImages((prevImages) =>
                prevImages.filter((img) => img.id !== renderId),
              );
            }
          }

          geometry.dispose();
        }

        const url = await uploadMeshAsync({ file: file, id: tempId });
        setMesh({
          id: tempId,
          isUploading: false,
          url,
          source: 'upload',
          fileType,
        });
      } catch (error) {
        console.error('Error uploading mesh:', error);
        setMesh(null);
        setMeshBoundingBox(null);
        setMeshFilename(null);
      }
    });

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

  const handleItemsChange = (selectedItems: FileList | null) => {
    if (selectedItems && selectedItems.length > 0) {
      addItems(selectedItems);
    }
  };

  const handleMeshRemoved = async () => {
    if (mesh?.source === 'upload') {
      try {
        const fileExtension = mesh.fileType || 'glb'; // Default to glb if fileType is not set
        await Promise.all([
          supabase.storage
            .from('meshes')
            .remove([
              `${session?.user?.id}/${conversation.id}/${mesh.id}.${fileExtension}`,
            ]),
          supabase.storage
            .from('images')
            .remove([
              `${session?.user?.id}/${conversation.id}/preview-${mesh.id}`,
            ]),
        ]);
      } catch (error) {
        console.error('Error removing mesh:', error);
      }
    }
    setMesh(null);
  };

  const handleImageRemoved = async (image: MessageItem) => {
    if (!image.isUploading) {
      // Only try to remove from storage if the item has been uploaded
      if (image.source === 'upload') {
        try {
          await supabase.storage
            .from('images')
            .remove([`${session?.user?.id}/${conversation.id}/${image.id}`]);
        } catch (error) {
          console.error('Error removing image:', error);
        }
      }
      setImages((prevImages) =>
        prevImages.filter((img) => img.id !== image.id),
      );
    }
  };

  const generatePrompt = async () => {
    if (isGeneratingPrompt) return;
    setIsGeneratingPrompt(true);
    try {
      const data = await apiJson(
        'prompt-generator',
        {
          method: 'POST',
          body: JSON.stringify({
            existingText: input.trim() || undefined,
            type,
          }),
        },
        promptResponseSchema,
      );
      if (!data?.prompt) throw new Error('No prompt generated');

      setInput(data.prompt);
    } catch (error) {
      console.error('Error generating prompt:', error);
      toast({
        title: 'Error',
        description: 'Failed to generate prompt',
        variant: 'destructive',
      });
    } finally {
      setIsGeneratingPrompt(false);
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
      if (e.relatedTarget === null) {
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
    if (images.length === 0 && mesh === null) {
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
  }, [isDragging, images.length, mesh]); // Listen to images.length and mesh too

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
        onFocus?.();
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
            : !isDragging && images.length === 0 && mesh === null
              ? 'h-0 border-transparent bg-transparent opacity-0'
              : isDragging
                ? isDragHover
                  ? 'h-20 border-[#00A6FF] bg-[rgba(0,166,255,0.24)] opacity-100' // Blue, full height
                  : 'h-20 border-[#0077B7] bg-[rgba(0,166,255,0.12)] opacity-100' // Intermediate blue, full height
                : images.length > 0 || mesh !== null
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
            {isDragging && (images.length > 0 || mesh !== null) ? (
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
            ) : /* Case 2: No items (images/mesh are zero) -> Show original "Drop images and 3D models here" logic */
            images.length === 0 && mesh === null ? (
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
              (images.length > 0 || mesh !== null) && (
                <div
                  className={cn(
                    'flex w-full items-center gap-4 overflow-x-auto overflow-y-hidden p-4',
                    // Opacity dimming logic can remain if desired, or be simplified
                    isDragging && (images.length > 0 || mesh !== null)
                      ? 'opacity-60'
                      : 'opacity-100',
                    'transition-opacity duration-150',
                  )}
                >
                  <AnimatePresence>
                    {' '}
                    {/* Ensure no initial={false} here */}
                    {mesh && (
                      <motion.div
                        key={`mesh-${mesh.id}`}
                        className="relative h-12 w-12 flex-shrink-0"
                        variants={itemAnimationVariants}
                        initial="initial"
                        animate="animate"
                        exit="exit"
                        layout
                      >
                        {mesh.url && (
                          <img
                            src={mesh.url}
                            alt="Mesh"
                            className="h-12 w-12 rounded-md object-cover"
                          />
                        )}
                        {mesh.isUploading && (
                          <div className="absolute inset-0 flex items-center justify-center rounded-md bg-black/50">
                            <Loader2 className="h-4 w-4 animate-spin text-white" />
                          </div>
                        )}
                        {!mesh.isUploading && (
                          <div className="absolute bottom-[-0.50rem] right-[-0.50rem] rounded-full border border-adam-neutral-500 bg-adam-neutral-500 text-white transition-colors duration-200 hover:border-adam-neutral-700 hover:bg-adam-neutral-700">
                            <Box className="h-4 w-4 text-white" />
                          </div>
                        )}
                        <button
                          onClick={handleMeshRemoved}
                          disabled={mesh.isUploading}
                          className={cn(
                            'absolute right-[-0.50rem] top-[-0.50rem] rounded-full border border-adam-neutral-500 bg-adam-neutral-500 text-white transition-colors duration-200 hover:border-adam-neutral-700 hover:bg-adam-neutral-700',
                            mesh.isUploading && 'opacity-50',
                          )}
                        >
                          <CircleX className="h-4 w-4 stroke-[1.5]" />
                        </button>
                      </motion.div>
                    )}
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
              disabled={isLoading || disabled}
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
          {showPromptGenerator && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 rounded-full hover:bg-adam-neutral-800"
                  onClick={(e) => {
                    e.stopPropagation();
                    generatePrompt();
                  }}
                  disabled={isGeneratingPrompt || isLoading || disabled}
                >
                  {isGeneratingPrompt ? (
                    <Loader2 className="h-4 w-4 animate-spin text-adam-blue" />
                  ) : (
                    <Wand2 className="h-4 w-4 text-gray-400 transition-colors duration-200 hover:text-white" />
                  )}
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                {input.trim() ? 'Enhance Prompt' : 'Generate Prompt'}
              </TooltipContent>
            </Tooltip>
          )}
        </div>
        <div className="flex items-center justify-between border-t border-[#2a2a2a] p-3">
          <div className="flex items-center gap-1">
            {(type !== 'parametric' ||
              parametricModelSupportsVision(model)) && (
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
                    input.accept = `${VALID_IMAGE_FORMATS.join(', ')}, ${
                      type === 'creative'
                        ? SUPPORTED_MESH_EXTENSIONS.join(', ')
                        : '.stl'
                    }`;
                    input.onchange = () => handleItemsChange(input.files);
                    input.click();
                  }}
                  disabled={disabled}
                >
                  <ImagePlus className="h-5 w-5" />
                </Button>
              </div>
            )}

            {/* Creative mode toggle button */}
            {onTypeChange && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="outline"
                    className={cn(
                      'flex h-8 items-center gap-1.5 rounded-lg border border-[#2a2a2a] bg-adam-background-2 px-2 text-sm transition-colors',
                      type === 'creative'
                        ? 'border-adam-blue/50 bg-adam-blue/10 text-adam-blue'
                        : 'text-adam-text-secondary hover:bg-adam-bg-secondary-dark',
                    )}
                    onClick={(e) => {
                      e.stopPropagation();
                      onTypeChange(
                        type === 'parametric' ? 'creative' : 'parametric',
                      );
                    }}
                  >
                    <Box className="h-4 w-4" />
                    <span className="hidden text-xs lg:inline">Mesh</span>
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  {type === 'parametric'
                    ? 'Switch to Creative mode'
                    : 'Switch to Parametric mode'}
                </TooltipContent>
              </Tooltip>
            )}

            {/* Quads vs Polys toggle button - show for standard and ultra models */}
            {showPolygonControls && (
              <QuadsButton
                meshTopology={meshTopology}
                showFullLabels={showFullLabels}
                isLoading={isLoading}
                disabled={disabled}
                onToggle={() =>
                  handleMeshTopologyChange(
                    meshTopology === 'quads' ? 'polys' : 'quads',
                  )
                }
              />
            )}

            {/* Polygon Count button - show for standard and ultra models */}
            {creativeModel && showPolygonControls && (
              <PolygonButton
                polygonCount={polygonCount}
                meshTopology={meshTopology}
                model={creativeModel}
                showFullLabels={showFullLabels}
                isLoading={isLoading}
                disabled={disabled || false}
                onPolygonCountChange={setPolygonCountForCurrentModel}
                onReset={resetPolygonCount}
              />
            )}
          </div>

          <div className="flex items-center gap-2">
            <ModelSelector
              disabled={isLoading || disabled}
              models={memoizedModels}
              selectedModel={model}
              onModelChange={setModel}
              type={type}
              focused={isFocused}
            />
            {/* Enhanced submit button */}
            {isLoading && stopGenerating ? (
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    onClick={stopGenerating}
                    className="flex h-8 w-8 transform items-center justify-center rounded-lg bg-adam-neutral-700 p-1 text-white transition-all duration-300 hover:scale-105 hover:bg-adam-blue/90 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:scale-100 disabled:hover:bg-adam-blue"
                  >
                    <Square className="h-5 w-5 fill-white" />
                  </button>
                </TooltipTrigger>
                <TooltipContent>Stop generation</TooltipContent>
              </Tooltip>
            ) : (
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
                  isLoading ||
                  images.some((img) => img.isUploading) ||
                  disabled
                }
              >
                <ArrowUp className="h-5 w-5" />
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export default TextAreaChat;
