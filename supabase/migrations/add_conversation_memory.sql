-- Migration: Add conversation memory and context persistence
-- Safe: uses IF NOT EXISTS / ADD COLUMN IF NOT EXISTS patterns

-- 1. Add context columns to conversations
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS purpose_summary text;
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS rolling_summary text;
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS pinned_context text;
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS last_context_refresh_at timestamptz;
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS message_count integer DEFAULT 0;

-- 2. Add token_count to messages
ALTER TABLE messages ADD COLUMN IF NOT EXISTS token_count integer;

-- 3. Create attachments table for persistent file/image context
CREATE TABLE IF NOT EXISTS public.attachments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  conversation_id uuid NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
  message_id uuid REFERENCES public.messages(id) ON DELETE SET NULL,
  file_name text,
  file_type text,
  mime_type text,
  storage_path text,
  public_url text,
  extracted_text text,
  vision_summary text,
  ocr_text text,
  important_details jsonb DEFAULT '{}',
  purpose_note text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_attachments_user_id ON public.attachments(user_id);
CREATE INDEX IF NOT EXISTS idx_attachments_conversation_id ON public.attachments(conversation_id);
CREATE INDEX IF NOT EXISTS idx_attachments_message_id ON public.attachments(message_id);

-- 4. Create conversation_memories table (conversation-scoped memory)
CREATE TABLE IF NOT EXISTS public.conversation_memories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  conversation_id uuid REFERENCES public.conversations(id) ON DELETE CASCADE,
  scope text NOT NULL DEFAULT 'conversation'
    CHECK (scope IN ('user', 'project', 'conversation', 'attachment', 'preference', 'task', 'decision', 'bug')),
  title text,
  content text NOT NULL,
  importance integer DEFAULT 3 CHECK (importance >= 1 AND importance <= 5),
  source_message_id uuid REFERENCES public.messages(id) ON DELETE SET NULL,
  source_attachment_id uuid,
  metadata jsonb DEFAULT '{}',
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_conv_memories_user_id ON public.conversation_memories(user_id);
CREATE INDEX IF NOT EXISTS idx_conv_memories_conversation_id ON public.conversation_memories(conversation_id);
CREATE INDEX IF NOT EXISTS idx_conv_memories_scope ON public.conversation_memories(scope);
CREATE INDEX IF NOT EXISTS idx_conv_memories_importance ON public.conversation_memories(importance DESC);

-- 5. Create memory_chunks table for long text chunking
CREATE TABLE IF NOT EXISTS public.memory_chunks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  conversation_id uuid REFERENCES public.conversations(id) ON DELETE CASCADE,
  source_type text NOT NULL CHECK (source_type IN ('message', 'attachment', 'import', 'summary', 'memory')),
  source_id uuid,
  chunk_index integer DEFAULT 0,
  content text NOT NULL,
  summary text,
  metadata jsonb DEFAULT '{}',
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_memory_chunks_user_id ON public.memory_chunks(user_id);
CREATE INDEX IF NOT EXISTS idx_memory_chunks_conversation_id ON public.memory_chunks(conversation_id);
CREATE INDEX IF NOT EXISTS idx_memory_chunks_source_type ON public.memory_chunks(source_type);

-- 6. Create context_snapshots table
CREATE TABLE IF NOT EXISTS public.context_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  conversation_id uuid NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
  summary text NOT NULL,
  key_decisions jsonb DEFAULT '[]',
  open_tasks jsonb DEFAULT '[]',
  important_files jsonb DEFAULT '[]',
  current_errors jsonb DEFAULT '[]',
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_context_snapshots_conversation ON public.context_snapshots(conversation_id);
CREATE INDEX IF NOT EXISTS idx_context_snapshots_user ON public.context_snapshots(user_id);

-- 7. Enable RLS on new tables
ALTER TABLE public.attachments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.conversation_memories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.memory_chunks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.context_snapshots ENABLE ROW LEVEL SECURITY;

-- 8. RLS Policies: attachments
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'attachments' AND policyname = 'Users can view own attachments') THEN
    CREATE POLICY "Users can view own attachments" ON public.attachments FOR SELECT USING (auth.uid() = user_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'attachments' AND policyname = 'Users can insert own attachments') THEN
    CREATE POLICY "Users can insert own attachments" ON public.attachments FOR INSERT WITH CHECK (auth.uid() = user_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'attachments' AND policyname = 'Users can update own attachments') THEN
    CREATE POLICY "Users can update own attachments" ON public.attachments FOR UPDATE USING (auth.uid() = user_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'attachments' AND policyname = 'Users can delete own attachments') THEN
    CREATE POLICY "Users can delete own attachments" ON public.attachments FOR DELETE USING (auth.uid() = user_id);
  END IF;
END $$;

-- 9. RLS Policies: conversation_memories
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'conversation_memories' AND policyname = 'Users can view own conv memories') THEN
    CREATE POLICY "Users can view own conv memories" ON public.conversation_memories FOR SELECT USING (auth.uid() = user_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'conversation_memories' AND policyname = 'Users can insert own conv memories') THEN
    CREATE POLICY "Users can insert own conv memories" ON public.conversation_memories FOR INSERT WITH CHECK (auth.uid() = user_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'conversation_memories' AND policyname = 'Users can update own conv memories') THEN
    CREATE POLICY "Users can update own conv memories" ON public.conversation_memories FOR UPDATE USING (auth.uid() = user_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'conversation_memories' AND policyname = 'Users can delete own conv memories') THEN
    CREATE POLICY "Users can delete own conv memories" ON public.conversation_memories FOR DELETE USING (auth.uid() = user_id);
  END IF;
END $$;

-- 10. RLS Policies: memory_chunks
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'memory_chunks' AND policyname = 'Users can view own chunks') THEN
    CREATE POLICY "Users can view own chunks" ON public.memory_chunks FOR SELECT USING (auth.uid() = user_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'memory_chunks' AND policyname = 'Users can insert own chunks') THEN
    CREATE POLICY "Users can insert own chunks" ON public.memory_chunks FOR INSERT WITH CHECK (auth.uid() = user_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'memory_chunks' AND policyname = 'Users can delete own chunks') THEN
    CREATE POLICY "Users can delete own chunks" ON public.memory_chunks FOR DELETE USING (auth.uid() = user_id);
  END IF;
END $$;

-- 11. RLS Policies: context_snapshots
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'context_snapshots' AND policyname = 'Users can view own snapshots') THEN
    CREATE POLICY "Users can view own snapshots" ON public.context_snapshots FOR SELECT USING (auth.uid() = user_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'context_snapshots' AND policyname = 'Users can insert own snapshots') THEN
    CREATE POLICY "Users can insert own snapshots" ON public.context_snapshots FOR INSERT WITH CHECK (auth.uid() = user_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'context_snapshots' AND policyname = 'Users can delete own snapshots') THEN
    CREATE POLICY "Users can delete own snapshots" ON public.context_snapshots FOR DELETE USING (auth.uid() = user_id);
  END IF;
END $$;
