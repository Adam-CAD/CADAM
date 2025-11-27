import { Switch } from '@/components/ui/switch';
import OrthographicCube from '@/components/viewer/OrthographicCube';
import PerspectiveCube from '@/components/viewer/PerspectiveCube';
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
  TooltipProvider,
} from '@/components/ui/tooltip';

interface OrthographicPerspectiveToggleProps {
  isOrthographic: boolean;
  onToggle: (value: boolean) => void;
}

export function OrthographicPerspectiveToggle({
  isOrthographic,
  onToggle,
}: OrthographicPerspectiveToggleProps) {
  return (
    <div className="flex items-center gap-2">
      <TooltipProvider delayDuration={300}>
        <Tooltip>
          <TooltipTrigger asChild>
            <div className="cursor-help">
              <PerspectiveCube className="h-4 w-4 text-adam-text-primary" />
            </div>
          </TooltipTrigger>
          <TooltipContent
            side="top"
            className="border-adam-neutral-700 bg-adam-background-2 text-adam-text-primary"
          >
            <p>Perspective View</p>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>

      <Switch checked={isOrthographic} onCheckedChange={onToggle} />

      <TooltipProvider delayDuration={300}>
        <Tooltip>
          <TooltipTrigger asChild>
            <div className="cursor-help">
              <OrthographicCube className="h-4 w-4 text-adam-text-primary" />
            </div>
          </TooltipTrigger>
          <TooltipContent
            side="top"
            className="border-adam-neutral-700 bg-adam-background-2 text-adam-text-primary"
          >
            <p>Orthographic View</p>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    </div>
  );
}
