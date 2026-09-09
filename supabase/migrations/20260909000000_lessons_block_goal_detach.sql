-- ALREADY APPLIED 2026-09-09 via Supabase MCP apply_migration. Do not re-run.
--
-- Live version stamp is `20260909010014`. The MCP records its own apply-time
-- timestamp, so it does not match this filename -- the same drift every
-- MCP-applied file in this directory carries. Match them on the name, not the
-- number.
--
-- Verified after applying:
--   * trg_lessons_block_goal_detach attached, and pg_get_triggerdef reads
--     BEFORE UPDATE OF curriculum_goal_id ... FOR EACH ROW, so the guard only
--     runs on statements that actually touch the column;
--   * block_lesson_goal_detach present;
--   * the self-test below PASSED on the way in, which is the proof that an
--     ON DELETE SET NULL cascade still deletes a curriculum cleanly;
--   * zero rows left behind on either table from its fixtures
--     (curriculum_name / title = '__detach_guard_selftest__'), confirming the
--     block rolled back as designed.
--
-- Per CLAUDE.md ("Migrations are applied by hand, never by a deploy") and
-- Anti-pattern J in docs/CURRICULUM-SCHEDULING.md, merging this file changes
-- nothing further in the live database.
--
-- ============================================================================
-- A GOAL-GENERATED LESSON MAY NOT BE DETACHED FROM ITS CURRICULUM
-- ============================================================================
--
-- Item 1 of the 2026-09-08 queue-slot brief. THE DAMAGE: three app_events
-- `lesson.updated` rows carry changes.curriculum_goal_id {from: <goal>, to:
-- null} -- djdillon88 on 2026-09-07 ("Apologia - Lesson 1" renamed to
-- "Math . Math Review-Lesson 1"), and two on tearinie.ink, 2026-08-18 and
-- 2026-08-19. Each was EditLessonModal's "Curriculum goal" picker being set to
-- (none) on a row the Schedule Builder had generated.
--
-- The row keeps its lesson_number and its queue_position. What it loses is the
-- only column the Today projector joins on: it emits slots
-- current_lesson+1 .. total_lessons and looks each one up by
-- (curriculum_goal_id, queue_position). A slot with no row renders a blank
-- subject card, and nothing in the app ever refills it -- the Schedule
-- Builder's phase 2 only inserts lesson_numbers that are missing, and this
-- lesson_number is not missing, it is sitting right there with a NULL goal. So
-- the family sees a blank card for that subject from that moment on. All three
-- were still blank when the brief was written.
--
-- app/lib/scheduler.ts planGoalReassign is the app-side rule: a slot-holding
-- row splits (the goal keeps its row, the parent's edit becomes a new
-- standalone lesson) or, when completed, refuses. This trigger is the backstop
-- that closes the class for any caller, including paths added later -- the same
-- reasoning as lessons_backfill_child_id_from_goal in 20260730200000.
--
-- ----------------------------------------------------------------------------
-- WHAT IT REFUSES, AND THE THREE THINGS IT DELIBERATELY DOES NOT
-- ----------------------------------------------------------------------------
--
-- Refused: curriculum_goal_id going NOT NULL -> NULL while lesson_number IS NOT
-- NULL and the goal still exists and is not archived.
--
--   1. ON DELETE SET NULL IS EXEMPT, and this is the load-bearing detail.
--      lessons_curriculum_goal_id_fkey is ON DELETE SET NULL, so deleting a
--      curriculum runs an UPDATE against every one of its lesson rows and fires
--      this trigger. Without an exemption, deleting a curriculum would fail
--      outright. The discriminator is the EXISTS: the FK action runs after the
--      goal row is gone, so inside that statement the goal is not visible and
--      the guard stands down. An ordinary edit from the app always has its goal
--      right there. This is why the check reads "the goal exists and is not
--      archived" rather than the simpler "lesson_number IS NOT NULL".
--
--      Item 5's goal-delete rewrite depends on exactly this: it keeps completed
--      rows as orphaned history, and those rows carry a lesson_number.
--
--   2. AN ARCHIVED GOAL IS EXEMPT. Archiving is how a family retires a
--      curriculum; its slots are no longer projected onto Today, so a detach
--      cannot blank anything.
--
--   3. rooted.allow_goal_detach = 'true' IS EXEMPT, mirroring
--      rooted.skip_orphan_cleanup in 20260519180000. Nothing in the app sets it
--      today, because planGoalReassign splits rather than detaching. It exists
--      for the "convert" semantics the brief lists as the alternative (detach,
--      then insert a replacement row at the same lesson_number and
--      queue_position with scheduled_source 'detach_backfill'), and for repair
--      scripts, which must be able to say so out loud rather than by accident.
--
-- Row triggers of the same timing fire in alphabetical order, so this one runs
-- after lessons_backfill_child_id_from_goal. That ordering does not matter here
-- (the two touch different columns), but the name is chosen to sort after it so
-- the fill still runs before any validation, per 20260730200000's note.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.block_lesson_goal_detach()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF OLD.curriculum_goal_id IS NULL OR NEW.curriculum_goal_id IS NOT NULL THEN
    RETURN NEW;
  END IF;
  IF OLD.lesson_number IS NULL THEN
    RETURN NEW;
  END IF;
  IF current_setting('rooted.allow_goal_detach', true) = 'true' THEN
    RETURN NEW;
  END IF;
  -- Both exemptions in one test: the goal is gone (an ON DELETE SET NULL
  -- cascade is running) or it is archived (its slots are not projected).
  IF NOT EXISTS (
    SELECT 1 FROM public.curriculum_goals g
    WHERE g.id = OLD.curriculum_goal_id AND g.archived = false
  ) THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION
    'Lesson % of this curriculum cannot be moved out of it: the curriculum would be left with a blank day nothing refills. Add a separate lesson instead.',
    OLD.lesson_number
    USING ERRCODE = 'check_violation';
