import { useOpenSCAD } from '@/hooks/useOpenSCAD';
import { useCallback, useEffect, useState, useContext, useRef } from 'react';
import { ThreeScene } from '@/components/viewer/ThreeScene';
import { STLLoader } from 'three/addons/loaders/STLLoader.js';
import { BufferGeometry, Group } from 'three';
import { CircleAlert, Loader2, Wrench } from 'lucide-react';
import {
  buildColoredGroupFromOff,
  disposeColoredGroup,
} from '@/utils/coloredOffMesh';
import { Button } from '@/components/ui/button';
import OpenSCADError from '@/lib/OpenSCADError';
import { cn } from '@/lib/utils';
import { MeshFilesContext } from '@/contexts/MeshFilesContext';
import { createDXFProjectionCode } from '@/utils/dxfUtils';
import { DxfExporter } from '@/utils/downloadUtils';

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

// Brand-fallback `color` arrives as a CSS hex string (e.g. "#00A6FF") since
// it's also handed to react-three-fiber's <meshStandardMaterial color>. The
// OFF builder wants a packed 0xRRGGBB number, so coerce here.
function parseHexColor(hex: string): number {
  const trimmed = hex.startsWith('#') ? hex.slice(1) : hex;
  const parsed = parseInt(trimmed, 16);
  return Number.isFinite(parsed) ? parsed : 0x00a6ff;
}

interface OpenSCADPreviewProps {
  scadCode: string | null;
  color: string;
  onOutputChange?: (output: Blob | undefined) => void;
  onDxfExportChange?: (exporter: DxfExporter | null) => void;
  fixError?: (error: OpenSCADError) => void;
  isMobile?: boolean;
  backgroundColor?: string;
}

