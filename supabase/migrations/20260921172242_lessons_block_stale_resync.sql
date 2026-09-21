-- lessons_block_stale_resync: containment for the retired automatic date writer.
--
-- WHAT IT BLOCKS
-- A direct browser write (PostgREST, role `authenticated`) that explicitly
-- names scheduled_source, sets it to 'queue_resync', and changes nothing but
-- the two date columns of an incomplete, unpinned, unskipped, non-backfill
-- row. That is the exact payload of syncProjectedScheduledDates in bundles
-- built before fix/scheduler-containment:
--   { scheduled_date, date, scheduled_source: 'queue_resync' }
-- New bundles never send it from a parent action (they write catchup_spread,
-- catchup_pushback, plan_cascade_shift, recalibrate_respread, undo_restore),
-- and send it from the automatic path only when
-- NEXT_PUBLIC_SCHEDULER_SYNC_ENABLED is not "false".
--
-- WHAT IT ALSO BLOCKS, BY CONSTRUCTION (old tabs only)
-- An old bundle's Plan catch-up re-spread, push-back, cascade-shift tail and
-- Recalibrate step 4 send the identical payload, and so do their undos for
-- rows that were unpinned before the action. Identical requests cannot be
-- told apart here. See the containment report for what those families see.
--
-- HOW IT TELLS WRITES APART
--   * BEFORE UPDATE OF scheduled_source: fires only when the statement's SET
--     list names the column. PostgREST builds the SET list from exactly the
--     payload keys (proven on staging from pg_stat_statements, 2026-09-21), so
--     a date-only write such as Today's "push back missed lessons" never fires
--     it, even on a row that already stores 'queue_resync'.
--   * current_user = 'authenticated': the trigger function is SECURITY
--     INVOKER, so it sees the role that ran the statement. PostgREST switches
--     to `authenticated` for a signed-in request; inside a SECURITY DEFINER
--     RPC (move_lesson_to_date, update_report_lesson_record, ...) it is the
--     function owner; the service_role key is `service_role`. Only the first
--     is blocked. No request field is trusted for this decision.
--   * Value checks on OLD/NEW. These establish what CHANGES, not which
--     columns were sent: a client that re-sends an unchanged column is
--     indistinguishable from one that omitted it.
--
-- WHAT A BLOCK DOES
-- Records an attempt in public.lessons_resync_blocked, then RETURN NULL: the
-- row is not written, updated_at is not touched (this trigger sorts before
-- lessons_set_updated_at), and no row-level AFTER trigger runs for it. Other
-- rows in the same statement proceed. The client is told nothing: PostgREST
-- answers 204 (or 200 with the skipped row missing from the representation),
-- the same as a statement that matched no rows. Statement-level effects are
-- NOT suppressed (none exist on lessons today).
--
-- If the audit insert fails, the exception propagates and the WHOLE statement
-- fails, allowed rows included. That is deliberate: a block that cannot be
-- recorded is not silently swallowed.
--
-- THE AUDIT IS OF ATTEMPTS, NOT CHANGES. It holds refused writes from the
-- moment this is applied. It is no evidence about any earlier batch.
--
-- ROLLBACK (re-permits the unwanted writes immediately):
--   ALTER TABLE public.lessons DISABLE TRIGGER lessons_block_stale_resync;
-- Full removal, keeping the evidence table: see the matching file in
-- supabase/rollbacks/.

create schema if not exists rooted_private;
revoke all on schema rooted_private from public;
-- The trigger runs as the calling role, so that role must be able to reach
-- the audit helper. rooted_private is not in PostgREST's exposed schemas, so
-- this grants no HTTP route.
grant usage on schema rooted_private to authenticated;

create table if not exists public.lessons_resync_blocked (
  id                          bigint generated always as identity primary key,
  blocked_at                  timestamptz not null default now(),
  lesson_id                   uuid not null,
  user_id                     uuid,   -- owner of the existing lesson row
  jwt_sub                     uuid,   -- auth.uid() of the refused request
  curriculum_goal_id          uuid,
  old_scheduled_date          date,
  attempted_scheduled_date    date,
  old_date                    date,
  attempted_date              date,
  old_scheduled_source        text,
  attempted_scheduled_source  text
);
create index if not exists lessons_resync_blocked_blocked_at_idx
  on public.lessons_resync_blocked (blocked_at);

