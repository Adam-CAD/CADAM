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

      // Type guard for event target
      const target = event.target;
      if (!(target instanceof HTMLElement)) return;

      // Check if user is typing in an input/textarea
      const isInputField =
        target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.isContentEditable;

      // Global shortcuts that work even in input fields (Cmd/Ctrl+K, Cmd/Ctrl+/)
      // Note: '/' might appear as '?' when pressed with Shift
      const isGlobalShortcut =
        (event.key === 'k' ||
          event.key === '/' ||
          event.key === '?' ||
          event.key === 'K') &&
        (event.metaKey || event.ctrlKey);

      // Save/Download shortcuts (Cmd/Ctrl+S, Cmd/Ctrl+D) that work in input fields
      const isSaveOrDownload =
        (event.key === 's' ||
          event.key === 'd' ||
          event.key === 'S' ||
          event.key === 'D') &&
        (event.metaKey || event.ctrlKey);

      // Block shortcuts in input fields, except for global and save/download shortcuts
      if (isInputField && !isGlobalShortcut) {
        if (isSaveOrDownload) {
          // Allow save/download shortcuts and prevent browser default behavior
          event.preventDefault();
        } else {
          // Block all other shortcuts in input fields
          return;
        }
      }

      // Find and execute matching shortcut
      for (const shortcut of KEYBOARD_SHORTCUTS) {
        if (matchesShortcut(event, shortcut.key)) {
          // Find handler for this action
          const handler = handlersRef.current.find(
            (h) => h.action === shortcut.action && h.enabled !== false,
          );

          if (handler) {
            event.preventDefault();
            event.stopPropagation();
            event.stopImmediatePropagation();
            handler.handler();
            return;
          }
        }
      }
    },
    [enabled],
  );

  useEffect(() => {
    // Use capture phase to ensure this runs before other listeners
    // This prevents multiple components from handling the same shortcut
    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, [handleKeyDown]);
}
