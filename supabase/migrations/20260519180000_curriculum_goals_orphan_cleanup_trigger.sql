-- Auto-complete orphan lesson rows when curriculum_goals.current_lesson
-- advances past them.
--
-- Background: incomplete lesson rows with lesson_number <= current_lesson
-- accumulate ("orphans") whenever current_lesson advances without the
-- caller also cleaning up the rows behind it. The largest source is the
-- Schedule Builder starting-position UI; H-drift fixes and bulk-logging
-- paths can do it too. Orphans have real future scheduled_date values
-- so they ghost onto Plan day-detail panels and the missed-lessons
-- panel even though the projector has long since moved past them.
--
-- On 2026-05-19 we manually cleaned 557 orphan rows across 48 goals.
-- This trigger prevents recurrence.
--
-- Trade-off: a parent who marks "Lesson 5 only" via the catch-up modal
-- will see lessons 1-4 auto-completed (no notes, lesson_number <= 5)
-- because current_lesson advances to 5. The orphan-prevention design
-- intentionally accepts the over-count in exchange for eliminating the
-- ghosting surface. Rows with notes are protected as parent-intentional
-- manual reschedules.

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
  -- recompute_curriculum_current_lesson, which UPDATEs this same row
  -- on curriculum_goals — so this function would be re-invoked inside
  -- its own transaction. The NEW > OLD gate stops the recursion on
  -- its own (queue_position = NULL on cleaned rows leaves
  -- MAX(queue_position) unchanged, so recompute writes the same
  -- current_lesson and NEW = OLD on the inner fire). The SET LOCAL is
  -- belt-and-suspenders so any unexpected path that DOES move
  -- current_lesson during cleanup short-circuits here.
  v_skip := current_setting('rooted.skip_orphan_cleanup', true);
  IF v_skip = 'true' THEN
    RETURN NEW;
  END IF;

  IF NEW.current_lesson > OLD.current_lesson THEN
    PERFORM set_config('rooted.skip_orphan_cleanup', 'true', true);

    -- Mark orphans complete. completed_at is backdated by one day so
    -- these rows do not count against today's lessons_per_day quota
    -- (Today reads completed_at::date = today per goal to anchor
    -- today's projected slot count). queue_position is nulled so they
    -- never feed back into recompute_curriculum_current_lesson's
    -- MAX(queue_position) and never advance current_lesson again.
    -- Rows with notes are parent-intentional and never touched.
    UPDATE public.lessons
      SET completed = true,
          completed_at = NOW() - interval '1 day',
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

REVOKE EXECUTE ON FUNCTION public.curriculum_goals_cleanup_orphans_trg() FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.curriculum_goals_cleanup_orphans_trg() TO authenticated, service_role;

DROP TRIGGER IF EXISTS trg_curriculum_goals_cleanup_orphans ON public.curriculum_goals;

CREATE TRIGGER trg_curriculum_goals_cleanup_orphans
AFTER UPDATE OF current_lesson ON public.curriculum_goals
FOR EACH ROW
WHEN (NEW.current_lesson IS DISTINCT FROM OLD.current_lesson)
EXECUTE FUNCTION public.curriculum_goals_cleanup_orphans_trg();
