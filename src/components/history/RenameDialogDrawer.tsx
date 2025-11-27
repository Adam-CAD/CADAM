import { useEffect, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

interface RenameDialogDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  newTitle: string;
  onNewTitleChange: (title: string) => void;
  onRename: () => void;
}

export function RenameDialogDrawer({
  open,
  onOpenChange,
  newTitle,
  onNewTitleChange,
  onRename,
}: RenameDialogDrawerProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      const timer = setTimeout(() => {
        if (inputRef.current) {
          inputRef.current.focus();
          inputRef.current.select();
        }
      }, 100);
      return () => clearTimeout(timer);
    }
  }, [open]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      onRename();
    } else if (e.key === 'Escape') {
      onOpenChange(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="border-[2px] border-adam-neutral-700 bg-adam-background-1 sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle className="text-adam-neutral-100">
            Rename Creation
          </DialogTitle>
          <DialogDescription>
            Enter a new name for this creation conversation.
          </DialogDescription>
        </DialogHeader>
        <div className="py-4">
          <Input
            ref={inputRef}
            value={newTitle}
            onChange={(e) => onNewTitleChange(e.target.value)}
            onKeyDown={handleKeyDown}
            className="border-2 border-adam-background-2 bg-adam-background-2 pl-6 text-base shadow-[0_0_0px_rgba(0,166,255,0)] ring-0 transition-[border-color,box-shadow] duration-300 ease-in-out hover:border-adam-background-2 hover:shadow-[0_0_4px_rgba(0,166,255,0.9),0_0_5px_rgba(0,166,255,0.7)] focus:border-adam-blue focus:outline-none"
            placeholder="Conversation name"
          />
        </div>
        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            className="border-adam-neutral-700 bg-adam-background-2 text-adam-neutral-50 [@media(hover:hover)]:hover:bg-adam-neutral-950 [@media(hover:hover)]:hover:text-adam-neutral-50"
          >
            Cancel
          </Button>
          <Button
            onClick={onRename}
            className="border bg-adam-neutral-50 text-black [@media(hover:hover)]:hover:border-adam-neutral-50 [@media(hover:hover)]:hover:bg-adam-neutral-950 [@media(hover:hover)]:hover:text-adam-neutral-50"
          >
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
