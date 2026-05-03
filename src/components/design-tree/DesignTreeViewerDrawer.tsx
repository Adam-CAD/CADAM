import { useState } from 'react';
import { Boxes, X } from 'lucide-react';
import { DesignNode, Parameter } from '@shared/types';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { DesignTreePanel } from '@/components/design-tree/DesignTreePanel';

interface DesignTreeViewerDrawerProps {
  nodes: DesignNode[];
  selectedNodeId?: string;
  parameters: Parameter[];
  onSelectNode: (nodeId: string | undefined) => void;
}

export function DesignTreeViewerDrawer({
  nodes,
  selectedNodeId,
  parameters,
  onSelectNode,
}: DesignTreeViewerDrawerProps) {
  const [open, setOpen] = useState(false);

  if (!open) {
    return (
      <Button
        type="button"
        aria-label="Open design tree"
        variant="ghost"
        className="absolute left-3 top-3 z-20 h-9 rounded-md border border-adam-neutral-700/70 bg-adam-neutral-900/80 px-2 text-adam-text-primary shadow-lg backdrop-blur-md hover:bg-adam-neutral-800 hover:text-adam-text-primary"
        onClick={() => setOpen(true)}
      >
        <Boxes className="h-4 w-4" />
        <Badge className="ml-2 rounded-full bg-adam-blue px-1.5 py-0 text-[10px] text-white">
          {nodes.length}
        </Badge>
      </Button>
    );
  }

  return (
    <div className="absolute left-3 top-3 z-20 flex max-h-[calc(100%-1.5rem)] w-[min(280px,calc(100%-1.5rem))] flex-col overflow-hidden rounded-lg border border-adam-neutral-700/80 bg-adam-bg-secondary-dark/95 shadow-2xl backdrop-blur-md">
      <div className="flex h-11 flex-shrink-0 items-center justify-between gap-3 border-b border-adam-neutral-700 px-3">
        <div className="flex min-w-0 items-center gap-2">
          <Boxes className="h-4 w-4 flex-shrink-0 text-adam-neutral-300" />
          <span className="truncate text-sm font-semibold text-adam-text-primary">
            Design Tree
          </span>
          <Badge className="rounded-full bg-adam-neutral-800 px-2 py-0 text-[10px] text-adam-neutral-300">
            {nodes.length}
          </Badge>
        </div>
        <Button
          type="button"
          aria-label="Close design tree"
          variant="ghost"
          className="h-7 w-7 flex-shrink-0 rounded-md p-0 text-adam-neutral-300 hover:bg-adam-neutral-800 hover:text-adam-text-primary"
          onClick={() => setOpen(false)}
        >
          <X className="h-4 w-4" />
        </Button>
      </div>
      <ScrollArea className="min-h-0 flex-1 p-3">
        <DesignTreePanel
          nodes={nodes}
          selectedNodeId={selectedNodeId}
          parameters={parameters}
          onSelectNode={onSelectNode}
        />
      </ScrollArea>
    </div>
  );
}
