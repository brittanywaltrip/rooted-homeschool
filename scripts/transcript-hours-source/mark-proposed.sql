-- PROPOSED ONE-TIME MARKING. A CUSTOMER-DATA WRITE. NOT APPLIED ANYWHERE.
-- Run only with Brittany's approval, only after the migration AND the app
-- release are live (see the PR's rollout order), and only after a fresh run of
-- classify.sql has been reviewed.
--
-- Writes hours_source = 'calculated' on linked courses whose stored hours are
-- the page's own calculation (classes 1 and 2), recomputed at the moment of the
-- write. Writes ONLY the marker: no hours, no credits, no updated_at.
-- Touches ONLY rows still NULL, so a course a family has edited under the new
-- app (now 'family') is never overwritten. Classes 3, 4, 5 stay NULL.
--
-- Guard: aborts if it would mark more than :max_to_mark rows. Set that from the
-- reviewed classify.sql run (classes 1 + 2), e.g. 487 on 2026-09-23.

do $$
declare
  max_to_mark constant int := 487;  -- REPLACE with the reviewed classes-1+2 count
  marked int;
begin
  with tc as (
    select id, curriculum_goal_id as gid, coalesce(hours_logged, 0) as stored, updated_at as u
    from public.transcript_courses
    where curriculum_goal_id is not null and hours_source is null
  ), calc as (
    select tc.id, tc.stored,
      round(coalesce(sum(case when l.completed then coalesce(l.minutes_spent, 45) end), 0) / 60.0) as h_now,
      round(coalesce(sum(case when l.completed and l.completed_at <= tc.u and l.created_at <= tc.u then coalesce(l.minutes_spent, 45) end), 0) / 60.0) as h_at_u
    from tc left join public.lessons l on l.curriculum_goal_id = tc.gid group by tc.id, tc.stored
  ), upd as (
    update public.transcript_courses t
       set hours_source = 'calculated'
      from calc
     where t.id = calc.id
       and t.hours_source is null
       and (calc.stored = calc.h_now or calc.stored = calc.h_at_u)
    returning t.id
  )
  select count(*) into marked from upd;

  if marked > max_to_mark then
    raise exception 'would mark % rows, more than the reviewed % ; nothing written', marked, max_to_mark;
  end if;
  raise notice 'marked % linked transcript courses calculated', marked;
end $$;
