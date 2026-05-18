import {
  Environment,
  GizmoHelper,
  GizmoViewcube,
  OrbitControls,
  Stage,
  PerspectiveCamera,
} from '@react-three/drei';
import { Canvas } from '@react-three/fiber';
import { Download, Frown, HeartCrack, ChevronDown } from 'lucide-react';
import {
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useState,
  useRef,
} from 'react';
import * as THREE from 'three';
import { GLTF, GLTFLoader, GLTFParser } from 'three-stdlib';
import { STLLoader } from 'three/addons/loaders/STLLoader.js';
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';
import { Button } from '@/components/ui/button';

import { GlbPreview } from './GlbPreview';
import { useGlbPreview } from '@/hooks/useGlbPreview';
import { LightingControls } from './LightingControls';

import posthog from 'posthog-js';
import { useIsMobile } from '@/hooks/useIsMobile';
import { cn } from '@/lib/utils';
import { useMeshData } from '@/hooks/useMeshData';
import { DownloadMenu } from './DownloadMenu';
import { WireframeIcon } from '@/components/icons/ui/WireframeIcon';

// Default values for material controls
import {
  DEFAULT_BRIGHTNESS,
  DEFAULT_BRIGHTNESS_UPSCALED,
  DEFAULT_ROUGHNESS,
  DEFAULT_NORMAL_INTENSITY,
  getModelDefaultBrightness,
  isCreativeModel,
} from '@/constants/meshConstants';

/**
 * ModelWithControls - Renders a 3D model with adjustable material properties.
 *
 * This component applies visual adjustments to the model's materials:
 * - Brightness: Controls overall lighting intensity and material brightness
 * - Roughness: Controls surface shininess and material roughness
 * - Normal Intensity: Controls normal map bump strength
 * - Wireframe: Shows mesh structure in wireframe mode
 *
 * The component stores original material properties when first mounted to allow
 * non-destructive adjustments. Material changes are applied using the stored originals
 * to prevent cumulative changes that could distort the model's appearance.
 */