alter table public.lessons_resync_blocked enable row level security;
-- No policies: clients can neither read nor write it. Supabase's default
-- privileges grant new public tables to anon and authenticated; take that back.
revoke all on public.lessons_resync_blocked from public, anon, authenticated;
grant select on public.lessons_resync_blocked to service_role;

-- The only writer of the audit table. SECURITY DEFINER so the calling role
-- needs no privilege on the table; everything else about it is a refusal:
--   * only from inside a trigger (a direct or RPC call is depth 0),
--   * only for a lesson the caller owns, read from the table itself, so a
--     caller cannot record a block against someone else's lesson,
--   * old values come from the stored row, not from the caller.
create or replace function rooted_private.record_blocked_resync(
  p_lesson_id uuid,
  p_attempted_scheduled_date date,
  p_attempted_date date,
  p_attempted_source text
) returns void
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $fn$
declare
  v_old record;
  v_sub uuid := auth.uid();
begin
  if pg_catalog.pg_trigger_depth() < 1 then
    raise exception 'record_blocked_resync may only run inside the lessons trigger'
      using errcode = '42501';
  end if;
  select l.user_id, l.curriculum_goal_id, l.scheduled_date, l.date, l.scheduled_source
    into v_old
    from public.lessons l
   where l.id = p_lesson_id;
  if not found or v_old.user_id is distinct from v_sub then
    raise exception 'record_blocked_resync: lesson % is not the caller''s', p_lesson_id
      using errcode = '42501';
  end if;
  insert into public.lessons_resync_blocked (
    lesson_id, user_id, jwt_sub, curriculum_goal_id,
    old_scheduled_date, attempted_scheduled_date,
    old_date, attempted_date,
    old_scheduled_source, attempted_scheduled_source
  ) values (
    p_lesson_id, v_old.user_id, v_sub, v_old.curriculum_goal_id,
    v_old.scheduled_date, p_attempted_scheduled_date,
    v_old.date, p_attempted_date,
    v_old.scheduled_source, p_attempted_source
  );
end;
$fn$;
revoke all on function rooted_private.record_blocked_resync(uuid, date, date, text) from public, anon;
grant execute on function rooted_private.record_blocked_resync(uuid, date, date, text) to authenticated;

create or replace function public.lessons_block_stale_resync()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog, pg_temp
as $fn$
begin
  -- Only a direct client write. SECURITY DEFINER RPCs run as their owner and
  -- the service_role key runs as service_role; both pass.
  if current_user <> 'authenticated' then return new; end if;
  if new.scheduled_source is distinct from 'queue_resync' then return new; end if;
  -- A date must actually change.
  if new.scheduled_date is not distinct from old.scheduled_date
     and new.date is not distinct from old.date then
    return new;
  end if;
  -- Protected states, before or after.
  if old.completed is true or new.completed is true then return new; end if;
  if old.queue_pinned is true or new.queue_pinned is true then return new; end if;
  if old.skipped is true or new.skipped is true then return new; end if;
  if old.is_backfill is true then return new; end if;
  -- Nothing else may change. Earlier BEFORE triggers that rewrite NEW (only
  -- lessons_backfill_child_id_from_goal, which fires on child_id or
  -- curriculum_goal_id) would show up here and let the write through.
  if (to_jsonb(new) - array['scheduled_date', 'date', 'scheduled_source', 'updated_at'])
     is distinct from
     (to_jsonb(old) - array['scheduled_date', 'date', 'scheduled_source', 'updated_at']) then
    return new;
  end if;

  perform rooted_private.record_blocked_resync(
    new.id, new.scheduled_date, new.date, new.scheduled_source
  );
  return null;
end;
$fn$;
-- A trigger function cannot be called as an RPC; revoke anyway so it never
-- appears callable. Firing a trigger does not check EXECUTE.
revoke all on function public.lessons_block_stale_resync() from public, anon, authenticated;

-- Name order among BEFORE UPDATE triggers on lessons:
--   lessons_backfill_child_id_from_goal (UPDATE OF child_id, curriculum_goal_id)
--   lessons_block_stale_resync           <- this one
--   lessons_child_id_matches_goal
--   lessons_set_updated_at
--   trg_lessons_block_goal_detach, trg_lessons_block_server_side_completion
drop trigger if exists lessons_block_stale_resync on public.lessons;
create trigger lessons_block_stale_resync
  before update of scheduled_source on public.lessons
  for each row execute function public.lessons_block_stale_resync();
