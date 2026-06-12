import { Link } from '@tanstack/react-router';
import { ExternalLink, MoreVertical, Pencil, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { Conversation } from '@shared/types';

interface SidebarConversationItemProps {
  conversation: Pick<Conversation, 'id' | 'title'>;
  onDelete: (conversationId: string) => void;
  onRename: (conversationId: string, currentTitle: string) => void;
  onNavigate?: () => void;
}

export function SidebarConversationItem({
  conversation,
  onDelete,
  onRename,
  onNavigate,
}: SidebarConversationItemProps) {
  return (
    <li className="group relative list-none">
      <Link
        to="/editor/$id"
        params={{ id: conversation.id }}
        onClick={onNavigate}
        className="block min-w-0 pr-7"
      >
        <span className="line-clamp-1 text-ellipsis text-nowrap rounded-md p-1 text-xs font-medium text-adam-neutral-400 transition-colors duration-200 ease-in-out [@media(hover:hover)]:group-hover:bg-adam-neutral-950 [@media(hover:hover)]:group-hover:text-adam-neutral-10">
          {conversation.title || 'Untitled creation'}
        </span>
      </Link>
      <div className="absolute right-0 top-1/2 -translate-y-1/2 opacity-0 transition-opacity duration-150 [@media(hover:hover)]:focus-within:opacity-100 [@media(hover:hover)]:group-hover:opacity-100">
        <AlertDialog>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-6 w-6 p-0 text-adam-neutral-400 hover:bg-adam-neutral-950 hover:text-adam-neutral-100"
                onClick={(event) => event.preventDefault()}
              >
                <MoreVertical className="h-3.5 w-3.5" />
                <span className="sr-only">Creation options</span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="end"
              className="min-w-[10rem] border-adam-neutral-700 bg-[#191A1A]"
            >
              <DropdownMenuItem
                asChild
                className="text-adam-neutral-50 hover:cursor-pointer hover:bg-adam-neutral-950 focus:bg-adam-neutral-950"
              >
                <Link
                  to="/editor/$id"
                  params={{ id: conversation.id }}
                  onClick={onNavigate}
                >
                  <ExternalLink className="mr-2 h-3.5 w-3.5" />
                  Open
                </Link>
              </DropdownMenuItem>
              <DropdownMenuItem
                className="text-adam-neutral-50 hover:cursor-pointer hover:bg-adam-neutral-950 focus:bg-adam-neutral-950"
                onClick={(event) => {
                  event.preventDefault();
                  onRename(conversation.id, conversation.title);
                }}
              >
                <Pencil className="mr-2 h-3.5 w-3.5" />
                Rename
              </DropdownMenuItem>
              <AlertDialogTrigger asChild>
                <DropdownMenuItem
                  className="text-adam-neutral-50 hover:cursor-pointer hover:bg-adam-neutral-950 hover:text-red-500 focus:bg-adam-neutral-950 focus:text-red-500"
                  onSelect={(event) => event.preventDefault()}
                >
                  <Trash2 className="mr-2 h-3.5 w-3.5" />
                  Delete
                </DropdownMenuItem>
              </AlertDialogTrigger>
            </DropdownMenuContent>
          </DropdownMenu>
          <AlertDialogContent className="border-[2px] border-adam-neutral-700 bg-adam-background-1">
            <AlertDialogHeader>
              <AlertDialogTitle className="text-adam-neutral-100">
                Delete creation
              </AlertDialogTitle>
              <AlertDialogDescription>
                Are you sure you want to delete &ldquo;
                {conversation.title || 'Untitled creation'}&rdquo;? This action
                cannot be undone.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                className="bg-red-600 hover:bg-red-700 dark:bg-red-900 dark:hover:bg-red-800"
                onClick={() => onDelete(conversation.id)}
              >
                Delete
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </li>
  );
}
