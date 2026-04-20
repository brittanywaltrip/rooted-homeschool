-- ============================================================
-- Scheduler integrity — prevent future gaps, duplicates, ghost
-- completions. Does NOT rewrite existing bad rows; a human will
-- run a separate cleanup pass. The partial unique index is safe
-- against legacy NULL-lesson_number rows because it excludes them.
-- ============================================================

-- Prevent duplicate (goal, lesson_number) pairs going forward.
-- Partial index: skip rows where either column is null (legacy data).
create unique index if not exists ux_lessons_goal_lesson_number
  on public.lessons (curriculum_goal_id, lesson_number)
  where curriculum_goal_id is not null and lesson_number is not null;

-- Enforce: completed=true ⇒ completed_at is not null.
-- NOT VALID so existing ghost rows don't block the migration; human cleanup
-- will backfill, then we can VALIDATE later.
alter table public.lessons
  drop constraint if exists lessons_completed_has_timestamp;
alter table public.lessons
  add constraint lessons_completed_has_timestamp
  check (completed = false or completed_at is not null)
  not valid;