function ModelWithControls({
  gltf,
  brightness,
  roughness,
  normalIntensity,
  showTexture,
  wireframe,
  isUpscaled = false,
}: {
  gltf: GLTF;
  brightness: number;
  roughness: number;
  normalIntensity: number;
  showTexture: boolean;
  wireframe: boolean;
  isUpscaled?: boolean;
}) {
  // Reference to the scene to update materials
  const modelRef = useRef<THREE.Group>(null);
  // Store original material properties including all PBR maps
  const originalMaterials = useRef<
    Map<
      THREE.Material,
      {
        color?: THREE.Color;
        emissive?: THREE.Color;
        map?: THREE.Texture | null;
        normalMap?: THREE.Texture | null;
        roughnessMap?: THREE.Texture | null;
        metalnessMap?: THREE.Texture | null;
        aoMap?: THREE.Texture | null;
        wireframe?: boolean;
        vertexColors?: boolean;
      }
    >
  >(new Map());

  // Track if initial material processing is complete
  const [materialsInitialized, setMaterialsInitialized] = useState(false);

  // Map brightness from 0-100 to 0-2 range (allows for brightening)
  const actualBrightness = brightness / 50;
  // Map roughness from 0-100 to 0.0-1.0 range
  const actualRoughness = roughness / 100;
  // Map normal intensity from 0-100 to 0.0-1.0 range
  const actualNormalIntensity = normalIntensity / 100;

  // Reset materials map when component is remounted with a different model
  useEffect(() => {
    // Clear the materials map when the component mounts
    originalMaterials.current = new Map();
    setMaterialsInitialized(false);
  }, [gltf]);

  // Function to apply material adjustments
  const applyMaterialAdjustments = useCallback(() => {
    if (!modelRef.current) return;

    modelRef.current.traverse((child: THREE.Object3D) => {
      if (child instanceof THREE.Mesh && child.material) {
        const applyToMaterial = (mat: THREE.Material) => {
          const original = originalMaterials.current.get(mat);
          if (!original) return;

          // Handle wireframe mode first since it affects color
          if ('wireframe' in mat && 'color' in mat) {
            const wireframeMat = mat as THREE.MeshStandardMaterial;
            wireframeMat.wireframe = wireframe;

            if (wireframe) {
              // Set wireframe color to white
              wireframeMat.color.setHex(0xffffff); // White wireframe

              // Add emissive glow for brightness
              if ('emissive' in wireframeMat) {
                const emissive = wireframeMat.emissive;
                if (emissive) {
                  emissive.setHex(0xffffff); // White emissive glow
                }
              }

              // Set line width for thicker lines (where supported)
              if ('wireframeLinewidth' in wireframeMat) {
                wireframeMat.wireframeLinewidth = 3;
              }

              // Increase opacity for better visibility
              if ('opacity' in wireframeMat) {
                wireframeMat.opacity = 1.0;
              }
            } else {
              // Restore original color when wireframe is disabled
              if (original.color) {
                wireframeMat.color.copy(original.color);
              }

              // Reset emissive
              if ('emissive' in wireframeMat && original.emissive) {
                const emissive = wireframeMat.emissive;
                if (emissive) {
                  emissive.copy(original.emissive);
                }
              } else if ('emissive' in wireframeMat) {
                const emissive = wireframeMat.emissive;
                if (emissive) {
                  emissive.setHex(0x000000);
                }
              }

              // Reset wireframe line width
              if ('wireframeLinewidth' in wireframeMat) {
                wireframeMat.wireframeLinewidth = 1;
              }
            }
          }

          // Only apply brightness adjustments if not in wireframe mode
          if (!wireframe) {
            // Apply to color property if it exists
            if ('color' in mat && original.color) {
              const colorMat = mat as THREE.MeshStandardMaterial;

              // Check if model uses texture maps or vertex colors
              const hasTextureMap =
                original.map !== null && original.map !== undefined;
              const hasVertexColors = original.vertexColors === true;

              // In textureless mode for models with baked base colors (like upscaled models),
              // use neutral gray as the base instead of original color
              const useGrayBase =
                !showTexture && !hasTextureMap && !hasVertexColors;
              const baseColor = useGrayBase
                ? { r: 0.533, g: 0.533, b: 0.533 } // 0x888888 in normalized RGB
                : original.color;

              // Apply brightness
              const r = Math.min(
                1,
                Math.max(0, baseColor.r * actualBrightness),
              );
              const g = Math.min(
                1,
                Math.max(0, baseColor.g * actualBrightness),
              );
              const b = Math.min(
                1,
                Math.max(0, baseColor.b * actualBrightness),
              );

              colorMat.color.setRGB(r, g, b);
            }

            // Apply to emissive property if it exists (affects brightness)
            if ('emissive' in mat && original.emissive) {
              const emissiveMat = mat as THREE.MeshStandardMaterial;
              // Use brightness for emissive intensity
              // Upscaled models with textures need much stronger emissive to appear correctly lit
              const baseIntensity = Math.max(0, (actualBrightness - 1) * 0.2);
              const intensity = isUpscaled ? baseIntensity * 3 : baseIntensity;
              emissiveMat.emissive.setRGB(intensity, intensity, intensity);
            }
          }

          // Handle PBR material properties
          if ('roughness' in mat || 'normalMap' in mat || 'map' in mat) {
            const pbrMat = mat as THREE.MeshStandardMaterial;

            // Handle albedo/diffuse map (show/hide based on showTexture)
            // Only modify the map when toggling textures - don't clear if we have no stored original
            if ('map' in pbrMat) {
              if (!showTexture) {
                // Explicitly textureless mode - clear the map
                pbrMat.map = null;
              } else if (original.map) {
                // Restore original map if we have one stored
                pbrMat.map = original.map;
              }
              // If showTexture is true and no original.map, leave the current map alone
            }

            // Handle vertex colors (SAM-3D models use vertex colors instead of textures)
            if ('vertexColors' in pbrMat) {
              if (!showTexture) {
                // Explicitly textureless mode - disable vertex colors
                pbrMat.vertexColors = false;
              } else if (original.vertexColors !== undefined) {
                // Restore original vertex colors setting
                pbrMat.vertexColors = original.vertexColors;
              }
              // If showTexture is true and no original setting, leave it alone
            }

            // Handle roughness - use slider value
            if ('roughness' in pbrMat) {
              pbrMat.roughness = actualRoughness;
            }

            // Apply normal map intensity (only if provided)
            if (
              actualNormalIntensity !== undefined &&
              'normalMap' in pbrMat &&
              'normalScale' in pbrMat
            ) {
              pbrMat.normalScale = new THREE.Vector2(
                actualNormalIntensity,
                actualNormalIntensity,
              );
            }

            // Ensure material knows it needs to update
            pbrMat.needsUpdate = true;
          }
        };

        if (Array.isArray(child.material)) {
          child.material.forEach(applyToMaterial);
        } else {
          applyToMaterial(child.material);
        }
      }
    });
  }, [
    actualBrightness,
    actualRoughness,
    actualNormalIntensity,
    showTexture,
    wireframe,
    originalMaterials,
    isUpscaled,
  ]);

  // When component mounts, store original material properties including PBR maps
  useEffect(() => {
    if (modelRef.current && originalMaterials.current.size === 0) {
      // Force refresh to ensure refs are current
      const scene = modelRef.current;

      scene.traverse((child: THREE.Object3D) => {
        if (child instanceof THREE.Mesh && child.material) {
          const storeMaterial = (mat: THREE.MeshStandardMaterial) => {
            // Skip if we've already stored this material
            if (originalMaterials.current.has(mat)) return;

            const originalProps: {
              color?: THREE.Color;
              emissive?: THREE.Color;
              map?: THREE.Texture | null;
              normalMap?: THREE.Texture | null;
              roughnessMap?: THREE.Texture | null;
              metalnessMap?: THREE.Texture | null;
              aoMap?: THREE.Texture | null;
              wireframe?: boolean;
              vertexColors?: boolean;
            } = {};

            // Save color if material has it
            if ('color' in mat && mat.color instanceof THREE.Color) {
              originalProps.color = mat.color.clone();
            }

            // Save emissive if material has it
            if ('emissive' in mat && mat.emissive instanceof THREE.Color) {
              originalProps.emissive = mat.emissive.clone();
            }

            // Save all PBR texture maps if material has them
            if ('map' in mat) {
              originalProps.map = mat.map || null;
            }

            if ('normalMap' in mat) {
              originalProps.normalMap = mat.normalMap || null;
            }

            if ('roughnessMap' in mat) {
              originalProps.roughnessMap = mat.roughnessMap || null;
            }

            if ('metalnessMap' in mat) {
              originalProps.metalnessMap = mat.metalnessMap || null;
            }

            if ('aoMap' in mat) {
              originalProps.aoMap = mat.aoMap || null;
            }

            // Save vertexColors if material has it (SAM-3D uses vertex colors)
            if ('vertexColors' in mat) {
              originalProps.vertexColors = mat.vertexColors;
            }

            // Save wireframe if material has it
            if ('wireframe' in mat) {
              originalProps.wireframe = mat.wireframe || false;
            }

            originalMaterials.current.set(mat, originalProps);
          };

          if (Array.isArray(child.material)) {
            child.material.forEach(storeMaterial);
          } else {
            storeMaterial(child.material);
          }
        }
      });

      // Mark materials as initialized so we can apply settings immediately
      setMaterialsInitialized(true);

      // Schedule an immediate application of material adjustments
      requestAnimationFrame(() => {
        applyMaterialAdjustments();
      });
    }
  }, [gltf, applyMaterialAdjustments]);

  // Apply settings whenever they change
  useEffect(() => {
    if (materialsInitialized) {
      applyMaterialAdjustments();
    }
  }, [materialsInitialized, applyMaterialAdjustments]);

  // Force an update on each render to ensure proper application of settings
  useEffect(() => {
    return () => {
      // Clean up function to handle any potential memory leaks
      originalMaterials.current.clear();
    };
  }, []);

  return <primitive ref={modelRef} object={gltf.scene} />;
}

