-- ============================================================================
-- PROPOSAL — NOT RUN. Needs Brittany's sign-off before anyone executes it.
--
-- Drift E residue: 6 incomplete lessons attached to a curriculum goal with no
-- queue slot (lesson_number IS NULL AND queue_position IS NULL). Today hydrates
-- rows by (goal_id, queue_position) and separately by `curriculum_goal_id IS
-- NULL` for one-offs, so these fall through both queries: they render on the
-- Plan calendar and then never appear on Today when their day arrives.
--
-- Matches the contract the code now enforces (resolveCustomLessonGoalLink in
-- app/lib/scheduler.ts): an incomplete lesson may not be attached to a goal
-- without a queue slot, so these become standalone one-offs. It does NOT
-- auto-assign a lesson number, because on 4 of the 6 goals the queue is already
-- full (max(lesson_number) = total_lessons) and the Schedule Builder's phase-2
-- cleanup deletes incomplete rows above total_lessons — an auto-assigned row
-- would be destroyed on that goal's next save.
--
-- Nothing visible is lost: AddLessonModal bakes the subject into the title as
-- "Subject · Title", so the pill reads the same, and these rows keep their
-- child_id, date, notes and minutes.
--
-- Deliberately NOT touched: the 39 COMPLETED rows with a goal and no slot.
-- "Log an extra lesson" writes those on purpose (scheduled_source='extra_log')
-- so an extra does not advance current_lesson. They are history, not plans, and
-- detaching them would orphan real completions from their curriculum.
--
-- Deletes nothing. Touches one column on 6 rows. Cannot affect plan_type /
-- is_pro / subscription_status.
--
-- The 6 rows as of 2026-07-30:
--   47349630  2026-05-26  Writing Practice   "Writing · Writing a page of one sentence"
--   3cfea590  2026-05-26  English            "Language Arts"
--   189b3b01  2026-06-01  Logic of English   "English"
--   38ddf439  2026-07-06  Ocean Unit         "Jelly fish · Jellyfish Sparkly Jellyfish Cup Lanterns"
--   328b30b5  2026-07-06  Ocean Unit         "Seahorses · Seahorse Art Activity"
--   2713ee71  2026-07-09  H&S Grammar        "Language Arts · 40"
-- ============================================================================


-- ─── STEP 1. Backup ─────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.backup_drift_e_slotless_20260730 AS
SELECT l.*, NOW() AS backed_up_at
FROM public.lessons l
WHERE l.curriculum_goal_id IS NOT NULL
  AND l.lesson_number IS NULL
  AND l.queue_position IS NULL
  AND l.completed = false;

-- Expect 6. If it has grown, the code fix may not be deployed yet — stop and
-- check before continuing.
SELECT count(*) AS backed_up FROM public.backup_drift_e_slotless_20260730;


-- ─── STEP 2. Dry run — review ───────────────────────────────────────────────

SELECT l.id::text,
       l.created_at::date AS created,
       l.scheduled_source,
       l.title,
       l.scheduled_date,
       l.date,
       l.child_id::text,
       l.notes IS NOT NULL AS has_notes,
       g.curriculum_name,
       g.total_lessons,
       (SELECT max(x.lesson_number) FROM public.lessons x
          WHERE x.curriculum_goal_id = l.curriculum_goal_id) AS goal_max_lesson_number,
       CASE
         WHEN (SELECT max(x.lesson_number) FROM public.lessons x
                 WHERE x.curriculum_goal_id = l.curriculum_goal_id) >= g.total_lessons
         THEN 'queue full — no slot available'
         ELSE 'queue has room, but standalone is still the contract'
       END AS why_standalone
FROM public.lessons l
JOIN public.curriculum_goals g ON g.id = l.curriculum_goal_id
WHERE l.lesson_number IS NULL
  AND l.queue_position IS NULL
  AND l.completed = false
ORDER BY l.created_at;

-- Confirm the completed off-queue rows are NOT in scope (expect 39-ish, and
-- step 3 must not touch any of them).
SELECT count(*) AS completed_offqueue_rows_left_alone
FROM public.lessons
WHERE curriculum_goal_id IS NOT NULL
  AND lesson_number IS NULL
  AND queue_position IS NULL
  AND completed = true;


-- ─── STEP 3. The fix ────────────────────────────────────────────────────────
-- Detach from the goal so Today's one-off query picks the row up.
--
-- scheduled_source is left as-is on purpose. Invariant 10 governs writes to
-- lessons.date, and this statement does not touch date or scheduled_date — the
-- existing source ('extra_log' / 'plan_move') stays the truthful record of what
-- last placed the row on its day.
--
-- WRAP IN A TRANSACTION and check the count before COMMIT:
--   BEGIN;
--     <the UPDATE below>
--     -- expect 6; if not, ROLLBACK and re-read step 2
--   COMMIT;   -- or ROLLBACK;

UPDATE public.lessons
   SET curriculum_goal_id = NULL
 WHERE curriculum_goal_id IS NOT NULL
   AND lesson_number IS NULL
   AND queue_position IS NULL
   AND completed = false;


-- ─── STEP 4. Verify ─────────────────────────────────────────────────────────

-- Must be 0: no incomplete row is attached to a goal without a slot.
SELECT count(*) AS remaining_unreachable
FROM public.lessons
WHERE curriculum_goal_id IS NOT NULL
  AND lesson_number IS NULL
  AND queue_position IS NULL
  AND completed = false;

-- Must be 0: nothing else about these rows changed, and none were deleted.
SELECT count(*) AS damaged_rows
FROM public.backup_drift_e_slotless_20260730 b
LEFT JOIN public.lessons l ON l.id = b.id
WHERE l.id IS NULL
   OR l.title IS DISTINCT FROM b.title
   OR l.child_id IS DISTINCT FROM b.child_id
   OR l.scheduled_date IS DISTINCT FROM b.scheduled_date
   OR l.date IS DISTINCT FROM b.date
   OR l.notes IS DISTINCT FROM b.notes
   OR l.completed IS DISTINCT FROM b.completed
   OR l.minutes_spent IS DISTINCT FROM b.minutes_spent;


-- ─── STEP 5. Undo, if needed ────────────────────────────────────────────────
--
-- UPDATE public.lessons l
--    SET curriculum_goal_id = b.curriculum_goal_id
--   FROM public.backup_drift_e_slotless_20260730 b
--  WHERE l.id = b.id;


-- ─── STEP 6. Drop the backup ────────────────────────────────────────────────
-- Only once the affected families confirm the activities show on Today.
--
-- DROP TABLE public.backup_drift_e_slotless_20260730;
