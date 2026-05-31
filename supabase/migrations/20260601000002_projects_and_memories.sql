-- Add Projects and Project Memories tables and link project_id to conversations and attachments

CREATE TABLE IF NOT EXISTS public.projects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name text NOT NULL,
  description text,
  instructions text,
  icon text,
  color text,
  archived_at timestamptz DEFAULT NULL,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_projects_user_id ON public.projects(user_id);
CREATE INDEX IF NOT EXISTS idx_projects_updated_at ON public.projects(updated_at DESC);

ALTER TABLE public.projects ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'projects' AND policyname = 'Users can manage own projects') THEN
    CREATE POLICY "Users can manage own projects" ON public.projects FOR ALL
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);
  END IF;
END $$;

-- Project memories
CREATE TABLE IF NOT EXISTS public.project_memories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  memory_type text,
  title text,
  content text NOT NULL,
  importance integer DEFAULT 1,
  source_type text,
  source_id uuid,
  last_used_at timestamptz DEFAULT NULL,
  archived_at timestamptz DEFAULT NULL,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_project_memories_project_id ON public.project_memories(project_id);
CREATE INDEX IF NOT EXISTS idx_project_memories_user_id ON public.project_memories(user_id);

ALTER TABLE public.project_memories ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'project_memories' AND policyname = 'Users can manage own project memories') THEN
    CREATE POLICY "Users can manage own project memories" ON public.project_memories FOR ALL
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
  END IF;
END $$;

-- Link project_id to conversations and attachments (safe add)
ALTER TABLE public.conversations ADD COLUMN IF NOT EXISTS project_id uuid REFERENCES public.projects(id) ON DELETE SET NULL;
ALTER TABLE public.attachments ADD COLUMN IF NOT EXISTS project_id uuid REFERENCES public.projects(id) ON DELETE SET NULL;
ALTER TABLE public.attachment_pages ADD COLUMN IF NOT EXISTS project_id uuid REFERENCES public.projects(id) ON DELETE SET NULL;

-- Index new columns
CREATE INDEX IF NOT EXISTS idx_conversations_project_id ON public.conversations(project_id);
CREATE INDEX IF NOT EXISTS idx_attachments_project_id ON public.attachments(project_id);
CREATE INDEX IF NOT EXISTS idx_attachment_pages_project_id ON public.attachment_pages(project_id);
