-- ALREADY APPLIED. DO NOT RE-RUN.
--   production gvkbegvvmhcrmxdorctk: 20260921210801 lessons_resync_parent_intent_window (2026-09-21)
--   staging    cvgqovweybggrqakhdtd: 20260921174221 lessons_resync_parent_intent_window (2026-09-21)
-- The filename carries the PRODUCTION version. The staging ledger recorded
-- 20260921174221; see docs/MIGRATION-LEDGER-CONTAINMENT.md.
--
-- lessons_resync_parent_intent_window: let an OLD tab's parent action finish.
--
-- Amends lessons_block_stale_resync (20260921210738). Staging first.
--
-- WHY
-- A tab running a bundle built before fix/scheduler-containment sends the
-- legacy payload {scheduled_date, date, scheduled_source:'queue_resync'} for
-- two different reasons:
--   * automatically, on every Today load (the write containment exists for);
--   * because the parent asked: Plan catch-up re-spread, push back, cascade
--     shift, their undos, and Recalibrate Phase 5.
-- The requests are identical, so the first version blocked both. For the
-- parent that meant: pins already released, dates not moved, and the old
-- toast still saying "Re-spread 12 lessons". Silent success with a partial
-- change is not an acceptable price.
--
-- WHAT TELLS THEM APART
-- The old code never sends a parent's queue_resync burst on its own. Every
-- parent path first makes a write the automatic path never makes, on the
-- same goal, from the same session, seconds earlier:
--   * re-spread / push back / cascade: a bare {queue_pinned:false} over the
--     goal's incomplete rows (PlanV2 reprojectGoalTail, catch-up handler);
--   * Recalibrate (Plan and Schedule Builder): Phase 3 writes
--     curriculum_goals.start_at_lesson.
-- Those two writes are recorded here as a short-lived, per-user, per-goal
-- "intent". A legacy queue_resync write on a goal the SAME user signalled in
-- the last 10 minutes is let through; without it, it is still blocked.
--
-- The window is 10 minutes: the undo toast is 5 seconds (UNDO_WINDOW_MS, the
-- same in 49d76134), a multi-goal re-spread writes goal by goal, and a
-- backgrounded tab throttles its timers. An automatic Today resync of a goal
-- the family re-spread minutes ago is also let through; it recomputes the
-- same projection the parent just asked for.
--
-- This is containment, not authorization. The signal comes from the owner's
-- own writes to rows they own; it is never read from a request header or any
-- field the browser labels.

create table if not exists rooted_private.schedule_intent (
  user_id             uuid        not null,
  curriculum_goal_id  uuid        not null,
  kind                text        not null,
  recorded_at         timestamptz not null default now(),
  primary key (user_id, curriculum_goal_id)
);
alter table rooted_private.schedule_intent enable row level security;
revoke all on rooted_private.schedule_intent from public, anon, authenticated;

-- Record an intent. Only inside a trigger, only for a goal the caller owns.
create or replace function rooted_private.note_schedule_intent(p_goal uuid, p_kind text)
returns void
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $fn$
declare
  v_sub uuid := auth.uid();
begin
  if pg_catalog.pg_trigger_depth() < 1 then
    raise exception 'note_schedule_intent may only run inside a trigger' using errcode = '42501';
  end if;
  if v_sub is null or p_goal is null then return; end if;
  if not exists (select 1 from public.curriculum_goals g where g.id = p_goal and g.user_id = v_sub) then
    return;
  end if;
  insert into rooted_private.schedule_intent (user_id, curriculum_goal_id, kind, recorded_at)
  values (v_sub, p_goal, p_kind, now())
  on conflict (user_id, curriculum_goal_id)
  do update set kind = excluded.kind, recorded_at = excluded.recorded_at;
end;
$fn$;
revoke all on function rooted_private.note_schedule_intent(uuid, text) from public, anon;
grant execute on function rooted_private.note_schedule_intent(uuid, text) to authenticated;

