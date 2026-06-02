import { Download, ChevronUp, Loader2 } from 'lucide-react';
import { useEffect, useState, useRef, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import type { Parameter } from '@shared/types';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { ParameterInput } from '@/components/parameter/ParameterInput';
import { validateParameterValue } from '@/utils/parameterUtils';
import {
  downloadSTLFile,
  downloadOpenSCADFile,
  downloadDXFFile,
  type DxfExporter,
} from '@/utils/downloadUtils';
import { useToast } from '@/hooks/use-toast';

interface ParameterSheetContentProps {
  parameters: Parameter[];
  onParameterChange: (parameters: Parameter[]) => void;
  currentOutput?: Blob;
  dxfExporter?: DxfExporter | null;
  code?: string;
}

type DownloadFormat = 'stl' | 'scad' | 'dxf';

export function ParameterSheetContent({
  parameters,
  onParameterChange,
  currentOutput,
  dxfExporter,
  code,
}: ParameterSheetContentProps) {
  const { toast } = useToast();
  const [selectedFormat, setSelectedFormat] = useState<DownloadFormat>('stl');
  const [isExporting, setIsExporting] = useState(false);
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingParametersRef = useRef<Parameter[] | null>(null);
  const latestParametersRef = useRef(parameters);

  useEffect(() => {
    latestParametersRef.current = parameters;
  }, [parameters]);

  // Always flush through the latest callback — the unmount flush below runs
  // with `[]` deps, so without this ref it would call a stale closure.
  const onParameterChangeRef = useRef(onParameterChange);
  useEffect(() => {
    onParameterChangeRef.current = onParameterChange;
  }, [onParameterChange]);

  // On unmount, flush any pending debounced edit instead of dropping it. The
  // editor remounts on `key={conversation.id}`, so an edit made within the
  // 200ms window just before navigating away would otherwise be lost.
  useEffect(() => {
    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
      if (pendingParametersRef.current) {
        onParameterChangeRef.current(pendingParametersRef.current);
        pendingParametersRef.current = null;
      }
    };
  }, []);

  const debouncedSubmit = useCallback(
    (params: Parameter[]) => {
      pendingParametersRef.current = params;

      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }

      debounceTimerRef.current = setTimeout(() => {
        if (pendingParametersRef.current) {
          onParameterChange(pendingParametersRef.current);
          latestParametersRef.current = pendingParametersRef.current;
          pendingParametersRef.current = null;
        }
      }, 200);
    },
    [onParameterChange],
  );

  const handleCommit = (param: Parameter, value: Parameter['value']) => {
    const validatedValue = validateParameterValue(param, value);
    const updatedParam = { ...param, value: validatedValue };
    const baseParameters =
      pendingParametersRef.current ?? latestParametersRef.current;
    const updatedParameters = baseParameters.map((p) =>
      p.name === param.name ? updatedParam : p,
    );

    debouncedSubmit(updatedParameters);
  };

  const handleDownloadSTL = () => {
    if (!currentOutput) return;
    downloadSTLFile(currentOutput);
  };

  const handleDownloadOpenSCAD = () => {
    if (!code) return;
    downloadOpenSCADFile(code);
  };

  const handleDownloadDXF = async () => {
    if (!dxfExporter) return;

    try {
      setIsExporting(true);
      const dxfOutput = await dxfExporter();
      downloadDXFFile(dxfOutput);
    } catch (error) {
      console.error('[OpenSCAD] Failed to export DXF:', error);
      toast({
        title: 'DXF export failed',
        description:
          error instanceof Error
            ? error.message
            : 'Adam could not export this model as DXF.',
        variant: 'destructive',
      });
    } finally {
      setIsExporting(false);
    }
  };

  const downloadHandlers: Record<DownloadFormat, () => void | Promise<void>> = {
    stl: handleDownloadSTL,
    scad: handleDownloadOpenSCAD,
    dxf: handleDownloadDXF,
  };
  const formatAvailable: Record<DownloadFormat, boolean> = {
    stl: !!currentOutput,
    scad: !!code,
    dxf: !!dxfExporter && !isExporting,
  };

  const handleDownload = async () => {
    await downloadHandlers[selectedFormat]();
  };
  const isDownloadDisabled = !formatAvailable[selectedFormat];
  const isAnyFormatAvailable = Object.values(formatAvailable).some(Boolean);

  return (
    <div className="flex h-full min-h-0 w-full flex-col">
      <ScrollArea className="min-h-0 w-full flex-1 px-4">
        <div className="flex flex-col gap-6 pb-4 pt-2">
          {parameters.map((param) => (
            <ParameterInput
              key={param.name}
              param={param}
              handleCommit={handleCommit}
            />
          ))}
        </div>
      </ScrollArea>
      <div className="flex w-full flex-col gap-4 p-4">
        <div className="flex border-t border-adam-neutral-700 pt-2">
          <Button
            onClick={handleDownload}
            disabled={isDownloadDisabled}
            aria-label={`download ${selectedFormat.toUpperCase()} file`}
            className="flex-1 rounded-r-none bg-adam-neutral-50 text-adam-neutral-800 hover:bg-adam-neutral-100 hover:text-adam-neutral-900"
          >
            {isExporting ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Download className="mr-2 h-4 w-4" />
            )}
            {selectedFormat.toUpperCase()}
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                disabled={!isAnyFormatAvailable}
                aria-label="select download format"
                className="rounded-l-none border-l border-adam-neutral-300 bg-adam-neutral-50 px-2 text-adam-neutral-800 hover:bg-adam-neutral-100 hover:text-adam-neutral-900"
              >
                <ChevronUp className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem
                onClick={() => setSelectedFormat('stl')}
                disabled={!formatAvailable.stl}
                className="grid cursor-pointer grid-cols-3 text-adam-text-primary"
              >
                <span className="text-sm">.STL</span>
                <span className="col-span-2 text-xs text-adam-text-primary/60">
                  3D Printing
                </span>
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => setSelectedFormat('scad')}
                disabled={!formatAvailable.scad}
                className="grid cursor-pointer grid-cols-3 text-adam-text-primary"
              >
                <span className="text-sm">.SCAD</span>
                <span className="col-span-2 text-xs text-adam-text-primary/60">
                  OpenSCAD Code
                </span>
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => setSelectedFormat('dxf')}
                disabled={!formatAvailable.dxf}
                className="grid cursor-pointer grid-cols-3 text-adam-text-primary"
              >
                <span className="text-sm">.DXF</span>
                <span className="col-span-2 text-xs text-adam-text-primary/60">
                  2D Projection to the (x,y) plane
                </span>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    </div>
  );
}
