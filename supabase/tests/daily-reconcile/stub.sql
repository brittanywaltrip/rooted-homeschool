-- Minimal stand-in: roles, auth.uid()/auth.jwt(), and the columns the function reads.
do $$ begin
  if not exists (select 1 from pg_roles where rolname='anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname='service_role') then create role service_role nologin bypassrls; end if;
end $$;
create schema auth; grant usage on schema auth to anon, authenticated, service_role;
create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;
create function auth.uid() returns uuid language sql stable as $$ select nullif(auth.jwt()->>'sub','')::uuid $$;
grant execute on all functions in schema auth to anon, authenticated, service_role;
create schema rooted_private; revoke all on schema rooted_private from public; grant usage on schema rooted_private to authenticated, service_role;
create table public.curriculum_goals (id uuid primary key, user_id uuid not null, total_lessons int not null, current_lesson int not null default 0,
  lessons_per_day int not null default 1, lessons_per_day_overrides jsonb, school_days text[], start_date date, archived boolean not null default false);
create table public.vacation_blocks (id uuid primary key default gen_random_uuid(), user_id uuid not null, start_date date not null, end_date date not null);
create table public.lessons (id uuid primary key, user_id uuid not null, curriculum_goal_id uuid, lesson_number int, queue_position int,
  scheduled_date date, date date not null default current_date, scheduled_source text, completed boolean not null default false, completed_at timestamptz,
  queue_pinned boolean not null default false, skipped boolean not null default false, is_backfill boolean, updated_at timestamptz default now());
alter table public.lessons enable row level security; alter table public.curriculum_goals enable row level security; alter table public.vacation_blocks enable row level security;
create policy l on public.lessons for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy g on public.curriculum_goals for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy v on public.vacation_blocks for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
grant select, insert, update, delete on public.lessons, public.curriculum_goals, public.vacation_blocks to authenticated, service_role;
