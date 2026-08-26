import { Box } from 'lucide-react';

import { Switch } from '@/components/ui/switch';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';

interface EdgesToggleProps {
  showEdges: boolean;
  onToggle: (value: boolean) => void;
}

export function EdgesToggle({ showEdges, onToggle }: EdgesToggleProps) {
  return (
    <div className="flex items-center gap-2">
      <TooltipProvider delayDuration={300}>
        <Tooltip>
          <TooltipTrigger asChild>
            <div className="cursor-help">
              <Box className="h-4 w-4 text-adam-text-primary" />
            </div>
          </TooltipTrigger>
          <TooltipContent
            side="top"
            className="border-adam-neutral-700 bg-adam-background-2 text-adam-text-primary"
          >
            <p>Edges</p>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>

      <Switch
        checked={showEdges}
        onCheckedChange={onToggle}
        aria-label="Toggle model edges"
      />
    </div>
  );
}
