-- Partial unique index on curriculum_goals to prevent duplicate active
-- goals per (user, child, curriculum_name).
--
-- Backstory: the 2026-05-22 audit found 23 users with 29 extra goal
-- rows, 1,157 attached lessons, 475 of which were completed. The dups
-- were created in two ways:
--
--   1) Double-click on Save (rare; the in-flight gate in the Schedule
--      Builder closes this).
--   2) Same user opens the Builder in two tabs or comes back later and
--      adds the same row again (common; the seconds-to-minutes-apart
--      pattern in the audit).
--
-- The Schedule Builder now does a pre-insert duplicate check, but the
-- DB needs to be authoritative so a future bug or a SQL-direct write
-- can't recreate the mess. Predicate matches the Builder's load query
-- (archived = false AND completed_at IS NULL) so a user who finishes a
-- curriculum can start the same one fresh next school year.
--
-- Case-insensitive on curriculum_name so "Sonlight" and "sonlight"
-- collide.
--
-- This migration ASSERTS that no current duplicates exist before
-- creating the index. Existing dupes are being cleaned up out-of-band
-- via SQL; the migration will refuse to deploy until that cleanup is
-- done, instead of silently archiving live data on its way through.

DO $$
DECLARE
  dup_count integer;
  dup_sample text;
BEGIN
  SELECT
    count(*),
    string_agg(
      format(
        '(user_id=%s, child_id=%s, name=%I, n=%s)',
        user_id, child_id, curriculum_name, n
      ),
      E'\n  ' ORDER BY n DESC
    )
  INTO dup_count, dup_sample
  FROM (
    SELECT
      user_id,
      child_id,
      curriculum_name,
      count(*) AS n
    FROM curriculum_goals
    WHERE archived = false
      AND completed_at IS NULL
    GROUP BY user_id, child_id, lower(curriculum_name), curriculum_name
    HAVING count(*) > 1
  ) dups;

  IF dup_count > 0 THEN
    RAISE EXCEPTION
      'Cannot create curriculum_goals_user_child_name_active_uidx: % duplicate (user, child, name) groups remain. Clean up first.\n  %',
      dup_count, dup_sample;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS curriculum_goals_user_child_name_active_uidx
  ON curriculum_goals (user_id, child_id, lower(curriculum_name))
  WHERE archived = false AND completed_at IS NULL;
