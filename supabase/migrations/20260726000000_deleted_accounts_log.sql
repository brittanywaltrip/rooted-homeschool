-- Forensic log of account deletions. Written by the service-role key only
-- (app/api/account/delete/route.ts) BEFORE user data is wiped, so every
-- deletion leaves a permanent trace even after the auth user is gone.
-- Applied to production 2026-07-26 via MCP.
create table if not exists public.deleted_accounts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  email text,
  first_name text,
  last_name text,
  plan_type text,
  account_created_at timestamptz,
  memories_count integer,
  lessons_count integer,
  curriculum_goals_count integer,
  children_count integer,
  source text not null default 'self_serve',
  deleted_at timestamptz not null default now()
);

-- Lock the table down: RLS on with no policies means anon/authenticated
-- clients can neither read nor write. The service-role key bypasses RLS.
alter table public.deleted_accounts enable row level security;

comment on table public.deleted_accounts is 'Permanent log of account deletions, written by the delete API route before data is wiped. Service role only.';
