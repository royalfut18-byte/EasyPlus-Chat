alter table public.easy_code_projects
  add column if not exists client_request_id text;

create unique index if not exists easy_code_projects_user_client_request_id_idx
  on public.easy_code_projects(user_id, client_request_id)
  where client_request_id is not null;
