-- user_feature_flags — per-user overrides for feature flags.
-- Env var NEXT_PUBLIC_<FLAG_NAME> sets the default for everyone; rows in this
-- table flip the flag for specific accounts. Admin inserts/updates go through
-- the service role. End users can only read their own rows.

create table if not exists public.user_feature_flags (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  flag_name text not null,
  enabled boolean not null default false,
  created_at timestamptz not null default now(),
  unique (user_id, flag_name)
);

alter table public.user_feature_flags enable row level security;

drop policy if exists "user_feature_flags_select_own" on public.user_feature_flags;
create policy "user_feature_flags_select_own" on public.user_feature_flags
  for select using (auth.uid() = user_id);

create index if not exists idx_user_feature_flags_user on public.user_feature_flags (user_id);