END;
$$;

DROP TRIGGER IF EXISTS trg_lessons_block_goal_detach ON public.lessons;
CREATE TRIGGER trg_lessons_block_goal_detach
  BEFORE UPDATE OF curriculum_goal_id ON public.lessons
  FOR EACH ROW
  EXECUTE FUNCTION public.block_lesson_goal_detach();

COMMENT ON FUNCTION public.block_lesson_goal_detach() IS
  'Item 1, 2026-09-08 queue-slot brief. Refuses curriculum_goal_id NOT NULL -> NULL on a row holding a lesson_number for a live goal, which leaves a blank Today card nothing refills. Exempt: ON DELETE SET NULL cascades (the goal is already gone), archived goals, and rooted.allow_goal_detach = true.';

-- ============================================================================
-- SELF-TEST. The exemption in (1) rests on a claim about Postgres: that the
-- UPDATE an ON DELETE SET NULL action runs cannot see the parent row it is
-- reacting to, so the EXISTS comes back false and the guard stands down. If
-- that claim is wrong, this trigger makes every curriculum undeletable -- a
-- worse bug than the one it fixes, on a path families use.
--
-- So the migration proves it rather than asserting it. The block below builds a
-- throwaway family, goal and lesson, exercises all three paths, and RAISEs if
-- any behaves wrong; a RAISE here aborts the whole migration and leaves the
-- trigger unattached. The final ROLLBACK-by-exception discards the fixtures, so
-- this writes nothing that survives. It is safe to re-run.
-- ============================================================================

DO $$
DECLARE
  v_user uuid;
  v_goal uuid;
  v_lesson uuid;
  v_detached boolean;
BEGIN
  -- A REAL account, not gen_random_uuid(). curriculum_goals.user_id has a
  -- foreign key to auth.users, so a synthetic id raises foreign_key_violation
  -- -- which is not raise_exception and so is not caught by the handler below.
  -- The migration would abort with the trigger unproven, which is the one thing
  -- this block exists to prevent. (lessons.user_id has no such FK, so only the
  -- goal insert needs this.)
  --
  -- Nothing is left behind on the account: the whole block rolls back through
  -- the exception handler either way.
  SELECT id INTO v_user FROM auth.users WHERE email = 'brittanywaltrip20@gmail.com';
  IF v_user IS NULL THEN
    RAISE EXCEPTION
      'SELF-TEST CANNOT RUN: no auth.users row for the fixture account. Point it at an account that exists rather than skipping the proof.';
  END IF;

  BEGIN
    INSERT INTO public.curriculum_goals (user_id, curriculum_name, total_lessons, archived)
    VALUES (v_user, '__detach_guard_selftest__', 10, false)
    RETURNING id INTO v_goal;

    INSERT INTO public.lessons (user_id, title, date, curriculum_goal_id, lesson_number, queue_position, completed)
    VALUES (v_user, '__detach_guard_selftest__', CURRENT_DATE, v_goal, 1, 1, false)
    RETURNING id INTO v_lesson;

    -- (a) The bug itself must be refused.
    BEGIN
      UPDATE public.lessons SET curriculum_goal_id = NULL WHERE id = v_lesson;
      RAISE EXCEPTION 'SELF-TEST FAILED: a plain detach was allowed';
    EXCEPTION WHEN check_violation THEN
      NULL;  -- expected
    END;

    -- (b) The explicit override must be honoured.
    PERFORM set_config('rooted.allow_goal_detach', 'true', true);
    UPDATE public.lessons SET curriculum_goal_id = NULL WHERE id = v_lesson;
    PERFORM set_config('rooted.allow_goal_detach', 'false', true);
    UPDATE public.lessons SET curriculum_goal_id = v_goal WHERE id = v_lesson;

    -- (c) THE ONE THAT MATTERS: deleting the goal must still work, with the FK
    -- action nulling the row rather than hitting the guard.
    DELETE FROM public.curriculum_goals WHERE id = v_goal;
    SELECT curriculum_goal_id IS NULL INTO v_detached
      FROM public.lessons WHERE id = v_lesson;
    IF v_detached IS NOT TRUE THEN
      RAISE EXCEPTION 'SELF-TEST FAILED: ON DELETE SET NULL did not null the row';
    END IF;

    RAISE EXCEPTION '__selftest_ok__';
  EXCEPTION
    WHEN raise_exception THEN
      IF SQLERRM = '__selftest_ok__' THEN
        RAISE NOTICE 'block_lesson_goal_detach self-test passed; fixtures rolled back';
      ELSE
        RAISE;
      END IF;
  END;
END $$;
