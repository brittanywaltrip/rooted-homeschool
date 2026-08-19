-- ============================================================
-- Lesson continuations (August 19, 2026)
--
-- ALREADY APPLIED TO PRODUCTION 2026-08-19 (via Supabase MCP apply_migration).
-- Migrations in this repo do not run on deploy; see the "Migrations are
-- applied by hand" section of CLAUDE.md. Do not re-run.
--
-- A family starts Lesson 8 on Monday and does not finish it. They want
-- to work Lesson 8 again on Tuesday and have BOTH days count toward the
-- curriculum's hours and attendance, without the curriculum advancing
-- to Lesson 9.
--
-- A continuation is a new lessons row that deliberately sits OFF THE
-- QUEUE while still belonging to the goal:
--
--   curriculum_goal_id  = the same goal   (so hours + transcript pick it up)
--   lesson_number       = NULL            (stays out of the unique index
--                                          AND out of healGoalIntegrity's
--                                          dedupe, which only considers
--                                          non-null lesson numbers)
--   queue_position      = NULL            (recomputeCurrentLesson reads
--                                          MAX(queue_position) over completed
--                                          rows, so the pointer cannot move)
--   scheduled_source    = 'continuation'
--   continues_lesson_id = the parent lesson's id
--   completed           = false initially
--
-- Why the NULLs are safe against the three unique indexes on lessons.
-- Verified against the live database on 2026-08-19:
--
--   lessons_goal_lesson_number_unique  partial, WHERE lesson_number IS NOT NULL
--   lessons_goal_queue_position_uniq   partial, WHERE queue_position IS NOT NULL
--   lessons_goal_lesson_unique         NOT partial, (curriculum_goal_id, lesson_number)
--
-- The first two exclude NULL rows by predicate. The third has no
-- predicate, but indnullsnotdistinct = false on all three, so NULLs
-- compare as distinct and any number of NULL-lesson_number rows may
-- share a goal. Production already relies on this: 'extra_log' rows have
-- had a goal and a NULL lesson_number since May 2026, and several goals
-- already carry three to five such rows.
--
-- The queue resync is likewise safe with no code change.
-- reconcileGoalScheduleCache builds its rowKey as
--   (r) => r.queue_position != null ? `${goal.id}|${r.queue_position}` : null
-- and syncProjectedScheduledDates skips any row whose key is null, so a
-- continuation is never re-dated and never deleted by a resync.
--
-- ON DELETE CASCADE is deliberate. If the parent lesson is deleted its
-- continuation days go with it rather than becoming orphans pointing at
-- a row that no longer exists. There is no ON UPDATE clause because
-- lessons.id is a uuid primary key and is never rewritten.
--
-- Anti-pattern H from docs/CURRICULUM-SCHEDULING.md is in force: this
-- migration adds a column and an index and does NOT bulk-update any
-- existing lessons or curriculum_goals row.
--
-- ─── Safety check ────────────────────────────────────────────────
--
-- Should return zero rows. A pre-existing column of the same name with a
-- different type would make the ADD COLUMN IF NOT EXISTS a silent no-op.
--
--   SELECT column_name, data_type
--   FROM information_schema.columns
--   WHERE table_schema = 'public' AND table_name = 'lessons'
--     AND column_name = 'continues_lesson_id';
-- ============================================================

alter table public.lessons
  add column if not exists continues_lesson_id uuid
    references public.lessons(id) on delete cascade;

comment on column public.lessons.continues_lesson_id is
  'When set, this row is another day of work on the lesson it points at. Off-queue by design: lesson_number and queue_position are NULL so the curriculum pointer does not advance. See the migration header and resolveCustomLessonGoalLink in app/lib/scheduler.ts.';

-- Partial: only continuation rows are ever looked up by this column, and
-- they are a small minority of the table.
create index if not exists lessons_continues_lesson_id_idx
  on public.lessons (continues_lesson_id)
  where continues_lesson_id is not null;
