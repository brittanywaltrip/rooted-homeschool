-- Preserve all forms of recorded unfinished work during pointer cleanup.
DO $$ BEGIN IF (SELECT md5(prosrc) FROM pg_proc WHERE oid='public.curriculum_goals_cleanup_orphans_trg()'::regprocedure) IS DISTINCT FROM '3fc51969d09a433b1f375182dfa4bf06' THEN RAISE EXCEPTION 'Cleanup baseline drift';END IF;END $$;
-- LOCAL REVIEW DRAFT. Prevent pointer cleanup and unaware writers from erasing
-- explicitly preserved earlier unfinished work. No existing data updates.
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
        -- Preserve PR146's placement rule for lessons outside the queue.
        AND queue_position IS NOT NULL
        AND queue_pinned = false
        AND queue_preserved = false
        AND lesson_number IS NOT NULL
        AND lesson_number <= NEW.current_lesson
        AND (notes IS NULL OR notes = '')
        AND coalesce(minutes_spent,0)=0
        AND coalesce(hours,0)=0
        AND started_at IS NULL;
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
