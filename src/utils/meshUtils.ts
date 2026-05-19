import * as THREE from 'three';
import { GLTF, GLTFLoader } from 'three-stdlib';
import { STLLoader } from 'three/addons/loaders/STLLoader.js';
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { Mesh } from '@shared/types';
import { buildColoredGroupFromOff } from './coloredOffMesh';

export interface BoundingBox {
  x: number;
  y: number;
  z: number;
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
 * Render a geometry from multiple camera angles for AI analysis
 */
export async function renderMultipleAngles(
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

  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;

  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    alpha: true,
    preserveDrawingBuffer: true,
  });

  renderer.setSize(size, size);
  renderer.setPixelRatio(1);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0xf5f5f5);

  const geometryClone = geometry.clone();

  const material = new THREE.MeshStandardMaterial({
    color: 0x00a6ff,
    metalness: 0.3,
    roughness: 0.5,
  });
  const mesh = new THREE.Mesh(geometryClone, material);

  mesh.rotation.set(-Math.PI / 2, 0, 0);
  scene.add(mesh);

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

  const maxDim = Math.max(boundingBox.x, boundingBox.y, boundingBox.z);
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
    renderer.dispose();
    geometryClone.dispose();
    material.dispose();
  }

  return renders;
}

/**
 * Validate that a file is a valid STL
 */
export function isValidSTL(file: File): boolean {
  const extension = file.name.toLowerCase().split('.').pop();
  if (extension !== 'stl') {
    return false;
  }

  const validMimeTypes = [
    'model/stl',
    'application/sla',
    'application/vnd.ms-pki.stl',
    'application/octet-stream',
    '',
  ];

  return validMimeTypes.includes(file.type) || file.type === '';
}

// Render any prebuilt THREE.Scene to a 1000×1000 PNG data URL using the same
// camera framing (top-right-front isometric), HDR environment, and lighting
// that both `generatePreview` and `generateColoredPreview` rely on.
function renderSceneToDataUrl(scene: THREE.Scene): string {
  const box = new THREE.Box3().setFromObject(scene);
  const center = new THREE.Vector3();
  const size = new THREE.Vector3();
  box.getCenter(center);
  box.getSize(size);

  // Use the bounding-box diagonal both as the ortho half-extent (with light
  // padding) and as the camera's stand-off distance from `center`. Ortho has
  // no foreshortening, so distance only needs to keep the model inside the
  // near/far planes.
  const diagonal = Math.sqrt(
    size.x * size.x + size.y * size.y + size.z * size.z,
  );
  const halfExtent = (diagonal / 2) * 1.1;

  const renderer = new THREE.WebGLRenderer({
    antialias: true,
    preserveDrawingBuffer: true,
  });
  renderer.setSize(1000, 1000);
  renderer.toneMapping = THREE.NoToneMapping;
  renderer.setPixelRatio(window.devicePixelRatio);

  // Orthographic gives the clean technical-drawing look you want for thumbnails
  // — parallel edges stay parallel, scale comparison reads correctly across
  // different artifacts. Aspect is 1:1 since we render to a 1000×1000 PNG.
  const camera = new THREE.OrthographicCamera(
    -halfExtent,
    halfExtent,
    halfExtent,
    -halfExtent,
    0.1,
    diagonal * 10,
  );
  // Top-right-front isometric framing — matches the live viewer's gizmo TFR
  // corner instead of staring straight down +Z, which on a Z-up OpenSCAD
  // STL/OFF produced a flat top-down view.
  const isoOffset = new THREE.Vector3(1, 1, 1)
    .normalize()
    .multiplyScalar(diagonal * 2);
  camera.position.copy(center).add(isoOffset);
  camera.lookAt(center);

  const pmremGenerator = new THREE.PMREMGenerator(renderer);
  const renderScene = new THREE.Scene();
  renderScene.background = new THREE.Color(0x3b3b3b);
  renderScene.environment = pmremGenerator.fromScene(
    new RoomEnvironment(),
    0.04,
  ).texture;

  const directionalLight = new THREE.DirectionalLight(0xffffff, 1);
  directionalLight.position.set(1, 1, 1);
  renderScene.add(directionalLight);

  renderScene.add(scene);

  renderer.render(renderScene, camera);
  const image = renderer.domElement.toDataURL('image/png');

  pmremGenerator.dispose();
  renderer.dispose();
  return image;
}

