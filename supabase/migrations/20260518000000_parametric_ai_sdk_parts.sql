ALTER TABLE public.messages
ADD COLUMN IF NOT EXISTS parts jsonb NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE public.messages
ADD COLUMN IF NOT EXISTS metadata jsonb NOT NULL DEFAULT '{}'::jsonb;

-- content column is intentionally retained (nullable) so legacy conversations
-- can be rendered through a read-only path in a follow-up task.

ALTER TABLE public.conversations
DROP COLUMN IF EXISTS legacy;
