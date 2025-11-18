/**
 * useKeyboardShortcuts Hook
 *
 * Manages keyboard shortcut registration and execution.
 * Supports platform-specific modifiers and prevents conflicts with input fields.
 */

import { useEffect, useCallback, useRef } from 'react';
import {
  type KeyboardShortcutHandler,
  KEYBOARD_SHORTCUTS,
  matchesShortcut,
} from '@/types/keyboard';

interface UseKeyboardShortcutsOptions {
  /** Handlers for specific shortcuts */
  handlers: KeyboardShortcutHandler[];
  /** Whether shortcuts are globally enabled */
  enabled?: boolean;
}

/**
 * Hook to register and handle keyboard shortcuts
 *
 * @example
 * useKeyboardShortcuts({
 *   handlers: [
 *     { action: 'download-stl', handler: () => download() },
 *     { action: 'toggle-sidebar', handler: () => setSidebarOpen(prev => !prev) }
 *   ]
 * });
 */
export function useKeyboardShortcuts({
  handlers,
  enabled = true,
}: UseKeyboardShortcutsOptions) {
  // Use ref to avoid recreating the handler on every render
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;

  const handleKeyDown = useCallback(
    (event: KeyboardEvent) => {
      if (!enabled) return;

      // Don't trigger shortcuts when user is typing in an input/textarea
      const target = event.target as HTMLElement;
      const isInputField =
        target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.isContentEditable;

      // Exception: Allow Cmd/Ctrl+K and Cmd/Ctrl+/ even in input fields
      const isGlobalShortcut =
        (event.key === 'k' || event.key === '/') &&
        (event.metaKey || event.ctrlKey);

      if (isInputField && !isGlobalShortcut) {
        // Still allow shortcuts that explicitly use Cmd/Ctrl+S, Cmd/Ctrl+D, etc.
        // but only if they're NOT editing text (to prevent browser save dialog)
        const isSaveOrDownload =
          (event.key === 's' || event.key === 'd') &&
          (event.metaKey || event.ctrlKey);

        if (isSaveOrDownload) {
          // Allow these shortcuts and prevent browser default
          event.preventDefault();
        } else {
          return;
        }
      }

      // Find matching shortcut
      for (const shortcut of KEYBOARD_SHORTCUTS) {
        if (matchesShortcut(event, shortcut.key)) {
          // Find handler for this action
          const handler = handlersRef.current.find(
            (h) => h.action === shortcut.action && h.enabled !== false,
          );

          if (handler) {
            event.preventDefault();
            event.stopPropagation();
            handler.handler();
            return;
          }
        }
      }
    },
    [enabled],
  );

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);
}
