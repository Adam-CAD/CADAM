ALTER TABLE public.messages
ADD COLUMN IF NOT EXISTS parts jsonb NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE public.messages
ADD COLUMN IF NOT EXISTS metadata jsonb NOT NULL DEFAULT '{}'::jsonb;

-- content column is intentionally retained for legacy conversations (a
-- follow-up read-only display path will use it). New messages persist their
-- payload in `parts` instead, so the NOT NULL constraint on `content` has
-- to be dropped or every insert from the new code path fails with
-- `null value in column "content" violates not-null constraint`.
ALTER TABLE public.messages
ALTER COLUMN content DROP NOT NULL;

ALTER TABLE public.conversations
DROP COLUMN IF EXISTS legacy;
