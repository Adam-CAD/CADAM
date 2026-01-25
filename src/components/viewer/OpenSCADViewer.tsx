import { useOpenSCAD } from '@/hooks/useOpenSCAD';
import { useCallback, useEffect, useState, useRef } from 'react';
import { ThreeScene } from '@/components/viewer/ThreeScene';
import { STLLoader } from 'three/addons/loaders/STLLoader.js';
import { BufferGeometry, Vector3 } from 'three';
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
  const { compileScad, writeFile, isCompiling, output, isError, error } =
    useOpenSCAD();
  const { getMeshFile, hasMeshFile } = useMeshFiles();
  const [geometry, setGeometry] = useState<BufferGeometry | null>(null);
  const [geometryStats, setGeometryStats] = useState<{
    size: { x: number; y: number; z: number };
    center: { x: number; y: number; z: number };
    vertexCount: number;
    triangleCount: number;
    byteSize: number;
  } | null>(null);
  const { mutate: sendMessage } = useSendContentMutation({ conversation });
  // Track which files (and their versions) we've written to avoid re-writing
  // Maps filename -> Blob instance
  const writtenFilesRef = useRef<Map<string, Blob>>(new Map());

  const scadCode = currentMessage?.content.artifact?.code;

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

  useEffect(() => {
    setBlob(output ?? null);
    if (output && output instanceof Blob) {
      output.arrayBuffer().then((buffer) => {
        const loader = new STLLoader();
        const geom = loader.parse(buffer);
        geom.computeBoundingBox();
        const bbox = geom.boundingBox;
        const size = new Vector3();
        const center = new Vector3();
        if (bbox) {
          bbox.getSize(size);
          bbox.getCenter(center);
        }
        // Center geometry for viewing after stats are captured
        geom.center();
        geom.computeVertexNormals();
        setGeometry(geom);
        const vertexCount = geom.attributes.position?.count ?? 0;
        const triangleCount = geom.index
          ? geom.index.count / 3
          : vertexCount / 3;
        setGeometryStats({
          size: { x: size.x, y: size.y, z: size.z },
          center: { x: center.x, y: center.y, z: center.z },
          vertexCount,
          triangleCount,
          byteSize: output.size,
        });
      });
    } else {
      setGeometry(null);
      setGeometryStats(null);
    }
  }, [output, setBlob]);

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
    <div className="relative h-full w-full bg-adam-neutral-700/50 shadow-lg backdrop-blur-sm transition-all duration-300 ease-in-out">
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
      <div className="border-adam-neutral-600/60 pointer-events-none absolute right-3 top-3 rounded-md border bg-adam-neutral-800/70 px-3 py-2 text-[11px] text-adam-text-primary/80 shadow-lg backdrop-blur">
        <div className="text-[10px] uppercase tracking-wide text-adam-text-primary/60">
          Geometry Inspector
        </div>
        {geometryStats ? (
          <div className="mt-1 space-y-0.5">
            <div>
              Size: {geometryStats.size.x.toFixed(2)},{' '}
              {geometryStats.size.y.toFixed(2)},{' '}
              {geometryStats.size.z.toFixed(2)}
            </div>
            <div>
              Center: {geometryStats.center.x.toFixed(2)},{' '}
              {geometryStats.center.y.toFixed(2)},{' '}
              {geometryStats.center.z.toFixed(2)}
            </div>
            <div>Vertices: {geometryStats.vertexCount}</div>
            <div>Triangles: {Math.floor(geometryStats.triangleCount)}</div>
            <div>STL Size: {(geometryStats.byteSize / 1024).toFixed(1)} KB</div>
          </div>
        ) : (
          <div className="mt-1 text-adam-text-primary/50">No geometry</div>
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
