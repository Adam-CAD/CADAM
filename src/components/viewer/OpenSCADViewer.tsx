import { useOpenSCAD } from '@/hooks/useOpenSCAD';
import { useCallback, useEffect, useState, useRef } from 'react';
import { ThreeScene } from '@/components/viewer/ThreeScene';
import { STLLoader } from 'three/addons/loaders/STLLoader.js';
import { BufferGeometry } from 'three';
import { Loader2, CircleAlert, Wrench } from 'lucide-react';
import { Button } from '@/components/ui/button';
import OpenSCADError from '@/lib/OpenSCADError';
import { cn } from '@/lib/utils';
import { useConversation } from '@/services/conversationService';
import { useCurrentMessage } from '@/contexts/CurrentMessageContext';
import { Content } from '@shared/types';
import { useSendContentMutation } from '@/services/messageService';
import { useBlob } from '@/contexts/BlobContext';
import { useMeshFiles } from '@/contexts/MeshFilesContext';
import { useDimensions } from '@/contexts/DimensionsContext';
import {
  calculateFilamentEstimates,
  calculateMeshVolume,
} from '@/utils/meshUtils';

// Extract import() filenames from OpenSCAD code
function extractImportFilenames(code: string): string[] {
  const importRegex = /import\s*\(\s*"([^"]+)"\s*\)/g;
  const filenames: string[] = [];
  let match;
  while ((match = importRegex.exec(code)) !== null) {
    filenames.push(match[1]);
  }
  return filenames;
}

export function OpenSCADViewer() {
  const { conversation } = useConversation();
  const { currentMessage } = useCurrentMessage();
  const { setBlob } = useBlob();
  const { setDimensions, setFilamentEstimates } = useDimensions();
  const { compileScad, writeFile, isCompiling, output, isError, error } =
    useOpenSCAD();
  const { getMeshFile, hasMeshFile } = useMeshFiles();
  const [geometry, setGeometry] = useState<BufferGeometry | null>(null);
  const { mutate: sendMessage } = useSendContentMutation({ conversation });
  // Track which files (and their versions) we've written to avoid re-writing
  // Maps filename -> Blob instance
  const writtenFilesRef = useRef<Map<string, Blob>>(new Map());

  const scadCode = currentMessage?.content.artifact?.code;

  // Compile OpenSCAD code when it changes
  useEffect(() => {
    if (!scadCode) return;

    const compileWithMeshFiles = async () => {
      try {
        // Extract any import() filenames from the code
        const importedFiles = extractImportFilenames(scadCode);

        // Write any mesh files that haven't been written yet
        for (const filename of importedFiles) {
          const inContext = hasMeshFile(filename);
          const meshContent = getMeshFile(filename);

          // Check if we need to write:
          // 1. File exists in context
          // 2. We haven't written it OR the content has changed (new Blob reference)
          const writtenBlob = writtenFilesRef.current.get(filename);
          const needsWrite =
            inContext &&
            meshContent &&
            (!writtenBlob || writtenBlob !== meshContent);

          if (needsWrite && meshContent) {
            await writeFile(filename, meshContent);
            writtenFilesRef.current.set(filename, meshContent);
          }
        }

        // Now compile the code
        compileScad(scadCode);
      } catch (err) {
        console.error('[OpenSCAD] Error preparing files for compilation:', err);
      }
    };

    compileWithMeshFiles();
  }, [scadCode, compileScad, writeFile, getMeshFile, hasMeshFile]);

  // Handle compiled output
  useEffect(() => {
    setBlob(output ?? null);
    if (output && output instanceof Blob) {
      output.arrayBuffer().then((buffer) => {
        const loader = new STLLoader();
        const geom = loader.parse(buffer);
        geom.center();
        geom.computeVertexNormals();
        geom.computeBoundingBox();

        // Calculate and set dimensions
        const box = geom.boundingBox;
        if (box) {
          setDimensions({
            x: Math.round((box.max.x - box.min.x) * 100) / 100,
            y: Math.round((box.max.y - box.min.y) * 100) / 100,
            z: Math.round((box.max.z - box.min.z) * 100) / 100,
          });
        }

        // Calculate volume and filament estimates
        const volumeMm3 = calculateMeshVolume(geom);
        const estimates = calculateFilamentEstimates(volumeMm3);
        setFilamentEstimates(estimates);

        setGeometry(geom);
      });
    } else {
      setGeometry(null);
      setDimensions(null);
      setFilamentEstimates(null);
    }
  }, [output, setBlob, setDimensions, setFilamentEstimates]);

  const fixError = useCallback(
    async (error: OpenSCADError) => {
      const newContent: Content = {
        text: 'Fix with AI',
        error: error.stdErr.join('\n'),
      };

      sendMessage(newContent);
    },
    [sendMessage],
  );

  const isLastMessage =
    conversation.current_message_leaf_id === currentMessage?.id;

  return (
    <div className="h-full w-full bg-adam-neutral-700/50 shadow-lg backdrop-blur-sm transition-all duration-300 ease-in-out">
      <div className="h-full w-full">
        {geometry ? (
          <div className="h-full w-full">
            <ThreeScene geometry={geometry} />
          </div>
        ) : (
          <>
            {isError && (
              <div className="flex h-full items-center justify-center">
                <FixWithAIButton
                  error={error}
                  fixError={isLastMessage ? fixError : undefined}
                />
              </div>
            )}
          </>
        )}
        {isCompiling && (
          <div className="absolute inset-0 flex items-center justify-center rounded-lg bg-adam-neutral-700/30 backdrop-blur-sm">
            <div className="flex flex-col items-center gap-3">
              <Loader2 className="h-6 w-6 animate-spin text-adam-blue" />
              <p className="text-xs font-medium text-adam-text-primary/70">
                Compiling...
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function FixWithAIButton({
  error,
  fixError,
}: {
  error?: OpenSCADError | Error;
  fixError?: (error: OpenSCADError) => void;
}) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 p-6">
      <div className="flex flex-col items-center gap-3">
        <div className="relative">
          <div className="absolute inset-0 animate-ping rounded-full bg-adam-blue/20" />
          <CircleAlert className="h-8 w-8 text-adam-blue" />
        </div>
        <div className="text-center">
          <p className="text-sm font-medium text-adam-blue">
            Error Compiling Model
          </p>
          <p className="mt-1 text-xs text-adam-text-primary/60">
            Adam encountered an error while compiling
          </p>
        </div>
      </div>
      {fixError && error && error.name === 'OpenSCADError' && (
        <Button
          variant="ghost"
          className={cn(
            'group relative flex items-center gap-2 rounded-lg border',
            'bg-gradient-to-br from-adam-blue/20 to-adam-neutral-800/70 p-3',
            'border-adam-blue/30 text-adam-text-primary',
            'transition-all duration-300 ease-in-out',
            'hover:border-adam-blue/70 hover:bg-adam-blue/50 hover:text-white',
            'hover:shadow-[0_0_25px_rgba(0,166,255,0.4)]',
            'focus:outline-none focus:ring-2 focus:ring-adam-blue/30',
          )}
          onClick={() => {
            if (error && error.name === 'OpenSCADError') {
              fixError?.(error as OpenSCADError);
            }
          }}
        >
          <div className="absolute inset-0 rounded-lg bg-gradient-to-br from-adam-blue/20 to-transparent opacity-0 transition-opacity duration-300 group-hover:opacity-100" />
          <Wrench className="h-4 w-4 transition-transform duration-300 group-hover:rotate-12" />
          <span className="relative text-sm font-medium">Fix with AI</span>
        </Button>
      )}
    </div>
  );
}
