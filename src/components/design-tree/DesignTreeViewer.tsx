import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import { cn } from '@/lib/utils';
import type {
  CadamDesignTreeNode,
  CadamDesignTreeParseWarning,
} from '@shared/types';
import {
  AlertTriangle,
  Box,
  ChevronDown,
  CircleDot,
  Folder,
  SlidersHorizontal,
  Wrench,
} from 'lucide-react';
import { useMemo, useState } from 'react';

interface DesignTreeViewerProps {
  nodes: CadamDesignTreeNode[];
  selectedNodeId?: string | null;
  onSelectNode?: (nodeId: string | null) => void;
  warnings: CadamDesignTreeParseWarning[];
}

type TreeNode = CadamDesignTreeNode & {
  children: TreeNode[];
};

export function DesignTreeViewer({
  nodes,
  selectedNodeId,
  onSelectNode,
  warnings,
}: DesignTreeViewerProps) {
  const treeNodes = useMemo(() => buildTree(nodes), [nodes]);
  if (nodes.length === 0 && warnings.length === 0) return null;

  return (
    <section className="flex flex-col gap-3 border-b border-adam-neutral-700 pb-4">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-xs font-semibold text-adam-text-primary">
            Design Tree
          </h3>
          <p className="mt-0.5 text-[11px] text-adam-text-secondary">
            Source annotations
          </p>
        </div>
        {warnings.length > 0 && (
          <Badge className="shrink-0 border-amber-400/20 bg-amber-400/10 px-2 py-0.5 text-[10px] text-amber-200">
            <AlertTriangle className="mr-1 h-3 w-3" />
            {warnings.length}
          </Badge>
        )}
      </div>

      {warnings.length > 0 && (
        <div className="rounded-md border border-amber-400/20 bg-amber-400/5 px-3 py-2 text-[11px] text-amber-100/90">
          {warnings.length === 1
            ? warnings[0].message
            : `${warnings.length} annotations could not be shown.`}
        </div>
      )}

      {treeNodes.length > 0 && (
        <div className="flex flex-col gap-1">
          {treeNodes.map((node) => (
            <DesignTreeRow
              key={node.id}
              node={node}
              selectedNodeId={selectedNodeId}
              onSelectNode={onSelectNode}
            />
          ))}
        </div>
      )}
    </section>
  );
}

function DesignTreeRow({
  node,
  selectedNodeId,
  onSelectNode,
}: {
  node: TreeNode;
  selectedNodeId?: string | null;
  onSelectNode?: (nodeId: string | null) => void;
}) {
  const hasChildren = node.children.length > 0;
  const [open, setOpen] = useState(true);
  const isSelected = selectedNodeId === node.id;
  const Icon = iconForKind(node.kind);

  const content = (
    <Button
      type="button"
      variant="ghost"
      onClick={() => onSelectNode?.(isSelected ? null : node.id)}
      className={cn(
        'h-8 min-w-0 flex-1 justify-start gap-2 rounded-md px-2 text-left text-xs text-adam-text-secondary hover:bg-adam-neutral-800 hover:text-adam-text-primary',
        isSelected && 'bg-adam-neutral-800 text-adam-text-primary',
      )}
    >
      <Icon className="h-3.5 w-3.5 shrink-0" />
      <span className="min-w-0 truncate">{node.name}</span>
      <span className="ml-auto shrink-0 text-[10px] text-adam-neutral-400">
        {node.kind}
      </span>
    </Button>
  );

  if (!hasChildren) {
    return <div className="flex items-center gap-1">{content}</div>;
  }

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <div className="flex items-center gap-1">
        <CollapsibleTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            aria-label={`${open ? 'Collapse' : 'Expand'} ${node.name}`}
            className="h-8 w-6 shrink-0 rounded-md p-0 text-adam-neutral-400 hover:bg-adam-neutral-800 hover:text-adam-text-primary"
          >
            <ChevronDown
              className={cn(
                'h-3.5 w-3.5 transition-transform',
                !open && '-rotate-90',
              )}
            />
          </Button>
        </CollapsibleTrigger>
        {content}
      </div>
      <CollapsibleContent>
        <div className="ml-4 border-l border-adam-neutral-700 pl-2">
          {node.children.map((child) => (
            <DesignTreeRow
              key={child.id}
              node={child}
              selectedNodeId={selectedNodeId}
              onSelectNode={onSelectNode}
            />
          ))}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

function buildTree(nodes: CadamDesignTreeNode[]) {
  const byId = new Map<string, TreeNode>();
  const roots: TreeNode[] = [];

  for (const node of nodes) {
    byId.set(node.id, { ...node, children: [] });
  }

  for (const node of byId.values()) {
    const parent = node.parentId ? byId.get(node.parentId) : undefined;
    if (parent && !wouldCreateCycle(node, parent, byId)) {
      parent.children.push(node);
    } else {
      roots.push(node);
    }
  }

  return roots;
}

function wouldCreateCycle(
  node: TreeNode,
  parent: TreeNode,
  byId: Map<string, TreeNode>,
) {
  const seenIds = new Set<string>();
  let current: TreeNode | undefined = parent;

  while (current) {
    if (current.id === node.id) return true;
    if (!current.parentId || seenIds.has(current.id)) return false;
    seenIds.add(current.id);
    current = byId.get(current.parentId);
  }

  return false;
}

function iconForKind(kind: CadamDesignTreeNode['kind']) {
  switch (kind) {
    case 'group':
      return Folder;
    case 'operation':
      return Wrench;
    case 'parameter':
      return SlidersHorizontal;
    case 'part':
      return Box;
    default:
      return CircleDot;
  }
}
