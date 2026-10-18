/**
 * Tiny pub/sub so the 3D viewer can push an `@part` mention into the chat
 * input. The chat input lives as private local state inside `TextAreaChat`,
 * and the viewer sits deep in a separate branch of the tree, so this decouples
 * the two without prop drilling or a shared context provider.
 */
type MentionListener = (partName: string) => void;

const listeners = new Set<MentionListener>();

/** Subscribe to part-mention events. Returns an unsubscribe function. */
export function onPartMention(listener: MentionListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Notify listeners that the user picked a part named `partName`. */
export function emitPartMention(partName: string): void {
  for (const listener of listeners) listener(partName);
}
