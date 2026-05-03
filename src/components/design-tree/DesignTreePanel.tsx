import { DesignNode, Parameter } from '@shared/types';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import {
  Box,
  Boxes,
  Braces,
  Cuboid,
  Eye,
  FileInput,
  Lock,
  PenTool,
} from 'lucide-react';

interface DesignTreePanelProps {
  nodes: DesignNode[];
  selectedNodeId?: string;
  parameters: Parameter[];
  onSelectNode: (nodeId: string | undefined) => void;
}

const kindIcons = {
  assembly: Boxes,
  part: Cuboid,
  operation: Braces,
  sketch: PenTool,
  'parameter-group': Box,
  import: FileInput,
} as const;

export function DesignTreePanel({
  nodes,
  selectedNodeId,
  parameters,
  onSelectNode,
}: DesignTreePanelProps) {
  const nodeRows = buildTreeRows(nodes);
  const selectedNode = nodes.find((node) => node.id === selectedNodeId);
  const parameterCount = selectedNode?.parameterNames?.filter((name) =>
    parameters.some((param) => param.name === name),
  ).length;

  if (nodes.length === 0) {
    return (
      <div className="flex min-h-[220px] flex-col items-center justify-center rounded-md border border-dashed border-adam-neutral-700 p-5 text-center">
        <Boxes className="mb-3 h-5 w-5 text-adam-neutral-400" />
        <p className="text-sm font-medium text-adam-text-primary">
          No design tree yet
        </p>
        <p className="mt-1 text-xs leading-5 text-adam-neutral-400">
          Add @cadam-node JSON comments above modules, operations, or assemblies
          to make model structure editable here.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <span className="truncate text-xs font-semibold text-adam-text-primary">
            Design Tree
          </span>
          <Badge className="rounded-full bg-adam-neutral-800 px-2 py-0 text-[10px] text-adam-neutral-300">
            {nodes.length}
          </Badge>
        </div>
        <Button
          variant="ghost"
          className="h-7 rounded-md px-2 text-xs text-adam-neutral-300 hover:bg-adam-neutral-800 hover:text-adam-text-primary"
          onClick={() => onSelectNode(undefined)}
          disabled={!selectedNodeId}
        >
          Clear
        </Button>
      </div>

      <div className="flex flex-col gap-1">
        {nodeRows.map(({ node, depth }) => {
          const Icon = kindIcons[node.kind];
          const selected = node.id === selectedNodeId;

          return (
            <button
              key={node.id}
              type="button"
              className={cn(
                'flex h-9 w-full items-center gap-2 rounded-md px-2 text-left transition-colors',
                selected
                  ? 'bg-adam-blue/20 text-adam-text-primary ring-1 ring-adam-blue/40'
                  : 'text-adam-neutral-300 hover:bg-adam-neutral-800 hover:text-adam-text-primary',
              )}
              style={{ paddingLeft: `${8 + depth * 16}px` }}
              onClick={() => onSelectNode(node.id)}
            >
              <Icon className="h-3.5 w-3.5 flex-shrink-0" />
              <span className="min-w-0 flex-1 truncate text-xs font-medium">
                {node.name}
              </span>
              {node.locked && <Lock className="h-3 w-3 flex-shrink-0" />}
              {node.visible === false && (
                <Eye className="h-3 w-3 flex-shrink-0 opacity-50" />
              )}
            </button>
          );
        })}
      </div>

      {selectedNode && (
        <div className="rounded-md border border-adam-neutral-700 bg-adam-neutral-900/40 p-3">
          <div className="flex items-center justify-between gap-2">
            <p className="min-w-0 truncate text-xs font-semibold text-adam-text-primary">
              {selectedNode.name}
            </p>
            <Badge className="rounded-full bg-adam-neutral-800 px-2 py-0 text-[10px] text-adam-neutral-300">
              {selectedNode.kind}
            </Badge>
          </div>
          <p className="mt-2 text-xs text-adam-neutral-400">
            {parameterCount
              ? `${parameterCount} linked parameter${parameterCount === 1 ? '' : 's'}`
              : 'No linked parameters'}
          </p>
        </div>
      )}
    </div>
  );
}

function buildTreeRows(nodes: DesignNode[]) {
  const childrenByParent = new Map<string | undefined, DesignNode[]>();
  const explicitChildIds = new Set<string>();

  for (const node of nodes) {
    if (node.children) {
      for (const childId of node.children) explicitChildIds.add(childId);
    }
    const siblings = childrenByParent.get(node.parentId) ?? [];
    siblings.push(node);
    childrenByParent.set(node.parentId, siblings);
  }

  const byId = new Map(nodes.map((node) => [node.id, node]));
  const roots = nodes.filter(
    (node) => !node.parentId && !explicitChildIds.has(node.id),
  );
  const rows: { node: DesignNode; depth: number }[] = [];
  const visited = new Set<string>();

  const visit = (node: DesignNode, depth: number) => {
    if (visited.has(node.id)) return;
    visited.add(node.id);
    rows.push({ node, depth });

    const childNodes =
      node.children?.map((id) => byId.get(id)).filter(isDesignNode) ??
      childrenByParent.get(node.id) ??
      [];

    for (const child of childNodes) visit(child, depth + 1);
  };

  for (const root of roots) visit(root, 0);
  for (const node of nodes) visit(node, 0);

  return rows;
}

function isDesignNode(node: DesignNode | undefined): node is DesignNode {
  return !!node;
}
