-- NOT YET APPLIED. Applicable as written: the rows that blocked it are clean as
-- of 2026-09-09 and the violating count is now ZERO, archived rows included.
-- Apply by hand (Supabase MCP apply_migration or the SQL editor), then add an
-- "ALREADY APPLIED" header line the way the 2026-08 migrations carry. Per
-- CLAUDE.md ("Migrations are applied by hand, never by a deploy"), merging this
-- file changes nothing in the live database.
--
-- ============================================================================
-- A CURRICULUM'S NUMBERS HAVE TO BE POSSIBLE
-- ============================================================================
--
-- Item 6 of the 2026-09-08 queue-slot brief. The visible symptom is a goal card
-- reading "22 of 13" (ksausten, "Weather"). The invisible one is worse: the
-- Today projector emits slots current_lesson+1 .. total_lessons, so a pointer
-- at or past the end emits NOTHING and the subject silently stops appearing.
--
-- app/lib/scheduler.ts is where this is enforced for real, on the write path:
-- isStartAtLessonInRange + clampStartAtLesson (already shipped) and
-- isTotalLessonsAboveProgress (new with this brief). This constraint is the
-- backstop.
--
-- ----------------------------------------------------------------------------
-- THE BRIEF ASKED FOR `start_at_lesson <= total_lessons`. THAT IS WRONG.
-- ----------------------------------------------------------------------------
--
-- Measured on production 2026-09-09, unarchived goals:
--
--   start_at_lesson > total_lessons        34 rows
--     of which start_at_lesson = total + 1   28 rows   <-- HEALTHY
--     genuinely out of range                  6 rows
--   current_lesson  > total_lessons         3 rows
--
-- A CHECK constraint has no idea what `archived` means: VALIDATE CONSTRAINT
-- checks EVERY row in the table. So the count that actually blocks this file is
-- the one over all rows, which was 7 -- the 6 unarchived above plus 1 archived.
-- All 7 have since been cleaned; the before-state is in
-- .repair-backups/possible-numbers-7-2026-09-09-before.sql.
--
-- `start_at_lesson = total_lessons + 1` is not corruption, it is how a FINISHED
-- curriculum is encoded: you start at the lesson after the last one. Every one
-- of those 28 pairs with current_lesson = total_lessons and its rows completed
-- ("School Zone - Homeschool First Grade Workbook", 11 of 11, completed_at set;
-- "Spelling Puzzles", 45 of 45). isStartAtLessonInRange has allowed total + 1
-- deliberately since it was written. A constraint at `<= total_lessons` would
-- reject 28 healthy rows and break the path that marks a curriculum finished.
--
-- So the constraint is `start_at_lesson <= total_lessons + 1`. That left the 7
-- genuinely broken rows: 4 with total_lessons = 1 and no lesson rows at all (the
-- total was never really set), "Logic Of English" (start 81, total 40),
-- "Kindergarten" (start 175, total 170), and one archived goal. All are now
-- repaired.
--
-- ----------------------------------------------------------------------------
-- AND `current_lesson <= total_lessons` IS DELIBERATELY NOT HERE
-- ----------------------------------------------------------------------------
--
-- All 3 rows in that state are families who did MORE lessons than the total
-- says: "Weather" has 21 completed rows against a total of 13, "Kindergarten"
-- 174 against 170. current_lesson is computed by
-- recompute_curriculum_current_lesson as MAX(queue_position) over completed
-- rows, so it is a measurement of real work, not a settable field. A constraint
-- on it would make that trigger throw and block a family from completing a
-- lesson -- turning a cosmetic label into an outage.
--
-- The honest fix for those rows is the total, and that is enforced on the way
-- in by isTotalLessonsAboveProgress rather than here.
--
-- ----------------------------------------------------------------------------
-- BEFORE RUNNING: re-confirm the count is still zero
-- ----------------------------------------------------------------------------
--
--   SELECT id, curriculum_name, archived, start_at_lesson, total_lessons,
--          current_lesson,
--          (SELECT count(*) FROM lessons l WHERE l.curriculum_goal_id = g.id) AS rows
--     FROM curriculum_goals g
--    WHERE start_at_lesson > total_lessons + 1;   -- NO archived filter
--
-- Returned 0 rows on 2026-09-09. Note the missing `archived = false`: an earlier
-- draft of this header quoted the unarchived count (6) as the blocker, which
-- would have made VALIDATE fail on the 7th row.
--
-- NOT VALID + VALIDATE is still used rather than a plain ADD, so the existing
-- rows are scanned without holding an ACCESS EXCLUSIVE lock for the whole
-- check. New and updated rows are checked from the moment the first statement
-- commits.
-- ============================================================================

ALTER TABLE public.curriculum_goals
  ADD CONSTRAINT curriculum_goals_start_at_lesson_in_range
  CHECK (
    start_at_lesson IS NULL
    OR total_lessons IS NULL
    OR start_at_lesson <= total_lessons + 1
  )
  NOT VALID;

-- Fails loudly if any violating row remains, archived ones included.
ALTER TABLE public.curriculum_goals
  VALIDATE CONSTRAINT curriculum_goals_start_at_lesson_in_range;

COMMENT ON CONSTRAINT curriculum_goals_start_at_lesson_in_range ON public.curriculum_goals IS
  'Item 6, 2026-09-08 queue-slot brief. A starting position past total_lessons + 1 generates zero lessons and blanks the subject on Today. total_lessons + 1 is allowed on purpose: it is how a finished curriculum is encoded (28 live goals). current_lesson is NOT constrained here -- it is computed from completed work, so a constraint would block completions.';
