-- Orphan cleanup must clear the date caches, not just the completion flags.
--
-- THE BUG (kierrak745@gmail.com, TPT goal d7791c72-10d7-4491-8ca2-1c4495457048):
-- she created a curriculum with starting position 8 and a future start_date of
-- Aug 10. Rows 1-100 were written as incomplete dated rows starting at lesson 1.
-- When current_lesson advanced to 8, this trigger auto-completed rows 1-7 but
-- left their scheduled_date / date caches sitting on Aug 10-18 — the exact days
-- the queue had assigned lessons 9-15. Plan's MonthGrid renders
-- `scheduled_date ?? date`, so she saw two lessons per day for 7 school days.
-- The daily integrity check reports this as drift B (overcapacity); roughly 215
-- residual goal-days across production carry the same shape.
--
-- WHY IT WAS STILL BROKEN: this is not a missing design. Migration
-- 20260520180000_orphan_cleanup_sync_scheduled_date.sql already added a
-- scheduled_date sync to this function, but it was never applied — it does not
-- appear in supabase_migrations.schema_migrations, and the live function body
-- carried only (completed, completed_at, queue_position). The fix existed on
-- disk for two months and never reached the database. This migration IS
-- applied; verified against the live function body after running.
--
-- THE FIX: a trigger-completed row can never occupy a future calendar day.
--   scheduled_date = NULL              -- no calendar slot at all
--   date           = (NOW() - '1 day') -- date is NOT NULL, so pin it to the
--                                         same synthetic day as completed_at
--
-- Clearing scheduled_date outright (rather than pointing it at the synthetic
-- day, which is what the unapplied 20260520180000 chose) is the stronger
-- guarantee: a NULL slot cannot double-book any surface, including ones that
-- read scheduled_date alone and never fall back to `date`. The trade-off is
-- that these rows drop out of the Plan calendar entirely instead of appearing
-- as completed history on the synthetic day, because usePlanV2Data selects on
-- `scheduled_date BETWEEN start AND end` and NULL fails that filter. That is
-- the intended behavior here: these rows are bookkeeping for "already done
-- before you started tracking", not work the family actually did on a day.
-- Their completed_at still carries them into transcripts and progress reports.
--
-- On Anti-pattern G (never use the server clock for a user-facing date): the
-- synthetic `NOW() - interval '1 day'` is deliberate and pre-existing — it
-- mirrors the completed_at this same statement writes so the two always agree.
-- A ±1 day UTC skew on a synthetic past marker cannot cause the calendar
-- doubling this migration exists to prevent.
--
-- Everything else is byte-identical to the live function: the
-- rooted.skip_orphan_cleanup re-entry guard, the NEW > OLD gate, the
-- notes-bearing skip, queue_position nulling, SECURITY DEFINER, search_path.

CREATE OR REPLACE FUNCTION public.curriculum_goals_cleanup_orphans_trg()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_skip text;
BEGIN
  -- Re-entry guard. Without this, the lessons UPDATE below would fire
  -- lessons_recompute_current_lesson_trg, which calls
  -- recompute_curriculum_current_lesson, which UPDATEs this same row on
  -- curriculum_goals — so this function would be re-invoked inside its own
  -- transaction. The NEW > OLD gate stops the recursion on its own
  -- (queue_position = NULL on cleaned rows leaves MAX(queue_position)
  -- unchanged, so recompute writes the same current_lesson and NEW = OLD on
  -- the inner fire). The SET LOCAL is belt-and-suspenders so any unexpected
  -- path that DOES move current_lesson during cleanup short-circuits here.
  v_skip := current_setting('rooted.skip_orphan_cleanup', true);
  IF v_skip = 'true' THEN
    RETURN NEW;
  END IF;

  IF NEW.current_lesson > OLD.current_lesson THEN
    PERFORM set_config('rooted.skip_orphan_cleanup', 'true', true);

    -- Mark orphans complete. completed_at is backdated by one day so these
    -- rows do not count against today's lessons_per_day quota (Today reads
    -- completed_at::date = today per goal to anchor today's projected slot
    -- count). queue_position is nulled so they never feed back into
    -- recompute_curriculum_current_lesson's MAX(queue_position) and never
    -- advance current_lesson again. The date caches are cleared so the row
    -- cannot keep a future calendar slot and collide with the live queue.
    -- Rows with notes are parent-intentional and never touched.
    UPDATE public.lessons
      SET completed = true,
          completed_at = NOW() - interval '1 day',
          scheduled_date = NULL,
          date = (NOW() - interval '1 day')::date,
          queue_position = NULL
      WHERE curriculum_goal_id = NEW.id
        AND completed = false
        AND lesson_number IS NOT NULL
        AND lesson_number <= NEW.current_lesson
        AND (notes IS NULL OR notes = '');
  END IF;

  RETURN NEW;
END;
$$;

-- Standing rule: re-assert grants whenever a SECURITY DEFINER function is
-- recreated. CREATE OR REPLACE preserves them (no DROP), but these are stated
-- explicitly so a fresh environment lands on the same grants as production and
-- so a future DROP + CREATE cannot silently widen access. This matches the
-- live state verified before this migration: service_role + postgres only.
-- It is a trigger function and is never called over /rest/v1/rpc.
REVOKE EXECUTE ON FUNCTION public.curriculum_goals_cleanup_orphans_trg() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.curriculum_goals_cleanup_orphans_trg() FROM anon;
REVOKE EXECUTE ON FUNCTION public.curriculum_goals_cleanup_orphans_trg() FROM authenticated;
GRANT EXECUTE ON FUNCTION public.curriculum_goals_cleanup_orphans_trg() TO service_role;
