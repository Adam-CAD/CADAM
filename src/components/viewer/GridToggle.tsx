import { Grid3x3 } from 'lucide-react';

import { Switch } from '@/components/ui/switch';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';

interface GridToggleProps {
  showGrid: boolean;
  onToggle: (value: boolean) => void;
}

export function GridToggle({ showGrid, onToggle }: GridToggleProps) {
  return (
    <div className="flex items-center gap-2">
      <TooltipProvider delayDuration={300}>
        <Tooltip>
          <TooltipTrigger asChild>
            <div className="cursor-help">
              <Grid3x3 className="h-4 w-4 text-adam-text-primary" />
            </div>
          </TooltipTrigger>
          <TooltipContent
            side="top"
            className="border-adam-neutral-700 bg-adam-background-2 text-adam-text-primary"
          >
            <p>Ground grid</p>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>

      <Switch
        checked={showGrid}
        onCheckedChange={onToggle}
        aria-label="Toggle ground grid"
      />
    </div>
  );
}