// Function to calculate polygon count from a 3D model
function calculatePolygonCount(gltfModel: GLTF): number {
  let totalPolygons = 0;

  gltfModel.scene.traverse((child) => {
    if (child instanceof THREE.Mesh && child.geometry) {
      const geometry = child.geometry;

      if (geometry.index) {
        // If geometry has an index, count triangles from index
        totalPolygons += geometry.index.count / 3;
      } else if (geometry.attributes.position) {
        // If no index, count triangles from position attribute
        totalPolygons += geometry.attributes.position.count / 3;
      }
    }
  });

  return Math.floor(totalPolygons);
}

/**
 * MeshPreview - Displays a 3D model with interactive controls for visual adjustments.
 *
 * This component handles:
 * 1. Loading and displaying a 3D model from Supabase storage
 * 2. Providing tools to adjust lighting, contrast, and texture visibility
 * 3. Offering download options in various 3D formats (STL, OBJ, GLB)
 * 4. Toggling between orthographic and perspective camera views
 *
 * Key Implementation Details:
 *
 * - Remounting System:
 *   The component uses a combination of keys and a mountId state to ensure proper
 *   rendering when switching between different models or messages. When meshId changes
 *   or a new model loads, the mountId increments, forcing a complete remount of the
 *   Canvas and ModelWithControls components. This guarantees that material states are
 *   properly reset and visual settings are correctly applied, or when navigating
 *   between different messages in the conversation.
 *
 * - State Initialization:
 *   Default values are applied when loading a new model and when switching between messages.
 *   This ensures consistent behavior regardless of navigation patterns within the application.
 *
 * @param {Object} props - Component props
 * @param {string} props.meshId - Unique identifier for the 3D mesh to display
 */
