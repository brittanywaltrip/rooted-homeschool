-- daily_reconcile: once a day, re-date a curriculum's unfinished lessons to
-- what Today projects, safely. STAGING FIRST; production only with approval.
--
-- LEDGER: applied to rooted-staging (cvgqovweybggrqakhdtd) on 2026-09-21 as
-- version 20260921230610 (this filename). NOT applied to production. The
-- applied body is this file with its comments removed. A production apply will
-- record its own version; add it to docs/MIGRATION-LEDGER-CONTAINMENT.md then.
--
-- WHY
-- Plan reads each lesson's stored scheduled_date; Today projects from the
-- queue pointer. The automatic page-load reconciler (queue_resync) is off,
-- and parent actions re-date only when a parent acts. When a school day simply
-- passes, a family that was behind or ahead drifts: on 2026-09-21 a curriculum
-- one day behind had all 18 unfinished lessons a day early in Plan.
--
-- WHAT THIS ADDS (nothing existing is created, altered, dropped or disabled)
--   rooted_private.app_switches        server-side switches, read at run time
--   rooted_private.daily_reconcile_log one row per curriculum per local day
--   public.apply_daily_reconcile(...)  the ONLY writer for this job
--
-- HOW ONE CALL IS DECIDED (all inside one transaction)
--   1. The 'daily_reconcile' switch must be on, read NOW. Turning it off stops
--      every tab at its next call, including tabs already open on any build.
--   2. The curriculum must belong to the caller (auth.uid()); its row is locked.
--   3. If the log already has (curriculum, local day), nothing happens
--      ('already'): once per curriculum per local day, across tabs and devices.
--   4. The caller's calculation must still be current. It sends exactly what it
--      projected from, and every value is compared under row locks:
--        the curriculum's pointer, pace, school days, per-day overrides, start;
--        the family's breaks; every pinned slot and its date; every skipped
--        slot; how many lessons were completed in the caller's local day;
--        and, for each row it wants to move, the date it saw.
--      Anything different means a parent acted in between: 'stale', nothing
--      written, the day NOT marked. The tab recomputes and may try again.
--   5. Every row it moves must still be unfinished, unpinned, unskipped and not
--      backfill, and may only move to the caller's local day or later.
--   6. Writes the dates (scheduled_source = 'daily_reconcile'), then logs the day.
--      A failure anywhere rolls back everything, including the log row, so a
--      failed day is simply retried.
--
-- AUDIT
-- The existing lessons_audit_date_change trigger records each moved row
-- (db_role postgres, jwt_sub = the family, new_scheduled_source
-- 'daily_reconcile'); the log row records the count. lessons_block_stale_resync
-- does not apply: this is not the legacy queue_resync payload, and it runs as
-- the function owner.
--
-- SWITCH
--   on:  update rooted_private.app_switches set enabled = true,  updated_at = now() where name = 'daily_reconcile';
--   off: update rooted_private.app_switches set enabled = false, updated_at = now() where name = 'daily_reconcile';
-- Created OFF.

create table if not exists rooted_private.app_switches (
  name        text        primary key,
  enabled     boolean     not null default false,
  updated_at  timestamptz not null default now(),
  note        text
);
alter table rooted_private.app_switches enable row level security;
revoke all on rooted_private.app_switches from public, anon, authenticated;
grant select on rooted_private.app_switches to service_role;
insert into rooted_private.app_switches (name, enabled, note)
values ('daily_reconcile', false, 'Once-a-day re-date of unfinished, unpinned, unskipped lessons (apply_daily_reconcile). Read at execution time.')
on conflict (name) do nothing;

create table if not exists rooted_private.daily_reconcile_log (
  curriculum_goal_id  uuid        not null,
  local_day           date        not null,
  user_id             uuid        not null,
  rows_written        integer     not null,
  applied_at          timestamptz not null default now(),
  primary key (curriculum_goal_id, local_day)
);
create index if not exists daily_reconcile_log_user_idx on rooted_private.daily_reconcile_log (user_id, local_day);
alter table rooted_private.daily_reconcile_log enable row level security;
revoke all on rooted_private.daily_reconcile_log from public, anon, authenticated;
grant select on rooted_private.daily_reconcile_log to service_role;

