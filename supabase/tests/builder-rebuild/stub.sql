-- Minimal stand-in for the rehearsal: roles, auth.uid(), the columns and the
-- triggers apply_builder_rebuild interacts with. Not the production schema.
do $$ begin
  if not exists (select 1 from pg_roles where rolname='anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname='service_role') then create role service_role nologin bypassrls; end if;
end $$;
create extension if not exists pgcrypto;
create schema auth; grant usage on schema auth to anon, authenticated, service_role;
create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;
create function auth.uid() returns uuid language sql stable as $$ select nullif(auth.jwt()->>'sub','')::uuid $$;
grant execute on all functions in schema auth to anon, authenticated, service_role;
create table public.curriculum_goals (id uuid primary key, user_id uuid not null, total_lessons int not null, current_lesson int not null default 0,
  start_at_lesson int not null default 1, lessons_per_day int not null default 1, lessons_per_day_overrides jsonb, school_days text[], start_date date,
  archived boolean not null default false);
create table public.lessons (id uuid primary key default gen_random_uuid(), user_id uuid not null, child_id uuid, curriculum_goal_id uuid,
  lesson_number int, queue_position int, title text not null default '', scheduled_date date, date date not null default current_date,
  scheduled_source text, completed boolean not null default false, completed_at timestamptz, queue_pinned boolean not null default false,
  skipped boolean not null default false, is_backfill boolean default false, notes text, minutes_spent int, hours numeric not null default 0,
  updated_at timestamptz not null default now());
create unique index lessons_goal_lesson_number_unique on public.lessons (curriculum_goal_id, lesson_number) where curriculum_goal_id is not null and lesson_number is not null;
create unique index lessons_goal_queue_position_uniq on public.lessons (curriculum_goal_id, queue_position) where queue_position is not null;
alter table public.lessons enable row level security; alter table public.curriculum_goals enable row level security;
create policy l on public.lessons for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy g on public.curriculum_goals for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
grant select, insert, update, delete on public.lessons, public.curriculum_goals to authenticated, service_role;
-- The production guard that only a person completes a lesson (depth > 1 only).
create function public.lessons_block_server_side_completion() returns trigger language plpgsql as $$
begin
  if new.completed = true and (tg_op = 'INSERT' or old.completed = false) and pg_trigger_depth() > 1 then
    raise exception 'lessons.completed may only be set by an explicit user action';
  end if;
  return new;
end $$;
create trigger trg_lessons_block_server_side_completion before insert or update of completed on public.lessons
  for each row execute function public.lessons_block_server_side_completion();
