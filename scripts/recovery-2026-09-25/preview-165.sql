-- READ-ONLY production preview for the first recovery batch: the 165
-- UNDO_restore_slot rows (curriculum otherwise in book order, slot provably
-- lesson_number). One SELECT, no writes. Excludes the 13 inferred-slot rows
-- (held for sign-off), the 29 archived, the 37 ambiguous and the 6 the family
-- touched.
--
-- Part 1 is the per-row before/after. Part 2 is the checks that must all be 0
-- (or equal the stated numbers) on the day of the write; the apply aborts on
-- the same conditions.
with run as (
  select '2026-09-25 15:11:35.834303+00'::timestamptz as t,
         '2026-09-24 15:11:35.834303+00'::timestamptz as fp
),
f as (
  select l.*, g.current_lesson, g.start_at_lesson, g.total_lessons, g.archived as goal_archived,
         g.curriculum_name, c.name as child_name
    from public.lessons l
    join public.curriculum_goals g on g.id = l.curriculum_goal_id
    left join public.children c on c.id = g.child_id, run
   where l.completed and l.completed_at = run.fp
),
t as (
  select f.* from f, run
   where f.updated_at = run.t
     and coalesce(f.hours, 0) = 0 and coalesce(f.minutes_spent, 0) = 0
     and not f.goal_archived
     and not exists (select 1 from public.lessons x where x.curriculum_goal_id = f.curriculum_goal_id
                      and x.queue_position is not null and x.queue_position <> x.lesson_number)
     and not exists (select 1 from public.lessons x where x.curriculum_goal_id = f.curriculum_goal_id
                      and x.queue_position = f.lesson_number)
     and not exists (select 1 from public.lessons x where x.curriculum_goal_id = f.curriculum_goal_id
                      and x.lesson_number is null and x.completed
                      and x.title ~* ('Lesson ' || f.lesson_number || '\M') and x.created_at > run.t)
)
-- Part 1: per row
select t.user_id, u.email, t.child_name, t.curriculum_name, t.curriculum_goal_id, t.id as lesson_id,
       t.lesson_number, t.start_at_lesson, t.current_lesson,
       'completed=true completed_at=' || t.completed_at || ' queue_position=NULL' as before,
       'completed=false completed_at=NULL queue_position=' || t.lesson_number as after,
       t.queue_pinned, t.scheduled_date, t.scheduled_source,
       case
         when t.queue_pinned and t.scheduled_date >= current_date then 'A make-up due today or later: on Today that day, and on Plan'
         when t.queue_pinned and t.scheduled_date <  current_date then 'B pinned, past date: back on Plan as unfinished on that day'
         when not t.queue_pinned and t.scheduled_date is null and t.lesson_number < coalesce(t.start_at_lesson, 1) then 'C hidden: before the starting lesson'
         when not t.queue_pinned and t.scheduled_date is null then 'D hidden behind the pointer: surface candidate'
         else 'E unpinned with a past date: on Plan, not Today'
       end as after_undo,
       exists (select 1 from public.lessons x, run where x.curriculum_goal_id = t.curriculum_goal_id
                and x.completed and x.completed_at <> run.fp
                and (x.completed_at > run.t or x.created_at > run.t or x.updated_at > run.t)) as goal_has_later_parent_work
  from t left join auth.users u on u.id = t.user_id
 order by u.email, t.curriculum_name, t.lesson_number;

-- Part 2: checks (run as a separate statement; replace Part 1's final SELECT)
-- target_rows = 165, goals = 88, families = 25
-- rows already holding a slot = 0; duplicate targets = 0; slot beyond total = 0
-- rows ahead of the pointer = 0
-- pointers that would move = 0, where predicted =
--   LEAST(GREATEST(start_at_lesson - 1, MAX(slot of completed rows not in the
--   batch)), total_lessons), exactly what recompute_curriculum_current_lesson
--   computes
-- goals with later parent work = 23 (28 lessons); none of those lessons is in
--   the batch, and the apply md5-compares every non-batch lesson in these 88
--   curricula before and after.
