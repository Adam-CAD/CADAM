import { useEffect, useImperativeHandle, useRef, useState } from 'react';
import * as THREE from 'three';
import { GLTF, GLTFParser } from 'three-stdlib';
import { STLLoader } from 'three/addons/loaders/STLLoader.js';
import { useOpenSCAD } from '@/hooks/useOpenSCAD';
import {
  buildColoredGroupFromOff,
  disposeColoredGroup,
} from '@/utils/coloredOffMesh';
import { MeshGifPreview } from './MeshGifPreview';

const FALLBACK_COLOR_HEX = 0x00a6ff;

// `buildColoredGroupFromOff` expects a packed RGB int as fallback —
// keep this in sync with the editor's brand fallback (see OpenSCADViewer).
const FALLBACK_COLOR_RGB = FALLBACK_COLOR_HEX;

interface OpenSCADGifPreviewProps {
  ref: React.RefObject<{ downloadGIF: () => Promise<void> } | null>;
  code: string;
  setIsGenerating: (isGenerating: boolean) => void;
  setProgress: (progress: number) => void;
  setReadyToDownload: (readyToDownload: boolean) => void;
}

export function OpenSCADGifPreview({
  ref,
  code,
  setIsGenerating,
  setProgress,
  setReadyToDownload,
}: OpenSCADGifPreviewProps) {
  // Use the *preview* path, not the full export — preview uses
  // --backend=manifold + --enable=lazy-union (matching the in-editor live
  // render) and emits an OFF companion with per-face RGBA so we can
  // reproduce OpenSCAD's `color()` calls in the GIF.
  const { previewScadColored } = useOpenSCAD();
  const [gltf, setGltf] = useState<GLTF | null>(null);
  const meshGifRef = useRef<{ downloadGIF: () => Promise<void> } | null>(null);
  const lastColoredGroupRef = useRef<THREE.Group | null>(null);

  useImperativeHandle(ref, () => ({
    downloadGIF: async () => {
      await meshGifRef.current?.downloadGIF();
    },
  }));

  useEffect(() => {
    if (!code) return;
    let stale = false;

    previewScadColored(code)
      .then(async ({ stl, off }) => {
        if (stale) return;

        // Prefer the colored OFF group — same path the editor uses so the
        // shared GIF matches what the author saw in the viewer.
        if (off) {
          try {
            const text = await off.text();
            if (stale) return;
            const colored = buildColoredGroupFromOff(text, FALLBACK_COLOR_RGB);
            if (colored) {
              // Release the previous compile's GPU resources before
              // swapping a new colored group in.
              if (lastColoredGroupRef.current) {
                disposeColoredGroup(lastColoredGroupRef.current);
              }
              lastColoredGroupRef.current = colored;
              const sceneGroup = new THREE.Group();
              sceneGroup.add(colored);
              setGltf(buildMockGltf(sceneGroup));
              return;
            }
          } catch (error) {
            console.error('OpenSCADGifPreview: OFF parse failed', error);
          }
        }

        // Fallback: build a single-color STL mesh.
        const arrayBuffer = await stl.arrayBuffer();
        if (stale) return;

        const loader = new STLLoader();
        const geometry = loader.parse(arrayBuffer);
        geometry.center();
        geometry.computeVertexNormals();

        const material = new THREE.MeshStandardMaterial({
          color: FALLBACK_COLOR_HEX,
          metalness: 0.3,
          roughness: 0.5,
        });
        const mesh = new THREE.Mesh(geometry, material);
        const sceneGroup = new THREE.Group();
        sceneGroup.add(mesh);
        setGltf(buildMockGltf(sceneGroup));
      })
      .catch((error) => {
        console.error('OpenSCADGifPreview: preview failed', error);
      });

    return () => {
      stale = true;
    };
  }, [code, previewScadColored]);

  // Release the last colored group's GPU resources on unmount.
  useEffect(() => {
    return () => {
      if (lastColoredGroupRef.current) {
        disposeColoredGroup(lastColoredGroupRef.current);
        lastColoredGroupRef.current = null;
      }
    };
  }, []);

  return (
    <MeshGifPreview
      ref={meshGifRef}
      externalGltf={gltf}
      setIsGenerating={setIsGenerating}
      setProgress={setProgress}
      setReadyToDownload={setReadyToDownload}
    />
  );
}

function buildMockGltf(scene: THREE.Group): GLTF {
  return {
    scene,
    scenes: [scene],
    cameras: [],
    animations: [],
    asset: {},
    parser: {} as GLTFParser,
    userData: {},
  };
}
