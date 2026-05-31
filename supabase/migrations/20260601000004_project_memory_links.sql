-- Link existing memory/index tables to projects when the tables exist.

DO $$ BEGIN
  IF to_regclass('public.conversation_memories') IS NOT NULL THEN
    ALTER TABLE public.conversation_memories
      ADD COLUMN IF NOT EXISTS project_id uuid REFERENCES public.projects(id) ON DELETE SET NULL;

    UPDATE public.conversation_memories cm
      SET project_id = c.project_id
      FROM public.conversations c
      WHERE cm.conversation_id = c.id
        AND cm.project_id IS NULL
        AND c.project_id IS NOT NULL;

    CREATE INDEX IF NOT EXISTS idx_conversation_memories_project_id
      ON public.conversation_memories(project_id);
  END IF;

  IF to_regclass('public.memory_chunks') IS NOT NULL THEN
    ALTER TABLE public.memory_chunks
      ADD COLUMN IF NOT EXISTS project_id uuid REFERENCES public.projects(id) ON DELETE SET NULL;

    UPDATE public.memory_chunks mc
      SET project_id = c.project_id
      FROM public.conversations c
      WHERE mc.conversation_id = c.id
        AND mc.project_id IS NULL
        AND c.project_id IS NOT NULL;

    CREATE INDEX IF NOT EXISTS idx_memory_chunks_project_id
      ON public.memory_chunks(project_id);
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.project_artifacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  conversation_id uuid REFERENCES public.conversations(id) ON DELETE SET NULL,
  message_id uuid DEFAULT NULL,
  title text NOT NULL,
  language text NOT NULL,
  code text NOT NULL,
  explanation text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_project_artifacts_project_id ON public.project_artifacts(project_id);
CREATE INDEX IF NOT EXISTS idx_project_artifacts_user_id ON public.project_artifacts(user_id);
CREATE INDEX IF NOT EXISTS idx_project_artifacts_conversation_id ON public.project_artifacts(conversation_id);

CREATE UNIQUE INDEX IF NOT EXISTS idx_project_artifacts_project_message_unique
  ON public.project_artifacts(project_id, message_id)
  WHERE message_id IS NOT NULL;

ALTER TABLE public.project_artifacts ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'project_artifacts' AND policyname = 'Users can manage own project artifacts'
  ) THEN
    CREATE POLICY "Users can manage own project artifacts" ON public.project_artifacts FOR ALL
      USING (
        auth.uid() = user_id
        AND EXISTS (
          SELECT 1 FROM public.projects
          WHERE projects.id = project_artifacts.project_id
            AND projects.user_id = auth.uid()
        )
      )
      WITH CHECK (
        auth.uid() = user_id
        AND EXISTS (
          SELECT 1 FROM public.projects
          WHERE projects.id = project_artifacts.project_id
            AND projects.user_id = auth.uid()
        )
      );
  END IF;
END $$;
