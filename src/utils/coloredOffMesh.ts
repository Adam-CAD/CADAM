import {
  BufferGeometry,
  Float32BufferAttribute,
  Group,
  Mesh,
  MeshStandardMaterial,
} from 'three';
import { parseColoredOff } from './offParser';

// OpenSCAD paints any face without an explicit color() call with its built-in
// model yellow (#F9D72C ≈ 249,215,44). Manifold also emits a secondary
// yellow-green (#9DCB51 ≈ 157,203,81) for CSG-cut faces. Strip both so those
// faces fall through to the brand fallback color instead of polluting the
// preview with OpenSCAD's editor defaults.
function stripOpenscadDefaults(
  color: [number, number, number, number] | null,
): [number, number, number, number] | null {
  if (!color) return null;
  const r = Math.round(color[0] * 255);
  const g = Math.round(color[1] * 255);
  const b = Math.round(color[2] * 255);
  if (r === 249 && g === 215 && b === 44) return null;
  if (r === 157 && g === 203 && b === 81) return null;
  return color;
}

// Build a Three.js Group whose meshes preserve OpenSCAD's color() calls from
// an OFF file. `fallbackColor` is used for faces without explicit color. The
// material parameters match the live viewer's OpenSCADPreview path so the
// preview thumbnail reads the same way as the in-editor render.
//
// Returns null when the OFF parses to zero usable faces — callers should fall
// back to the single-color STL render path in that case.
export function buildColoredGroupFromOff(
  offText: string,
  fallbackColor: number,
): Group | null {
  const parsed = parseColoredOff(offText);

  for (const face of parsed.faces) {
    face.color = stripOpenscadDefaults(face.color);
  }

  const buckets = new Map<string, typeof parsed.faces>();
  for (const face of parsed.faces) {
    const key = face.color ? face.color.join(',') : '__default';
    const bucket = buckets.get(key);
    if (bucket) bucket.push(face);
    else buckets.set(key, [face]);
  }

  const group = new Group();
  for (const [key, faces] of buckets) {
    const positions = new Float32Array(faces.length * 9);
    for (let f = 0; f < faces.length; f++) {
      const [a, b, c] = faces[f].vertices;
      const va = parsed.vertices[a];
      const vb = parsed.vertices[b];
      const vc = parsed.vertices[c];
      const base = f * 9;
      positions[base + 0] = va[0];
      positions[base + 1] = va[1];
      positions[base + 2] = va[2];
      positions[base + 3] = vb[0];
      positions[base + 4] = vb[1];
      positions[base + 5] = vb[2];
      positions[base + 6] = vc[0];
      positions[base + 7] = vc[1];
      positions[base + 8] = vc[2];
    }
    const geom = new BufferGeometry();
    geom.setAttribute('position', new Float32BufferAttribute(positions, 3));
    geom.computeVertexNormals();

    const firstFace = faces[0];
    const faceColor = key === '__default' ? null : firstFace.color;
    const mat = new MeshStandardMaterial({
      color: faceColor
        ? (Math.round(faceColor[0] * 255) << 16) |
          (Math.round(faceColor[1] * 255) << 8) |
          Math.round(faceColor[2] * 255)
        : fallbackColor,
      metalness: faceColor ? 0.05 : 0.6,
      roughness: faceColor ? 0.7 : 0.3,
      envMapIntensity: faceColor ? 0.15 : 0.3,
      transparent: faceColor ? faceColor[3] < 1 : false,
      opacity: faceColor ? faceColor[3] : 1,
    });

    group.add(new Mesh(geom, mat));
  }

  if (group.children.length === 0) return null;
  return group;
}

export function disposeColoredGroup(group: Group): void {
  group.traverse((obj) => {
    if (!(obj instanceof Mesh)) return;
    obj.geometry?.dispose();
    const mat = obj.material;
    if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
    else mat?.dispose();
  });
}
