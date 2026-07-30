-- ============================================================================
-- EXECUTED 2026-07-30. HISTORICAL RECORD — do not run again.
--
-- The residue this script targets was cleaned directly against production on
-- the night of 2026-07-30 (~470 rows), using the same filter as step 2/3 below:
--   completed = true AND queue_position IS NULL
--   AND (scheduled_date > completed_at::date OR date > completed_at::date)
--
-- Re-verified after the fact by running step 2's dry run verbatim: 0 rows,
-- 0 goals, 0 users. The trigger fix (migration 20260730100000) stops new rows
-- entering this state, so the count should stay at zero; if it ever climbs
-- again, that migration is the first thing to check against the LIVE function
-- body (anti-pattern J).
--
-- Kept in the repo as the record of what was run and why, and as the shape to
-- reuse if a related residue ever needs clearing. The steps below are left
-- exactly as written so the filter, the backup, and the verification queries
-- are all auditable.
--
-- One-time cleanup of the residue left by curriculum_goals_cleanup_orphans_trg
-- before migration 20260730100000. The trigger auto-completed orphan rows but
-- left their scheduled_date / date caches on future school days, so those rows
-- kept rendering on the Plan calendar (MonthGrid reads `scheduled_date ?? date`)
-- on days the live queue also owned. kierrak745's TPT goal showed two lessons
-- per day for seven school days that way. The trigger is fixed going forward;
-- this script only cleans rows already written.
--
-- This is a script and not a migration on purpose: CLAUDE.md anti-pattern H
-- forbids bulk lesson UPDATEs in migrations, because a migration runs in every
-- environment at deploy time and rewrites real families' data with no review.
-- Anti-pattern H prescribes exactly this shape instead — backup table, dry run,
-- explicit sign-off.
--
-- SCOPE, measured against production on 2026-07-30:
--     520 rows, 81 goals, 29 users
--     519 of 520 carry a future scheduled_date; all 520 carry a future `date`
--     completed_at days span 2026-05-18 .. 2026-07-07
--     furthest future cache: 2027-05-18
--     kierrak745's goal d7791c72 is already hand-corrected: 0 rows, no-op
--
-- It NEVER deletes a lessons or curriculum_goals row. It touches two cache
-- columns on rows that are already completed. It does not touch completed,
-- completed_at, queue_position, lesson_number, notes, or anything on
-- curriculum_goals. It cannot change plan_type / is_pro / subscription_status.
--
-- Run each step separately and read the output before continuing.
-- ============================================================================


-- ─── STEP 1. Backup ─────────────────────────────────────────────────────────
-- Full row copy of everything step 3 will touch, so any surprise is one INSERT
-- ... SELECT away from being undone (see step 5).

CREATE TABLE IF NOT EXISTS public.backup_orphan_future_caches_20260730 AS
SELECT l.*, NOW() AS backed_up_at
FROM public.lessons l
WHERE l.completed = true
  AND l.queue_position IS NULL
  AND l.completed_at IS NOT NULL
  AND (l.scheduled_date > l.completed_at::date OR l.date > l.completed_at::date);

-- Expect 520 as of 2026-07-30. If this number has grown a lot, stop: the
-- trigger fix may not be live, and the source of new rows needs finding first.
SELECT count(*) AS backed_up FROM public.backup_orphan_future_caches_20260730;


-- ─── STEP 2. Dry run — per-goal review ──────────────────────────────────────
-- What changes, grouped the way Brittany reviews it. Nothing is written here.

WITH affected AS (
  SELECT l.id, l.curriculum_goal_id, l.user_id, l.lesson_number,
         l.scheduled_date, l.date, l.completed_at::date AS completed_day
  FROM public.lessons l
  WHERE l.completed = true
    AND l.queue_position IS NULL
    AND l.completed_at IS NOT NULL
    AND (l.scheduled_date > l.completed_at::date OR l.date > l.completed_at::date)
)
SELECT a.curriculum_goal_id::text                     AS goal_id,
       g.curriculum_name,
       g.current_lesson,
       g.total_lessons,
       count(*)                                       AS affected_rows,
       min(a.lesson_number)                           AS lowest_lesson,
       max(a.lesson_number)                           AS highest_lesson,
       min(a.completed_day)                           AS completed_day,
       min(COALESCE(a.scheduled_date, a.date))        AS earliest_future_cache,
       max(COALESCE(a.scheduled_date, a.date))        AS latest_future_cache
