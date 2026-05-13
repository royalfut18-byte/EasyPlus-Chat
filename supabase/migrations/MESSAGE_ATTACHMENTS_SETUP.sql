-- ============================================================
-- MESSAGE ATTACHMENTS SETUP
-- ============================================================
-- Run this in the Supabase SQL Editor to add attachment
-- persistence to the messages table.
--
-- This adds a JSONB column that stores attachment metadata
-- (file name, type, size, storage path) — NOT file content.
-- ============================================================

ALTER TABLE public.messages
ADD COLUMN IF NOT EXISTS attachments jsonb DEFAULT '[]'::jsonb;

CREATE INDEX IF NOT EXISTS idx_messages_attachments
ON public.messages USING gin (attachments);

-- ============================================================
-- After running this, redeploy Vercel so the app can read/write
-- the new column. Existing messages will have attachments = [].
-- ============================================================