create or replace function public.apply_daily_reconcile(
  p_goal_id   uuid,
  p_local_day date,
  p_expected  jsonb,
  p_writes    jsonb
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $fn$
declare
  v_uid     uuid := auth.uid();
  v_goal    public.curriculum_goals%rowtype;
  v_have    jsonb;
  v_w       jsonb;
  v_n       integer := 0;
  v_ok      integer;
  v_start   timestamptz;
  v_end     timestamptz;
begin
  if v_uid is null then
    return jsonb_build_object('status', 'invalid', 'reason', 'no_user');
  end if;

  -- 1. The switch, read now.
  if not coalesce((select s.enabled from rooted_private.app_switches s where s.name = 'daily_reconcile'), false) then
    return jsonb_build_object('status', 'disabled');
  end if;

  -- The caller's local day can only be within a day of the server's UTC date.
  if p_local_day is null or abs(p_local_day - (now() at time zone 'UTC')::date) > 1 then
    return jsonb_build_object('status', 'invalid', 'reason', 'local_day');
  end if;
  if jsonb_typeof(p_writes) is distinct from 'array' or jsonb_typeof(p_expected) is distinct from 'object' then
    return jsonb_build_object('status', 'invalid', 'reason', 'shape');
  end if;

  -- 2. Ownership, and serialize every call for this curriculum.
  select * into v_goal from public.curriculum_goals g
   where g.id = p_goal_id and g.user_id = v_uid
   for update;
  if not found then
    return jsonb_build_object('status', 'invalid', 'reason', 'not_owner');
  end if;

  -- 3. Once per curriculum per local day.
  if exists (select 1 from rooted_private.daily_reconcile_log l
              where l.curriculum_goal_id = p_goal_id and l.local_day = p_local_day) then
    return jsonb_build_object('status', 'already');
  end if;

  -- Hold the curriculum's lessons still while comparing and writing. A parent
  -- write in flight commits first, and is then seen by the comparison below.
  perform 1 from public.lessons l where l.curriculum_goal_id = p_goal_id for update;

  -- 4. Is the calculation still current?
  if jsonb_build_object(
       'total_lessons', v_goal.total_lessons,
       'current_lesson', v_goal.current_lesson,
       'lessons_per_day', v_goal.lessons_per_day,
       'lessons_per_day_overrides', v_goal.lessons_per_day_overrides,
       'school_days', to_jsonb(v_goal.school_days),
       'start_date', v_goal.start_date::text
     ) is distinct from p_expected -> 'goal' then
    return jsonb_build_object('status', 'stale', 'reason', 'goal');
  end if;

  select coalesce(jsonb_agg(jsonb_build_array(v.start_date::text, v.end_date::text) order by v.start_date, v.end_date), '[]'::jsonb)
    into v_have
    from public.vacation_blocks v where v.user_id = v_uid;
  if v_have is distinct from coalesce(p_expected -> 'vacations', '[]'::jsonb) then
    return jsonb_build_object('status', 'stale', 'reason', 'breaks');
  end if;

  select coalesce(jsonb_agg(jsonb_build_array(l.queue_position, l.scheduled_date::text) order by l.queue_position), '[]'::jsonb)
    into v_have
    from public.lessons l
   where l.curriculum_goal_id = p_goal_id and not l.completed and l.queue_pinned and not l.skipped
     and l.queue_position is not null and l.scheduled_date is not null;
  if v_have is distinct from coalesce(p_expected -> 'pins', '[]'::jsonb) then
    return jsonb_build_object('status', 'stale', 'reason', 'pins');
  end if;

  select coalesce(jsonb_agg(l.queue_position order by l.queue_position), '[]'::jsonb)
    into v_have
    from public.lessons l
   where l.curriculum_goal_id = p_goal_id and not l.completed and l.skipped and l.queue_position is not null;
  if v_have is distinct from coalesce(p_expected -> 'skipped', '[]'::jsonb) then
    return jsonb_build_object('status', 'stale', 'reason', 'skips');
  end if;

  v_start := (p_expected ->> 'day_start')::timestamptz;
  v_end   := (p_expected ->> 'day_end')::timestamptz;
  if v_start is null or v_end is null or v_end <= v_start then
    return jsonb_build_object('status', 'invalid', 'reason', 'day_window');
  end if;
  select count(*) into v_ok from public.lessons l
   where l.curriculum_goal_id = p_goal_id and l.completed
     and l.completed_at >= v_start and l.completed_at < v_end;
  if v_ok is distinct from (p_expected ->> 'done_today')::integer then
    return jsonb_build_object('status', 'stale', 'reason', 'done_today');
  end if;

  -- 5. Every row to move is still movable and still where the caller saw it.
  select count(*) into v_ok
    from jsonb_array_elements(p_writes) w
    join public.lessons l on l.id = (w ->> 'id')::uuid
   where l.curriculum_goal_id = p_goal_id
     and not l.completed and not l.queue_pinned and not l.skipped and not coalesce(l.is_backfill, false)
     and l.scheduled_date is not distinct from (w ->> 'from')::date
     and (w ->> 'to')::date >= p_local_day;
  if v_ok <> jsonb_array_length(p_writes) then
    return jsonb_build_object('status', 'stale', 'reason', 'rows');
  end if;

  -- 6. Write, then log the day. One transaction: all of it or none of it.
  for v_w in select * from jsonb_array_elements(p_writes) loop
    update public.lessons
       set scheduled_date = (v_w ->> 'to')::date,
           date = (v_w ->> 'to')::date,
           scheduled_source = 'daily_reconcile'
     where id = (v_w ->> 'id')::uuid;
    v_n := v_n + 1;
  end loop;

  insert into rooted_private.daily_reconcile_log (curriculum_goal_id, local_day, user_id, rows_written)
  values (p_goal_id, p_local_day, v_uid, v_n);

  return jsonb_build_object('status', 'applied', 'written', v_n);
end;
$fn$;
revoke all on function public.apply_daily_reconcile(uuid, date, jsonb, jsonb) from public, anon;
grant execute on function public.apply_daily_reconcile(uuid, date, jsonb, jsonb) to authenticated;
