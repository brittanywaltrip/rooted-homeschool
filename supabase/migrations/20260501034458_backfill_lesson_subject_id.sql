-- One-time backfill: set lessons.subject_id where it's currently NULL but
-- the related curriculum_goal.subject_label has a case-insensitive match
-- to an existing subjects row for the same user.
--
-- Background: ~6% of production lessons (4,523 of 74,412 as of 2026-04-30)
-- have subject_id = NULL while their curriculum_goal.subject_label IS
-- populated. The Today / Plan loaders read subjects(name) via the
-- subject_id join and historically had no fallback, so 1,730 lessons
-- across 17 users displayed under the "Untitled" bucket.
--
-- The accompanying code change (lib/lesson-subject.ts + every lesson read
-- site) handles the NULL case at runtime by falling back to
-- curriculum_goals.subject_label. This migration is opportunistic
-- cleanup so the underlying data matches what the UI will now show.
--
-- IMPORTANT: this migration does NOT create new subjects rows. If a
-- curriculum_goal.subject_label has no match in the user's subjects
-- table (different spelling, never created), subject_id stays NULL and
-- the runtime fallback handles display. Creating subjects rows here
-- would silently grow the user's subject picker with values they didn't
-- choose.
--
-- Idempotent: re-running this migration is a no-op. Only updates
-- lessons that are still subject_id NULL AND have a matching subjects
-- row, so subsequent runs find zero matches.

BEGIN;

DO $$
DECLARE
  before_count integer;
  after_count integer;
  fixed_count integer;
BEGIN
  SELECT COUNT(*) INTO before_count FROM lessons WHERE subject_id IS NULL;
  RAISE NOTICE 'lessons with NULL subject_id BEFORE backfill: %', before_count;

  -- Match by (user_id, lower(name) = lower(subject_label)). The
  -- curriculum_goal carries user_id; we scope the subjects lookup to that
  -- same user so we never assign a subject from one user's catalog to
  -- another user's lesson.
  UPDATE lessons l
  SET subject_id = s.id
  FROM curriculum_goals cg
  JOIN subjects s
    ON s.user_id = cg.user_id
   AND LOWER(s.name) = LOWER(cg.subject_label)
  WHERE l.curriculum_goal_id = cg.id
    AND l.subject_id IS NULL
    AND cg.subject_label IS NOT NULL
    AND TRIM(cg.subject_label) <> '';

  SELECT COUNT(*) INTO after_count FROM lessons WHERE subject_id IS NULL;
  fixed_count := before_count - after_count;
  RAISE NOTICE 'lessons with NULL subject_id AFTER backfill:  %', after_count;
  RAISE NOTICE 'rows fixed: %', fixed_count;
  RAISE NOTICE 'remaining NULL subject_id rows are either: orphaned curriculum_goal_id, NULL or empty subject_label, or subject_label has no matching subjects row for that user — all handled at runtime by resolveLessonSubject().';
END $$;

COMMIT;
