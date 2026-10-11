/**
 * Minimal parser for the AMF (Additive Manufacturing File) XML that OpenSCAD's
 * manifold backend emits when `--enable=lazy-union` is set: one `<object>` per
 * top-level part, in source order. AMF carries geometry only — no part names,
 * no colors — so callers map object order back to named modules from the code.
 */

export type AmfObject = {
  id: string;
  /** Flat xyz vertex coordinates, length = vertexCount * 3. */
  positions: Float32Array;
  /** Triangle vertex indices into `positions`, length = triangleCount * 3. */
  indices: Uint32Array;
};

const OBJECT_RE = /<object\b[^>]*\bid="([^"]*)"[\s\S]*?<\/object>/g;
const VERTEX_RE =
  /<x>\s*([-\d.eE+]+)\s*<\/x>\s*<y>\s*([-\d.eE+]+)\s*<\/y>\s*<z>\s*([-\d.eE+]+)\s*<\/z>/g;
const TRIANGLE_RE =
  /<v1>\s*(\d+)\s*<\/v1>\s*<v2>\s*(\d+)\s*<\/v2>\s*<v3>\s*(\d+)\s*<\/v3>/g;

/** Parse an OpenSCAD-emitted AMF document into one entry per `<object>`. */
export function parseAmf(text: string): AmfObject[] {
  const objects: AmfObject[] = [];

  for (const objectMatch of text.matchAll(OBJECT_RE)) {
    const id = objectMatch[1];
    const body = objectMatch[0];

    const coords: number[] = [];
    for (const v of body.matchAll(VERTEX_RE)) {
      coords.push(Number(v[1]), Number(v[2]), Number(v[3]));
    }

    const indices: number[] = [];
    for (const t of body.matchAll(TRIANGLE_RE)) {
      indices.push(Number(t[1]), Number(t[2]), Number(t[3]));
    }

    if (coords.length === 0 || indices.length === 0) continue;

    objects.push({
      id,
      positions: new Float32Array(coords),
      indices: new Uint32Array(indices),
    });
  }

  return objects;
}
