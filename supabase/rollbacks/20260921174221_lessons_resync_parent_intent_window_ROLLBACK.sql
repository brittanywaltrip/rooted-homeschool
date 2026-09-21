-- Rollback for 20260921174221_lessons_resync_parent_intent_window
-- (and 20260921183953_lessons_resync_intent_session_scope, which amends it).
--
-- FAST PATH, if intent tracking itself is failing writes. Its two triggers sit
-- in the write path of every bare unpin and every curriculum_goals
-- start_at_lesson write; a failure in either fails that write. This removes
-- both from the write path at once (proven on staging 2026-09-21: an injected
-- schedule_intent failure broke both writes, and both landed after this):
--   ALTER TABLE public.lessons          DISABLE TRIGGER lessons_note_schedule_intent;
--   ALTER TABLE public.curriculum_goals DISABLE TRIGGER curriculum_goals_note_schedule_intent;
-- With the signals off, no new intent is recorded, so an OLD tab's parent
-- re-spread is blocked again as in 20260921172242. If has_recent_schedule_intent
-- itself is what fails, the containment rollback (disable
-- lessons_block_stale_resync) is the fast path, because that trigger calls it.
--
-- FULL REMOVAL below.
--
-- Returns the block to its 20260921172242 behaviour: EVERY legacy
-- queue_resync write from a browser is refused again, including an old tab's
-- parent re-spread, its undo and Recalibrate Phase 5 (pins released, dates not
-- moved, old toast still reporting success). Use only if the intent window
-- itself misbehaves. To stop blocking altogether, use the rollback of
-- 20260921172242 instead.
--
-- Apply AFTER 20260921174245's rollback if both are being removed: the date
-- change audit reads the transaction-local list this migration writes, and
-- tolerates its absence.

begin;
drop trigger if exists lessons_note_schedule_intent on public.lessons;
drop trigger if exists curriculum_goals_note_schedule_intent on public.curriculum_goals;
drop function if exists public.lessons_note_schedule_intent();
drop function if exists public.curriculum_goals_note_schedule_intent();

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
  perform rooted_private.record_blocked_resync(
    new.id, new.scheduled_date, new.date, new.scheduled_source
  );
  return null;
end;
$fn$;
revoke all on function public.lessons_block_stale_resync() from public, anon, authenticated;

drop function if exists rooted_private.has_recent_schedule_intent(uuid);
drop function if exists rooted_private.note_schedule_intent(uuid, text);
-- Intent rows are 10-minute working state, not evidence.
drop table if exists rooted_private.schedule_intent;
commit;
