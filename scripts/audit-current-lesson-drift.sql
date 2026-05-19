-- Audit: curriculum_goals.current_lesson drift vs. lessons.
--
-- Catches the Ivy bug (May 2026): current_lesson sits BELOW
-- max(queue_position) of completed rows, so Today projects from a stale
-- counter and renders a lesson the user already finished.
--
-- After the lessons-completed trigger ships (migration
-- 20260519120000_lessons_current_lesson_trigger.sql), this should
-- return zero rows on every run. Add to the daily Curriculum
-- Scheduling Audit so a regression surfaces in the morning report
-- instead of in a support ticket.
--
-- Run from psql / Supabase SQL editor against production.

WITH goal_stats AS (
  SELECT
    g.id              AS goal_id,
    g.user_id,
    g.curriculum_name,
    g.current_lesson,
    g.start_at_lesson,
    g.total_lessons,
    (
      SELECT MAX(l.queue_position)
        FROM lessons l
        WHERE l.curriculum_goal_id = g.id
          AND l.completed = true
          AND l.queue_position IS NOT NULL
    ) AS max_qp_completed,
    (
      SELECT COUNT(*)
        FROM lessons l
        WHERE l.curriculum_goal_id = g.id
          AND l.completed = true
          AND l.queue_position IS NULL
    ) AS completed_no_qp
  FROM curriculum_goals g
  WHERE g.archived = false
)
SELECT
  goal_id,
  user_id,
  curriculum_name,
  current_lesson,
  max_qp_completed,
  (max_qp_completed - current_lesson) AS lag,
  completed_no_qp,
  start_at_lesson,
  total_lessons
FROM goal_stats
WHERE max_qp_completed IS NOT NULL
  AND current_lesson < max_qp_completed
ORDER BY (max_qp_completed - current_lesson) DESC, curriculum_name;
