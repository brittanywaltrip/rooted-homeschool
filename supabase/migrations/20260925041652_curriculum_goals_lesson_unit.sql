-- What a curriculum calls its lessons, for display only.
--
-- A family asked to see Math with Confidence's own wording, "Week 12.3",
-- instead of "Lesson 47". Two nullable columns on curriculum_goals:
--
--   lesson_unit_label  one of 'lesson', 'week', 'day', 'unit', 'chapter'
--   lessons_per_unit   how many lessons make one of those units, 1 to 20
--
-- Null in both (every existing curriculum) reads exactly as before. The label
-- is computed when a lesson is shown (lib/lesson-label.ts). lessons.lesson_number,
-- queue_position, current_lesson, total_lessons and every scheduler rule are
-- untouched: lesson 47 is still lesson 47. No backfill, no lesson row written
-- (Anti-pattern H), no trigger, no function.
--
-- authenticated already holds a table-level UPDATE on curriculum_goals on both
-- projects (checked 2026-09-25), so the builder can write these with no grant.

alter table public.curriculum_goals
  add column if not exists lesson_unit_label text,
  add column if not exists lessons_per_unit smallint;

alter table public.curriculum_goals
  add constraint curriculum_goals_lesson_unit_label_check
    check (lesson_unit_label is null or lesson_unit_label in ('lesson', 'week', 'day', 'unit', 'chapter')),
  add constraint curriculum_goals_lessons_per_unit_check
    check (lessons_per_unit is null or lessons_per_unit between 1 and 20);
