-- READ-ONLY inventory of the lessons falsely marked done by the integrity
-- routine's auto-heal on 2026-09-25 (250 rows), 2026-09-26 (2) and 2026-09-27 (7).
-- Safe to run against production: one SELECT, no writes.
--
-- The scheduled task's statement wrote exactly three columns on every row:
--   completed = true, completed_at = 2026-09-24 15:11:35.834303+00 (now() - 1 day),
--   queue_position = NULL.
-- It did not touch dates, pins, sources, notes, hours or any other row. So an
-- exact undo is those three columns, and the only fact the undo has to supply
-- is the queue slot the statement erased.
--
-- One row per affected lesson. Columns that decide the recovery:
--   untouched         the row is exactly as the statement left it (updated_at
--                     equals the statement's timestamp)
--   goal_later_work   the family completed, back-dated or edited a real lesson
--                     in this curriculum after the statement ran
--   slot_provable     the curriculum is otherwise in book order
--                     (queue_position = lesson_number on every slotted row) and
--                     slot lesson_number is free, so the erased slot must have
--                     been lesson_number
--   slot_by_elimination  the curriculum was reordered (so lesson_number
--                     proves nothing) but it has exactly one empty slot and
--                     exactly one affected row without a slot: eliminated_slot
--   hidden_if_undone  unpinned, no scheduled_date, behind the pointer: an exact
--                     undo puts it back where no screen shows it
--   action            see docs/RECOVERY-PLAN-false-completions-2026-09-25.md
-- The same routine ran the statement three times. Each run stamped
-- completed_at = its own time - 1 day, and updated_at = its own time.
with runs(run_date, t, fp) as (values
  ('2026-09-25', '2026-09-25 15:11:35.834303+00'::timestamptz, '2026-09-24 15:11:35.834303+00'::timestamptz),
  ('2026-09-26', '2026-09-26 15:01:51.917494+00'::timestamptz, '2026-09-25 15:01:51.917494+00'::timestamptz),
  ('2026-09-27', '2026-09-27 15:02:34.471527+00'::timestamptz, '2026-09-26 15:02:34.471527+00'::timestamptz)
),
first_run as (select min(t) as t from runs),
f as (
  select l.*, g.current_lesson, g.start_at_lesson, g.archived as goal_archived,
         g.curriculum_name, c.name as child_name, runs.run_date, runs.t as run_t, runs.fp as run_fp
    from public.lessons l
    join runs on l.completed_at = runs.fp
    join public.curriculum_goals g on g.id = l.curriculum_goal_id
    left join public.children c on c.id = g.child_id
   where l.completed
),
goal as (
  select g.id,
    (select max(x.queue_position) from public.lessons x
      where x.curriculum_goal_id = g.id and x.completed
        and x.completed_at not in (select fp from runs)) as max_real_done_slot,
    exists (select 1 from public.lessons x, first_run
             where x.curriculum_goal_id = g.id and x.completed
               and x.completed_at not in (select fp from runs)
               and (x.completed_at > first_run.t or x.created_at > first_run.t or x.updated_at > first_run.t)) as later_work,
    exists (select 1 from public.lessons x
             where x.curriculum_goal_id = g.id and x.queue_position is not null
               and x.queue_position <> x.lesson_number) as drifted,
    -- Empty slots from 1 to the highest slot in use, and how many of this
    -- goal's affected rows have no slot. One of each means the empty slot is
    -- the one the statement erased.
    (select array_agg(s order by s) from generate_series(1,
        (select coalesce(max(x.queue_position), 0) from public.lessons x where x.curriculum_goal_id = g.id)) s
      where not exists (select 1 from public.lessons x where x.curriculum_goal_id = g.id and x.queue_position = s)) as holes,
    (select count(*) from f where f.curriculum_goal_id = g.id and f.queue_position is null) as unslotted_affected
    from public.curriculum_goals g
   where g.id in (select curriculum_goal_id from f)
),
r as (
  select f.run_date, f.run_t, f.run_fp, f.id as lesson_id, f.user_id, f.curriculum_goal_id, f.child_name, f.curriculum_name,
         f.lesson_number, f.queue_position, f.queue_pinned, f.scheduled_date, f.date,
         f.hours, f.minutes_spent, f.current_lesson, f.start_at_lesson, f.goal_archived,
         goal.max_real_done_slot, goal.later_work as goal_later_work, goal.drifted as goal_drifted,
         f.updated_at = f.run_t as untouched,
         (coalesce(f.hours, 0) > 0 or coalesce(f.minutes_spent, 0) > 0) as carries_time,
         exists (select 1 from public.lessons x
                  where x.curriculum_goal_id = f.curriculum_goal_id and x.lesson_number is null
                    and x.completed and x.title ~* ('Lesson ' || f.lesson_number || '\M')
                    and x.created_at > f.run_t) as relogged_as_extra,
         (not goal.drifted and not exists (select 1 from public.lessons x
            where x.curriculum_goal_id = f.curriculum_goal_id and x.queue_position = f.lesson_number)) as slot_provable,
         (goal.drifted and f.queue_position is null and goal.unslotted_affected = 1
            and coalesce(array_length(goal.holes, 1), 0) = 1) as slot_by_elimination,
         case when goal.drifted and f.queue_position is null and goal.unslotted_affected = 1
                   and coalesce(array_length(goal.holes, 1), 0) = 1 then goal.holes[1] end as eliminated_slot,
         (not f.queue_pinned and f.scheduled_date is null) as hidden_if_undone,
         (f.lesson_number < coalesce(f.start_at_lesson, 1)) as before_start_at
    from f join goal on goal.id = f.curriculum_goal_id
)
select r.*,
  case
    when not untouched          then 'HOLD_family_acted_on_row'
    when carries_time           then 'HOLD_carries_time'
    when relogged_as_extra      then 'HOLD_relogged_as_extra'
    when goal_archived          then 'UNDO_archived'
    when slot_provable          then 'UNDO_restore_slot'
    when slot_by_elimination    then 'UNDO_restore_only_hole_SIGNOFF'
    else                             'REVIEW_slot_ambiguous'
  end as action,
  -- Where an exact undo would leave the lesson invisible, and the family had
  -- not chosen to start past it, it is a candidate to surface as missed.
  (hidden_if_undone and not before_start_at) as surface_candidate
from r
order by user_id, curriculum_goal_id, lesson_number;
