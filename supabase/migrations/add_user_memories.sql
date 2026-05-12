-- Migration: Add user_memories table for long-term memory
-- Run this in Supabase SQL Editor or via supabase db push

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

-- Indexes
CREATE INDEX IF NOT EXISTS idx_user_memories_user_id ON public.user_memories(user_id);
CREATE INDEX IF NOT EXISTS idx_user_memories_category ON public.user_memories(category);
CREATE INDEX IF NOT EXISTS idx_user_memories_importance ON public.user_memories(importance DESC);
CREATE INDEX IF NOT EXISTS idx_user_memories_created_at ON public.user_memories(created_at DESC);

-- Enable RLS
ALTER TABLE public.user_memories ENABLE ROW LEVEL SECURITY;

-- RLS Policies: Users can manage their own memories
CREATE POLICY "Users can view own memories"
  ON public.user_memories FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own memories"
  ON public.user_memories FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own memories"
  ON public.user_memories FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own memories"
  ON public.user_memories FOR DELETE
  USING (auth.uid() = user_id);

-- Admin policies: admins can view/manage all memories
CREATE POLICY "Admins can view all memories"
  ON public.user_memories FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE profiles.user_id = auth.uid() AND profiles.role = 'admin'
    )
  );

CREATE POLICY "Admins can delete any memory"
  ON public.user_memories FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE profiles.user_id = auth.uid() AND profiles.role = 'admin'
    )
  );
