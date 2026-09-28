-- Rollback for 20260928200000_lessons_completion_needs_a_person.sql.
-- Restores the 20260907000000 body verbatim: only trigger depth > 1 is
-- refused, so a top-level statement with no signed-in user can mark lessons
-- done again. Verify afterwards: md5(prosrc) of
-- public.lessons_block_server_side_completion = c7e61be62dabbb31d826c82b2593b0b5
-- (the value production and staging both held on 2026-09-28).

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