export function OpenSCADPreview({
  scadCode,
  color,
  onOutputChange,
  onDxfExportChange,
  fixError,
  isMobile,
  backgroundColor,
}: OpenSCADPreviewProps) {
  const {
    compileScad,
    exportScad,
    writeFile,
    isCompiling,
    output,
    offOutput,
    isError,
    error,
  } = useOpenSCAD();
  const [geometry, setGeometry] = useState<BufferGeometry | null>(null);
  const [coloredGroup, setColoredGroup] = useState<Group | null>(null);
  // Use context directly to avoid throwing if provider is not mounted (e.g. VisualCard)
  const meshFilesCtx = useContext(MeshFilesContext);
  // Track which files we've written to avoid re-writing unchanged blobs
  const writtenFilesRef = useRef<Map<string, Blob>>(new Map());
  // Hold on to the last colored group so its meshes' GPU resources can be
  // released when a new compile replaces it (or the component unmounts).
  const mountedGroupRef = useRef<Group | null>(null);
  // Same story for the STL-path BufferGeometry — every compile produces a
  // fresh one, and even when OFF wins the render the STL still parses, so
  // the previous geometry's VRAM must be released on replacement.
  const mountedGeometryRef = useRef<BufferGeometry | null>(null);
  // Capture the brand fallback color in a ref so the OFF-parse effect can
  // read the current value without listing `color` as a dependency —
  // otherwise every fallback-color change would rebuild the entire
  // per-color mesh group, which gets expensive for large models.
  const fallbackColorRef = useRef(color);
  useEffect(() => {
    fallbackColorRef.current = color;
  }, [color]);

  // Shared by preview compilation and on-demand exports so import() files are
  // available in the OpenSCAD worker before either operation runs.
  const prepareMeshFiles = useCallback(
    async (code: string) => {
      // Extract any import() filenames from the code
      const importedFiles = extractImportFilenames(code);

      // Write any mesh files that haven't been written yet
      if (!meshFilesCtx) return;

      for (const filename of importedFiles) {
        const meshContent = meshFilesCtx.getMeshFile(filename);
        const writtenBlob = writtenFilesRef.current.get(filename);
        const needsWrite =
          meshContent && (!writtenBlob || writtenBlob !== meshContent);

        if (needsWrite && meshContent) {
          await writeFile(filename, meshContent);
          writtenFilesRef.current.set(filename, meshContent);
        }
      }
    },
    [writeFile, meshFilesCtx],
  );

  // Recompile the preview whenever the current SCAD code changes.
  useEffect(() => {
    if (!scadCode) return;

    const compileWithMeshFiles = async () => {
      try {
        await prepareMeshFiles(scadCode);
        compileScad(scadCode);
      } catch (err) {
        console.error('[OpenSCAD] Error preparing files for compilation:', err);
      }
    };

    compileWithMeshFiles();
  }, [scadCode, compileScad, prepareMeshFiles]);

  // Register a parent-owned DXF exporter for the current SCAD code. The export
  // runs only when the user chooses DXF from the download menu.
  useEffect(() => {
    if (!scadCode || !onDxfExportChange) return;

    onDxfExportChange(async () => {
      await prepareMeshFiles(scadCode);
      return exportScad(createDXFProjectionCode(scadCode), 'dxf');
    });

    return () => onDxfExportChange(null);
  }, [scadCode, exportScad, onDxfExportChange, prepareMeshFiles]);

  useEffect(() => {
    onOutputChange?.(output);

    // Mirror the colored-group pattern: every path that clears geometry
    // state must first release the previous vertex buffers, otherwise
    // recompiles + no-output transitions leak VRAM the same way the group
    // path used to.
    const clearGeometry = () => {
      if (mountedGeometryRef.current) {
        mountedGeometryRef.current.dispose();
        mountedGeometryRef.current = null;
      }
      setGeometry(null);
    };

    if (output && output instanceof Blob) {
      let cancelled = false;
      output
        .arrayBuffer()
        .then((buffer) => {
          if (cancelled) return;
          const loader = new STLLoader();
          const geom = loader.parse(buffer);
          geom.center();
          geom.computeVertexNormals();
          if (mountedGeometryRef.current) mountedGeometryRef.current.dispose();
          mountedGeometryRef.current = geom;
          setGeometry(geom);
        })
        .catch((err) => {
          console.error('[OpenSCAD] Failed to parse STL preview:', err);
          if (!cancelled) clearGeometry();
        });
      return () => {
        cancelled = true;
      };
    } else {
      clearGeometry();
    }
  }, [output, onOutputChange]);

  useEffect(() => {
    let cancelled = false;

    // Centralize the "clear colored group" path so the previous group's GPU
    // resources are always released before we drop the reference, no matter
    // which branch fires (no-OFF, parse error, empty-after-filtering).
    const clearColoredGroup = () => {
      if (mountedGroupRef.current) {
        disposeColoredGroup(mountedGroupRef.current);
        mountedGroupRef.current = null;
      }
      setColoredGroup(null);
    };

    if (!(offOutput instanceof Blob)) {
      clearColoredGroup();
      return;
    }

    offOutput
      .text()
      .then((text) => {
        if (cancelled) return;

        const fallback = parseHexColor(fallbackColorRef.current);
        const group = buildColoredGroupFromOff(text, fallback);

        // If every face was rejected (malformed OFF, empty mesh, etc.) the
        // helper returns null — leave coloredGroup null so the render gate
        // falls back to the single-color STL path instead of drawing nothing.
        if (!group) {
          if (!cancelled) clearColoredGroup();
          return;
        }

        // Release the previous group's GPU resources before swapping it in.
        if (mountedGroupRef.current)
          disposeColoredGroup(mountedGroupRef.current);
        mountedGroupRef.current = group;
        setColoredGroup(group);
      })
      .catch((err) => {
        console.error('[OpenSCAD] Failed to parse OFF preview:', err);
        if (!cancelled) clearColoredGroup();
      });

    return () => {
      cancelled = true;
    };
  }, [offOutput]);

  // Release the last mounted group's and geometry's GPU resources on unmount.
  useEffect(() => {
    return () => {
      if (mountedGroupRef.current) {
        disposeColoredGroup(mountedGroupRef.current);
        mountedGroupRef.current = null;
      }
      if (mountedGeometryRef.current) {
        mountedGeometryRef.current.dispose();
        mountedGeometryRef.current = null;
      }
    };
  }, []);

  return (
    <div className="relative h-full w-full bg-adam-neutral-700/50 transition-all duration-300 ease-in-out">
      <div className="h-full w-full">
        {geometry || coloredGroup ? (
          <div className="h-full w-full">
            <ThreeScene
              geometry={geometry}
              coloredGroup={coloredGroup}
              color={color}
              isMobile={isMobile}
              backgroundColor={backgroundColor}
            />
          </div>
        ) : (
          <>
            {isError && (
              <div className="flex h-full items-center justify-center">
                <FixWithAIButton error={error} fixError={fixError} />
              </div>
            )}
          </>
        )}
        {isCompiling && (
          <div className="absolute inset-0 flex items-center justify-center bg-adam-neutral-700/30 backdrop-blur-sm">
            <Loader2 className="h-8 w-8 animate-spin text-adam-text-primary/70" />
          </div>
        )}
      </div>
    </div>
  );
}

// Alias for backwards compatibility (ViewerSection imports OpenSCADViewer)
export { OpenSCADPreview as OpenSCADViewer };

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
            'hover:shadow-[0_0_25px_rgba(249,115,184,0.4)]',
            'focus:outline-none focus:ring-2 focus:ring-adam-blue/30',
          )}
          onClick={() => {
            // error crosses the worker boundary as a plain object, so
            // instanceof OpenSCADError won't narrow — check the name
            // discriminator and narrow via a local type guard instead of
            // a cast.
            const isOpenSCADError = (e: unknown): e is OpenSCADError =>
              !!e &&
              typeof e === 'object' &&
              'name' in e &&
              e.name === 'OpenSCADError';
            if (isOpenSCADError(error)) fixError?.(error);
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
