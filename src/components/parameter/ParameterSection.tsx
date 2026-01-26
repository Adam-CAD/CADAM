import {
  RefreshCcw,
  Download,
  ChevronUp,
  Box,
  Ruler,
  Scale,
  DollarSign,
} from 'lucide-react';
import { useEffect, useState, useRef, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Parameter } from '@shared/types';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { ParameterInput } from '@/components/parameter/ParameterInput';
import { ColorPicker } from '@/components/parameter/ColorPicker';
import { validateParameterValue } from '@/utils/parameterUtils';
import { useCurrentMessage } from '@/contexts/CurrentMessageContext';
import { downloadSTLFile, downloadOpenSCADFile } from '@/utils/downloadUtils';
import { useChangeParameters } from '@/services/messageService';
import { useBlob } from '@/contexts/BlobContext';
import { useDimensions } from '@/contexts/DimensionsContext';

export function ParameterSection() {
  const { blob } = useBlob();
  const { dimensions, filamentEstimates } = useDimensions();
  const changeParameters = useChangeParameters();
  const { currentMessage } = useCurrentMessage();
  const parameters = currentMessage?.content.artifact?.parameters ?? [];
  const [selectedFormat, setSelectedFormat] = useState<'stl' | 'scad'>('stl');

  // Debounce timer for compilation
  const debounceTimerRef = useRef<NodeJS.Timeout | null>(null);
  const pendingParametersRef = useRef<Parameter[] | null>(null);

  // Cleanup debounce timer on unmount
  useEffect(() => {
    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
    };
  }, []);

  // Debounced submit function
  const debouncedSubmit = useCallback(
    (params: Parameter[]) => {
      // Store the parameters to submit
      pendingParametersRef.current = params;

      // Clear existing timer
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }

      // Set new debounced timer (200ms delay)
      debounceTimerRef.current = setTimeout(() => {
        if (pendingParametersRef.current) {
          changeParameters(currentMessage, pendingParametersRef.current);
          pendingParametersRef.current = null;
        }
      }, 200);
    },
    [changeParameters, currentMessage],
  );

  const handleCommit = (param: Parameter, value: Parameter['value']) => {
    const validatedValue = validateParameterValue(param, value);

    const updatedParam = { ...param, value: validatedValue };
    const updatedParameters = parameters.map((p) =>
      p.name === param.name ? updatedParam : p,
    );

    debouncedSubmit(updatedParameters);
  };

  const handleDownload = () => {
    if (selectedFormat === 'stl') {
      handleDownloadSTL();
    } else {
      handleDownloadOpenSCAD();
    }
  };

  const handleDownloadSTL = () => {
    if (!blob) return;
    downloadSTLFile(blob, currentMessage);
  };

  const handleDownloadOpenSCAD = () => {
    if (!currentMessage?.content.artifact?.code) return;
    downloadOpenSCADFile(currentMessage.content.artifact.code, currentMessage);
  };

  const isDownloadDisabled =
    selectedFormat === 'stl' ? !blob : !currentMessage?.content.artifact?.code;

  return (
    <div className="h-full w-full max-w-full border-l border-gray-200/20 bg-adam-bg-secondary-dark dark:border-gray-800">
      <div className="flex h-14 items-center justify-between border-b border-adam-neutral-700 bg-gradient-to-r from-adam-bg-secondary-dark to-adam-bg-secondary-dark/95 px-6 py-6">
        <div className="flex items-center gap-2">
          <span className="text-lg font-semibold tracking-tight text-adam-text-primary">
            Parameters
          </span>
        </div>
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                className="h-8 w-8 rounded-full p-0 text-adam-text-primary transition-colors [@media(hover:hover)]:hover:bg-adam-neutral-950 [@media(hover:hover)]:hover:text-adam-neutral-10"
                disabled={parameters.length === 0}
                onClick={() => {
                  const newParameters = parameters.map((param) => ({
                    ...param,
                    value: param.defaultValue,
                  }));
                  changeParameters(currentMessage, newParameters);
                }}
              >
                <RefreshCcw className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              <p>Reset all parameters</p>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </div>
      <div className="flex h-[calc(100%-3.5rem)] flex-col justify-between overflow-hidden">
        <ScrollArea className="flex-1 px-6 py-6">
          <div className="flex flex-col gap-3">
            {parameters.map((param) => (
              <ParameterInput
                key={param.name}
                param={param}
                handleCommit={handleCommit}
              />
            ))}
          </div>
        </ScrollArea>
        {dimensions && (
          <div className="border-t border-adam-neutral-700 px-6 py-4">
            <div className="mb-3 flex items-center gap-2">
              <Box className="h-4 w-4 text-adam-blue" />
              <span className="text-sm font-semibold text-adam-text-primary">
                Dimensions
              </span>
            </div>
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-red-400">X</span>
                <span className="font-mono text-xs text-adam-text-primary">
                  {dimensions.x.toFixed(2)} mm
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-green-400">Y</span>
                <span className="font-mono text-xs text-adam-text-primary">
                  {dimensions.y.toFixed(2)} mm
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-blue-400">Z</span>
                <span className="font-mono text-xs text-adam-text-primary">
                  {dimensions.z.toFixed(2)} mm
                </span>
              </div>
              <div className="border-adam-neutral-600/50 mt-2 flex items-center gap-1.5 border-t pt-2">
                <Ruler className="h-3 w-3 text-adam-text-secondary" />
                <span className="text-xs text-adam-text-secondary">
                  {dimensions.x.toFixed(2)} × {dimensions.y.toFixed(2)} ×{' '}
                  {dimensions.z.toFixed(2)} mm
                </span>
              </div>
            </div>
          </div>
        )}
        {filamentEstimates && (
          <div className="border-t border-adam-neutral-700 px-6 py-4">
            <div className="mb-3 flex items-center gap-2">
              <Scale className="h-4 w-4 text-adam-blue" />
              <span className="text-sm font-semibold text-adam-text-primary">
                Print Estimates
              </span>
            </div>
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs text-adam-text-secondary">Volume</span>
                <span className="font-mono text-xs text-adam-text-primary">
                  {filamentEstimates.volumeCm3.toFixed(2)} cm³
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-xs text-adam-text-secondary">
                  Filament
                </span>
                <span className="font-mono text-xs text-adam-text-primary">
                  {filamentEstimates.weightGrams.toFixed(1)} g
                </span>
              </div>
              <div className="border-adam-neutral-600/50 mt-2 flex items-center justify-between border-t pt-2">
                <div className="flex items-center gap-1.5">
                  <DollarSign className="h-3 w-3 text-green-400" />
                  <span className="text-xs font-medium text-adam-text-primary">
                    Est. Cost
                  </span>
                </div>
                <span className="font-mono text-xs font-semibold text-green-400">
                  ${filamentEstimates.costUSD.toFixed(2)}
                </span>
              </div>
              <p className="mt-1 text-[10px] text-adam-text-secondary/60">
                PLA @ $20/kg
              </p>
            </div>
          </div>
        )}
        <div className="flex flex-col gap-4 border-t border-adam-neutral-700 px-6 py-6">
          <div>
            <ColorPicker />
          </div>
          <div className="flex">
            <Button
              onClick={handleDownload}
              disabled={isDownloadDisabled}
              aria-label={`download ${selectedFormat.toUpperCase()} file`}
              className="h-12 flex-1 rounded-r-none bg-adam-neutral-50 text-adam-neutral-800 hover:bg-adam-neutral-100 hover:text-adam-neutral-900"
            >
              <Download className="mr-2 h-4 w-4" />
              {selectedFormat.toUpperCase()}
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  disabled={!blob && !currentMessage?.content.artifact?.code}
                  aria-label="select download format"
                  className="h-12 w-12 rounded-l-none border-l border-adam-neutral-300 bg-adam-neutral-50 p-0 text-adam-neutral-800 hover:bg-adam-neutral-100 hover:text-adam-neutral-900"
                >
                  <ChevronUp className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent
                align="end"
                className="w-64 border-none bg-adam-neutral-800 shadow-md"
              >
                <DropdownMenuItem
                  onClick={() => setSelectedFormat('stl')}
                  disabled={!blob}
                  className="cursor-pointer text-adam-text-primary"
                >
                  <span className="text-sm">.STL</span>
                  <span className="ml-3 text-xs text-adam-text-primary/60">
                    3D Printing
                  </span>
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => setSelectedFormat('scad')}
                  disabled={!currentMessage?.content.artifact?.code}
                  className="cursor-pointer text-adam-text-primary"
                >
                  <span className="text-sm">.SCAD</span>
                  <span className="ml-3 text-xs text-adam-text-primary/60">
                    OpenSCAD Code
                  </span>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </div>
    </div>
  );
}