-- Did THIS caller signal intent on this goal recently? Inside a trigger only.
create or replace function rooted_private.has_recent_schedule_intent(p_goal uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = pg_catalog, pg_temp
as $fn$
begin
  if pg_catalog.pg_trigger_depth() < 1 then
    raise exception 'has_recent_schedule_intent may only run inside a trigger' using errcode = '42501';
  end if;
  return exists (
    select 1 from rooted_private.schedule_intent i
     where i.user_id = auth.uid()
       and i.curriculum_goal_id = p_goal
       and i.recorded_at > now() - interval '10 minutes'
  );
end;
$fn$;
revoke all on function rooted_private.has_recent_schedule_intent(uuid) from public, anon;
grant execute on function rooted_private.has_recent_schedule_intent(uuid) to authenticated;

-- Signal 1: a bare unpin by the owner (the old re-spread's first write).
create or replace function public.lessons_note_schedule_intent()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog, pg_temp
as $fn$
begin
  if current_user <> 'authenticated' then return null; end if;
  if new.queue_pinned is not false or new.curriculum_goal_id is null then return null; end if;
  -- Nothing but the pin (and updated_at) changed.
  if (to_jsonb(new) - array['queue_pinned', 'updated_at'])
     is distinct from (to_jsonb(old) - array['queue_pinned', 'updated_at']) then
    return null;
  end if;
  perform rooted_private.note_schedule_intent(new.curriculum_goal_id, 'unpin');
  return null;
end;
$fn$;
revoke all on function public.lessons_note_schedule_intent() from public, anon, authenticated;
drop trigger if exists lessons_note_schedule_intent on public.lessons;
create trigger lessons_note_schedule_intent
  after update of queue_pinned on public.lessons
  for each row execute function public.lessons_note_schedule_intent();

-- Signal 2: Recalibrate Phase 3 writes start_at_lesson on the goal.
create or replace function public.curriculum_goals_note_schedule_intent()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog, pg_temp
as $fn$
begin
  if current_user <> 'authenticated' then return null; end if;
  perform rooted_private.note_schedule_intent(new.id, 'start_at_lesson');
  return null;
end;
$fn$;
revoke all on function public.curriculum_goals_note_schedule_intent() from public, anon, authenticated;
drop trigger if exists curriculum_goals_note_schedule_intent on public.curriculum_goals;
create trigger curriculum_goals_note_schedule_intent
  after update of start_at_lesson on public.curriculum_goals
  for each row execute function public.curriculum_goals_note_schedule_intent();

-- The block, unchanged except for the intent check just before it refuses.
create or replace function public.lessons_block_stale_resync()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog, pg_temp
as $fn$
begin
  if current_user <> 'authenticated' then return new; end if;
  if new.scheduled_source is distinct from 'queue_resync' then return new; end if;
  if new.scheduled_date is not distinct from old.scheduled_date
     and new.date is not distinct from old.date then
    return new;
  end if;
  if old.completed is true or new.completed is true then return new; end if;
  if old.queue_pinned is true or new.queue_pinned is true then return new; end if;
  if old.skipped is true or new.skipped is true then return new; end if;
  if old.is_backfill is true then return new; end if;
  if (to_jsonb(new) - array['scheduled_date', 'date', 'scheduled_source', 'updated_at'])
     is distinct from
     (to_jsonb(old) - array['scheduled_date', 'date', 'scheduled_source', 'updated_at']) then
    return new;
  end if;
  -- An old tab's parent action: the same user just unpinned this goal or
  -- recalibrated it. Let the parent's request finish.
  if rooted_private.has_recent_schedule_intent(old.curriculum_goal_id) then
    -- Telemetry for lessons_audit_date_change, which cannot see the SET list:
    -- the ids this trigger let through by intent, for this transaction only.
    -- It decides nothing.
    perform set_config('rooted.resync_intent_ids',
      coalesce(nullif(current_setting('rooted.resync_intent_ids', true), ''), '') || new.id::text || ',',
      true);
    return new;
  end if;

  perform rooted_private.record_blocked_resync(
    new.id, new.scheduled_date, new.date, new.scheduled_source
  );
  return null;
end;
$fn$;
revoke all on function public.lessons_block_stale_resync() from public, anon, authenticated;