export const generatePreview = async (
  mesh: Blob,
  fileType: Mesh['fileType'] = 'glb',
) => {
  const arrayBuffer = await mesh.arrayBuffer();

  let scene: THREE.Scene;

  if (fileType === 'stl') {
    // Handle STL files
    const loader = new STLLoader();
    const geometry = loader.parse(arrayBuffer);

    // OpenSCAD emits Z-up STLs. Bake the same -π/2 X rotation the live viewer
    // applies so the camera framing below sees a Y-up model and the brand
    // color reads as the author would on screen.
    geometry.rotateX(-Math.PI / 2);
    geometry.center();
    geometry.computeVertexNormals();

    const material = new THREE.MeshStandardMaterial({
      color: 0x00a6ff,
      metalness: 0.6,
      roughness: 0.3,
      envMapIntensity: 0.3,
    });
    const mesh = new THREE.Mesh(geometry, material);

    // Create scene and add the mesh
    scene = new THREE.Scene();
    scene.add(mesh);
  } else if (fileType === 'obj') {
    // Handle OBJ files
    const loader = new OBJLoader();
    const objText = new TextDecoder().decode(arrayBuffer);
    const objGroup = loader.parse(objText);

    // Create scene and add the OBJ group
    scene = new THREE.Scene();
    scene.add(objGroup);
  } else {
    // Handle GLB files (original logic)
    const loader = new GLTFLoader();
    const gltf = await new Promise<GLTF>((resolve, reject) => {
      loader.parse(arrayBuffer, '', resolve, reject);
    });

    scene = new THREE.Scene();
    scene.add(gltf.scene);
  }

  return renderSceneToDataUrl(scene);
};

// Render an OpenSCAD OFF file (which carries per-face color() data) to a PNG
// data URL using the same camera/lighting as `generatePreview`. Faces without
// an explicit color fall back to `fallbackColor` (a packed 0xRRGGBB number).
// Returns null if the OFF parses to zero usable faces so the caller can fall
// back to the STL render path.
export const generateColoredPreview = async (
  off: Blob,
  fallbackColor: number = 0x00a6ff,
): Promise<string | null> => {
  const text = await off.text();
  const group = buildColoredGroupFromOff(text, fallbackColor);
  if (!group) return null;

  // OpenSCAD coordinates are Z-up; match the live viewer's parent-group
  // rotation so the iso camera frames the model the same way.
  const rotated = new THREE.Group();
  rotated.rotation.x = -Math.PI / 2;

  // Center the colored group at the origin (its meshes sit at raw OpenSCAD
  // coordinates) so the iso framing math centers correctly after rotation.
  const box = new THREE.Box3().setFromObject(group);
  if (!box.isEmpty()) {
    const center = box.getCenter(new THREE.Vector3());
    group.position.sub(center);
  }
  rotated.add(group);

  const scene = new THREE.Scene();
  scene.add(rotated);

  return renderSceneToDataUrl(scene);
};

export const applyMaterialAdjustments = (
  material: THREE.MeshStandardMaterial,
  actualBrightness: number,
  actualRoughness: number,
  actualNormalIntensity?: number,
) => {
  // Apply brightness to color
  if ('color' in material && material.color instanceof THREE.Color) {
    const colorMat = material;
    const origColor = colorMat.color.clone();
    const r = Math.min(1, Math.max(0, origColor.r * actualBrightness));
    const g = Math.min(1, Math.max(0, origColor.g * actualBrightness));
    const b = Math.min(1, Math.max(0, origColor.b * actualBrightness));
    colorMat.color.setRGB(r, g, b);
  }

  // Apply emissive for brightness (if actualNormalIntensity provided, we're in full mode)
  if (
    actualNormalIntensity !== undefined &&
    'emissive' in material &&
    material.emissive instanceof THREE.Color
  ) {
    const emissiveMat = material;
    const intensity = Math.max(0, (actualBrightness - 1) * 0.2);
    emissiveMat.emissive.setRGB(intensity, intensity, intensity);
  }

  // Apply roughness
  if ('roughness' in material) {
    material.roughness = actualRoughness;
  }

  // Apply normal map intensity (only if provided)
  if (
    actualNormalIntensity !== undefined &&
    'normalMap' in material &&
    'normalScale' in material
  ) {
    const pbrMat = material;
    if (pbrMat.normalMap && pbrMat.normalScale) {
      pbrMat.normalScale = new THREE.Vector2(
        actualNormalIntensity,
        actualNormalIntensity,
      );
    }
  }

  // Ensure material updates
  material.needsUpdate = true;
};
