import {
  BufferAttribute,
  BufferGeometry,
  Color,
  Group,
  Mesh,
  MeshStandardMaterial,
} from 'three';

import { parseAmf } from './amfParser';

export type PartInfo = { name: string; color: string | null };

const CADAM_NODE_PART_RE = /@cadam-node\b[^\n]*\bkind\s*=\s*"?part"?[^\n]*/g;

function attr(line: string, key: string): string | undefined {
  return new RegExp('\\b' + key + '\\s*=\\s*"?([\\w-]+)"?').exec(line)?.[1];
}

/**
 * Ordered top-level parts described by the OpenSCAD source.
 *
 * Prefers `@cadam-node kind=part` annotations (forward-compatible with the
 * design-tree PR #176); otherwise falls back to the order of top-level module
 * calls, then to `piece_N`. Colors come from each part module's first
 * `color(...)` (literal or a `*_color` parameter default).
 */
export function partsFromScad(code: string): PartInfo[] {
  const moduleColors = moduleColorMap(code);

  const annotated = [...code.matchAll(CADAM_NODE_PART_RE)].map((m) => {
    const moduleName = attr(m[0], 'moduleName');
    return {
      name: attr(m[0], 'name') ?? moduleName ?? '',
      moduleName,
    };
  });
  if (annotated.length > 0) {
    return annotated.map((a, i) => ({
      name: a.name || `piece_${i + 1}`,
      color: a.moduleName ? (moduleColors.get(a.moduleName) ?? null) : null,
    }));
  }

  return topLevelModuleCalls(code).map((mod, i) => ({
    name: mod || `piece_${i + 1}`,
    color: moduleColors.get(mod) ?? null,
  }));
}

function colorParamDefaults(code: string): Map<string, string> {
  const map = new Map<string, string>();
  for (const m of code.matchAll(/(\w+_color)\s*=\s*"([^"]+)"/g)) {
    map.set(m[1], m[2]);
  }
  return map;
}

function extractBlock(code: string, openBraceIndex: number): string {
  let depth = 0;
  for (let i = openBraceIndex; i < code.length; i++) {
    if (code[i] === '{') depth++;
    else if (code[i] === '}' && --depth === 0)
      return code.slice(openBraceIndex, i + 1);
  }
  return code.slice(openBraceIndex);
}

function moduleColorMap(code: string): Map<string, string> {
  const defaults = colorParamDefaults(code);
  const map = new Map<string, string>();
  for (const m of code.matchAll(/module\s+(\w+)\s*\([^)]*\)\s*\{/g)) {
    const openBrace = (m.index ?? 0) + m[0].length - 1;
    const arg = /color\s*\(\s*(?:"([^"]+)"|(\w+))/.exec(
      extractBlock(code, openBrace),
    );
    if (!arg) continue;
    const value = arg[1] ?? (arg[2] ? defaults.get(arg[2]) : undefined);
    if (value) map.set(m[1], value);
  }
  return map;
}

function topLevelModuleCalls(code: string): string[] {
  const modules = new Set(
    [...code.matchAll(/module\s+(\w+)\s*\(/g)].map((m) => m[1]),
  );
  const calls: string[] = [];
  const callRe = /(\w+)\s*\(/g;
  let depth = 0;
  let i = 0;
  while (i < code.length) {
    const ch = code[i];
    if (ch === '{') depth++;
    else if (ch === '}') depth = Math.max(0, depth - 1);
    else if (depth === 0) {
      callRe.lastIndex = i;
      const m = callRe.exec(code);
      if (m && m.index === i && modules.has(m[1])) {
        calls.push(m[1]);
        i = callRe.lastIndex;
        continue;
      }
    }
    i++;
  }
  return calls;
}

const FALLBACK_PALETTE = [
  0x4f8fba, 0xba7a4f, 0x6aba4f, 0xba4f9c, 0x4fba9c, 0xbab04f,
];

/**
 * Build a THREE.Group with one named, colored mesh per AMF `<object>`.
 * `parts[i]` (from {@link partsFromScad}) names object i by source order.
 */
export function buildPartsGroup(
  amfText: string,
  parts: PartInfo[],
  fallbackColor = 0x999999,
): Group {
  const group = new Group();
  group.name = 'cadam-parts';

  parseAmf(amfText).forEach((obj, i) => {
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new BufferAttribute(obj.positions, 3));
    geometry.setIndex(new BufferAttribute(obj.indices, 1));
    geometry.computeVertexNormals();

    const info = parts[i];
    const colorValue: string | number =
      info?.color ??
      FALLBACK_PALETTE[i % FALLBACK_PALETTE.length] ??
      fallbackColor;

    const mesh = new Mesh(
      geometry,
      new MeshStandardMaterial({
        color: new Color(colorValue),
        roughness: 0.6,
        metalness: 0.1,
      }),
    );
    mesh.name = info?.name ?? `piece_${i + 1}`;
    mesh.userData.partName = mesh.name;
    mesh.userData.partIndex = i;
    group.add(mesh);
  });

  return group;
}
