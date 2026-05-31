import type {
  CadamDesignTreeNode,
  CadamDesignTreeNodeKind,
  CadamDesignTreeParseResult,
  CadamDesignTreeParseWarning,
} from './types.ts';

const CADAM_NODE_COMMENT_REGEX = /^\s*\/\/\s*@cadam-node\s+(.+?)\s*$/gm;
const KNOWN_NODE_KINDS = new Set<string>([
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

type CadamNodeSource = {
  line: number;
  raw: string;
};

export default function parseDesignTree(
  source: string,
): CadamDesignTreeParseResult {
  const nodes: CadamDesignTreeNode[] = [];
  const warnings: CadamDesignTreeParseWarning[] = [];
  const seenIds = new Set<string>();
  const nodeSources = new Map<string, CadamNodeSource>();

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
    const params = stringArrayResult(payload.params);
    if (params?.hasInvalidEntry) {
      warnings.push({
        code: 'invalid-param-entry',
        message: '@cadam-node params must contain only strings.',
        line,
        raw,
        id,
      });
    }
    if (params && params.values.length > 0) node.params = params.values;
    const moduleName = stringOrUndefined(payload.moduleName);
    if (moduleName) node.moduleName = moduleName;

    nodes.push(node);
    nodeSources.set(id, { line, raw });
  }

  validateParentLinks(nodes, warnings, nodeSources);

  return { nodes, warnings };
}

function validateParentLinks(
  nodes: CadamDesignTreeNode[],
  warnings: CadamDesignTreeParseWarning[],
  nodeSources: Map<string, CadamNodeSource>,
) {
  const byId = new Map(nodes.map((node) => [node.id, node]));

  for (const node of nodes) {
    if (!node.parentId || byId.has(node.parentId)) continue;
    const source = nodeSources.get(node.id);
    warnings.push({
      code: 'missing-parent',
      message: `@cadam-node parentId "${node.parentId}" does not match another node.`,
      line: source?.line ?? 0,
      raw: source?.raw ?? '',
      id: node.id,
      parentId: node.parentId,
    });
  }

  const warnedCycles = new Set<string>();
  for (const node of nodes) {
    const path: string[] = [];
    const pathIndex = new Map<string, number>();
    let currentId: string | undefined = node.id;

    while (currentId) {
      const existingIndex = pathIndex.get(currentId);
      if (existingIndex !== undefined) {
        const cycleIds = path.slice(existingIndex);
        const cycleKey = [...cycleIds].sort().join('\0');
        if (!warnedCycles.has(cycleKey)) {
          warnedCycles.add(cycleKey);
          const warningNode = byId.get(cycleIds[0]);
          const source = warningNode
            ? nodeSources.get(warningNode.id)
            : undefined;
          warnings.push({
            code: 'circular-parent',
            message: `@cadam-node parentId chain contains a cycle: ${cycleIds.join(' -> ')}.`,
            line: source?.line ?? 0,
            raw: source?.raw ?? '',
            id: warningNode?.id,
            parentId: warningNode?.parentId,
          });
        }
        break;
      }

      pathIndex.set(currentId, path.length);
      path.push(currentId);

      const current = byId.get(currentId);
      if (!current?.parentId || !byId.has(current.parentId)) break;
      currentId = current.parentId;
    }
  }
}

function isKnownNodeKind(kind: string): kind is CadamDesignTreeNodeKind {
  return KNOWN_NODE_KINDS.has(kind);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stringOrUndefined(value: unknown) {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function stringArrayResult(value: unknown) {
  if (!Array.isArray(value)) return undefined;
  const values = value.filter(
    (item): item is string => typeof item === 'string',
  );
  return { values, hasInvalidEntry: values.length !== value.length };
}

function lineNumberForIndex(source: string, index: number) {
  return source.slice(0, index).split('\n').length;
}
