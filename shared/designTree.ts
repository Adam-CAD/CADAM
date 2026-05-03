import { DesignNode, DesignNodeKind } from './types.ts';

type RawDesignNode = {
  id?: unknown;
  kind?: unknown;
  name?: unknown;
  parentId?: unknown;
  children?: unknown;
  params?: unknown;
  parameterNames?: unknown;
  visible?: unknown;
  locked?: unknown;
  color?: unknown;
};

const DESIGN_NODE_PREFIX = '@cadam-node';
const DESIGN_NODE_KINDS = new Set<DesignNodeKind>([
  'assembly',
  'part',
  'operation',
  'sketch',
  'parameter-group',
  'import',
]);

export function parseDesignTree(code: string): DesignNode[] {
  const lines = code.split(/\r?\n/);
  const lineStarts = getLineStarts(code);
  const nodes: DesignNode[] = [];
  const seenIds = new Set<string>();

  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    const prefixIndex = line.indexOf(DESIGN_NODE_PREFIX);
    if (prefixIndex === -1) continue;

    const payload = line.slice(prefixIndex + DESIGN_NODE_PREFIX.length).trim();
    if (!payload.startsWith('{')) continue;

    const raw = parseRawNode(payload);
    if (!raw) continue;

    const node = normalizeNode(raw);
    if (!node || seenIds.has(node.id)) continue;

    const range = findAnnotatedRange(lines, lineStarts, index);
    nodes.push({ ...node, codeRange: range });
    seenIds.add(node.id);
  }

  const validIds = new Set(nodes.map((node) => node.id));
  return nodes.map((node) => ({
    ...node,
    parentId:
      node.parentId && validIds.has(node.parentId) ? node.parentId : undefined,
    children: node.children?.filter((id) => validIds.has(id)),
  }));
}

function parseRawNode(payload: string): RawDesignNode | null {
  try {
    return JSON.parse(payload) as RawDesignNode;
  } catch {
    return null;
  }
}

function normalizeNode(raw: RawDesignNode): DesignNode | null {
  if (typeof raw.id !== 'string' || !raw.id.trim()) return null;
  if (
    typeof raw.kind !== 'string' ||
    !DESIGN_NODE_KINDS.has(raw.kind as DesignNodeKind)
  ) {
    return null;
  }

  const id = raw.id.trim();
  const name =
    typeof raw.name === 'string' && raw.name.trim() ? raw.name.trim() : id;
  const rawParams = Array.isArray(raw.parameterNames)
    ? raw.parameterNames
    : raw.params;

  return {
    id,
    kind: raw.kind as DesignNodeKind,
    name,
    parentId: stringValue(raw.parentId),
    children: stringArray(raw.children),
    parameterNames: stringArray(rawParams),
    visible: booleanValue(raw.visible),
    locked: booleanValue(raw.locked),
    color: stringValue(raw.color),
  };
}

function stringValue(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function booleanValue(value: unknown) {
  return typeof value === 'boolean' ? value : undefined;
}

function stringArray(value: unknown) {
  if (!Array.isArray(value)) return undefined;
  const values = value.filter(
    (item): item is string =>
      typeof item === 'string' && item.trim().length > 0,
  );
  return values.length > 0 ? values.map((item) => item.trim()) : undefined;
}

function getLineStarts(code: string) {
  const starts = [0];
  for (let index = 0; index < code.length; index++) {
    if (code[index] === '\n') starts.push(index + 1);
  }
  return starts;
}

function findAnnotatedRange(
  lines: string[],
  lineStarts: number[],
  annotationLineIndex: number,
) {
  const startLine = findNextMeaningfulLine(lines, annotationLineIndex + 1);
  if (startLine === -1) {
    return {
      start: lineStarts[annotationLineIndex],
      end: lineStarts[annotationLineIndex] + lines[annotationLineIndex].length,
    };
  }

  const endLine = findRangeEndLine(lines, startLine);
  return {
    start: lineStarts[startLine],
    end: lineStarts[endLine] + lines[endLine].length,
  };
}

function findNextMeaningfulLine(lines: string[], startLine: number) {
  for (let index = startLine; index < lines.length; index++) {
    const trimmed = lines[index].trim();
    if (!trimmed || trimmed.startsWith('//')) continue;
    return index;
  }
  return -1;
}

function findRangeEndLine(lines: string[], startLine: number) {
  let depth = 0;
  let sawBrace = false;

  for (let index = startLine; index < lines.length; index++) {
    const line = stripLineComment(lines[index]);

    for (const char of line) {
      if (char === '{') {
        depth++;
        sawBrace = true;
      } else if (char === '}') {
        depth = Math.max(0, depth - 1);
      }
    }

    if (sawBrace && depth === 0) return index;
    if (!sawBrace && line.includes(';')) return index;
  }

  return startLine;
}

function stripLineComment(line: string) {
  const commentIndex = line.indexOf('//');
  return commentIndex === -1 ? line : line.slice(0, commentIndex);
}