FROM affected a
LEFT JOIN public.curriculum_goals g ON g.id = a.curriculum_goal_id
GROUP BY a.curriculum_goal_id, g.curriculum_name, g.current_lesson, g.total_lessons
ORDER BY affected_rows DESC, goal_id;

-- Totals, for the one-line sanity check against the backup count.
WITH affected AS (
  SELECT l.id, l.curriculum_goal_id, l.user_id
  FROM public.lessons l
  WHERE l.completed = true
    AND l.queue_position IS NULL
    AND l.completed_at IS NOT NULL
    AND (l.scheduled_date > l.completed_at::date OR l.date > l.completed_at::date)
)
SELECT count(*)                             AS total_rows,
       count(DISTINCT curriculum_goal_id)   AS goals,
       count(DISTINCT user_id)              AS users
FROM affected;


-- ─── STEP 3. The fix ────────────────────────────────────────────────────────
-- Clear the calendar slot and pin `date` to the day the row was completed.
-- Mirrors exactly what the fixed trigger now writes for new orphans:
--   scheduled_date = NULL      (no calendar slot; `date` is NOT NULL so it
--   date = completed_at::date   keeps a value, the real completion day)
--
-- scheduled_source is stamped 'cleanup_sql' per Invariant 10 so this pass is
-- identifiable in any later investigation.
--
-- WRAP IN A TRANSACTION and check the row count before COMMIT:
--   BEGIN;
--     <the UPDATE below>
--     -- expect 520; if it is wildly different, ROLLBACK and re-read step 2
--   COMMIT;   -- or ROLLBACK;

UPDATE public.lessons l
   SET scheduled_date   = NULL,
       date             = l.completed_at::date,
       scheduled_source = 'cleanup_sql'
 WHERE l.completed = true
   AND l.queue_position IS NULL
   AND l.completed_at IS NOT NULL
   AND (l.scheduled_date > l.completed_at::date OR l.date > l.completed_at::date);


-- ─── STEP 4. Verify ─────────────────────────────────────────────────────────
-- Both must return 0.

SELECT count(*) AS remaining_future_caches
FROM public.lessons
WHERE completed = true
  AND queue_position IS NULL
  AND completed_at IS NOT NULL
  AND (scheduled_date > completed_at::date OR date > completed_at::date);

-- No row the script touched may have lost its completion or its history.
SELECT count(*) AS damaged_rows
FROM public.backup_orphan_future_caches_20260730 b
JOIN public.lessons l ON l.id = b.id
WHERE l.completed IS DISTINCT FROM b.completed
   OR l.completed_at IS DISTINCT FROM b.completed_at
   OR l.lesson_number IS DISTINCT FROM b.lesson_number
   OR l.notes IS DISTINCT FROM b.notes;

-- Spot-check the drift-B overcapacity count per goal-day afterwards using the
-- existing daily integrity check rather than a bespoke query here.


-- ─── STEP 5. Undo, if needed ────────────────────────────────────────────────
-- Restores only the two cache columns and the source, from the backup.
--
-- UPDATE public.lessons l
--    SET scheduled_date   = b.scheduled_date,
--        date             = b.date,
--        scheduled_source = b.scheduled_source
--   FROM public.backup_orphan_future_caches_20260730 b
--  WHERE l.id = b.id;


-- ─── STEP 6. Drop the backup ────────────────────────────────────────────────
-- Only after the next morning's automated audit reports 0 affected goals.
--
-- DROP TABLE public.backup_orphan_future_caches_20260730;
