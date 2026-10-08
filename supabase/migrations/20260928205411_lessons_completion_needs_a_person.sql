-- ALREADY APPLIED. DO NOT RE-RUN.
--   production gvkbegvvmhcrmxdorctk: 20260928205411 lessons_completion_needs_a_person
--     (2026-09-28 20:54 UTC; function only, the trigger already existed with
--     the identical definition, so it was not dropped and recreated under
--     live traffic)
--   staging    cvgqovweybggrqakhdtd: 20260928201722 lessons_completion_needs_a_person
--              + 20260928201826 lessons_completion_needs_a_person_key_claims
-- The filename carries the PRODUCTION version (CLAUDE.md). Installed function
-- md5 on both = 4c5e182a5325771883725e2b481525a5, identical to the body below.
-- The error HINT inside the body names this file by its pre-apply name
-- (20260928200000_...); it is kept verbatim so the body matches what is
-- installed.
-- Verified on production after applying, in a transaction that rolled back:
-- a parent completion (role authenticated, the family's claims, the e2e test
-- account) lands and moves the pointer; a postgres completion with no user is
-- refused. Rehearsal: supabase/tests/completion-needs-a-person.sql, 12/12 on
-- staging. Rollback:
-- supabase/rollbacks/20260928205411_lessons_completion_needs_a_person_ROLLBACK.sql
--
-- ============================================================================
-- A LESSON IS MARKED DONE ONLY BY A PERSON, OR BY REVIEWED CODE
-- ============================================================================
--
-- THE DAMAGE, measured 2026-09-28 (production, read-only). At 2026-09-25
-- 15:11:35 UTC one ad-hoc statement marked 250 unfinished lessons as
-- completed across 123 curricula and 34 families, set completed_at to
-- exactly 24 hours before the write, and set queue_position to NULL. It was
-- the "drift G auto-heal" of a scheduled integrity check, run through the
-- Supabase MCP as the postgres role with no signed-in user. It chose rows by
--   lesson_number <= current_lesson
-- but current_lesson is MAX(queue_position) over completed rows. After a Plan
-- drag had swapped two lessons' slots (move_lesson_to_date, 2026-09-23), the
-- family completed the lower-numbered lesson in the HIGHER slot, the pointer
-- jumped over the other one, and the sweep then declared that other lesson
-- done. The family had not done it. Its slot went NULL, so the curriculum was
-- left with an empty queue slot below the pointer. That is the queue-slot gap
-- reported on 2026-09-28 (Math With Confidence, Gather Round: Chemistry,
-- Reason for Handwriting K, and others). One family logged the missing lesson
-- again by hand as an extra.
--
-- This is the same fabrication 20260907000000 removed from the orphan
-- trigger, with the same fingerprint (completed_at = updated_at - 24h, NULL
-- queue_position, 34 families). That migration's guard only fires inside a
-- trigger (pg_trigger_depth() > 1), so a top-level statement walked past it.
--
-- THE RULE. When a statement at trigger depth 1 marks a lesson completed
-- (INSERT with completed = true, or UPDATE from false to true), it must come
-- from one of:
--   1. The family itself: auth.uid() = the lesson's user_id. This covers the
--      browser writing directly and every SECURITY DEFINER RPC the family
--      calls (reopen_lesson, apply_builder_rebuild, report corrections),
--      because PostgREST's request claims stay set inside them.
--   2. The service_role key: reviewed server code, repair scripts and the
--      e2e seeding, which all go through PostgREST with that key. Checked as
--      current_user = service_role AND request.jwt.claims role = service_role,
--      so a SQL session that merely runs SET ROLE service_role (which the
--      Supabase MCP and the SQL editor can do) is still refused.
--   3. A transaction that says why, out loud:
--        set local rooted.completion_attested = '<ticket or reason>';
--      For a reviewed repair run from the SQL editor. The reason is required
--      and non-empty.
-- Anything else (the postgres role with no signed-in user, which is what the
-- SQL editor and the Supabase MCP run as) is refused with check_violation and
-- the lesson is left as it was. Depth > 1 is still refused unconditionally,
-- exactly as before.
--
-- Un-completing, re-dating, and every other column are untouched by this
-- rule. Lessons RLS is owner-only, so clause 1 matches every legitimate
-- browser and RPC path in the app; no API route or edge function completes
-- lessons (checked 2026-09-28).

CREATE OR REPLACE FUNCTION public.lessons_block_server_side_completion()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.completed = true AND (TG_OP = 'INSERT' OR OLD.completed = false) THEN
    IF pg_trigger_depth() > 1 THEN
      RAISE EXCEPTION
        'lessons.completed may only be set by an explicit user action (lesson %, goal %, trigger depth %)',
        NEW.id, NEW.curriculum_goal_id, pg_trigger_depth()
        USING ERRCODE = 'check_violation',
              HINT = 'A trigger tried to mark a lesson complete. Completion is a claim about what a family did; only a person may make it. See supabase/migrations/20260907000000_no_server_side_lesson_completion.sql and Invariant 15 in docs/CURRICULUM-SCHEDULING.md.';
    END IF;

    IF auth.uid() IS NOT DISTINCT FROM NEW.user_id AND auth.uid() IS NOT NULL THEN
      RETURN NEW;
    END IF;
    -- A real service-key request: PostgREST switches to service_role AND
    -- stamps the key's claims. A SQL session that only runs SET ROLE
    -- service_role (the Supabase MCP, the SQL editor) carries no claims and is
    -- not let through here.
    IF current_user = 'service_role'
       AND coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role', '') = 'service_role' THEN
      RETURN NEW;
    END IF;
    IF coalesce(btrim(current_setting('rooted.completion_attested', true)), '') <> '' THEN
      RETURN NEW;
    END IF;

    RAISE EXCEPTION
      'lessons.completed may only be set by the family or reviewed code (lesson %, goal %, role %)',
      NEW.id, NEW.curriculum_goal_id, current_user
      USING ERRCODE = 'check_violation',
            HINT = 'No signed-in family member and no service_role key. An ad-hoc statement may not mark lessons done; on 2026-09-25 one did, for 250 lessons nobody had finished. For a reviewed repair, run it in a transaction that first does: set local rooted.completion_attested = ''<ticket or reason>''. See supabase/migrations/20260928200000_lessons_completion_needs_a_person.sql.';
  END IF;

  RETURN NEW;
END;
$$;

-- The trigger itself is unchanged (BEFORE INSERT OR UPDATE OF completed).
-- Re-asserted so this file is self-contained if the trigger was ever dropped.
DROP TRIGGER IF EXISTS trg_lessons_block_server_side_completion ON public.lessons;
CREATE TRIGGER trg_lessons_block_server_side_completion
  BEFORE INSERT OR UPDATE OF completed ON public.lessons
  FOR EACH ROW EXECUTE FUNCTION public.lessons_block_server_side_completion();
