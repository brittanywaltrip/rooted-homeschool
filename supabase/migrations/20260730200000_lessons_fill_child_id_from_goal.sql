-- Backstop: a lesson attached to a curriculum goal always carries that goal's
-- child_id.
--
-- THE BUG (drift F): 6 production rows across 3 families, created Jul 9-27, were
-- lessons with child_id NULL on goals that have a child. A childless lesson row
-- never renders under a kid on Today or Plan and never reaches that child's
-- transcript, so the family's work silently disappears from the surfaces that
-- matter. Two app paths could produce it, both now fixed in code:
--   * the Today missed-lesson recovery insert, which fell back to
--     `?? null` when its goal SELECT failed or returned nothing;
--   * PlanV2's "log past hours" backfill, which read child_id out of the
--     archived-filtered, possibly-not-yet-loaded curriculumGoals state.
--
-- Those two fixes stop the paths I can identify. This trigger makes the whole
-- class impossible regardless of which client, script, or future code path does
-- the insert — including ones written after this comment. It only ever FILLS a
-- NULL from the goal; it never overwrites a child_id the caller supplied, so a
-- deliberate cross-child value still reaches
-- enforce_lesson_child_matches_goal() and is still rejected there.
--
-- TRIGGER ORDER MATTERS. Postgres fires same-timing row triggers in alphabetical
-- order by trigger name, and lessons already has a BEFORE INSERT OR UPDATE
-- validator called `lessons_child_id_matches_goal` that raises when child_id
-- disagrees with the goal. This trigger is named `lessons_backfill_child_id...`
-- so that 'b' sorts before 'c' and the fill happens BEFORE the validation.
-- Renaming either one without preserving that order re-opens the bug: the
-- validator would reject the NULL-child insert instead of the fill repairing it.
-- (The validator's own guard is `new.child_id is not null`, so today it passes
-- NULL rows through rather than raising — the ordering still matters for the
-- fill to take effect at all.)

CREATE OR REPLACE FUNCTION public.lessons_fill_child_id_from_goal()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.child_id IS NULL AND NEW.curriculum_goal_id IS NOT NULL THEN
    SELECT g.child_id
      INTO NEW.child_id
      FROM public.curriculum_goals g
     WHERE g.id = NEW.curriculum_goal_id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS lessons_backfill_child_id_from_goal ON public.lessons;
CREATE TRIGGER lessons_backfill_child_id_from_goal
  BEFORE INSERT OR UPDATE OF child_id, curriculum_goal_id ON public.lessons
  FOR EACH ROW
  EXECUTE FUNCTION public.lessons_fill_child_id_from_goal();

-- Standing rule: state the grants explicitly whenever a SECURITY DEFINER
-- function is created, so a fresh environment matches production and a future
-- DROP + CREATE cannot silently widen access. This is a trigger function and is
-- never called over /rest/v1/rpc.
REVOKE EXECUTE ON FUNCTION public.lessons_fill_child_id_from_goal() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.lessons_fill_child_id_from_goal() FROM anon;
REVOKE EXECUTE ON FUNCTION public.lessons_fill_child_id_from_goal() FROM authenticated;
GRANT EXECUTE ON FUNCTION public.lessons_fill_child_id_from_goal() TO service_role;
