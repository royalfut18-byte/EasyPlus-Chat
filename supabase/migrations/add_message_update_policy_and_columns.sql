-- Fix: Add UPDATE policy for messages table (was missing - caused assistant responses to silently fail to save)
-- Also add missing updated_at column

-- Add updated_at column if not exists
ALTER TABLE public.messages
ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

-- Create index on conversation_id if not exists (may already exist from initial schema)
CREATE INDEX IF NOT EXISTS messages_conversation_id_idx ON public.messages(conversation_id);

-- Create index on request_id if not exists
CREATE INDEX IF NOT EXISTS messages_request_id_idx ON public.messages(request_id) WHERE request_id IS NOT NULL;

-- Create index on parent_message_id
CREATE INDEX IF NOT EXISTS messages_parent_message_id_idx ON public.messages(parent_message_id) WHERE parent_message_id IS NOT NULL;

-- Create index on client_message_id
CREATE INDEX IF NOT EXISTS messages_client_message_id_idx ON public.messages(client_message_id) WHERE client_message_id IS NOT NULL;

-- CRITICAL FIX: Add UPDATE policy for messages
-- Without this, all .update() calls (partial saves, final saves, status updates) silently fail
CREATE POLICY "Users can update messages in own conversations"
  ON messages FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM conversations
      WHERE conversations.id = messages.conversation_id
      AND conversations.user_id = auth.uid()
    )
  );
