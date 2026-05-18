-- queue_position lets the user reorder lessons inside a goal without
-- touching lesson_number. The projector reads queue_position; display
-- (Past tab, lesson titles, etc.) still uses lesson_number.
--
-- One-off custom lessons (no curriculum_goal_id, or no lesson_number)
-- stay out of the queue: their queue_position is NULL and the unique
-- index is partial so it does not include them.

ALTER TABLE lessons ADD COLUMN IF NOT EXISTS queue_position integer;

UPDATE lessons
SET queue_position = lesson_number
WHERE lesson_number IS NOT NULL
  AND curriculum_goal_id IS NOT NULL
  AND queue_position IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS lessons_goal_queue_position_uniq
ON lessons (curriculum_goal_id, queue_position)
WHERE curriculum_goal_id IS NOT NULL AND queue_position IS NOT NULL;

-- Atomic queue-aware move. The Plan page calls this when the user drags
-- or reschedules a lesson to a new date. It computes the new queue rank
-- ("end of that day's existing slots for this goal"), shifts siblings to
-- keep queue_positions dense, and updates the lesson's date columns +
-- scheduled_source. See CURRICULUM-SCHEDULING.md, "Queue position" section.
CREATE OR REPLACE FUNCTION public.move_lesson_to_date(
  p_lesson_id uuid,
  p_target_date date
) RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
DECLARE
  v_goal_id uuid;
  v_old_qp integer;
  v_old_date date;
  v_max_qp_on_d integer;
  v_max_qp_before_d integer;
  v_new_qp integer;
BEGIN
  SELECT curriculum_goal_id, queue_position, scheduled_date
    INTO v_goal_id, v_old_qp, v_old_date
    FROM lessons
    WHERE id = p_lesson_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'lesson % not found', p_lesson_id;
  END IF;

  IF v_goal_id IS NULL OR v_old_qp IS NULL THEN
    UPDATE lessons
      SET scheduled_date = p_target_date,
          date           = p_target_date,
          scheduled_source = 'plan_move'
      WHERE id = p_lesson_id;
    RETURN;
  END IF;

  SELECT MAX(queue_position)
    INTO v_max_qp_on_d
    FROM lessons
    WHERE curriculum_goal_id = v_goal_id
      AND scheduled_date = p_target_date
      AND id <> p_lesson_id
      AND queue_position IS NOT NULL;

  IF v_max_qp_on_d IS NULL THEN
    SELECT MAX(queue_position)
      INTO v_max_qp_before_d
      FROM lessons
      WHERE curriculum_goal_id = v_goal_id
        AND scheduled_date < p_target_date
        AND id <> p_lesson_id
        AND queue_position IS NOT NULL;
    v_max_qp_on_d := COALESCE(v_max_qp_before_d, 0);
  END IF;

  IF v_old_qp > v_max_qp_on_d THEN
    v_new_qp := v_max_qp_on_d + 1;
  ELSE
    v_new_qp := v_max_qp_on_d;
  END IF;

  IF v_new_qp = v_old_qp AND v_old_date IS NOT DISTINCT FROM p_target_date THEN
    UPDATE lessons
      SET scheduled_source = 'plan_move'
      WHERE id = p_lesson_id;
    RETURN;
  END IF;

  UPDATE lessons SET queue_position = NULL WHERE id = p_lesson_id;

  IF v_old_qp < v_new_qp THEN
    UPDATE lessons
      SET queue_position = -(queue_position - 1)
      WHERE curriculum_goal_id = v_goal_id
        AND queue_position > v_old_qp
        AND queue_position <= v_new_qp;
    UPDATE lessons
      SET queue_position = -queue_position
      WHERE curriculum_goal_id = v_goal_id
        AND queue_position < 0;
  ELSIF v_old_qp > v_new_qp THEN
    UPDATE lessons
      SET queue_position = -(queue_position + 1)
      WHERE curriculum_goal_id = v_goal_id
        AND queue_position >= v_new_qp
        AND queue_position < v_old_qp;
    UPDATE lessons
      SET queue_position = -queue_position
      WHERE curriculum_goal_id = v_goal_id
        AND queue_position < 0;
  END IF;

  UPDATE lessons
    SET queue_position = v_new_qp,
        scheduled_date = p_target_date,
        date           = p_target_date,
        scheduled_source = 'plan_move'
    WHERE id = p_lesson_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.move_lesson_to_date(uuid, date) TO authenticated;
