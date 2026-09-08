-- ALREADY APPLIED 2026-09-08 via Supabase MCP apply_migration. Do not re-run.
-- Verified after applying: trg_lessons_block_server_side_completion attached;
-- curriculum_goals_cleanup_orphans_trg sets scheduled_date = NULL only, with no
-- completed / completed_at / date / queue_position assignment remaining.
--
-- Per CLAUDE.md ("Migrations are applied by hand, never by a deploy") and
-- Anti-pattern J in docs/CURRICULUM-SCHEDULING.md, merging this file changes
-- nothing in the live database. Apply it explicitly (Supabase MCP
-- apply_migration or the SQL editor), then verify with pg_get_functiondef and
-- add an "ALREADY APPLIED" header line the way the 2026-08 migrations carry.
--
-- ============================================================================
-- STOP SERVER-SIDE AUTO-COMPLETION OF LESSONS
-- ============================================================================
--
-- THE DAMAGE, measured 2026-09-07 (read-only): 289 lesson rows across 161
-- goals and 34 families are marked completed by
-- curriculum_goals_cleanup_orphans_trg rather than by anybody doing the work.
-- They carry the trigger's fingerprint: completed = true, scheduled_date NULL,
-- and completed_at exactly 24 hours before updated_at to the microsecond. The
-- oldest is 2026-07-30, the newest was written the morning this migration was
-- drafted, and the weekly count is rising. Two visible symptoms, both from
-- families who never touched the calendar:
--
--   * a lesson dated on a day the goal does not school. The trigger stamps
--     date = (NOW() - interval '1 day')::date, which is whatever calendar day
--     precedes the write. Goal e2c99827 ("Spanish 1:1", school_days Tue/Wed)
--     holds lesson 5 on Sunday 2026-08-30 for exactly this reason.
--   * lesson numbers out of order. That synthetic day is by construction one
--     day BEFORE the completion that provoked the sweep, so an auto-completed
--     row always sorts ahead of the lower-numbered lessons its own family
--     finished minutes earlier. Goal 327a80a6 ("Kitchen Math") holds lesson 11
--     on 2026-09-01 while lessons 4 through 10 sit on 2026-09-02.
--
-- Both are downstream of one decision. The trigger answers "this row is behind
-- the queue pointer" with "so the family must have done it", and that is not a
-- claim any trigger is in a position to make.
--
-- ----------------------------------------------------------------------------
-- WHAT THE TRIGGER WAS ORIGINALLY SOLVING, and how this version still solves it
-- ----------------------------------------------------------------------------
--
-- From 20260519180000: incomplete rows with lesson_number <= current_lesson
-- accumulate ("orphans") whenever current_lesson advances without the caller
-- cleaning up behind it. The Schedule Builder's starting-position UI is the
-- largest source; bulk-logging paths and pointer repairs do it too. The
-- problem those rows cause is a CALENDAR problem: they still carry a real
-- future scheduled_date, so they ghost onto the Plan day panel and the
-- missed-lesson surfaces, and they double-book days the live queue has already
-- assigned to lessons ahead of the pointer (drift B, the kierrak745 report in
-- 20260730100000). 557 of them were cleaned by hand on 2026-05-19.
--
-- The remedy chosen then was "mark them complete", which conflated two
-- different things: removing the calendar slot, and asserting the work
-- happened. Only the first was ever needed.
--
-- This version removes the calendar slot and nothing else:
--
--   scheduled_date = NULL
--
-- That is the same guarantee 20260730100000 reached for and stated in its own
-- words: "a trigger-completed row can never occupy a future calendar day ...
-- a NULL slot cannot double-book any surface". Every calendar surface selects
-- on scheduled_date (usePlanV2Data filters `scheduled_date BETWEEN start AND
-- end`; PlanV2's catch-up loader requires `scheduled_date IS NOT NULL`), so a
-- NULL slot drops out of all of them. The Today projector never emitted these
-- rows in the first place: it emits slots ABOVE current_lesson, and an orphan
-- is by definition at or below it.
--
-- What is deliberately NOT written any more:
--
--   completed / completed_at  -- an orphan is an unfinished lesson that fell
--                                behind the pointer. It stays unfinished until
--                                a person says otherwise. This is the whole
--                                point of the migration.
--   date                      -- the historical record of the day the row was
--                                planned for. NOT NULL, so it cannot be
--                                cleared, and the synthetic yesterday it was
--                                being set to was a fabrication that put rows
--                                on Sundays.
--   queue_position            -- untouched, which retires the Invariant 14
--                                machinery entirely rather than tuning it. The
--                                slot only feeds recompute_curriculum_current_
--                                lesson through COMPLETED rows, and this
--                                statement no longer completes anything.
--
-- The consequence for the Invariant 14 loop (ROOTED-HOMESCHOOL-R and -13) is
-- that it cannot occur at all. lessons_recompute_current_lesson_trg fires on
-- an UPDATE only when curriculum_goal_id changes, `completed` flips, or
-- queue_position changes on a completed row. This statement writes
-- scheduled_date alone, so the recompute never runs, current_lesson cannot
-- move as a side effect of the cleanup, and no slot is ever stranded. The
-- 20260824000000 CASE expression is therefore removed as dead code, not
-- reverted: nothing it guarded against can still happen.
--
-- Two new exclusions on the WHERE clause:
--
--   scheduled_date IS NOT NULL  -- makes the statement a no-op when there is
--                                  nothing to unschedule, instead of touching
--                                  updated_at on rows it has already cleaned.
--                                  It also keeps the fingerprint honest: after
--                                  this migration, a row with scheduled_date
--                                  NULL and a 24-hour completed_at/updated_at
--                                  gap can only be pre-existing damage.
--   queue_pinned = false        -- Invariant 12. A pinned row is a placement
--                                  the family made by hand; the system does
--                                  not silently unschedule it. Under the old
--                                  trigger this could not arise (completing a
--                                  row retires its pin), so this is new ground
--                                  and the conservative answer is to leave the
--                                  family's own placement alone.
--
-- Unchanged: the rooted.skip_orphan_cleanup re-entry guard, the NEW > OLD
-- gate, the notes-bearing skip (parent-intentional rows), SECURITY DEFINER,
-- search_path, and the grants.

CREATE OR REPLACE FUNCTION public.curriculum_goals_cleanup_orphans_trg()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_skip text;
BEGIN
  -- Re-entry guard, kept from 20260519180000. It blocks re-entry into THIS
  -- function only. That was never sufficient on its own (see the header of
  -- 20260824000000), but the statement below no longer flips `completed`, so
  -- lessons_recompute_current_lesson_trg is not fired by it and there is no
  -- second path back into this function to guard against.
  v_skip := current_setting('rooted.skip_orphan_cleanup', true);
  IF v_skip = 'true' THEN
    RETURN NEW;
  END IF;

  IF NEW.current_lesson > OLD.current_lesson THEN
    PERFORM set_config('rooted.skip_orphan_cleanup', 'true', true);

    -- UNSCHEDULE orphans. Do not complete them, do not re-date them.
    --
    -- An orphan is an incomplete row that the queue pointer has moved past.
    -- The harm it does is holding a calendar day the live queue has already
    -- given to a lesson ahead of it, so releasing the day is the entire fix.
    -- Whether the family ever did that lesson is not something this trigger
    -- can know, and it must not guess: every row it guessed about is in the
    -- 289 this migration exists to stop.
    UPDATE public.lessons
      SET scheduled_date = NULL
      WHERE curriculum_goal_id = NEW.id
        AND completed = false
        AND scheduled_date IS NOT NULL
        AND queue_pinned = false
        AND lesson_number IS NOT NULL
        AND lesson_number <= NEW.current_lesson
        AND (notes IS NULL OR notes = '');
  END IF;

  RETURN NEW;
END;
$$;

-- Standing rule: re-assert grants whenever a SECURITY DEFINER function is
-- recreated. CREATE OR REPLACE preserves them, but stating them keeps a fresh
-- environment identical to production and stops a future DROP + CREATE from
-- silently widening access. Trigger function; never called over /rest/v1/rpc.
REVOKE EXECUTE ON FUNCTION public.curriculum_goals_cleanup_orphans_trg() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.curriculum_goals_cleanup_orphans_trg() FROM anon;
REVOKE EXECUTE ON FUNCTION public.curriculum_goals_cleanup_orphans_trg() FROM authenticated;
GRANT EXECUTE ON FUNCTION public.curriculum_goals_cleanup_orphans_trg() TO service_role;


-- ============================================================================
-- THE GUARD: completion is a user action, enforced by the database
-- ============================================================================
--
-- Fixing the one trigger that did this is not the same as making it
-- impossible. The next one will be written by someone who has never read this
-- file, and the failure mode is silent: a family's record of their own year
-- gains lessons nobody taught, and nothing errors.
--
-- pg_trigger_depth() is the signal that separates the two cases exactly:
--
--   depth 1  a statement issued by the app (any client, any role) fired this
--            BEFORE trigger. A person tapped something.
--   depth 2+ the write originates INSIDE another trigger's statement. No
--            person is in that call stack.
--
-- So: a false -> true transition on lessons.completed at depth > 1 is refused,
-- loudly, with the goal and lesson in the message. An INSERT of an
-- already-completed row from inside a trigger is refused on the same rule.
--
-- Scope, stated honestly: this enforces "no TRIGGER completes a lesson". It
-- cannot enforce "no server-side path", because an API route holding the
-- service-role key is a client like any other and reaches the database at
-- depth 1. That half is enforced in application code and by the source-level
-- test in app/lib/scheduler.test.ts (Invariant 15).
--
-- Deliberately no escape hatch. There is no rooted.allow_server_completion
-- setting to flip, because the first thing a future trigger author would do is
-- flip it.

CREATE OR REPLACE FUNCTION public.lessons_block_server_side_completion()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.completed = true
     AND (TG_OP = 'INSERT' OR OLD.completed = false)
     AND pg_trigger_depth() > 1
  THEN
    RAISE EXCEPTION
      'lessons.completed may only be set by an explicit user action (lesson %, goal %, trigger depth %)',
      NEW.id, NEW.curriculum_goal_id, pg_trigger_depth()
      USING ERRCODE = 'check_violation',
            HINT = 'A trigger tried to mark a lesson complete. Completion is a claim about what a family did; only a person may make it. See supabase/migrations/20260907000000_no_server_side_lesson_completion.sql and Invariant 15 in docs/CURRICULUM-SCHEDULING.md.';
  END IF;

  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.lessons_block_server_side_completion() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.lessons_block_server_side_completion() FROM anon;
REVOKE EXECUTE ON FUNCTION public.lessons_block_server_side_completion() FROM authenticated;
GRANT EXECUTE ON FUNCTION public.lessons_block_server_side_completion() TO service_role;

DROP TRIGGER IF EXISTS trg_lessons_block_server_side_completion ON public.lessons;

-- BEFORE, so the write never lands. Row-level, so the message names the row.
-- Named with a leading trg_ like the other guard triggers on this table; BEFORE
-- triggers fire in name order and this one is order-independent (it inspects
-- NEW.completed, which no other BEFORE trigger on lessons writes).
CREATE TRIGGER trg_lessons_block_server_side_completion
BEFORE INSERT OR UPDATE OF completed ON public.lessons
FOR EACH ROW
EXECUTE FUNCTION public.lessons_block_server_side_completion();


-- ============================================================================
-- VERIFY AFTER APPLYING (read-only, run in the SQL editor)
-- ============================================================================
--
-- 1. The cleanup no longer completes anything:
--      SELECT pg_get_functiondef('public.curriculum_goals_cleanup_orphans_trg'::regproc);
--    Expect one UPDATE, setting scheduled_date = NULL, with no `completed`,
--    `completed_at`, `date` or `queue_position` assignment anywhere in it.
--
-- 2. The guard is attached:
--      SELECT tgname FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
--       WHERE c.relname = 'lessons' AND NOT t.tgisinternal;
--    Expect trg_lessons_block_server_side_completion in the list.
--
-- 3. No NEW damage accrues. This count must stop rising (it does not fall on
--    its own; the existing rows are Phase 2's job):
--      SELECT count(*) FROM lessons
--       WHERE completed AND completed_at IS NOT NULL AND scheduled_date IS NULL
--         AND updated_at - completed_at
--             BETWEEN interval '23:59:59.5' AND interval '24:00:00.5';
--    289 at 2026-09-07. Re-run daily for a week.
