import { useCallback, useEffect, useRef } from 'react';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import vertexShader from '@/utils/points.vert?raw';
import fragmentShader from '@/utils/points.frag?raw';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { adamLogoVertices } from '@/utils/adamLogoVertices';
import { useIsMobile } from '@/hooks/useIsMobile';

interface GlbPreviewProps {
  /**
   * GLB blob (typically the Hunyuan turbo preview returned during mesh generation).
   * While undefined, the Adam-logo particle cloud holds. As soon as the blob arrives
   * the logo dissolves and the mesh point cloud diffuses into place.
   */
  glbBlob?: Blob;
}

// Optimize vertex count based on performance
function optimizeVertexCount(originalCount: number): number {
  const target = 2000;
  if (originalCount <= target) return originalCount;
  const decimation = Math.ceil(originalCount / target);
  return Math.floor(originalCount / decimation);
}

// Constants
const POINT_SIZE = 0.2;
const POINT_SIZE_MOBILE = 0.1;
const LOGO_DISSOLVE_DURATION = 2000;
const DIFFUSION_DURATION = 3000;

export function GlbPreview({ glbBlob }: GlbPreviewProps) {
  // canvas ref
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const isMobile = useIsMobile();

  // three.js persistent refs
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const geometryRef = useRef<THREE.BufferGeometry | null>(null);
  const materialRef = useRef<THREE.ShaderMaterial | null>(null);
  const animationIdRef = useRef<number | null>(null);
  const controlsRef = useRef<OrbitControls | null>(null);
  const pointsRef = useRef<THREE.Points | null>(null);
  const meshLoadedRef = useRef<boolean>(false); // mesh points created & diffusion underway
  const diffusionStartTimeRef = useRef<number | null>(null); // when mesh diffusion starts
  const mouseRef = useRef(new THREE.Vector2(0, 0)); // Track normalized mouse position

  // Dissolve timing is driven by glbBlob arrival, not wall-clock guesses
  const logoDissolveStartTimeRef = useRef<number | null>(null);
  const logoDissolveCompletedRef = useRef<boolean>(false);

  // Store vertices of the loaded mesh until ready to display
  const pendingMeshVerticesRef = useRef<number[] | null>(null);

  // Build / rebuild renderer whenever the canvas mounts or resizes
  const initThree = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    // Dispose previous renderer
    rendererRef.current?.dispose();

    const renderer = new THREE.WebGLRenderer({
      canvas,
      alpha: true,
      antialias: true,
    });
    renderer.setPixelRatio(window.devicePixelRatio);
    rendererRef.current = renderer;

    // Scene & camera
    const scene = new THREE.Scene();
    sceneRef.current = scene;

    const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 1000);
    camera.position.set(0, 0, 5);
    cameraRef.current = camera;

    // Orbit controls
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.05;
    controls.autoRotate = true;
    controls.autoRotateSpeed = 1.0;
    controls.enablePan = false;
    controlsRef.current = controls;

    // Apply background transparency (keep the canvas parent background)
    renderer.setClearColor(0x000000, 0);
  }, []);

  // Pointer move handler to update mouse uniform
  const handlePointerMove = useCallback((event: PointerEvent) => {
    const canvas = canvasRef.current;
    const material = materialRef.current;
    if (!canvas || !material) return;

    const rect = canvas.getBoundingClientRect();
    // Normalize mouse position to 0..1 within the canvas
    const x = (event.clientX - rect.left) / rect.width;
    const y = 1 - (event.clientY - rect.top) / rect.height; // Flip Y so 0 is bottom

    mouseRef.current.set(x, y);
    // Update the uniform in the currently active material
    if (material.uniforms.u_mouse) {
      (material.uniforms.u_mouse.value as THREE.Vector2).set(x, y);
    }
  }, []);

  // Initialise Three.js once the canvas is in the DOM
  useEffect(() => {
    initThree();
    const canvas = canvasRef.current;
    canvas?.addEventListener('pointermove', handlePointerMove);
    return () => {
      canvas?.removeEventListener('pointermove', handlePointerMove);
      // Dispose resources
      if (animationIdRef.current) {
        cancelAnimationFrame(animationIdRef.current);
      }
      rendererRef.current?.dispose();
      geometryRef.current?.dispose();
      materialRef.current?.dispose();
      controlsRef.current?.dispose();
      if (pointsRef.current) {
        sceneRef.current?.remove(pointsRef.current);
        pointsRef.current.geometry?.dispose();
        (pointsRef.current.material as THREE.Material)?.dispose();
        pointsRef.current = null;
      }
      sceneRef.current?.clear();
    };
  }, [initThree, handlePointerMove]);

  // Helper to create / replace the points geometry in the scene
  const createPoints = useCallback(
    (vertices: number[], scene: THREE.Scene, startingProgress: number) => {
      // Remove previous points from scene and dispose resources
      if (pointsRef.current) {
        scene.remove(pointsRef.current);
        pointsRef.current.geometry?.dispose();
        (pointsRef.current.material as THREE.Material)?.dispose();
        pointsRef.current = null;
      }

      // Dispose old standalone geometry/material if any
      geometryRef.current?.dispose();
      materialRef.current?.dispose();

      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute(
        'position',
        new THREE.Float32BufferAttribute(vertices, 3),
      );
      geometry.setAttribute(
        'size',
        new THREE.Float32BufferAttribute(
          vertices.map(() => (isMobile ? POINT_SIZE_MOBILE : POINT_SIZE)),
          1,
        ),
      );
      geometry.center();
      geometry.computeVertexNormals();
      geometryRef.current = geometry;

      const canvas = canvasRef.current;
      const dpr =
        rendererRef.current?.getPixelRatio() || window.devicePixelRatio || 1;
      const resolution = new THREE.Vector2(
        (canvas?.clientWidth || window.innerWidth) * dpr,
        (canvas?.clientHeight || window.innerHeight) * dpr,
      );

      const material = new THREE.ShaderMaterial({
        vertexShader,
        fragmentShader,
        vertexColors: true,
        transparent: true,
        depthWrite: false,
        blending: THREE.NormalBlending,
        glslVersion: THREE.GLSL3,
        uniforms: {
          u_progress: { value: startingProgress }, // default value (will be overridden in loop)
          u_mouse: { value: mouseRef.current },
          u_resolution: { value: resolution },
        },
      });
      materialRef.current = material;

      const points = new THREE.Points(geometry, material);
      scene.add(points);
      pointsRef.current = points;
    },
    [isMobile], // deps are refs which are stable across re-renders
  );

  // GLB loading & point cloud generation (runs after Three.js is initialized)
  useEffect(() => {
    // Reset flags whenever glbBlob changes
    meshLoadedRef.current = false;
    pendingMeshVerticesRef.current = null;

    const createAdamLogoPoints = () => {
      const scene = sceneRef.current;
      if (!scene) {
        return;
      }

      const vertices: number[] = adamLogoVertices;

      createPoints(vertices, scene, 1);
    };

    // Create Adam-logo points immediately (scene is ready now)
    createAdamLogoPoints();
    logoDissolveStartTimeRef.current = null;
    logoDissolveCompletedRef.current = false;
    diffusionStartTimeRef.current = null;

    // If no glbBlob, just keep the Adam logo indefinitely
    if (!glbBlob) {
      return () => {
        if (pointsRef.current) {
          sceneRef.current?.remove(pointsRef.current);
          pointsRef.current.geometry?.dispose();
          (pointsRef.current.material as THREE.Material)?.dispose();
          pointsRef.current = null;
        }
      };
    }

    // Blob has arrived — start dissolve immediately
    logoDissolveStartTimeRef.current = Date.now();
    diffusionStartTimeRef.current =
      logoDissolveStartTimeRef.current + LOGO_DISSOLVE_DURATION;

    // If glbBlob exists, load it and replace random points once loaded
    const loader = new GLTFLoader();
    const url = URL.createObjectURL(glbBlob);

    loader.load(
      url,
      (gltf) => {
        const vertices: number[] = [];

        gltf.scene.traverse((child) => {
          if (child instanceof THREE.Mesh && child.geometry) {
            const pos = child.geometry.attributes
              .position as THREE.BufferAttribute;

            for (let i = 0; i < pos.count; i++) {
              vertices.push(pos.getX(i), pos.getY(i), pos.getZ(i));
            }
          }
        });

        // decimate if necessary
        const vCount = vertices.length / 3;
        const optimised = optimizeVertexCount(vCount);
        if (optimised < vCount) {
          const step = Math.ceil(vCount / optimised);
          const v2: number[] = [];
          for (let i = 0; i < vCount; i += step) {
            v2.push(vertices[i * 3], vertices[i * 3 + 1], vertices[i * 3 + 2]);
          }
          vertices.length = 0;
          vertices.push(...v2);
        }

        // Store vertices until dissolve completes, then they will be rendered
        pendingMeshVerticesRef.current = vertices;

        // If dissolve already done, switch immediately
        if (logoDissolveCompletedRef.current) {
          const scene = sceneRef.current;
          if (scene) {
            createPoints(vertices, scene, 0);
            meshLoadedRef.current = true;
          }
        }
      },
      undefined,
      (err) => {
        console.error('Error loading GLB:', err);
      },
    );

    return () => {
      URL.revokeObjectURL(url);
      if (pointsRef.current) {
        sceneRef.current?.remove(pointsRef.current);
        pointsRef.current.geometry?.dispose();
        (pointsRef.current.material as THREE.Material)?.dispose();
        pointsRef.current = null;
      }
    };
  }, [glbBlob, createPoints]);

  // Main render loop
  useEffect(() => {
    function animate() {
      const renderer = rendererRef.current;
      const scene = sceneRef.current;
      const camera = cameraRef.current;
      const material = materialRef.current;
      const controls = controlsRef.current;
      if (renderer && scene && camera && material) {
        // Progress logic based on vertex shader behavior:
        // u_progress = 0: shows random positions
        // u_progress = 1: shows actual positions

        let progress: number;

        // 1. Run the Adam-logo dissolve (triggered only when glbBlob exists)
        if (
          !logoDissolveCompletedRef.current &&
          logoDissolveStartTimeRef.current
        ) {
          const timeSinceStart = Date.now() - logoDissolveStartTimeRef.current;
          const dissolveProgress = Math.max(
            Math.min(1, timeSinceStart / LOGO_DISSOLVE_DURATION),
            0,
          );
          progress = 1 - dissolveProgress; // Reverse: 1 → 0

          // Before dissolve starts, show adam logo
          if (!pendingMeshVerticesRef.current) {
            progress = 1;
          }

          // Flag completion when done
          if (progress <= 0) {
            logoDissolveCompletedRef.current = true;
            progress = 0; // Ensure fully random at the end

            // If mesh vertices are ready, swap geometry and begin diffusion
            if (
              pendingMeshVerticesRef.current &&
              !meshLoadedRef.current &&
              sceneRef.current
            ) {
              createPoints(pendingMeshVerticesRef.current, sceneRef.current, 0);
              meshLoadedRef.current = true;
            }
          }
        } else {
          // 2. After dissolve, handle mesh diffusion (if available)
          if (!glbBlob) {
            progress = 1; // keep logo if nothing to load
          } else if (!meshLoadedRef.current || !diffusionStartTimeRef.current) {
            // Mesh not ready yet: stay random cloud
            progress = 0;
          } else {
            // Mesh loaded & ready: animate from random (0) → mesh (1)
            const timeSinceDiffusionStart =
              Date.now() - diffusionStartTimeRef.current;
            const diffusionProgress = Math.min(
              1,
              timeSinceDiffusionStart / DIFFUSION_DURATION,
            );

            // Smooth easing (smoothstep)
            const smoothProgress =
              diffusionProgress *
              diffusionProgress *
              (3 - 2 * diffusionProgress);
            progress = smoothProgress; // 0 → 1
          }
        }

        if (canvasRef.current) {
          const { clientWidth: w, clientHeight: h } = canvasRef.current;
          renderer.setSize(w, h, false);
          camera.aspect = w / h || 1;
          camera.updateProjectionMatrix();

          // Update resolution uniform
          const material = materialRef.current;
          if (material && material.uniforms.u_resolution) {
            const dpr = renderer.getPixelRatio();
            (material.uniforms.u_resolution.value as THREE.Vector2).set(
              w * dpr,
              h * dpr,
            );
          }
        }

        material.uniforms.u_progress.value = progress;
        controls?.update();
        renderer.render(scene, camera);
      }
      animationIdRef.current = requestAnimationFrame(animate);
    }

    // Start loop
    animationIdRef.current = requestAnimationFrame(animate);
    return () => {
      if (animationIdRef.current) {
        cancelAnimationFrame(animationIdRef.current);
      }
    };
  }, [glbBlob, createPoints]);

  return (
    <div className="flex h-full w-full items-center justify-center">
      <canvas ref={canvasRef} className="h-full w-full" />
    </div>
  );
}
