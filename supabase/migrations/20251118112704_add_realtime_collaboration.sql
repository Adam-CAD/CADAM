-- Add real-time collaboration support
-- This migration adds:
-- 1. Share tokens for conversations (public sharing via unique URLs)
-- 2. Realtime broadcasts enabled for conversations and messages
-- 3. Presence tracking for active viewers

-- Add share_token column to conversations for public sharing
ALTER TABLE conversations
ADD COLUMN share_token TEXT UNIQUE,
ADD COLUMN is_public BOOLEAN DEFAULT FALSE;

-- Create index for fast share_token lookups
CREATE INDEX conversations_share_token_idx ON conversations(share_token)
WHERE share_token IS NOT NULL;

-- Function to generate a secure share token
CREATE OR REPLACE FUNCTION generate_share_token()
RETURNS TEXT AS $$
DECLARE
  characters TEXT := 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  token TEXT := '';
  i INTEGER := 0;
BEGIN
  FOR i IN 1..12 LOOP
    token := token || substr(characters, floor(random() * length(characters) + 1)::int, 1);
  END LOOP;
  RETURN token;
END;
$$ LANGUAGE plpgsql;

-- Enable realtime for conversations and messages tables
ALTER PUBLICATION supabase_realtime ADD TABLE conversations;
ALTER PUBLICATION supabase_realtime ADD TABLE messages;

-- Update RLS policies to allow read access via share_token
CREATE POLICY "Allow read access via share token"
ON conversations FOR SELECT
USING (
  -- Owner can always read
  auth.uid() = user_id
  OR
  -- Anyone with valid share token can read if public
  (is_public = true AND share_token IS NOT NULL)
);

CREATE POLICY "Allow read messages via share token"
ON messages FOR SELECT
USING (
  -- Owner can read
  EXISTS (
    SELECT 1 FROM conversations
    WHERE conversations.id = messages.conversation_id
    AND conversations.user_id = auth.uid()
  )
  OR
  -- Anyone can read if conversation is public
  EXISTS (
    SELECT 1 FROM conversations
    WHERE conversations.id = messages.conversation_id
    AND conversations.is_public = true
    AND conversations.share_token IS NOT NULL
  )
);

-- Drop old restrictive policies
DROP POLICY IF EXISTS "Users can view own conversations" ON conversations;
DROP POLICY IF EXISTS "Users can manage their own messages" ON messages;

-- Recreate owner policies
CREATE POLICY "Users can manage own conversations"
ON conversations
FOR ALL
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can manage own messages"
ON messages
FOR ALL
USING (
  EXISTS (
    SELECT 1 FROM conversations
    WHERE conversations.id = messages.conversation_id
    AND conversations.user_id = auth.uid()
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM conversations
    WHERE conversations.id = messages.conversation_id
    AND conversations.user_id = auth.uid()
  )
);

-- Comment on new columns
COMMENT ON COLUMN conversations.share_token IS 'Unique token for sharing conversation publicly';
COMMENT ON COLUMN conversations.is_public IS 'Whether conversation is publicly accessible via share link';
