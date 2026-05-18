# Legacy code

This directory holds the pre-migration components verbatim from `master`. They reference the old `Content` blob shape on `messages.content`, the deleted `CurrentMessageContext`, and the legacy edge function chat handlers.

These files are **excluded from typecheck and build** (see `tsconfig.app.json` excludes). They are kept here as a faithful reference so a future task can wire up a read-only view of legacy conversations — conversations where `messages.parts` is empty and the legacy `content` jsonb column holds the real data.

To resurrect any of this, you'll need to either:

1. Reintroduce the `Content` type into `shared/types.ts` (or carry it in a `src/legacy/types.ts` alongside the components), and
2. Restore the dependencies these files reference (`CurrentMessageContext`, `shared/types.Content`, etc.) — or rewrite them.

Until then this is just a parking lot.
