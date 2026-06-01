// Helpers for resolving uploaded-image file parts to private-storage objects.
//
// Uploaded images live in the (private, RLS-protected) `images` bucket at
// `${userId}/${conversationId}/${imageId}`. An AI SDK file part carries the
// image id in its `filename` (`${imageId}.png`); the part's `url` is a stable
// REFERENCE string, not something to fetch directly. The bytes are resolved
// from storage by id at the two boundaries that actually need them:
//   * the chat server downloads them to base64 for the model, and
//   * the client downloads them via a signed URL for display.
//
// Persisting a base64 data URL in the part (as the AI SDK migration
// accidentally did) duplicates the whole image into `messages.parts`; a raw
// `/storage/.../public/...` path (as the backfill wrote) never resolves
// because the bucket is private. Both are avoided by keeping `url` a
// reference and resolving by id.

export function imageIdFromFilename(
  filename: string | null | undefined,
): string | null {
  if (!filename) return null;
  return filename.replace(/\.[^.]+$/, '') || null;
}

export function imageStoragePath(
  userId: string,
  conversationId: string,
  imageId: string,
): string {
  return `${userId}/${conversationId}/${imageId}`;
}

// Canonical reference persisted in a file part's `url`. Kept in the exact
// shape the 2026-05-18 AI-SDK backfill produced so every row in
// `messages.parts` carries a single, uniform format. Never fetched directly —
// see the note above.
export function imageFilePartUrl(
  userId: string,
  conversationId: string,
  imageId: string,
): string {
  return `/storage/v1/object/public/images/${imageStoragePath(
    userId,
    conversationId,
    imageId,
  )}`;
}
