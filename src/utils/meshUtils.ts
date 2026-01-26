import { STLLoader } from 'three/addons/loaders/STLLoader.js';
import * as THREE from 'three';

export interface BoundingBox {
  x: number;
  y: number;
  z: number;
}

export interface FilamentEstimates {
  volumeCm3: number; // Volume in cubic centimeters
  weightGrams: number; // Weight in grams
  costUSD: number; // Estimated cost in USD
}

// PLA filament density: ~1.24 g/cm³
const PLA_DENSITY_G_CM3 = 1.24;
// Average PLA filament cost: ~$20/kg = $0.02/g
const FILAMENT_COST_PER_GRAM = 0.02;

/**
 * Calculate filament estimates from model volume
 * The mesh volume represents the actual material in the model as designed.
 * @param volumeMm3 - Volume in cubic millimeters (actual mesh volume)
 */
export function calculateFilamentEstimates(
  volumeMm3: number,
): FilamentEstimates {
  // Convert mm³ to cm³ (1 cm³ = 1000 mm³)
  const volumeCm3 = volumeMm3 / 1000;

  // Calculate weight using PLA density (1.24 g/cm³)
  const weightGrams = volumeCm3 * PLA_DENSITY_G_CM3;

  // Calculate cost
  const costUSD = weightGrams * FILAMENT_COST_PER_GRAM;

  return {
    volumeCm3: Math.round(volumeCm3 * 100) / 100,
    weightGrams: Math.round(weightGrams * 100) / 100,
    costUSD: Math.round(costUSD * 100) / 100,
  };
}

export interface STLProcessingResult {
  geometry: THREE.BufferGeometry;
  boundingBox: BoundingBox;
  renders: Blob[];
}

/**
 * Parse an STL file and extract geometry with bounding box
 */
export async function parseSTL(
  file: File,
): Promise<{ geometry: THREE.BufferGeometry; boundingBox: BoundingBox }> {
  const buffer = await file.arrayBuffer();
  const loader = new STLLoader();
  const geometry = loader.parse(buffer);

  geometry.computeBoundingBox();
  const box = geometry.boundingBox!;

  const boundingBox: BoundingBox = {
    x: Math.round((box.max.x - box.min.x) * 100) / 100,
    y: Math.round((box.max.y - box.min.y) * 100) / 100,
    z: Math.round((box.max.z - box.min.z) * 100) / 100,
  };

  geometry.center();
  geometry.computeVertexNormals();

  return { geometry, boundingBox };
}

/**
 * Process an STL file: parse, extract dimensions, and render from multiple angles
 */
export async function processSTL(file: File): Promise<STLProcessingResult> {
  const { geometry, boundingBox } = await parseSTL(file);
  const renders = await renderMultipleAngles(geometry, boundingBox);

  return { geometry, boundingBox, renders };
}

/**
 * Render a geometry from multiple camera angles for AI analysis
 */
async function renderMultipleAngles(
  geometry: THREE.BufferGeometry,
  boundingBox: BoundingBox,
): Promise<Blob[]> {
  const cameraAngles = [
    { position: [1, 1, 1], name: 'isometric' },
    { position: [0, 0, 1], name: 'top' },
    { position: [0, -1, 0], name: 'front' },
    { position: [1, 0, 0], name: 'right' },
  ];

  const renders: Blob[] = [];
  const size = 512;

  // Create a canvas element for offscreen rendering
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;

  // Create offscreen renderer with explicit canvas
  let renderer: THREE.WebGLRenderer;
  try {
    renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      alpha: true,
      preserveDrawingBuffer: true,
    });
  } catch (e) {
    console.error('Failed to create WebGL renderer:', e);
    throw new Error(
      'WebGL is not available. Please use a browser that supports WebGL.',
    );
  }

  renderer.setSize(size, size);
  renderer.setPixelRatio(1);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0xf5f5f5);

  // Clone geometry to avoid disposing the original
  const geometryClone = geometry.clone();

  // Add mesh with the ADAM blue color
  const material = new THREE.MeshStandardMaterial({
    color: 0x00a6ff,
    metalness: 0.3,
    roughness: 0.5,
  });
  const mesh = new THREE.Mesh(geometryClone, material);

  // Apply the same rotation as ThreeScene for consistency
  mesh.rotation.set(-Math.PI / 2, 0, 0);
  scene.add(mesh);

  // Lighting setup similar to ThreeScene
  scene.add(new THREE.AmbientLight(0xffffff, 0.8));

  const dirLight1 = new THREE.DirectionalLight(0xffffff, 1.2);
  dirLight1.position.set(5, 5, 5);
  scene.add(dirLight1);

  const dirLight2 = new THREE.DirectionalLight(0xffffff, 0.2);
  dirLight2.position.set(-5, 5, 5);
  scene.add(dirLight2);

  const dirLight3 = new THREE.DirectionalLight(0xffffff, 0.2);
  dirLight3.position.set(-5, 5, -5);
  scene.add(dirLight3);

  // Calculate camera distance based on bounding box
  const maxDim = Math.max(boundingBox.x, boundingBox.y, boundingBox.z);
  // Ensure we have a valid dimension (fallback to 1 for degenerate geometry)
  const safeDim = maxDim > 0 ? maxDim : 1;
  const cameraDistance = safeDim * 2.5;

  const camera = new THREE.PerspectiveCamera(45, 1, 0.1, safeDim * 10);

  try {
    for (const angle of cameraAngles) {
      camera.position.set(
        angle.position[0] * cameraDistance,
        angle.position[1] * cameraDistance,
        angle.position[2] * cameraDistance,
      );
      camera.lookAt(0, 0, 0);

      renderer.render(scene, camera);

      const blob = await new Promise<Blob>((resolve, reject) => {
        canvas.toBlob(
          (b) => {
            if (b) {
              resolve(b);
            } else {
              reject(new Error('Failed to create blob from canvas'));
            }
          },
          'image/png',
          0.9,
        );
      });
      renders.push(blob);
    }
  } finally {
    // Cleanup
    renderer.dispose();
    geometryClone.dispose();
    material.dispose();
  }

  return renders;
}

/**
 * Get angle names for labeling renders
 */
export function getRenderAngleNames(): string[] {
  return ['isometric', 'top', 'front', 'right'];
}

/**
 * Validate that a file is a valid STL
 */
export function isValidSTL(file: File): boolean {
  const extension = file.name.toLowerCase().split('.').pop();
  if (extension !== 'stl') {
    return false;
  }

  // Check MIME type if available (browsers may report different types)
  const validMimeTypes = [
    'model/stl',
    'application/sla',
    'application/vnd.ms-pki.stl',
    'application/octet-stream', // Generic binary, common for STL
    '', // Some browsers don't set MIME for STL
  ];

  return validMimeTypes.includes(file.type) || file.type === '';
}
