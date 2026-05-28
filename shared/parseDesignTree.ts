import type {
  CadamDesignTreeNode,
  CadamDesignTreeNodeKind,
  CadamDesignTreeParseResult,
  CadamDesignTreeParseWarning,
} from './types.ts';

const CADAM_NODE_COMMENT_REGEX = /^\s*\/\/\s*@cadam-node\s+(.+?)\s*$/gm;
const KNOWN_NODE_KINDS = new Set<CadamDesignTreeNodeKind>([
  'part',
  'operation',
  'group',
  'parameter',
]);

type CadamNodePayload = {
  id?: unknown;
  kind?: unknown;
  name?: unknown;
  parentId?: unknown;
  params?: unknown;
  moduleName?: unknown;
};

export default function parseDesignTree(
  source: string,
): CadamDesignTreeParseResult {
  const nodes: CadamDesignTreeNode[] = [];
  const warnings: CadamDesignTreeParseWarning[] = [];
  const seenIds = new Set<string>();

  let match: RegExpExecArray | null;
  while ((match = CADAM_NODE_COMMENT_REGEX.exec(source)) !== null) {
    const raw = match[0];
    const json = match[1].trim();
    const line = lineNumberForIndex(source, match.index);
    let payload: CadamNodePayload;

    try {
      const parsed: unknown = JSON.parse(json);
      if (!isRecord(parsed)) {
        warnings.push({
          code: 'invalid-json',
          message: '@cadam-node payload must be a JSON object.',
          line,
          raw,
        });
        continue;
      }
      payload = parsed;
    } catch {
      warnings.push({
        code: 'invalid-json',
        message: '@cadam-node payload is not valid JSON.',
        line,
        raw,
      });
      continue;
    }

    const id = stringOrUndefined(payload.id);
    if (!id) {
      warnings.push({
        code: 'missing-id',
        message: '@cadam-node payload is missing a string id.',
        line,
        raw,
      });
      continue;
    }

    const kind = stringOrUndefined(payload.kind);
    if (!kind) {
      warnings.push({
        code: 'missing-kind',
        message: '@cadam-node payload is missing a string kind.',
        line,
        raw,
        id,
      });
      continue;
    }

    if (!isKnownNodeKind(kind)) {
      warnings.push({
        code: 'unknown-kind',
        message: `@cadam-node kind "${kind}" is not supported.`,
        line,
        raw,
        id,
        kind,
      });
      continue;
    }

    if (seenIds.has(id)) {
      warnings.push({
        code: 'duplicate-id',
        message: `@cadam-node id "${id}" was already used.`,
        line,
        raw,
        id,
      });
      continue;
    }

    seenIds.add(id);

    const node: CadamDesignTreeNode = {
      id,
      kind,
      name: stringOrUndefined(payload.name) ?? id,
    };
    const parentId = stringOrUndefined(payload.parentId);
    if (parentId) node.parentId = parentId;
    const params = stringArrayOrUndefined(payload.params);
    if (params) node.params = params;
    const moduleName = stringOrUndefined(payload.moduleName);
    if (moduleName) node.moduleName = moduleName;

    nodes.push(node);
  }

  return { nodes, warnings };
}

function isKnownNodeKind(kind: string): kind is CadamDesignTreeNodeKind {
  return KNOWN_NODE_KINDS.has(kind as CadamDesignTreeNodeKind);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stringOrUndefined(value: unknown) {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function stringArrayOrUndefined(value: unknown) {
  if (!Array.isArray(value)) return undefined;
  const strings = value.filter(
    (item): item is string => typeof item === 'string',
  );
  return strings.length > 0 ? strings : undefined;
}

function lineNumberForIndex(source: string, index: number) {
  return source.slice(0, index).split('\n').length;
}
