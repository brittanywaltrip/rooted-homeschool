-- READ-ONLY. Classifies every LINKED transcript course by whether its stored
-- hours_logged is provably the transcript page's own calculation.
--
-- Mirrors refreshLinkedCourseHours on main before the hours_source change:
-- completed lessons of the linked goal, minutes_spent ?? 45, round(total/60),
-- stored as `hours || null` (so NULL hours_logged means 0). Every lesson term
-- sits inside `case when l.completed`, so the LEFT JOIN's phantom row for a
-- goal with no lessons counts 0, not 45.
--
-- Classes:
--   1_current_calculation   stored = today's calculation                 -> 'calculated'
--   2_stale_calculation     stored = the calculation as of updated_at    -> 'calculated'
--   3_explained_untouched   matches only a heuristic over older lessons  -> stays NULL
--   4_app_created_batch     batch-inserted, history since rebuilt        -> stays NULL
--   5_possibly_typed        none of the above                            -> stays NULL
-- Nothing is labelled 'family' without evidence (Brittany, 2026-09-23).
--
-- It is a SNAPSHOT: each page open under the old app rewrites classes 1-2.
-- mark-proposed.sql recomputes it inside the write; never mark from old counts.

with tc as (
  select id, user_id, child_id, curriculum_goal_id as gid, hours_source,
         coalesce(hours_logged, 0) as stored, updated_at as u, created_at as c
  from public.transcript_courses where curriculum_goal_id is not null
), calc as (
  select tc.id,
    round(coalesce(sum(case when l.completed then coalesce(l.minutes_spent, 45) end), 0) / 60.0) as h_now,
    round(coalesce(sum(case when l.completed and l.completed_at <= tc.u and l.created_at <= tc.u then coalesce(l.minutes_spent, 45) end), 0) / 60.0) as h_at_u,
    round(coalesce(sum(case when l.completed and coalesce(l.updated_at, l.created_at) <= tc.u then coalesce(l.minutes_spent, 45) end), 0) / 60.0) as h_untouched,
    round(coalesce(sum(case when l.completed and l.created_at <= tc.u then coalesce(l.minutes_spent, 45) end), 0) / 60.0) as h_created_by_u,
    round(coalesce(sum(case when l.completed and l.completed_at <= tc.c and l.created_at <= tc.c then coalesce(l.minutes_spent, 45) end), 0) / 60.0) as h_at_create
  from tc left join public.lessons l on l.curriculum_goal_id = tc.gid group by tc.id
), k as (
  select tc.*, calc.h_now, calc.h_at_u, calc.h_untouched, calc.h_created_by_u, calc.h_at_create,
    (select count(*) from public.transcript_courses t2
      where t2.user_id = tc.user_id and t2.child_id = tc.child_id and t2.created_at = tc.c) as same_insert
  from tc join calc using (id)
), classified as (
  select k.*, case
      when stored = h_now then '1_current_calculation'
      when stored = h_at_u then '2_stale_calculation'
      when stored in (h_untouched, h_created_by_u, h_at_create) then '3_explained_untouched'
      when same_insert > 1 then '4_app_created_batch'
      else '5_possibly_typed' end as class
  from k
)
select class,
       case when class in ('1_current_calculation', '2_stale_calculation') then 'calculated' else 'NULL (protected)' end as proposed_marking,
       count(*) as courses, count(distinct user_id) as families, sum(stored) as stored_hours,
       count(*) filter (where hours_source is not null) as already_classified
from classified group by class order by class;
