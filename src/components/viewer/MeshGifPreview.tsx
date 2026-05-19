import { useMeshData } from '@/hooks/useMeshData';
import { Loader2 } from 'lucide-react';
import {
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react';
import * as THREE from 'three';
import { GLTF, GLTFLoader, GLTFParser } from 'three-stdlib';
import { STLLoader } from 'three/addons/loaders/STLLoader.js';
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';
import { useConversation } from '@/contexts/ConversationContext';
import * as omggif from 'omggif';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { getSafeFilename } from '@/utils/file-utils';
import quantizeFragmentShader from '@/utils/quantize.frag?raw';

const vertexShader = `
  out vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const fragmentShader = quantizeFragmentShader;

export function MeshGifPreview({
  ref,
  meshId,
  externalGltf,
  setIsGenerating,
  setProgress,
  setReadyToDownload,
}: {
  ref: React.RefObject<{ downloadGIF: () => Promise<void> } | null>;
  meshId?: string;
  externalGltf?: GLTF | null;
  setIsGenerating: (isGenerating: boolean) => void;
  setProgress: (progress: number) => void;
  setReadyToDownload: (readyToDownload: boolean) => void;
}) {
  const { conversation } = useConversation();
  const [gltf, setGltf] = useState<GLTF | null>(externalGltf ?? null);
  const [canvas, setCanvas] = useState<HTMLCanvasElement | null>(null);
  const logoImage = useMemo(() => {
    const img = new Image();
    img.src = `${import.meta.env.BASE_URL}/adam-logo-full.svg`; // served from public folder root
    return img;
  }, []);
  const isGeneratingRef = useRef(false);
  const animationIdRef = useRef<number | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const pmremGeneratorRef = useRef<THREE.PMREMGenerator | null>(null);

  // Cleanup function for Three.js objects
  const cleanupThreeJS = useCallback(() => {
    // Stop animation loop
    if (animationIdRef.current) {
      cancelAnimationFrame(animationIdRef.current);
      animationIdRef.current = null;
    }

    // Dispose of renderer
    if (rendererRef.current) {
      rendererRef.current.dispose();
      rendererRef.current = null;
    }

    // Dispose of scene and its children
    if (sceneRef.current) {
      sceneRef.current.traverse((child) => {
        if (child instanceof THREE.Mesh) {
          if (child.geometry) {
            child.geometry.dispose();
          }
          if (child.material) {
            if (Array.isArray(child.material)) {
              child.material.forEach((material) => material.dispose());
            } else {
              child.material.dispose();
            }
          }
        }
      });
      sceneRef.current = null;
    }

    // Dispose of camera
    if (cameraRef.current) {
      cameraRef.current = null;
    }

    // Dispose of PMREM generator
    if (pmremGeneratorRef.current) {
      pmremGeneratorRef.current.dispose();
      pmremGeneratorRef.current = null;
    }

    // Clear GLTF
    setGltf(null);
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      cleanupThreeJS();
    };
  }, [cleanupThreeJS]);

  useEffect(() => {
    if (externalGltf !== undefined) {
      setGltf(externalGltf);
      return;
    }
    setGltf(null);
  }, [meshId, externalGltf]);

  const {
    data: { data: meshData, isLoading: isMeshDataLoading },
    blob: { data: mesh, isLoading: isMeshLoading },
  } = useMeshData({
    id: meshId ?? '',
  });

  useEffect(() => {
    if (externalGltf) return; // skip blob load when caller provided gltf directly
    const loadMesh = async (meshBlob: Blob) => {
      try {
        const fileType = meshData?.file_type || 'glb';
        const arrayBuffer = await meshBlob.arrayBuffer();

        if (fileType === 'stl') {
          // Handle STL files
          const loader = new STLLoader();
          const geometry = loader.parse(arrayBuffer);

          // Center the geometry
          geometry.center();
          geometry.computeVertexNormals();

          // Create a mesh with the STL geometry
          const material = new THREE.MeshStandardMaterial({
            color: 0x888888,
            metalness: 0.6,
            roughness: 0.3,
          });
          const stlMesh = new THREE.Mesh(geometry, material);

          // Create a GLTF-like structure for compatibility
          const scene = new THREE.Group();
          scene.add(stlMesh);

          const mockGltf: GLTF = {
            scene: scene,
            scenes: [scene],
            cameras: [],
            animations: [],
            asset: {},
            parser: {} as GLTFParser,
            userData: {},
          };

          setGltf(mockGltf);
        } else if (fileType === 'obj') {
          // Handle OBJ files
          const loader = new OBJLoader();
          const objText = new TextDecoder().decode(arrayBuffer);
          const objGroup = loader.parse(objText);

          // Create a GLTF-like structure for compatibility
          const mockGltf: GLTF = {
            scene: objGroup,
            scenes: [objGroup],
            cameras: [],
            animations: [],
            asset: {},
            parser: {} as GLTFParser,
            userData: {},
          };

          setGltf(mockGltf);
        } else if (fileType === 'fbx') {
          // Handle FBX files (binary format from Tripo API)
          try {
            const loader = new FBXLoader();
            // FBX files from Tripo are binary format, not text
            // Use the binary data directly
            const fbxGroup = loader.parse(arrayBuffer, '');

            // Scale down FBX models (they tend to be very large)
            fbxGroup.scale.setScalar(0.01); // Scale to 1% of original size

            // Center the model
            const box = new THREE.Box3().setFromObject(fbxGroup);
            const center = box.getCenter(new THREE.Vector3());
            fbxGroup.position.sub(center);

            // Convert FBX materials to MeshStandardMaterial for consistency
            fbxGroup.traverse((child) => {
              if (child instanceof THREE.Mesh && child.material) {
                const materials = Array.isArray(child.material)
                  ? child.material
                  : [child.material];

                const convertedMaterials = materials.map((mat) => {
                  // If it's already MeshStandardMaterial, keep it
                  if (mat instanceof THREE.MeshStandardMaterial) {
                    return mat;
                  }

                  // Convert other material types to MeshStandardMaterial
                  const standardMat = new THREE.MeshStandardMaterial();

                  // Copy common properties
                  if ('color' in mat && mat.color) {
                    standardMat.color = mat.color.clone();
                  }
                  if ('map' in mat && mat.map) {
                    standardMat.map = mat.map;
                  }
                  if ('normalMap' in mat && mat.normalMap) {
                    standardMat.normalMap = mat.normalMap;
                  }
                  if ('emissive' in mat && mat.emissive) {
                    standardMat.emissive = mat.emissive.clone();
                  }
                  if ('emissiveMap' in mat && mat.emissiveMap) {
                    standardMat.emissiveMap = mat.emissiveMap;
                  }

                  // Set default PBR values
                  standardMat.roughness = 0.5;
                  standardMat.metalness = 0.0;

                  // Copy other properties
                  standardMat.transparent = mat.transparent;
                  standardMat.opacity = mat.opacity;
                  standardMat.side = mat.side;

                  // Dispose of the original material to free WebGL resources
                  mat.dispose();

                  return standardMat;
                });

                // Apply the converted materials
                if (Array.isArray(child.material)) {
                  child.material = convertedMaterials;
                } else {
                  child.material = convertedMaterials[0];
                }
              }
            });

            // Create a GLTF-like structure for compatibility
            const mockGltf: GLTF = {
              scene: fbxGroup,
              scenes: [fbxGroup],
              cameras: [],
              animations: [],
              asset: {},
              parser: {} as GLTFParser,
              userData: {},
            };

            setGltf(mockGltf);
          } catch {
            // Silently fail and continue
          }
        } else {
          // Handle GLB files (original logic)
          const loader = new GLTFLoader();
          loader.parse(
            arrayBuffer,
            '',
            (parsedGltf) => {
              setGltf(parsedGltf);
            },
            (error) => {
              console.error('Error loading GLB model:', error);
            },
          );
        }
      } catch (error) {
        console.error('Error processing mesh:', error);
      }
    };

    if (mesh && meshData) {
      loadMesh(mesh);
    }
  }, [mesh, meshData, externalGltf]);

  const renderer = useMemo(() => {
    if (!canvas) {
      return null;
    }

    // Clean up previous renderer
    if (rendererRef.current) {
      rendererRef.current.dispose();
    }

    const renderer = new THREE.WebGLRenderer({
      canvas: canvas,
    });

    // Size to the canvas's actual layout box instead of forcing a 1.618
    // ratio — when the wrapper is, say, h-56 × ~262px the old math made a
    // 262×162 buffer and left a 62px black bar below.
    const width = canvas.clientWidth || 1;
    const height = canvas.clientHeight || width;
    renderer.setSize(width, height, false);
    renderer.setClearColor(0xffffff, 1);
    rendererRef.current = renderer;

    return renderer;
  }, [canvas]);

  const camera = useMemo(() => {
    // Clean up previous camera
    cameraRef.current = null;

    const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 1000);
    camera.position.set(0, 0, 3);
    cameraRef.current = camera;
    return camera;
  }, []);

  // Keep the camera aspect matched to the canvas. Runs whenever the
  // renderer (and therefore canvas dimensions) settles.
  useEffect(() => {
    if (!canvas || !camera) return;
    const width = canvas.clientWidth || 1;
    const height = canvas.clientHeight || width;
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
  }, [canvas, camera, renderer]);

  // Add effect to adjust camera so the mesh is fully in view
  useEffect(() => {
    if (!gltf || !camera || !renderer) {
      return;
    }

    // Compute the bounding box and sphere of the model
    const box = new THREE.Box3().setFromObject(gltf.scene);
    const center = box.getCenter(new THREE.Vector3());

    // Center the model at the origin
    gltf.scene.position.sub(center);

    // Calculate a bounding sphere that encompasses the entire model
    const sphere = new THREE.Sphere();
    box.getBoundingSphere(sphere);
    const radius = sphere.radius;

    // Vertical and horizontal field-of-view (in radians)
    const vFov = THREE.MathUtils.degToRad(camera.fov);
    const hFov = 2 * Math.atan(Math.tan(vFov / 2) * camera.aspect);

    // Required distances to fit the bounding sphere in view
    const distanceV = radius / Math.sin(vFov / 2);
    const distanceH = radius / Math.sin(hFov / 2);

    // Pick the larger distance to ensure the model fits in both dimensions
    const distance = Math.max(distanceV, distanceH);

    // Apply a margin so the model is not touching the frame
    camera.position.set(0, 0, distance);
    camera.near = distance / 100;
    camera.far = distance * 100;
    camera.updateProjectionMatrix();
  }, [gltf, camera, renderer]);

  const renderScene = useMemo(() => {
    if (!renderer) {
      return null;
    }

    // Clean up previous scene and PMREM generator
    if (sceneRef.current) {
      sceneRef.current.traverse((child) => {
        if (child instanceof THREE.Mesh) {
          if (child.geometry) {
            child.geometry.dispose();
          }
          if (child.material) {
            if (Array.isArray(child.material)) {
              child.material.forEach((material) => material.dispose());
            } else {
              child.material.dispose();
            }
          }
        }
      });
    }

    if (pmremGeneratorRef.current) {
      pmremGeneratorRef.current.dispose();
    }

    const pmremGenerator = new THREE.PMREMGenerator(renderer);
    pmremGeneratorRef.current = pmremGenerator;

    const renderScene = new THREE.Scene();
    sceneRef.current = renderScene;

    renderScene.background = new THREE.Color(0x3b3b3b);
    renderScene.environment = pmremGenerator.fromScene(
      new RoomEnvironment(),
      0.04,
    ).texture;

    // `RoomEnvironment` alone lights Tripo GLBs (full PBR maps) but leaves a
    // plain `MeshStandardMaterial` — the OpenSCAD path — rendering black. Add
    // an ambient + key directional pair so both surfaces show up. The render
    // loop already preserves `DirectionalLight` children when it swaps the
    // model in, so these survive each render() pass.
    renderScene.add(new THREE.AmbientLight(0xffffff, 0.8));
    const keyLight = new THREE.DirectionalLight(0xffffff, 1.2);
    keyLight.position.set(5, 5, 5);
    renderScene.add(keyLight);

    return renderScene;
  }, [renderer]);

  const render = useCallback(
    (progress: number) => {
      if (!renderer || !renderScene || !gltf) {
        return;
      }

      const scene = gltf.scene;

      // Strip the previous model out before adding the new one. Lights set
      // up in `renderScene` (ambient + key directional) stay across frames
      // — only `Object3D` children that aren't lights get removed.
      [...renderScene.children].forEach((child) => {
        if (!(child instanceof THREE.Light)) renderScene.remove(child);
      });

      renderScene.add(scene);

      // Rotate the entire scene for consistent turntable rotation
      scene.rotation.y = progress * Math.PI * 2;

      renderer.render(renderScene, camera);
    },
    [renderer, camera, renderScene, gltf],
  );

  useEffect(() => {
    function animate(time: number) {
      if (!isGeneratingRef.current) {
        render((time / 5000) % 1);
      }

      animationIdRef.current = requestAnimationFrame(animate);
    }

    animationIdRef.current = requestAnimationFrame(animate);

    // Cleanup function for this effect
    return () => {
      if (animationIdRef.current) {
        cancelAnimationFrame(animationIdRef.current);
        animationIdRef.current = null;
      }
    };
  }, [render]);

  const generateGIF = useCallback(
    async (duration: number, fps: number) => {
      if (!canvas) {
        return;
      }

      // Ensure the logo image is fully loaded before starting generation
      if (!logoImage.complete) {
        await new Promise<void>((resolve) => {
          logoImage.onload = () => resolve();
          logoImage.onerror = () => resolve(); // proceed even if load fails
        });
      }

      const frames = duration * fps;

      const newCanvas = document.createElement('canvas');
      newCanvas.width = canvas.width;
      newCanvas.height = canvas.height;

      const context = newCanvas.getContext('2d', { willReadFrequently: true });

      const buffer = new Uint8Array(
        newCanvas.width * newCanvas.height * frames * 5,
      );
      const pixels = new Uint8Array(newCanvas.width * newCanvas.height);
      const writer = new omggif.GifWriter(buffer, canvas.width, canvas.height, {
        loop: 0,
      });

      let current = 0;

      if (!context) {
        throw new Error('Canvas context is null');
      }

      return new Promise<BlobPart>(function addFrame(resolve) {
        render(current / frames);

        context.drawImage(canvas, 0, 0);

        // Draw logo in the bottom-right corner
        const margin = 12;
        const logoWidth = newCanvas.width * 0.15; // 15% of canvas width
        const aspectRatio =
          logoImage.height && logoImage.width
            ? logoImage.height / logoImage.width
            : 1;
        const logoHeight = logoWidth * aspectRatio;
        context.drawImage(
          logoImage,
          newCanvas.width - logoWidth - margin,
          newCanvas.height - logoHeight - margin,
          logoWidth,
          logoHeight,
        );

        const data = context.getImageData(
          0,
          0,
          canvas.width,
          canvas.height,
        ).data;

        const palette = [];

        for (let j = 0, k = 0, jl = data.length; j < jl; j += 4, k++) {
          const r = Math.floor(data[j + 0] * 0.1) * 10;
          const g = Math.floor(data[j + 1] * 0.1) * 10;
          const b = Math.floor(data[j + 2] * 0.1) * 10;
          const color = (r << 16) | (g << 8) | (b << 0);

          const index = palette.indexOf(color);

          if (index === -1) {
            pixels[k] = palette.length;
            palette.push(color);
          } else {
            pixels[k] = index;
          }
        }

        // Force palette to be power of 2 and less than 256, should be handled by the shader

        let powof2 = 1;
        while (powof2 < palette.length && powof2 < 256) {
          powof2 <<= 1;
        }

        palette.length = powof2;

        const delay = 100 / fps; // Delay in hundredths of a sec (100 = 1s)
        const options = { palette: palette, delay: delay };
        writer.addFrame(
          0,
          0,
          canvas.width,
          canvas.height,
          Array.from(pixels),
          options,
        );

        current++;

        setProgress(current / frames);

        if (current < frames) {
          setTimeout(addFrame, 0, resolve);
        } else {
          resolve(buffer.subarray(0, writer.end()));
        }
      });
    },
    [canvas, render, setProgress, logoImage],
  );

  const downloadGIF = useCallback(async () => {
    if (!canvas) {
      return;
    }

    setIsGenerating(true);
    isGeneratingRef.current = true;

    let buffer: BlobPart | undefined;

    try {
      buffer = await generateGIF(4, 30);
    } catch (error) {
      console.error('Error generating GIF:', error);
    } finally {
      setIsGenerating(false);
      isGeneratingRef.current = false;
    }

    // Download
    if (!buffer) {
      return;
    }

    const blob = new Blob([buffer], { type: 'image/gif' });

    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = getSafeFilename(
      conversation.title || 'animation',
      'animation',
    );
    link.click();

    URL.revokeObjectURL(link.href);
  }, [canvas, generateGIF, conversation.title, setIsGenerating]);

  useImperativeHandle(ref, () => ({
    downloadGIF,
  }));

  useEffect(() => {
    if (canvas) {
      setReadyToDownload(true);
    }
  }, [canvas, setReadyToDownload]);

  const canvasRefCallback = useCallback((element: HTMLCanvasElement) => {
    setCanvas(element);
  }, []);

  useEffect(() => {
    if (!gltf || !renderer) {
      return;
    }

    gltf.scene.traverse((child) => {
      if (child instanceof THREE.Mesh && child.material) {
        const texture: THREE.Texture | null = child.material.map;
        if (!texture) {
          return;
        }

        // Dispose original material (assume non-array)
        if (!Array.isArray(child.material)) {
          child.material.dispose?.();
        }

        child.material = new THREE.ShaderMaterial({
          vertexShader,
          fragmentShader,
          glslVersion: THREE.GLSL3,
          uniforms: {
            u_mesh_texture: { value: texture },
          },
        });
      }
    });
  }, [gltf, renderer]);

  // Show a spinner whenever we don't yet have anything to draw — the
  // meshId fetch path covers Tripo GLB downloads, and `!gltf` covers the
  // OpenSCAD compile path where render() stays a no-op until the caller
  // hands us a gltf via externalGltf. Without this the canvas just sits
  // there as a transparent rectangle showing the dark wrapper through.
  const meshLoading = !!meshId && (isMeshDataLoading || isMeshLoading);
  const showLoader = !gltf && (meshLoading || !meshId);

  return (
    <div className="flex h-full w-full flex-col items-center justify-center gap-2">
      <div className="relative h-full w-full overflow-hidden rounded-lg">
        <canvas
          width="100%"
          className="h-full w-full"
          ref={canvasRefCallback}
        />
        <img
          src={`${import.meta.env.BASE_URL}/adam-logo-full.svg`}
          alt="ADAM logo"
          className="pointer-events-none absolute bottom-3 right-3 w-[15%] select-none"
        />
        {showLoader ? (
          <div className="absolute inset-0 flex items-center justify-center">
            <Loader2 className="h-10 w-10 animate-spin" />
          </div>
        ) : null}
      </div>
    </div>
  );
}
