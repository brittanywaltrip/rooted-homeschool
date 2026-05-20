-- Extend the orphan-cleanup trigger so it also pins scheduled_date to
-- match the completed_at it stamps.
--
-- Before this migration, the trigger marked an orphan row complete
-- (completed=true, completed_at=NOW()-1 day, queue_position=NULL) but
-- left its scheduled_date untouched. Rows whose original scheduled_date
-- sat on a future calendar day kept ghosting onto the Plan calendar's
-- future slots even after the trigger had collapsed them into the
-- "already done" pool. Aligning scheduled_date to (completed_at::date)
-- makes the cached date match the new completion event and drops the
-- ghosts from future Plan views.
--
-- The trigger semantics are otherwise unchanged: completed_at still
-- backdates by one day so the row doesn't count against today's
-- lessons_per_day quota; queue_position still nulls out so
-- recompute_curriculum_current_lesson ignores the row; notes-bearing
-- rows are still skipped as parent-intentional manual reschedules.

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
    -- scheduled_date is pulled forward to match completed_at so the
    -- Plan calendar stops ghosting these rows on their original
    -- future slot.
    -- Rows with notes are parent-intentional and never touched.
    UPDATE public.lessons
      SET completed = true,
          completed_at = NOW() - interval '1 day',
          scheduled_date = (NOW() - interval '1 day')::date,
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
