-- Add OCR support for scanned/image-only PDFs.
-- Safe migration: all columns/tables are added conditionally.

ALTER TABLE public.attachments
ADD COLUMN IF NOT EXISTS processing_status text DEFAULT 'ready',
ADD COLUMN IF NOT EXISTS ocr_status text,
ADD COLUMN IF NOT EXISTS page_count integer,
ADD COLUMN IF NOT EXISTS ocr_pages_processed jsonb DEFAULT '[]'::jsonb,
ADD COLUMN IF NOT EXISTS metadata jsonb DEFAULT '{}'::jsonb;

CREATE TABLE IF NOT EXISTS public.attachment_pages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  attachment_id uuid NOT NULL REFERENCES public.attachments(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  conversation_id uuid NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
  page_number integer NOT NULL,
  ocr_text text,
  vision_summary text,
  processing_status text DEFAULT 'pending',
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE (attachment_id, page_number)
);

CREATE INDEX IF NOT EXISTS idx_attachment_pages_attachment_id
ON public.attachment_pages(attachment_id);

CREATE INDEX IF NOT EXISTS idx_attachment_pages_conversation_id
ON public.attachment_pages(conversation_id);

CREATE INDEX IF NOT EXISTS idx_attachment_pages_user_id
ON public.attachment_pages(user_id);

CREATE INDEX IF NOT EXISTS idx_attachment_pages_page_number
ON public.attachment_pages(page_number);

ALTER TABLE public.attachment_pages ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'attachment_pages' AND policyname = 'Users can view own attachment pages') THEN
    CREATE POLICY "Users can view own attachment pages" ON public.attachment_pages FOR SELECT USING (auth.uid() = user_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'attachment_pages' AND policyname = 'Users can insert own attachment pages') THEN
    CREATE POLICY "Users can insert own attachment pages" ON public.attachment_pages FOR INSERT WITH CHECK (auth.uid() = user_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'attachment_pages' AND policyname = 'Users can update own attachment pages') THEN
    CREATE POLICY "Users can update own attachment pages" ON public.attachment_pages FOR UPDATE USING (auth.uid() = user_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'attachment_pages' AND policyname = 'Users can delete own attachment pages') THEN
    CREATE POLICY "Users can delete own attachment pages" ON public.attachment_pages FOR DELETE USING (auth.uid() = user_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'attachment_pages' AND policyname = 'Service role full access attachment pages') THEN
    CREATE POLICY "Service role full access attachment pages" ON public.attachment_pages FOR ALL USING (true) WITH CHECK (true);
  END IF;
END $$;
