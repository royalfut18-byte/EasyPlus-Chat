-- Easy Code generation progress/status fields.
-- Non-destructive: only adds columns if they do not already exist.

ALTER TABLE public.easy_code_projects
  ADD COLUMN IF NOT EXISTS generation_status text NOT NULL DEFAULT 'idle',
  ADD COLUMN IF NOT EXISTS generation_phase text,
  ADD COLUMN IF NOT EXISTS generation_error text,
  ADD COLUMN IF NOT EXISTS generation_metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS last_generated_at timestamptz;

CREATE INDEX IF NOT EXISTS easy_code_projects_generation_status_idx
  ON public.easy_code_projects(user_id, generation_status, updated_at DESC);
