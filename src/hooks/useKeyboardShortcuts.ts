/**
 * useKeyboardShortcuts Hook
 *
 * Manages keyboard shortcut registration and execution.
 * Supports platform-specific modifiers and prevents conflicts with input fields.
 */

import { useEffect, useCallback, useRef, useMemo } from 'react';
import {
  type KeyboardShortcut,
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

  // Build a Map from key combination to shortcut for O(1) lookup
  const shortcutMap = useMemo(() => {
    const map = new Map<string, KeyboardShortcut>();
    KEYBOARD_SHORTCUTS.forEach((shortcut) => {
      map.set(shortcut.key, shortcut);
    });
    return map;
  }, []);

  const handleKeyDown = useCallback(
    (event: KeyboardEvent) => {
      if (!enabled || event.defaultPrevented) return;

      // Type guard for event target
      const target = event.target;
      if (!(target instanceof HTMLElement)) return;

      // Check if user is typing in an input/textarea
      const isInputField =
        target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.isContentEditable;

      // Find matching shortcut with O(1) lookup
      let matchedShortcut: KeyboardShortcut | undefined;
      for (const [key, shortcut] of shortcutMap) {
        if (matchesShortcut(event, key)) {
          matchedShortcut = shortcut;
          break;
        }
      }

      if (!matchedShortcut) return;

      // Check if this shortcut works in input fields
      if (isInputField && !matchedShortcut.worksInInputFields) {
        return;
      }

      // Find handler for this action
      const handler = handlersRef.current.find(
        (h) => h.action === matchedShortcut!.action && h.enabled !== false,
      );

      if (handler) {
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
        handler.handler();
      }
    },
    [enabled, shortcutMap],
  );

  useEffect(() => {
    // Use capture phase to ensure this runs before other listeners
    // This prevents multiple components from handling the same shortcut
    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, [handleKeyDown]);
}
