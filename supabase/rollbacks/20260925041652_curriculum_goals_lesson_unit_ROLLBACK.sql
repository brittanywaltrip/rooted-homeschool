-- Rollback for curriculum_goals_lesson_unit.
--
-- Roll back the APP first. An app that selects these columns fails its
-- curriculum reads once they are gone; an app that does not know them ignores
-- them. Dropping them deletes every family's chosen wording (display only: no
-- lesson, date or completion depends on it).

alter table public.curriculum_goals
  drop constraint if exists curriculum_goals_lessons_per_unit_check,
  drop constraint if exists curriculum_goals_lesson_unit_label_check;

alter table public.curriculum_goals
  drop column if exists lessons_per_unit,
  drop column if exists lesson_unit_label;