export function MeshPreview({ meshId }: { meshId: string }) {
  const isMobile = useIsMobile();

  // Replace separate texture and wireframe states with a single view mode
  type ViewMode = 'textured' | 'textureless' | 'wireframe';
  const [viewMode, setViewMode] = useState<ViewMode>('textured');

  // Derived states for backward compatibility
  const showTexture = viewMode === 'textured';
  const wireframe = viewMode === 'wireframe';

  const [brightness, setBrightness] = useState(DEFAULT_BRIGHTNESS);
  const [roughness, setRoughness] = useState(DEFAULT_ROUGHNESS);
  const [normalIntensity, setNormalIntensity] = useState(
    DEFAULT_NORMAL_INTENSITY,
  );
  const [gltf, setGltf] = useState<GLTF | null>(null);
  const [polygonCount, setPolygonCount] = useState<number | undefined>(
    undefined,
  );
  const [error, setError] = useState<string | null>(null);

  // Check if model has PBR maps available
  const [hasPBRMaps, setHasPBRMaps] = useState({
    albedo: false,
    normal: false,
    roughness: false,
    metallic: false,
    ao: false,
  });

  // Fetch mesh data and blob early so it can be used by effects below
  const {
    data: { data: meshData, isLoading: isMeshDataLoading },
    blob: { data: mesh, isLoading: isMeshLoading },
  } = useMeshData({
    id: meshId,
  });

  // Detect upscaled models (need special lighting treatment)
  const isUpscaled = useMemo(
    () =>
      !!(
        meshData?.prompt &&
        typeof meshData.prompt === 'object' &&
        'upscaledFrom' in meshData.prompt &&
        meshData.prompt.upscaledFrom
      ),
    [meshData?.prompt],
  );

  // Reset material states when meshId changes
  useEffect(() => {
    // Reset to defaults when switching between messages
    setViewMode('textured');
    // Set brightness based on model configuration
    // Upscaled models need higher brightness to show color correctly
    const promptModel = meshData?.prompt.model;
    const modelBrightness = isUpscaled
      ? DEFAULT_BRIGHTNESS_UPSCALED
      : promptModel && isCreativeModel(promptModel)
        ? getModelDefaultBrightness(promptModel)
        : DEFAULT_BRIGHTNESS;
    setBrightness(modelBrightness);
    setRoughness(DEFAULT_ROUGHNESS);
    setNormalIntensity(DEFAULT_NORMAL_INTENSITY);
    setGltf(null);
    setPolygonCount(undefined);
    setError(null);
    setHasPBRMaps({
      albedo: false,
      normal: false,
      roughness: false,
      metallic: false,
      ao: false,
    });
  }, [meshId, isUpscaled, meshData?.prompt.model]);

  useEffect(() => {
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
          setPolygonCount(calculatePolygonCount(mockGltf));
        } else if (fileType === 'obj') {
          // Handle OBJ files
          try {
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
            setPolygonCount(calculatePolygonCount(mockGltf));
          } catch {
            // Fallback to GLB loading if OBJ fails
            await loadAsGLB(arrayBuffer);
          }
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

            // Convert FBX materials to MeshStandardMaterial for PBR support
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

                  // Set default PBR values for converted materials
                  standardMat.roughness = 0.5; // Default roughness
                  standardMat.metalness = 0.0; // Default metalness

                  // Copy other common properties
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
            setPolygonCount(calculatePolygonCount(mockGltf));
          } catch {
            // Fallback to GLB loading if FBX fails
            await loadAsGLB(arrayBuffer);
          }
        } else {
          await loadAsGLB(arrayBuffer);
        }

        // Helper function to load as GLB
        async function loadAsGLB(buffer: ArrayBuffer) {
          const loader = new GLTFLoader();
          return new Promise<void>((resolve, reject) => {
            loader.parse(
              buffer,
              '',
              (parsedGltf) => {
                // Center the model
                const box = new THREE.Box3().setFromObject(parsedGltf.scene);
                const center = box.getCenter(new THREE.Vector3());
                parsedGltf.scene.position.sub(center);

                setGltf(parsedGltf);
                setPolygonCount(calculatePolygonCount(parsedGltf));

                // Analyze the loaded model to detect available PBR maps
                const detectedMaps = {
                  albedo: false,
                  normal: false,
                  roughness: false,
                  metallic: false,
                  ao: false,
                };

                parsedGltf.scene.traverse((child) => {
                  if (child instanceof THREE.Mesh && child.material) {
                    const materials = Array.isArray(child.material)
                      ? child.material
                      : [child.material];

                    materials.forEach((mat) => {
                      if ('map' in mat && mat.map) {
                        detectedMaps.albedo = true;
                      }
                      if ('normalMap' in mat && mat.normalMap) {
                        detectedMaps.normal = true;
                      }
                      if ('roughnessMap' in mat && mat.roughnessMap) {
                        detectedMaps.roughness = true;
                      }
                      if ('metalnessMap' in mat && mat.metalnessMap) {
                        detectedMaps.metallic = true;
                      }
                      if ('aoMap' in mat && mat.aoMap) {
                        detectedMaps.ao = true;
                      }
                    });
                  }
                });

                setHasPBRMaps(detectedMaps);
                resolve();
              },
              (error) => {
                setError('Failed to load GLB mesh');
                reject(error);
              },
            );
          });
        }

        // Note: Default values are set by useEffect when meshId changes
        setViewMode('textured');
      } catch {
        setError('Failed to process mesh');
      }
    };

    if (mesh && meshData) {
      loadMesh(mesh);
    }
  }, [mesh, meshData]);

  const handleViewModeChange = (mode: ViewMode) => {
    setViewMode(mode);
    posthog.capture('view_mode_changed', {
      mode,
      meshId,
    });
  };
  if (
    isMeshDataLoading ||
    isMeshLoading ||
    (meshData && meshData.status === 'pending')
  ) {
    return <MeshPreviewPending meshId={meshId} />;
  }

  if (!meshData) {
    return (
      <div className="flex h-full w-full flex-col items-center justify-center gap-2 text-adam-text-primary">
        <Frown className="h-10 w-10" />
        <span>3D Object Data not found</span>
      </div>
    );
  }

  if (meshData.status === 'failure' || error) {
    return (
      <div className="flex h-full w-full flex-col items-center justify-center gap-2 text-adam-text-primary">
        <HeartCrack className="h-10 w-10" />
        <span>3D Object failed to generate</span>
      </div>
    );
  }

  if (!mesh) {
    return (
      <div className="flex h-full w-full flex-col items-center justify-center gap-2 text-adam-text-primary">
        <Frown className="h-10 w-10" />
        <span>3D Object not found</span>
      </div>
    );
  }

  return (
    <div className="relative flex h-full w-full flex-col items-center justify-center gap-2">
      <div
        className={cn(
          'h-full w-full',
          isMobile && 'aspect-square overflow-hidden rounded-lg bg-[#3B3B3B]',
        )}
      >
        {/* Local Suspense boundary — r3f's <Canvas> rethrows suspension
            upward when <Environment preset="city" /> or any other asset
            loader is in flight. Without this boundary the suspension
            unwinds to <Await> in TanStack's StartClient and tears down
            the entire app. */}
        <Suspense fallback={<div className="h-full w-full bg-[#3B3B3B]" />}>
          <Canvas
            gl={{ toneMapping: THREE.NoToneMapping }}
            style={{
              width: '100%',
              height: '100%',
              touchAction: 'none',
            }}
          >
            <color attach="background" args={['#3B3B3B']} />
            <PerspectiveCamera
              makeDefault
              position={[-1, 1, 1]}
              fov={45}
              near={0.1}
              far={1000}
              zoom={0.4}
            />
            <Environment preset="city" />
            <Stage
              environment={null}
              intensity={brightness / 50}
              adjustCamera={false}
            >
              <ambientLight intensity={brightness / 100} />
              {gltf && (
                <ModelWithControls
                  gltf={gltf}
                  brightness={brightness}
                  roughness={roughness}
                  normalIntensity={normalIntensity}
                  showTexture={showTexture}
                  wireframe={wireframe}
                  isUpscaled={isUpscaled}
                />
              )}
            </Stage>
            <OrbitControls makeDefault />
            {!isMobile && (
              <GizmoHelper alignment="top-left" margin={[80, 65]}>
                <GizmoViewcube />
              </GizmoHelper>
            )}
          </Canvas>
        </Suspense>
      </div>

      {/* Bottom center controls for view mode */}
      <div className="absolute bottom-6 left-1/2 hidden -translate-x-1/2 transform lg:flex">
        {meshData?.prompt.model !== 'fast' ? (
          <ViewModeControl
            viewMode={viewMode}
            handleViewModeChange={handleViewModeChange}
          />
        ) : (
          // For fast model, only show wireframe toggle since texture isn't supported
          <div className="flex items-center gap-2 rounded-full bg-adam-neutral-900 px-3 py-2 shadow-[0px_4px_24px_0px_rgba(0,0,0,0.32)]">
            <button
              onClick={() => handleViewModeChange('textureless')}
              className={cn(
                'flex h-8 w-8 items-center justify-center rounded-full transition-colors',
                viewMode === 'textureless' &&
                  'border-2 border-adam-neutral-500',
              )}
              style={{
                background: 'linear-gradient(135deg, #D9D9D9 0%, #6F6F6F 100%)',
              }}
              aria-label="Solid view"
              title="Solid"
            ></button>

            <button
              onClick={() => handleViewModeChange('wireframe')}
              className={cn(
                'flex h-8 w-8 items-center justify-center rounded-full transition-colors',
                viewMode === 'wireframe'
                  ? 'border-2 border-adam-neutral-500 bg-transparent text-adam-neutral-500'
                  : 'bg-transparent text-adam-neutral-500',
              )}
              aria-label="Wireframe view"
              title="Wireframe"
            >
              <WireframeIcon />
            </button>
          </div>
        )}
      </div>

      {!isMobile && (
        <LightingControls
          brightness={brightness}
          roughness={roughness}
          normalIntensity={normalIntensity}
          polygonCount={polygonCount}
          modelQuality={meshData?.prompt.model}
          isUpscaled={isUpscaled}
          onBrightnessChange={setBrightness}
          onRoughnessChange={setRoughness}
          onNormalIntensityChange={setNormalIntensity}
        />
      )}

      {/* Mobile controls */}
      {isMobile && (
        <>
          {/* Mobile download button */}
          {gltf && (
            <div className="mt-4 px-4">
              <DownloadMenu
                hasPBRMaps={hasPBRMaps}
                meshData={meshData}
                gltf={gltf}
                mesh={mesh}
                brightness={brightness}
                roughness={roughness}
                normalIntensity={normalIntensity}
              >
                <Button
                  size="lg"
                  className="mx-auto flex w-[75%] items-center gap-2 px-4 py-2.5 hover:bg-adam-background-2"
                >
                  <Download className="h-4 w-4" />
                  <span>Download</span>
                  <ChevronDown className="ml-1 h-3 w-3 opacity-70" />
                </Button>
              </DownloadMenu>
            </div>
          )}
        </>
      )}

      {/* Desktop download button - bottom right aligned with view mode toggles */}
      {!isMobile && gltf && (
        <div className="absolute bottom-7 right-4 z-10">
          <DownloadMenu
            hasPBRMaps={hasPBRMaps}
            meshData={meshData}
            gltf={gltf}
            mesh={mesh}
            brightness={brightness}
            roughness={roughness}
            normalIntensity={normalIntensity}
          >
            <Button size="lg" className="flex items-center gap-2 px-4 py-2.5">
              <Download className="h-4 w-4" />
              <span className="hidden xl:inline">Download</span>
              <ChevronDown className="ml-1 h-3 w-3 opacity-70" />
            </Button>
          </DownloadMenu>
        </div>
      )}
    </div>
  );
}

