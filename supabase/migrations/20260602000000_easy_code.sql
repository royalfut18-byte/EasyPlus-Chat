-- Easy Code: isolated AI coding workspace tables.
-- Non-destructive: does not alter existing chat, project, billing, admin, or file tables.

CREATE TABLE IF NOT EXISTS public.easy_code_projects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title text NOT NULL,
  description text,
  framework text,
  status text NOT NULL DEFAULT 'active',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.easy_code_files (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.easy_code_projects(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  path text NOT NULL,
  language text,
  content text NOT NULL DEFAULT '',
  size_bytes integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(project_id, path)
);

CREATE TABLE IF NOT EXISTS public.easy_code_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.easy_code_projects(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
  content text NOT NULL,
  metadata jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS easy_code_projects_user_updated_idx
  ON public.easy_code_projects(user_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS easy_code_files_project_path_idx
  ON public.easy_code_files(project_id, path);

CREATE INDEX IF NOT EXISTS easy_code_messages_project_created_idx
  ON public.easy_code_messages(project_id, created_at);

ALTER TABLE public.easy_code_projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.easy_code_files ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.easy_code_messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own easy code projects"
  ON public.easy_code_projects FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own easy code projects"
  ON public.easy_code_projects FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own easy code projects"
  ON public.easy_code_projects FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own easy code projects"
  ON public.easy_code_projects FOR DELETE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can view own easy code files"
  ON public.easy_code_files FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own easy code files"
  ON public.easy_code_files FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own easy code files"
  ON public.easy_code_files FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own easy code files"
  ON public.easy_code_files FOR DELETE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can view own easy code messages"
  ON public.easy_code_messages FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own easy code messages"
  ON public.easy_code_messages FOR INSERT
  WITH CHECK (auth.uid() = user_id);
