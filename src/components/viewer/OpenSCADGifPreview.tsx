import { useEffect, useImperativeHandle, useRef, useState } from 'react';
import * as THREE from 'three';
import { GLTF, GLTFParser } from 'three-stdlib';
import { STLLoader } from 'three/addons/loaders/STLLoader.js';
import { useOpenSCAD } from '@/hooks/useOpenSCAD';
import { MeshGifPreview } from './MeshGifPreview';

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
  const { exportScad } = useOpenSCAD();
  const [gltf, setGltf] = useState<GLTF | null>(null);
  const meshGifRef = useRef<{ downloadGIF: () => Promise<void> } | null>(null);

  useImperativeHandle(ref, () => ({
    downloadGIF: async () => {
      await meshGifRef.current?.downloadGIF();
    },
  }));

  useEffect(() => {
    if (!code) return;
    let stale = false;

    exportScad(code, 'stl')
      .then(async (stlBlob) => {
        if (stale) return;
        const arrayBuffer = await stlBlob.arrayBuffer();
        if (stale) return;

        const loader = new STLLoader();
        const geometry = loader.parse(arrayBuffer);
        geometry.center();
        geometry.computeVertexNormals();

        const material = new THREE.MeshStandardMaterial({
          color: 0x00a6ff,
          metalness: 0.3,
          roughness: 0.5,
        });
        const mesh = new THREE.Mesh(geometry, material);
        const scene = new THREE.Group();
        scene.add(mesh);

        const mockGltf: GLTF = {
          scene,
          scenes: [scene],
          cameras: [],
          animations: [],
          asset: {},
          parser: {} as GLTFParser,
          userData: {},
        };

        setGltf(mockGltf);
      })
      .catch((error) => {
        console.error('OpenSCADGifPreview: compile failed', error);
      });

    return () => {
      stale = true;
    };
  }, [code, exportScad]);

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
