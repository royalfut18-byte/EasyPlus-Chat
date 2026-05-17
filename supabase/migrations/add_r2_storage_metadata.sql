-- R2 storage metadata table for tracking uploaded files
-- The messages.attachments JSONB still stores inline metadata per-message.
-- This table provides a dedicated lookup for R2-stored files.

CREATE TABLE IF NOT EXISTS public.upload_metadata (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  conversation_id UUID REFERENCES public.conversations(id) ON DELETE SET NULL,
  message_id UUID REFERENCES public.messages(id) ON DELETE SET NULL,
  file_name TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  size_bytes BIGINT NOT NULL DEFAULT 0,
  original_size_bytes BIGINT,
  compression_applied BOOLEAN DEFAULT FALSE,
  storage_provider TEXT NOT NULL DEFAULT 'r2',
  storage_key TEXT NOT NULL,
  storage_bucket TEXT NOT NULL DEFAULT 'easyplus-uploads',
  public_url TEXT,
  extracted_text TEXT,
  vision_summary TEXT,
  processing_status TEXT DEFAULT 'pending',
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Index for user file lookups
CREATE INDEX IF NOT EXISTS idx_upload_metadata_user
ON public.upload_metadata(user_id, created_at DESC);

-- Index for conversation file lookups
CREATE INDEX IF NOT EXISTS idx_upload_metadata_conversation
ON public.upload_metadata(conversation_id) WHERE conversation_id IS NOT NULL;

-- Index for storage key lookups
CREATE UNIQUE INDEX IF NOT EXISTS idx_upload_metadata_key
ON public.upload_metadata(storage_key);

-- RLS policies
ALTER TABLE public.upload_metadata ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own uploads"
ON public.upload_metadata FOR SELECT
USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own uploads"
ON public.upload_metadata FOR INSERT
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own uploads"
ON public.upload_metadata FOR UPDATE
USING (auth.uid() = user_id);
