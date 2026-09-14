-- ============================================================
-- APPLIED 2026-09-14. Applied by hand to the live database at 8:40 AM, before
-- this file landed. This file is the record of that change, not an
-- instruction: do not re-run it (CLAUDE.md, "Migrations are applied by hand").
-- The `if not exists` makes a re-run a no-op anyway.
--
-- lessons.skipped: the family tapped Skip, meaning "we are not doing this
-- lesson, move on". Not "not today", which is Reschedule.
--
-- Before this column Skip wrote scheduled_date = null and nothing else. The
-- row was still an ordinary unpinned, incomplete queue row, so the next Today
-- load's reconciler (syncProjectedScheduledDates) gave it back the projector's
-- date for its (goal, queue_position) and the lesson reappeared on Plan,
-- usually on the same day. See Invariant 22 in docs/CURRICULUM-SCHEDULING.md.
--
-- A skipped row keeps its title, number, notes and queue_position. The
-- projector steps over its slot, the reconciler and the Today self-heal never
-- touch it, and it never counts as done: recompute_curriculum_current_lesson
-- reads completed rows only and is unchanged.
--
-- No backfill, deliberately. Verified read-only on 2026-09-14: 10,047 incomplete,
-- non-backfill rows across 402 active goals have scheduled_date IS NULL and a
-- lesson_number above the goal's current_lesson. Some are old skips that came
-- back, some are rows the builder never dated, and nothing in the data tells
-- the two apart. They are left exactly as they are.
-- ============================================================

alter table public.lessons
  add column if not exists skipped boolean not null default false;
