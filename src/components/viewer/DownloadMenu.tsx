import { MeshData } from '@shared/types';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '../ui/dropdown-menu';
import { Loader2, ShoppingCart } from 'lucide-react';
import { ReactNode, useCallback, useMemo, useRef, useState } from 'react';
import posthog from 'posthog-js';
import {
  processUserModelForDownload,
  processUserModelForPrint,
} from '@/utils/meshPrintProcessUtils';
import { useConversation } from '@/contexts/ConversationContext';
import { useToast } from '@/hooks/use-toast';
import { generate3DModelFilename } from '@/utils/file-utils';
import { GLTF, OBJExporter, GLTFExporter } from 'three-stdlib';
import { useIsMobile } from '@/hooks/useIsMobile';
import * as Sentry from '@sentry/react';
import * as THREE from 'three';
import { applyMaterialAdjustments } from '@/utils/meshUtils';
import { MeshGifPreview } from './MeshGifPreview';
import { extractAndDownloadTextures } from '@/utils/textureExtraction';
import { Button } from '../ui/button';

// Default values for material controls
const DEFAULT_BRIGHTNESS = 50;
const DEFAULT_ROUGHNESS = 50;
const DEFAULT_NORMAL_INTENSITY = 100;

// Reusable download menu items component
export function DownloadMenu({
  hasPBRMaps,
  meshData,
  gltf,
  mesh,
  brightness,
  roughness,
  normalIntensity,
  children,
}: {
  hasPBRMaps: { [key: string]: boolean };
  meshData: MeshData;
  gltf: GLTF;
  mesh: Blob;
  brightness: number;
  roughness: number;
  normalIntensity: number;
  children: ReactNode;
}) {
  const { conversation } = useConversation();
  const { toast, dismiss } = useToast();
  const isMobile = useIsMobile();

  const [isDropdownOpen, setIsDropdownOpen] = useState(false);

  // GIF generation state
  const [_isGifGenerating, setIsGifGenerating] = useState(false);
  const [_gifProgress, setGifProgress] = useState(0);
  const [isGifReady, setIsGifReady] = useState(false);
  const gifRef = useRef<{ downloadGIF: () => Promise<void> } | null>(null);

  const [isDownloadingSTL, setIsDownloadingSTL] = useState(false);
  const [isOrderProcessing, setIsOrderProcessing] = useState(false);
  const [isDownloadingOBJ, setIsDownloadingOBJ] = useState(false);
  const [isDownloadingGIF, setIsDownloadingGIF] = useState(false);
  const [isDownloadingWithTextures, setIsDownloadingWithTextures] =
    useState(false);
  const [isDownloadingGLB, setIsDownloadingGLB] = useState(false);
  const [isDownloadingFBX, setIsDownloadingFBX] = useState(false);

  // Check if this model supports both GLB and FBX (quad topology models)
  const isQuadModel = useMemo(() => {
    return (
      (meshData?.prompt.model === 'ultra' ||
        meshData?.prompt.model === 'quality') &&
      meshData?.file_type === 'fbx'
    );
  }, [meshData?.prompt.model, meshData?.file_type]);

  // Generate a safe filename for downloads
  const filename = useMemo(() => {
    return generate3DModelFilename({
      conversationTitle: conversation?.title,
      modelName: meshData?.prompt.model,
      fallback: `3d-model-${meshData.id}`,
    });
  }, [conversation?.title, meshData?.prompt.model, meshData.id]);

  const downloadSTL = useCallback(() => {
    posthog.capture('3d_model_download', {
      meshId: meshData.id,
      model_name: meshData?.prompt.model || 'Unknown Model',
      format: 'STL',
      conversation_id: conversation.id,
    });

    setIsDownloadingSTL(true);

    // Force the download to macro task queue
    setTimeout(async () => {
      try {
        // Apply the same scaling logic used for Mandarin3D to ensure proper size
        const processedFile = await processUserModelForPrint(
          gltf,
          () => filename,
        );

        // The processUserModelForPrint already returns a properly sized STL file
        const url = URL.createObjectURL(processedFile);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${filename}.stl`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      } catch (error) {
        Sentry.captureException(error, {
          extra: {
            meshId: meshData.id,
            format: 'STL',
          },
        });
        toast({
          title: 'Error',
          description: 'Failed to prepare STL file.',
          variant: 'destructive',
        });
      } finally {
        setIsDownloadingSTL(false);
        setIsDropdownOpen(false);
      }
    }, 0);
  }, [gltf, toast, filename, meshData, conversation.id]);

  const downloadOBJ = useCallback(() => {
    posthog.capture('3d_model_download', {
      meshId: meshData.id,
      model_name: meshData?.prompt.model || 'Unknown Model',
      format: 'OBJ_WITH_MTL',
      conversation_id: conversation.id,
    });

    setIsDownloadingOBJ(true);

    setTimeout(async () => {
      try {
        // Apply the same scaling logic used for Mandarin3D to ensure proper size
        const processedScene = await processUserModelForDownload(gltf);

        // Helper function to clone and adjust material settings
        const cloneAndAdjustMaterial = (
          mat: THREE.MeshStandardMaterial,
          materialIndex: number,
        ): THREE.MeshStandardMaterial => {
          const clonedMat = mat.clone();

          // Apply current UI settings using shared helper
          const actualBrightness = brightness / 50;
          const actualRoughness = roughness / 100;
          applyMaterialAdjustments(
            clonedMat,
            actualBrightness,
            actualRoughness,
          );

          // Assign material name for MTL reference
          if (!materials.has(clonedMat)) {
            materials.set(clonedMat, `material_${materialIndex}`);
          }

          return clonedMat;
        };

        // Create a clone of the processed scene with current material settings applied
        const clonedScene = new THREE.Scene();
        const materials = new Map<THREE.Material, string>();
        let materialIndex = 0;

        // Clone the processed scene with applied material settings and collect materials
        processedScene.traverse((node) => {
          if (node instanceof THREE.Mesh) {
            const newGeometry = node.geometry.clone();
            let newMaterial;

            if (Array.isArray(node.material)) {
              newMaterial = node.material.map((mat) =>
                cloneAndAdjustMaterial(mat, materialIndex++),
              );
            } else {
              newMaterial = cloneAndAdjustMaterial(
                node.material,
                materialIndex++,
              );
            }

            const newMesh = new THREE.Mesh(newGeometry, newMaterial);
            newMesh.position.copy(node.position);
            newMesh.quaternion.copy(node.quaternion);
            newMesh.scale.copy(node.scale);
            // Use the generated filename instead of "tripo" or original name
            newMesh.name = filename;
            clonedScene.add(newMesh);
          }
        });

        // Export OBJ with material references
        const objExporter = new OBJExporter();
        const objContent = objExporter.parse(clonedScene);

        // Create MTL content
        let mtlContent = `# MTL file for ${filename}\n`;
        mtlContent += `# Generated by Adam - ${new Date().toISOString()}\n`;
        mtlContent += `# Model processed with Mandarin3D scaling for proper size\n\n`;

        for (const [material, materialName] of materials.entries()) {
          mtlContent += `newmtl ${materialName}\n`;

          // Add diffuse color (main color)
          if ('color' in material && material.color instanceof THREE.Color) {
            const color = material.color as THREE.Color;
            mtlContent += `Kd ${color.r.toFixed(6)} ${color.g.toFixed(6)} ${color.b.toFixed(6)}\n`;
            // Ambient color (slightly darker)
            mtlContent += `Ka ${(color.r * 0.2).toFixed(6)} ${(color.g * 0.2).toFixed(6)} ${(color.b * 0.2).toFixed(6)}\n`;
          } else {
            // Default gray color
            mtlContent += `Kd 0.800000 0.800000 0.800000\n`;
            mtlContent += `Ka 0.200000 0.200000 0.200000\n`;
          }

          // Add specular properties based on roughness
          if ('roughness' in material) {
            const roughness =
              (material as THREE.MeshStandardMaterial).roughness || 0.5;
            const shininess = Math.max(1, (1 - roughness) * 128);
            mtlContent += `Ns ${shininess.toFixed(6)}\n`;
            mtlContent += `Ks 0.500000 0.500000 0.500000\n`;
          } else {
            mtlContent += `Ns 32.000000\n`;
            mtlContent += `Ks 0.500000 0.500000 0.500000\n`;
          }

          // Illumination model (2 = highlight on)
          mtlContent += `illum 2\n`;
          // Opacity
          mtlContent += `d 1.000000\n\n`;
        }

        // Add MTL reference to OBJ content
        const objWithMtl = `mtllib ${filename}.mtl\n${objContent}`;

        // Create download helper function
        const downloadFile = (
          content: string,
          filename: string,
          mimeType: string,
        ): Promise<void> => {
          return new Promise((resolve) => {
            const blob = new Blob([content], { type: mimeType });
            const url = URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = url;
            link.download = filename;

            // Use event listener to know when download completes
            link.addEventListener('click', () => {
              // Small delay to ensure download starts, then clean up and resolve
              setTimeout(() => {
                document.body.removeChild(link);
                URL.revokeObjectURL(url);
                resolve();
              }, 100);
            });

            document.body.appendChild(link);
            link.click();
          });
        };

        // Download OBJ file first, then MTL file
        await downloadFile(objWithMtl, `${filename}.obj`, 'text/plain');
        await downloadFile(mtlContent, `${filename}.mtl`, 'text/plain');

        // Clean up cloned scene
        clonedScene.traverse((child) => {
          if (child instanceof THREE.Mesh) {
            child.geometry.dispose();
            if (Array.isArray(child.material)) {
              child.material.forEach((mat) => mat.dispose());
            } else {
              child.material.dispose();
            }
          }
        });

        // Clean up processed scene
        processedScene.traverse((child) => {
          if (child instanceof THREE.Mesh) {
            child.geometry.dispose();
            if (Array.isArray(child.material)) {
              child.material.forEach((mat) => mat.dispose());
            } else {
              child.material.dispose();
            }
          }
        });
      } catch (error) {
        Sentry.captureException(error, {
          extra: {
            meshId: meshData.id,
            format: 'OBJ_WITH_MTL',
          },
        });

        toast({
          title: 'Error',
          description: 'Failed to prepare the OBJ files with colors.',
          variant: 'destructive',
        });
      } finally {
        setIsDownloadingOBJ(false);
        setIsDropdownOpen(false);
      }
    }, 0);
  }, [gltf, brightness, roughness, filename, meshData, conversation.id, toast]);

  const downloadGIF = useCallback(() => {
    posthog.capture('3d_model_download', {
      meshId: meshData.id,
      model_name: meshData?.prompt.model || 'Unknown Model',
      format: 'GIF',
      conversation_id: conversation.id,
    });

    setIsDownloadingGIF(true);

    setTimeout(async () => {
      try {
        if (gifRef.current && isGifReady) {
          await gifRef.current.downloadGIF();
        }
      } catch (error) {
        Sentry.captureException(error, {
          extra: {
            meshId: meshData.id,
            format: 'GIF',
          },
        });

        toast({
          title: 'Error',
          description: 'Failed to generate GIF. Please try again.',
          variant: 'destructive',
        });
      } finally {
        setIsDownloadingGIF(false);
        setIsDropdownOpen(false);
      }
    }, 0);
  }, [isGifReady, meshData, conversation.id, toast]);

  const downloadWithTextures = useCallback(() => {
    posthog.capture('3d_model_download', {
      meshId: meshData.id,
      model_name: meshData?.prompt.model || 'Unknown Model',
      format: 'ZIP_WITH_TEXTURES',
      conversation_id: conversation.id,
      texture_types: Object.entries(hasPBRMaps)
        .filter(([_, hasMap]) => hasMap)
        .map(([type, _]) => type),
    });

    setIsDownloadingWithTextures(true);

    setTimeout(async () => {
      try {
        const fileExtension = meshData?.file_type || 'glb';

        const success = await extractAndDownloadTextures(
          gltf,
          mesh,
          filename,
          fileExtension,
        );

        if (!success) {
          throw new Error('Texture extraction returned false');
        }
      } catch (error) {
        Sentry.captureException(error, {
          extra: {
            meshId: meshData.id,
            format: 'ZIP_WITH_TEXTURES',
            error: error instanceof Error ? error.message : 'Unknown error',
            texture_types: Object.entries(hasPBRMaps)
              .filter(([_, hasMap]) => hasMap)
              .map(([type, _]) => type),
          },
        });

        // Provide more helpful error messages
        let errorDescription = 'Failed to extract textures. ';

        if (error instanceof Error) {
          if (error.message.includes('No PBR textures found')) {
            errorDescription +=
              'The model does not contain any PBR texture maps.';
          } else if (error.message.includes('Failed to convert')) {
            errorDescription +=
              'Texture conversion failed. The texture format might not be supported.';
          } else if (error.message.includes('WebGL')) {
            errorDescription +=
              'Graphics rendering issue. Try refreshing the page.';
          }
        } else {
          errorDescription +=
            'Unknown error occurred during texture extraction.';
        }

        toast({
          title: 'Texture extraction failed',
          description:
            errorDescription + ' You can still download the standard GLB file.',
          variant: 'destructive',
          duration: 8000,
        });
      } finally {
        setIsDownloadingWithTextures(false);
        setIsDropdownOpen(false);
      }
    }, 0);
  }, [gltf, mesh, hasPBRMaps, meshData, conversation.id, toast, filename]);

  const sendToMandarin3D = useCallback(() => {
    setIsOrderProcessing(true);

    setTimeout(async () => {
      let preparingToastId: string | undefined;
      try {
        posthog.capture('3d_print_service_clicked', {
          meshId: meshData.id,
          model_name: meshData?.prompt.model || 'Unknown Model',
          conversation_id: conversation.id,
        });

        const { id } = toast({
          title: 'Preparing model',
          description:
            "We're preparing your 3D model for printing. This might take a few moments.",
        });
        preparingToastId = id;

        const modelFile = await processUserModelForPrint(gltf, () => filename);

        const formData = new FormData();
        formData.append('file', modelFile);
        formData.append('external_source', `adam-${meshData.id}`);

        const response = await fetch(
          'https://backend.mandarin3d.com/api/submit-remote',
          {
            method: 'POST',
            body: formData,
          },
        );

        if (!response.ok) {
          const errorData = await response.json();
          Sentry.captureException(errorData, {
            extra: {
              meshId: meshData.id,
              format: 'ZIP_WITH_TEXTURES',
              texture_types: Object.entries(hasPBRMaps)
                .filter(([_, hasMap]) => hasMap)
                .map(([type, _]) => type),
            },
          });
          throw new Error(
            errorData.message || 'Failed to send model to Mandarin3D',
          );
        }

        const data = await response.json();

        if (preparingToastId) {
          dismiss(preparingToastId);
        }

        // Open the window immediately after receiving the response
        const mandarinWindow = window.open(data.url, '_blank');

        if (mandarinWindow) {
          // Popup was successful
          toast({
            title: 'Success!',
            description:
              "Your model has been sent to Mandarin3D. You'll be redirected to complete your order.",
            duration: 3000,
          });
        } else {
          // Popup was blocked
          toast({
            title: 'Popup Blocked',
            description: (
              <div className="flex flex-col gap-2">
                <p>
                  Please allow popups for this site or click the button below to
                  open Mandarin3D.
                </p>
                <Button
                  onClick={() => window.open(data.url, '_blank')}
                  className="mt-2"
                >
                  Open Mandarin3D
                </Button>
              </div>
            ),
            duration: 10000,
          });
        }

        setIsOrderProcessing(false);
        setIsDropdownOpen(false);
      } catch (error) {
        if (preparingToastId) {
          dismiss(preparingToastId);
        }

        Sentry.captureException(error, {
          extra: {
            meshId: meshData.id,
            format: 'ZIP_WITH_TEXTURES',
            texture_types: Object.entries(hasPBRMaps)
              .filter(([_, hasMap]) => hasMap)
              .map(([type, _]) => type),
          },
        });

        toast({
          title: 'Error',
          description:
            error instanceof Error
              ? error.message
              : 'Failed to send model to Mandarin3D',
          variant: 'destructive',
        });
        setIsOrderProcessing(false);
      }
    }, 0);
  }, [gltf, meshData, conversation.id, toast, dismiss, filename, hasPBRMaps]);

  // Helper function to apply current UI settings to a material
  const applyCurrentSettingsToMaterial = useCallback(
    (material: THREE.MeshStandardMaterial) => {
      const actualBrightness = brightness / 50;
      const actualRoughness = roughness / 100;
      const actualNormalIntensity = normalIntensity / 100;

      applyMaterialAdjustments(
        material,
        actualBrightness,
        actualRoughness,
        actualNormalIntensity,
      );
    },
    [brightness, roughness, normalIntensity],
  );

  // Enhanced GLB creation with embedded PBR textures and applied settings
  const createEnhancedGLB = useCallback(
    async (
      originalScene: THREE.Group | THREE.Scene,
      filename: string,
    ): Promise<Blob> => {
      return new Promise((resolve, reject) => {
        try {
          // Clone the scene with current material settings applied
          const enhancedScene = new THREE.Scene();

          originalScene.traverse((node) => {
            if (node instanceof THREE.Mesh) {
              const newGeometry = node.geometry.clone();
              let newMaterial;

              if (Array.isArray(node.material)) {
                newMaterial = node.material.map((mat) => {
                  const clonedMat = mat.clone();
                  // Apply current UI settings to the cloned material
                  applyCurrentSettingsToMaterial(clonedMat);
                  return clonedMat;
                });
              } else {
                newMaterial = node.material.clone();
                // Apply current UI settings to the cloned material
                applyCurrentSettingsToMaterial(newMaterial);
              }

              const newMesh = new THREE.Mesh(newGeometry, newMaterial);
              newMesh.position.copy(node.position);
              newMesh.quaternion.copy(node.quaternion);
              newMesh.scale.copy(node.scale);
              newMesh.name = filename;
              enhancedScene.add(newMesh);
            }
          });

          // Use GLTFExporter to create GLB with embedded textures
          const exporter = new GLTFExporter();
          exporter.parse(
            enhancedScene,
            (result) => {
              const blob = new Blob([result as ArrayBuffer], {
                type: 'model/gltf-binary',
              });

              // Clean up cloned scene
              enhancedScene.traverse((child) => {
                if (child instanceof THREE.Mesh) {
                  child.geometry.dispose();
                  if (Array.isArray(child.material)) {
                    child.material.forEach((mat) => mat.dispose());
                  } else {
                    child.material.dispose();
                  }
                }
              });

              resolve(blob);
            },
            (error) => {
              reject(error);
            },
            {
              binary: true,
              embedImages: true, // Embed all textures in the GLB
              maxTextureSize: 2048, // Reasonable size limit for compatibility
              includeCustomExtensions: true,
            },
          );
        } catch (error) {
          reject(error);
        }
      });
    },
    [applyCurrentSettingsToMaterial],
  );

  const downloadGLB = useCallback(() => {
    posthog.capture('3d_model_download', {
      meshId: meshData.id,
      model_name: meshData?.prompt.model || 'Unknown Model',
      format: 'GLB_ENHANCED',
      conversation_id: conversation.id,
      has_embedded_textures: Object.values(hasPBRMaps).some(Boolean),
      has_material_adjustments:
        brightness !== DEFAULT_BRIGHTNESS ||
        roughness !== DEFAULT_ROUGHNESS ||
        normalIntensity !== DEFAULT_NORMAL_INTENSITY,
    });

    setIsDownloadingGLB(true);

    setTimeout(async () => {
      try {
        // Create enhanced GLB with embedded textures and applied settings
        const enhancedBlob = await createEnhancedGLB(gltf.scene, filename);

        const url = URL.createObjectURL(enhancedBlob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${filename}.glb`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      } catch (error) {
        Sentry.captureException(error, {
          extra: {
            meshId: meshData.id,
            format: 'GLB_ENHANCED',
          },
        });

        toast({
          title: 'Error',
          description:
            'Failed to create enhanced GLB. Downloading original file instead.',
          variant: 'destructive',
        });

        // Fallback to original GLB download
        try {
          const url = URL.createObjectURL(mesh);
          const a = document.createElement('a');
          a.href = url;
          a.download = `${filename}.glb`;
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
          URL.revokeObjectURL(url);
        } catch (fallbackError) {
          Sentry.captureException(fallbackError, {
            extra: {
              meshId: meshData.id,
              format: 'GLB_ENHANCED',
            },
          });
        }
      } finally {
        setIsDownloadingGLB(false);
        setIsDropdownOpen(false);
      }
    }, 0);
  }, [
    mesh,
    gltf,
    meshData,
    conversation.id,
    toast,
    createEnhancedGLB,
    hasPBRMaps,
    brightness,
    roughness,
    normalIntensity,
    filename,
  ]);

  const downloadFBX = useCallback(() => {
    posthog.capture('3d_model_download', {
      meshId: meshData.id,
      model_name: meshData?.prompt.model || 'Unknown Model',
      format: 'FBX_ORIGINAL',
      conversation_id: conversation.id,
    });

    setIsDownloadingFBX(true);

    setTimeout(async () => {
      try {
        // Download the original FBX file (preserves quad topology but has "tripo node" names)
        const url = URL.createObjectURL(mesh);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${filename}.fbx`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      } catch (error) {
        Sentry.captureException(error, {
          extra: {
            meshId: meshData.id,
            format: 'FBX_ORIGINAL',
          },
        });

        toast({
          title: 'Error',
          description: 'Failed to download FBX file. Please try again.',
          variant: 'destructive',
        });
      } finally {
        setIsDownloadingFBX(false);
        setIsDropdownOpen(false);
      }
    }, 0);
  }, [mesh, meshData, conversation.id, toast, filename]);

  return (
    <>
      <DropdownMenu open={isDropdownOpen} onOpenChange={setIsDropdownOpen}>
        <DropdownMenuTrigger asChild>{children}</DropdownMenuTrigger>
        <DropdownMenuContent align={isMobile ? 'center' : 'end'}>
          <DropdownMenuItem
            onClick={(e) => {
              e.preventDefault();
              downloadSTL();
            }}
            className="cursor-pointer text-adam-text-primary"
            disabled={isDownloadingSTL}
          >
            {isDownloadingSTL ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : null}
            <span className="text-sm">.STL</span>
            <span className="ml-3 text-xs text-adam-text-primary/60">
              {isDownloadingSTL ? 'Downloading...' : '3D Printing'}
            </span>
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onClick={(e) => {
              e.preventDefault();
              downloadOBJ();
            }}
            className="cursor-pointer text-adam-text-primary"
            disabled={isDownloadingOBJ}
          >
            {isDownloadingOBJ ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : null}
            <span className="text-sm">.OBJ</span>
            <span className="ml-3 text-xs text-adam-text-primary/60">
              {isDownloadingOBJ ? 'Downloading...' : 'Universal'}
            </span>
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          {isQuadModel ? (
            <>
              <DropdownMenuItem
                onClick={(e) => {
                  e.preventDefault();
                  downloadGLB();
                }}
                className="cursor-pointer text-adam-text-primary"
                disabled={isDownloadingGLB}
              >
                {isDownloadingGLB ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : null}
                <span className="text-sm">.GLB</span>
                <span className="ml-3 text-xs text-adam-text-primary/60">
                  {isDownloadingGLB ? 'Downloading...' : 'Web & XR'}
                </span>
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onClick={(e) => {
                  e.preventDefault();
                  downloadFBX();
                }}
                className="cursor-pointer text-adam-text-primary"
                disabled={isDownloadingFBX}
              >
                {isDownloadingFBX ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : null}
                <span className="text-sm">.FBX</span>
                <span className="ml-3 text-xs text-adam-text-primary/60">
                  {isDownloadingFBX ? 'Downloading...' : '3D Scene'}
                </span>
              </DropdownMenuItem>
            </>
          ) : (
            <DropdownMenuItem
              onClick={(e) => {
                e.preventDefault();
                downloadGLB();
              }}
              className="cursor-pointer text-adam-text-primary"
              disabled={isDownloadingGLB}
            >
              {isDownloadingGLB ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : null}
              <span className="text-sm">
                .{(meshData?.file_type || 'glb').toUpperCase()}
              </span>
              <span className="ml-3 text-xs text-adam-text-primary/60">
                {isDownloadingGLB ? 'Downloading...' : 'Web & XR'}
              </span>
            </DropdownMenuItem>
          )}
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onClick={(e) => {
              e.preventDefault();
              downloadGIF();
            }}
            className="cursor-pointer text-adam-text-primary"
            disabled={!isGifReady || isDownloadingGIF}
          >
            {isDownloadingGIF ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : null}
            <span className="text-sm">.GIF</span>
            <span className="ml-3 text-xs text-adam-text-primary/60">
              {isDownloadingGIF ? 'Downloading...' : 'Animation'}
            </span>
          </DropdownMenuItem>
          {/* Conditionally show Download with Textures */}
          {Object.values(hasPBRMaps).some(Boolean) && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onClick={(e) => {
                  e.preventDefault();
                  downloadWithTextures();
                }}
                className="cursor-pointer text-adam-text-primary"
                disabled={!gltf || !mesh || isDownloadingWithTextures}
              >
                {isDownloadingWithTextures ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : null}
                <span className="text-sm">.ZIP with Textures</span>
                <span className="ml-3 text-xs text-adam-text-primary/60">
                  {isDownloadingWithTextures
                    ? 'Downloading...'
                    : 'GLB With Textures'}
                </span>
              </DropdownMenuItem>
            </>
          )}
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onClick={(e) => {
              e.preventDefault();
              sendToMandarin3D();
            }}
            className="cursor-pointer text-adam-text-primary"
            disabled={isOrderProcessing}
          >
            {isOrderProcessing ? (
              <Loader2 className="ml-2 h-4 w-4 animate-spin" />
            ) : (
              <ShoppingCart className="ml-2 h-4 w-4" />
            )}
            <span className="ml-3 text-xs text-adam-text-primary/60">
              Print Service
              <span className="ml-1.5 inline-flex items-center rounded-full border border-adam-blue/20 bg-adam-blue/20 px-2 py-1 text-[10px] font-semibold text-adam-blue">
                BETA
              </span>
            </span>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <div
        className="pointer-events-none fixed -left-[1000px] -top-[1000px] z-[-1]"
        style={{
          width: '512px',
          height: '317px',
        }}
      >
        <MeshGifPreview
          ref={gifRef}
          meshId={meshData.id}
          setIsGenerating={setIsGifGenerating}
          setProgress={setGifProgress}
          setReadyToDownload={setIsGifReady}
        />
      </div>
    </>
  );
}
