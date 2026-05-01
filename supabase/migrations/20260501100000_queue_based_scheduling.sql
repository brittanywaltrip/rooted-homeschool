-- ============================================================
-- Queue-based curriculum scheduling (Path A)
--
-- Today / Plan no longer treat lessons.scheduled_date as the source of
-- truth for what to render. They project from curriculum_goals.current_lesson
-- + lessons_per_day + school_days. scheduled_date stays as a cache so
-- legacy reads keep working during rollover.
--
-- This migration is intentionally minimal. The column and most logic
-- already exist in the codebase:
--   - curriculum_goals.current_lesson exists (NOT NULL DEFAULT 0)
--   - app/lib/scheduler.ts already exposes recomputeCurrentLesson()
--   - the unique (curriculum_goal_id, lesson_number) index already exists
--     via 20260419000000_lessons_scheduler_integrity.sql
--
-- What's new here:
--   1. A composite index for the completion-history queries the new
--      catch-up flow + recomputeCurrentLesson run repeatedly.
--   2. profiles.last_catchup_dismissed_at to gate the "did you do any
--      lessons since [date]" modal once mom dismisses it.
--   3. A safety-only backfill of current_lesson from completed lesson rows.
--      A no-op for healthy goals, but flushes any drift before the read
--      side switches to trusting current_lesson.
-- ============================================================

-- 1. New composite index for completion history lookups.
create index if not exists idx_lessons_goal_completed
  on public.lessons (curriculum_goal_id, completed_at)
  where curriculum_goal_id is not null;

-- 2. Catch-up modal dismissal timestamp on profiles.
alter table public.profiles
  add column if not exists last_catchup_dismissed_at timestamptz;

-- 3. Safety backfill: recompute current_lesson from actual completed rows
--    so no goal's current_lesson is stale when reads switch over.
--    This mirrors recomputeCurrentLesson()'s formula:
--      current_lesson = max(start_at_lesson - 1, max(completed lesson_number), 0)
--    capped at total_lessons.
update public.curriculum_goals g
set current_lesson = least(
  g.total_lessons,
  greatest(
    coalesce(g.start_at_lesson, 1) - 1,
    coalesce(sub.max_done, 0)
  )
)
from (
  select curriculum_goal_id, max(lesson_number) as max_done
  from public.lessons
  where completed = true
    and lesson_number is not null
  group by curriculum_goal_id
) sub
where g.id = sub.curriculum_goal_id;
