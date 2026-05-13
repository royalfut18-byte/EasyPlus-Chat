-- Add attachments JSONB column to messages table
-- Stores attachment metadata (not file content) so file cards persist across sessions

ALTER TABLE public.messages
ADD COLUMN IF NOT EXISTS attachments jsonb DEFAULT '[]'::jsonb;

-- GIN index for efficient queries on attachment metadata
CREATE INDEX IF NOT EXISTS idx_messages_attachments
ON public.messages USING gin (attachments);