function MeshPreviewPending({ meshId }: { meshId: string }) {
  const { data: previewBlob } = useGlbPreview({ id: meshId });
  return (
    <div className="flex h-full w-full items-center justify-center bg-[#3B3B3B]">
      <div className="h-full w-full">
        <GlbPreview glbBlob={previewBlob ?? undefined} />
      </div>
    </div>
  );
}

// Three-state segmented control component
function ViewModeControl({
  viewMode,
  handleViewModeChange,
}: {
  viewMode: 'textured' | 'textureless' | 'wireframe';
  handleViewModeChange: (
    mode: 'textured' | 'textureless' | 'wireframe',
  ) => void;
}) {
  return (
    <div className="flex items-center gap-2 rounded-full bg-adam-neutral-900 px-3 py-2 shadow-[0px_4px_24px_0px_rgba(0,0,0,0.32)]">
      {/* Textured */}
      <button
        onClick={() => handleViewModeChange('textured')}
        className={cn(
          'flex h-8 w-8 items-center justify-center rounded-full transition-colors',
          viewMode === 'textured' && 'border-2 border-adam-neutral-500',
        )}
        style={{
          background: 'linear-gradient(135deg, #FFA3DD 0%, #05AFB8 100%)',
        }}
        aria-label="Textured view"
        title="Textured"
      ></button>

      {/* Textureless */}
      <button
        onClick={() => handleViewModeChange('textureless')}
        className={cn(
          'flex h-8 w-8 items-center justify-center rounded-full transition-colors',
          viewMode === 'textureless' && 'border-2 border-adam-neutral-500',
        )}
        style={{
          background: 'linear-gradient(135deg, #D9D9D9 0%, #6F6F6F 100%)',
        }}
        aria-label="Textureless view"
        title="Solid"
      ></button>

      {/* Wireframe */}
      <button
        onClick={() => handleViewModeChange('wireframe')}
        className={cn(
          'flex h-8 w-8 items-center justify-center rounded-full transition-colors',
          viewMode === 'wireframe'
            ? 'border-2 border-adam-neutral-500 bg-transparent text-adam-neutral-500'
            : 'bg-transparent text-adam-neutral-500',
        )}
        aria-label="Wireframe view"
        title="Wireframe"
      >
        <WireframeIcon />
      </button>
    </div>
  );
}
