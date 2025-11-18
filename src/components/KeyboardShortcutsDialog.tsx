/**
 * Keyboard Shortcuts Help Dialog
 *
 * Displays all available keyboard shortcuts organized by category.
 */

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { KEYBOARD_SHORTCUTS, formatKeyCombo } from '@/types/keyboard';

interface KeyboardShortcutsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function KeyboardShortcutsDialog({
  open,
  onOpenChange,
}: KeyboardShortcutsDialogProps) {
  // Group shortcuts by category
  const categories = Array.from(
    new Set(KEYBOARD_SHORTCUTS.map((s) => s.category)),
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Keyboard Shortcuts</DialogTitle>
          <DialogDescription>
            Speed up your workflow with these keyboard shortcuts
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6">
          {categories.map((category) => {
            const shortcuts = KEYBOARD_SHORTCUTS.filter(
              (s) => s.category === category && s.enabled !== false,
            );

            return (
              <div key={category} className="space-y-3">
                <h3 className="text-sm font-semibold text-adam-neutral-200">
                  {category}
                </h3>
                <div className="space-y-2">
                  {shortcuts.map((shortcut) => (
                    <div
                      key={shortcut.action}
                      className="flex items-center justify-between rounded-lg bg-adam-neutral-800/50 px-4 py-3"
                    >
                      <div className="flex-1">
                        <div className="text-sm font-medium text-adam-neutral-100">
                          {shortcut.label}
                        </div>
                        <div className="text-xs text-adam-neutral-400">
                          {shortcut.description}
                        </div>
                      </div>
                      <kbd className="ring-adam-neutral-600 ml-4 inline-flex items-center gap-1 rounded bg-adam-neutral-700 px-3 py-1.5 font-mono text-sm font-semibold text-adam-neutral-100 ring-1">
                        {formatKeyCombo(shortcut.key)}
                      </kbd>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>

        <div className="mt-4 rounded-lg bg-adam-blue/10 p-4 text-sm text-adam-neutral-300">
          <p className="font-medium text-adam-blue">Pro tip:</p>
          <p className="mt-1">
            Press{' '}
            <kbd className="rounded bg-adam-neutral-700 px-2 py-0.5 font-mono text-xs">
              {formatKeyCombo('mod+/')}
            </kbd>{' '}
            anytime to view this help dialog.
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}
