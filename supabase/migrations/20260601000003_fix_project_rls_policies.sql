-- Correct project RLS policies created by the initial projects migration.
-- Supabase service-role clients bypass RLS and do not need permissive policies.

DROP POLICY IF EXISTS "Service role full access projects" ON public.projects;
DROP POLICY IF EXISTS "Service role full access project memories" ON public.project_memories;

DO $$ BEGIN
  IF to_regclass('public.conversation_memories') IS NOT NULL THEN
    DROP POLICY IF EXISTS "Service role full access conv memories" ON public.conversation_memories;
  END IF;
  IF to_regclass('public.memory_chunks') IS NOT NULL THEN
    DROP POLICY IF EXISTS "Service role full access chunks" ON public.memory_chunks;
  END IF;
  IF to_regclass('public.context_snapshots') IS NOT NULL THEN
    DROP POLICY IF EXISTS "Service role full access snapshots" ON public.context_snapshots;
  END IF;
  IF to_regclass('public.attachments') IS NOT NULL THEN
    DROP POLICY IF EXISTS "Service role full access attachments" ON public.attachments;
  END IF;
  IF to_regclass('public.attachment_pages') IS NOT NULL THEN
    DROP POLICY IF EXISTS "Service role full access attachment pages" ON public.attachment_pages;
  END IF;
END $$;

DROP POLICY IF EXISTS "Users can manage own project memories" ON public.project_memories;

CREATE POLICY "Users can manage own project memories"
  ON public.project_memories
  FOR ALL
  USING (
    auth.uid() = user_id
    AND EXISTS (
      SELECT 1 FROM public.projects
      WHERE projects.id = project_memories.project_id
        AND projects.user_id = auth.uid()
    )
  )
  WITH CHECK (
    auth.uid() = user_id
    AND EXISTS (
      SELECT 1 FROM public.projects
      WHERE projects.id = project_memories.project_id
        AND projects.user_id = auth.uid()
    )
  );
