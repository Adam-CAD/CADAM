/**
 * Keyboard Shortcuts System
 *
 * Centralized keyboard shortcuts management for CADAM.
 * Supports platform-specific modifiers (Cmd on Mac, Ctrl on Windows/Linux).
 */

export type ShortcutAction =
  | 'download-stl'
  | 'download-scad'
  | 'submit-message'
  | 'toggle-sidebar'
  | 'show-shortcuts'
  | 'focus-chat-input';

export interface KeyboardShortcut {
  /** Unique action identifier */
  action: ShortcutAction;
  /** Human-readable label */
  label: string;
  /** Description of what this shortcut does */
  description: string;
  /** Key combination (e.g., "mod+d" where mod = Cmd/Ctrl) */
  key: string;
  /** Category for grouping in help modal */
  category: 'General' | 'Files' | 'Navigation';
  /** Whether this shortcut is enabled */
  enabled?: boolean;
}

export interface KeyboardShortcutHandler {
  /** The action to handle */
  action: ShortcutAction;
  /** Callback function to execute */
  handler: () => void;
  /** Whether this handler should be enabled (optional) */
  enabled?: boolean;
}

/**
 * Default keyboard shortcuts configuration
 */
export const KEYBOARD_SHORTCUTS: KeyboardShortcut[] = [
  {
    action: 'download-stl',
    label: 'Download STL',
    description: 'Download the current model as STL file',
    key: 'mod+d',
    category: 'Files',
  },
  {
    action: 'download-scad',
    label: 'Download OpenSCAD',
    description: 'Download the OpenSCAD source code',
    key: 'mod+shift+s',
    category: 'Files',
  },
  {
    action: 'submit-message',
    label: 'Send Message',
    description: 'Submit the current chat message',
    key: 'mod+enter',
    category: 'General',
  },
  {
    action: 'toggle-sidebar',
    label: 'Toggle Sidebar',
    description: 'Show or hide the conversations sidebar',
    key: 'mod+b',
    category: 'Navigation',
  },
  {
    action: 'show-shortcuts',
    label: 'Show Shortcuts',
    description: 'Display this keyboard shortcuts help',
    key: 'mod+/',
    category: 'General',
  },
  {
    action: 'focus-chat-input',
    label: 'Focus Chat Input',
    description: 'Jump to the chat input field',
    key: 'mod+k',
    category: 'Navigation',
  },
];

/**
 * Check if we're on macOS
 */
export const isMac = () =>
  typeof navigator !== 'undefined' && navigator.userAgent.includes('Mac');

/**
 * Get the modifier key for the current platform
 * @returns "⌘" on Mac, "Ctrl" on other platforms
 */
export const getModifierKey = (): string => (isMac() ? '⌘' : 'Ctrl');

/**
 * Format a key combination for display
 * @example formatKeyCombo("mod+d") => "⌘D" on Mac, "Ctrl+D" on Windows
 */
export const formatKeyCombo = (key: string): string => {
  const parts = key.split('+');
  const formatted = parts.map((part) => {
    switch (part.toLowerCase()) {
      case 'mod':
        return getModifierKey();
      case 'shift':
        return isMac() ? '⇧' : 'Shift';
      case 'alt':
        return isMac() ? '⌥' : 'Alt';
      case 'enter':
        return isMac() ? '↵' : 'Enter';

      default:
        return part.toUpperCase();
    }
  });

  return isMac() ? formatted.join('') : formatted.join('+');
};

/**
 * Parse a keyboard event to check if it matches a shortcut key
 */
export const matchesShortcut = (
  event: KeyboardEvent,
  shortcutKey: string,
): boolean => {
  const parts = shortcutKey.toLowerCase().split('+');
  const key = parts[parts.length - 1];
  const modifiers = parts.slice(0, -1);

  // For special characters like '/', use event.code to avoid Shift key conflicts
  // '/' requires Shift on most keyboards (appears as '?'), so we check the code instead
  const keyMatches =
    key === '/' ? event.code === 'Slash' : event.key.toLowerCase() === key;

  if (!keyMatches) return false;

  // Check modifiers
  const needsMod = modifiers.includes('mod');
  const needsShift = modifiers.includes('shift');
  const needsAlt = modifiers.includes('alt');

  // Check if the required modifier is pressed
  const hasMod = isMac() ? event.metaKey : event.ctrlKey;

  // Match the required modifiers
  // For '/' key, ignore Shift since it's required to type '/' on most keyboards
  const modMatches = needsMod === hasMod;
  const shiftMatches = key === '/' ? true : needsShift === event.shiftKey;
  const altMatches = needsAlt === event.altKey;

  return modMatches && shiftMatches && altMatches;
};
