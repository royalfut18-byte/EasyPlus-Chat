-- ============================================================
-- EasyPlus Long-Term Memory Setup
-- ============================================================
-- Run this SQL in your Supabase SQL Editor (https://supabase.com/dashboard)
-- Go to: Project > SQL Editor > New Query > Paste this > Run
-- ============================================================

-- Create the user_memories table
CREATE TABLE IF NOT EXISTS public.user_memories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  memory_text text NOT NULL,
  category text DEFAULT 'general',
  importance integer DEFAULT 3 CHECK (importance >= 1 AND importance <= 5),
  source_conversation_id uuid REFERENCES public.conversations(id) ON DELETE SET NULL,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Indexes for fast retrieval
CREATE INDEX IF NOT EXISTS idx_user_memories_user_id ON public.user_memories(user_id);
CREATE INDEX IF NOT EXISTS idx_user_memories_category ON public.user_memories(category);
CREATE INDEX IF NOT EXISTS idx_user_memories_importance ON public.user_memories(importance DESC);
CREATE INDEX IF NOT EXISTS idx_user_memories_created_at ON public.user_memories(created_at DESC);

-- Enable Row Level Security
ALTER TABLE public.user_memories ENABLE ROW LEVEL SECURITY;

-- Users can view their own memories
CREATE POLICY "Users can view own memories"
  ON public.user_memories FOR SELECT
  USING (auth.uid() = user_id);

-- Users can insert their own memories
CREATE POLICY "Users can insert own memories"
  ON public.user_memories FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- Users can update their own memories
CREATE POLICY "Users can update own memories"
  ON public.user_memories FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Users can delete their own memories
CREATE POLICY "Users can delete own memories"
  ON public.user_memories FOR DELETE
  USING (auth.uid() = user_id);

-- Admins can view all memories (for moderation)
CREATE POLICY "Admins can view all memories"
  ON public.user_memories FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE profiles.user_id = auth.uid() AND profiles.role = 'admin'
    )
  );

-- Admins can delete any memory (for moderation)
CREATE POLICY "Admins can delete any memory"
  ON public.user_memories FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE profiles.user_id = auth.uid() AND profiles.role = 'admin'
    )
  );

-- ============================================================
-- DONE! After running this, redeploy your Vercel app.
-- The memory feature will activate automatically.
-- ============================================================
