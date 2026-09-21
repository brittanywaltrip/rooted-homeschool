-- Minimal Supabase stand-in: roles, auth.uid()/auth.jwt() from request.jwt.claims, the two tables.
do $$ begin
  if not exists (select 1 from pg_roles where rolname='anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname='service_role') then create role service_role nologin bypassrls; end if;
end $$;
create schema auth;
grant usage on schema auth to anon, authenticated, service_role;
create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;
create function auth.uid() returns uuid language sql stable as $$ select nullif(auth.jwt()->>'sub','')::uuid $$;
grant execute on all functions in schema auth to anon, authenticated, service_role;
create table public.curriculum_goals (id uuid primary key, user_id uuid not null, current_lesson int default 0, start_at_lesson int default 1);
create table public.lessons (
  id uuid primary key, user_id uuid not null, curriculum_goal_id uuid references public.curriculum_goals(id),
  lesson_number int, queue_position int, scheduled_date date, date date not null default current_date,
  scheduled_source text, completed boolean not null default false, completed_at timestamptz,
  queue_pinned boolean not null default false, skipped boolean not null default false,
  is_backfill boolean not null default false, notes text, updated_at timestamptz default now());
alter table public.lessons enable row level security;
alter table public.curriculum_goals enable row level security;
create policy own_l on public.lessons for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy own_g on public.curriculum_goals for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
grant select, insert, update, delete on public.lessons, public.curriculum_goals to authenticated, service_role;
insert into public.curriculum_goals values ('aaaaaaaa-0000-4000-8000-000000000001','bbbbbbbb-0000-4000-8000-000000000001',3,1);
insert into public.lessons (id,user_id,curriculum_goal_id,lesson_number,queue_position,scheduled_date,date,scheduled_source)
select ('cccccccc-0000-4000-8000-00000000000'||n)::uuid,'bbbbbbbb-0000-4000-8000-000000000001','aaaaaaaa-0000-4000-8000-000000000001',n,n,('2026-09-2'||n)::date,('2026-09-2'||n)::date,'queue_resync' from generate_series(4,8) n;
