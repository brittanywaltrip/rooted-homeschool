-- Atomic trigger: keep curriculum_goals.current_lesson in sync with
-- lessons.completed inside the same transaction as the write.
--
-- Background: completion paths in the app call recomputeCurrentLesson()
-- on the client AFTER updating lessons.completed. The two writes go
-- over the network as separate round trips, so a tab close / JS error /
-- network blip between them leaves current_lesson lagging the actual
-- completed count. Ivy hit this on TGTB MATH 2 / LANGUAGE ARTS 2 (May
-- 2026): current_lesson was below max(queue_position) of completed
-- rows, so Today and Plan rendered different lesson numbers until the
-- counter was hand-corrected.
--
-- The trigger fires inside the lessons UPDATE/INSERT/DELETE transaction
-- and runs the same formula the TS helper uses, so the lag is
-- structurally impossible from this point on. Existing
-- recomputeCurrentLesson() calls in TS become redundant but harmless;
-- they still update local optimistic state and the DB write is now
-- idempotent with the trigger.

CREATE OR REPLACE FUNCTION public.recompute_curriculum_current_lesson(p_goal_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_total    integer;
  v_start_at integer;
  v_max_qp   integer;
  v_value    integer;
BEGIN
  SELECT total_lessons, start_at_lesson
    INTO v_total, v_start_at
    FROM curriculum_goals
    WHERE id = p_goal_id;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  SELECT MAX(queue_position)
    INTO v_max_qp
    FROM lessons
    WHERE curriculum_goal_id = p_goal_id
      AND completed = true
      AND queue_position IS NOT NULL;

  v_value := GREATEST(
    COALESCE(v_max_qp, 0),
    GREATEST(0, COALESCE(v_start_at, 1) - 1)
  );

  IF v_total IS NOT NULL AND v_total > 0 THEN
    v_value := LEAST(v_value, v_total);
  END IF;

  UPDATE curriculum_goals
    SET current_lesson = v_value
    WHERE id = p_goal_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.recompute_curriculum_current_lesson(uuid) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.recompute_curriculum_current_lesson(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.lessons_recompute_current_lesson_trg()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.curriculum_goal_id IS NOT NULL AND NEW.completed = true THEN
      PERFORM public.recompute_curriculum_current_lesson(NEW.curriculum_goal_id);
    END IF;
    RETURN NEW;
  END IF;

  IF TG_OP = 'DELETE' THEN
    IF OLD.curriculum_goal_id IS NOT NULL AND OLD.completed = true THEN
      PERFORM public.recompute_curriculum_current_lesson(OLD.curriculum_goal_id);
    END IF;
    RETURN OLD;
  END IF;

  -- TG_OP = 'UPDATE'
  IF OLD.completed IS DISTINCT FROM NEW.completed
     AND NEW.curriculum_goal_id IS NOT NULL THEN
    PERFORM public.recompute_curriculum_current_lesson(NEW.curriculum_goal_id);
  ELSIF NEW.completed = true
     AND OLD.queue_position IS DISTINCT FROM NEW.queue_position
     AND NEW.curriculum_goal_id IS NOT NULL THEN
    PERFORM public.recompute_curriculum_current_lesson(NEW.curriculum_goal_id);
  END IF;

  -- Goal reassignment of a completed row: recompute the source goal too,
  -- otherwise its current_lesson stays anchored to a row it no longer owns.
  IF OLD.completed = true
     AND OLD.curriculum_goal_id IS NOT NULL
     AND OLD.curriculum_goal_id IS DISTINCT FROM NEW.curriculum_goal_id THEN
    PERFORM public.recompute_curriculum_current_lesson(OLD.curriculum_goal_id);
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_lessons_recompute_current_lesson ON public.lessons;

CREATE TRIGGER trg_lessons_recompute_current_lesson
AFTER INSERT OR UPDATE OR DELETE ON public.lessons
FOR EACH ROW
EXECUTE FUNCTION public.lessons_recompute_current_lesson_trg();
