/**
 * Collaborators Indicator
 *
 * Shows avatars of active collaborators viewing the current conversation.
 * Displays in real-time using presence tracking.
 */

import { Users } from 'lucide-react';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { CollaboratorPresence } from '@/hooks/useRealtimeCollaboration';

interface CollaboratorsIndicatorProps {
  collaborators: CollaboratorPresence[];
  isConnected: boolean;
}

export function CollaboratorsIndicator({
  collaborators,
  isConnected,
}: CollaboratorsIndicatorProps) {
  if (!isConnected || collaborators.length === 0) {
    return null;
  }

  const maxVisible = 3;
  const visibleCollaborators = collaborators.slice(0, maxVisible);
  const remainingCount = collaborators.length - maxVisible;

  return (
    <TooltipProvider>
      <div className="flex items-center gap-2">
        <div className="flex -space-x-2">
          {visibleCollaborators.map((collaborator) => (
            <Tooltip key={collaborator.userId}>
              <TooltipTrigger>
                <div
                  className="flex h-8 w-8 items-center justify-center rounded-full border-2 border-adam-bg-dark text-xs font-medium text-white"
                  style={{ backgroundColor: collaborator.color }}
                >
                  {collaborator.userName.charAt(0).toUpperCase()}
                </div>
              </TooltipTrigger>
              <TooltipContent>
                <p className="text-xs">{collaborator.userName}</p>
              </TooltipContent>
            </Tooltip>
          ))}
          {remainingCount > 0 && (
            <div className="flex h-8 w-8 items-center justify-center rounded-full border-2 border-adam-bg-dark bg-adam-neutral-700 text-xs font-medium text-adam-neutral-300">
              +{remainingCount}
            </div>
          )}
        </div>
        <span className="text-xs text-adam-neutral-400">
          <Users className="mr-1 inline h-3 w-3" />
          {collaborators.length} viewing
        </span>
      </div>
    </TooltipProvider>
  );
}
