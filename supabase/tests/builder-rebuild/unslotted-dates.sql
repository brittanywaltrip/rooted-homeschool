-- Synthetic-only assertions for 20261005000000 (a raised pointer keeps the
-- dates of lessons with no queue slot). Load stub.sql, live-triggers.sql and
-- all Builder migrations first. No production connection or customer ids.
create temporary table dates_checks (label text primary key);
create function pg_temp.dcheck(ok boolean, label text) returns void language plpgsql as $$
begin
  if ok is distinct from true then raise exception 'FAIL %', label; end if;
  insert into dates_checks values (label);
end $$;

-- L1 done (slot 1). L2 and L3 have no slot, no pin, no notes and a date the
-- family chose; L2 carries recorded minutes. L4 is an ordinary slotted orphan
-- once the pointer passes it, L5 is slotted with notes, L6 slotted and pinned,
-- L7 and L8 are ahead of any pointer used here.
create function pg_temp.reset_dates() returns void language plpgsql as $$
declare g constant uuid := 'aaaaaaaa-0000-4000-8000-000000000001'; u constant uuid := 'bbbbbbbb-0000-4000-8000-000000000001';
begin
  perform set_config('rooted.skip_orphan_cleanup', '', false);
  delete from rooted_private.builder_commit_log;
  delete from public.lessons; delete from public.curriculum_goals;
  insert into public.curriculum_goals(id,user_id,total_lessons,current_lesson,start_at_lesson,lessons_per_day,school_days,start_date)
  values (g,u,8,1,1,1,array['Mon','Tue','Wed','Thu','Fri','Sat','Sun'],current_date-10);
  insert into public.lessons(id,user_id,curriculum_goal_id,lesson_number,queue_position,title,scheduled_date,date,scheduled_source,completed,completed_at,minutes_spent,notes,queue_pinned)
  values
  ('dddddddd-0000-4000-8000-000000000001',u,g,1,1,'L1',current_date-10,current_date-10,'manual',true,now()-interval '10 days',30,null,false),
  ('dddddddd-0000-4000-8000-000000000002',u,g,2,null,'L2 minutes, no slot',current_date+1,current_date+1,'plan_move',false,null,20,null,false),
  ('dddddddd-0000-4000-8000-000000000003',u,g,3,null,'L3 plan move, no slot',current_date+2,current_date+2,'plan_move',false,null,null,'',false),
  ('dddddddd-0000-4000-8000-000000000004',u,g,4,4,'L4',current_date+3,current_date+3,'wizard_create',false,null,null,null,false),
  ('dddddddd-0000-4000-8000-000000000005',u,g,5,5,'L5 notes',current_date+4,current_date+4,'wizard_create',false,null,null,'parent note',false),
  ('dddddddd-0000-4000-8000-000000000006',u,g,6,6,'L6 pinned',current_date+5,current_date+5,'plan_move',false,null,null,null,true),
  ('dddddddd-0000-4000-8000-000000000007',u,g,7,7,'L7',current_date+6,current_date+6,'wizard_create',false,null,null,null,false),
  ('dddddddd-0000-4000-8000-000000000008',u,g,8,8,'L8',current_date+7,current_date+7,'wizard_create',false,null,null,null,false);
end $$;
create function pg_temp.drows() returns jsonb language sql as $$
select coalesce(jsonb_agg(jsonb_build_array(id::text,lesson_number,queue_position,completed,queue_pinned,skipped,scheduled_date::text) order by id),'[]'::jsonb) from public.lessons
$$;
-- The rows after the cleanup, with the given lesson numbers' scheduled_date cleared.
create function pg_temp.drows_clearing(nums int[]) returns jsonb language sql as $$
select jsonb_agg(case when (x->>1)::int = any(nums) then jsonb_set(x, '{6}', 'null'::jsonb) else x end order by x->>0) from jsonb_array_elements(pg_temp.drows()) x
$$;
create function pg_temp.dexpected() returns jsonb language sql as $$
select jsonb_build_object(
 'goal',(select jsonb_build_object('total_lessons',total_lessons,'current_lesson',current_lesson,'start_at_lesson',start_at_lesson,
   'lessons_per_day',lessons_per_day,'lessons_per_day_overrides',lessons_per_day_overrides,'school_days',to_jsonb(school_days),'start_date',start_date::text)
   from public.curriculum_goals),
 'rows',pg_temp.drows(),'day_start',date_trunc('day',now()),'day_end',date_trunc('day',now())+interval '1 day')
$$;
create function pg_temp.dplan() returns jsonb language sql as $$
select jsonb_build_object('unpin_ids','[]'::jsonb,'makeup_ids','[]'::jsonb,'delete_ids','[]'::jsonb,'inserts','[]'::jsonb,'redates','[]'::jsonb,'retire_above',null,'retire_keep_ids','[]'::jsonb)
$$;
create function pg_temp.dstate() returns jsonb language sql as $$
select jsonb_build_object('lessons',(select jsonb_agg(to_jsonb(l) order by id) from public.lessons l),'goal',(select to_jsonb(g) from public.curriculum_goals g))
$$;
-- A lesson row in full: date, pin, notes, minutes, source, updated_at, everything.
create function pg_temp.lesson(n int) returns jsonb language sql as $$
select to_jsonb(l) from public.lessons l where lesson_number = n
$$;

select set_config('request.jwt.claims','{"sub":"bbbbbbbb-0000-4000-8000-000000000001","role":"authenticated"}',false);
do $$
declare e jsonb; p jsonb; r jsonb; r2 jsonb; s0 jsonb; s1 jsonb; l2 jsonb; l3 jsonb; g constant uuid := 'aaaaaaaa-0000-4000-8000-000000000001';
begin
  -- 1. The trigger alone: a raised pointer releases only slotted orphans.
  perform pg_temp.reset_dates(); l2 := pg_temp.lesson(2); l3 := pg_temp.lesson(3);
  update public.curriculum_goals set current_lesson = 6 where id = g;
  perform pg_temp.dcheck(pg_temp.lesson(2) = l2, 'trigger: unslotted lesson with minutes is untouched (date, pin, notes, minutes, updated_at)');
  perform pg_temp.dcheck(pg_temp.lesson(3) = l3, 'trigger: unslotted plan-move lesson is untouched');
  perform pg_temp.dcheck((select scheduled_date is null and date = current_date + 3 and queue_position = 4 and not completed from public.lessons where lesson_number = 4),
    'trigger: slotted orphan still released (scheduled_date cleared, date and slot kept, not completed)');
  perform pg_temp.dcheck((select scheduled_date = current_date + 4 from public.lessons where lesson_number = 5), 'trigger: slotted lesson with notes keeps its date');
  perform pg_temp.dcheck((select scheduled_date = current_date + 5 and queue_pinned from public.lessons where lesson_number = 6), 'trigger: pinned slotted lesson keeps its date');
  perform pg_temp.dcheck((select count(*) = 2 from public.lessons where lesson_number in (7, 8) and scheduled_date is not null), 'trigger: lessons ahead of the pointer untouched');

  -- 2. Builder raises the starting lesson (start 7, pointer 6) with the new prediction.
  perform pg_temp.reset_dates(); l2 := pg_temp.lesson(2); l3 := pg_temp.lesson(3);
  e := pg_temp.dexpected() || jsonb_build_object('current_lesson_after', 6, 'rows_after_settings', pg_temp.drows_clearing(array[4]));
  r := public.apply_builder_rebuild(g, current_date, e, pg_temp.dplan(), jsonb_build_object('start_at_lesson', 7));
  perform pg_temp.dcheck(r->>'status' = 'applied' and (r->>'settings_applied')::boolean, 'builder: raised start applies with the slotted-only prediction');
  perform pg_temp.dcheck((select current_lesson = 6 and start_at_lesson = 7 from public.curriculum_goals), 'builder: start and pointer written');
  perform pg_temp.dcheck(pg_temp.lesson(2) = l2 and pg_temp.lesson(3) = l3, 'builder: unslotted lessons byte-identical after the save');
  perform pg_temp.dcheck((select scheduled_date is null from public.lessons where lesson_number = 4), 'builder: slotted orphan released as before');

  -- 3. The old prediction (unslotted dates cleared too) is stale and writes nothing.
  perform pg_temp.reset_dates(); s0 := pg_temp.dstate();
  e := pg_temp.dexpected() || jsonb_build_object('current_lesson_after', 6, 'rows_after_settings', pg_temp.drows_clearing(array[2, 3, 4]));
  r := public.apply_builder_rebuild(g, current_date, e, pg_temp.dplan(), jsonb_build_object('start_at_lesson', 7));
  perform pg_temp.dcheck(r->>'status' = 'stale' and r->>'reason' = 'rooted_rebuild_stale_settings', 'old-client prediction is reported stale');
  perform pg_temp.dcheck(pg_temp.dstate() = s0, 'stale save leaves settings, pointer and lessons unchanged');

  -- 4. A refused save with a raised start rolls back the settings, the pointer and the cleanup.
  perform pg_temp.reset_dates(); s0 := pg_temp.dstate();
  e := pg_temp.dexpected() || jsonb_build_object('current_lesson_after', 6, 'rows_after_settings', pg_temp.drows_clearing(array[4]));
  p := pg_temp.dplan() || jsonb_build_object('redates', jsonb_build_array(jsonb_build_object('id', 'dddddddd-0000-4000-8000-000000000007', 'to', (current_date + 1)::text)));
  r := public.apply_builder_rebuild(g, current_date, e, p, jsonb_build_object('start_at_lesson', 7));
  perform pg_temp.dcheck(r->>'status' = 'refused', 'a redate onto the unslotted lesson''s full day is refused');
  perform pg_temp.dcheck(pg_temp.dstate() = s0, 'refusal leaves settings, pointer and every lesson unchanged');

  -- 5. Retry: the identical call after a lost response replays, writes nothing more.
  perform pg_temp.reset_dates(); l2 := pg_temp.lesson(2); l3 := pg_temp.lesson(3);
  e := pg_temp.dexpected() || jsonb_build_object('current_lesson_after', 6, 'rows_after_settings', pg_temp.drows_clearing(array[4]));
  p := pg_temp.dplan() || jsonb_build_object('request_id', 'eeeeeeee-0000-4000-8000-000000000001');
  r := public.apply_builder_rebuild(g, current_date, e, p, jsonb_build_object('start_at_lesson', 7));
  s1 := pg_temp.dstate();
  r2 := public.apply_builder_rebuild(g, current_date, e, p, jsonb_build_object('start_at_lesson', 7));
  perform pg_temp.dcheck(r->>'status' = 'applied' and (r2->>'replayed')::boolean and (r2 - 'replayed') = r, 'retry returns the first outcome');
  perform pg_temp.dcheck(pg_temp.dstate() = s1 and pg_temp.lesson(2) = l2 and pg_temp.lesson(3) = l3, 'retry writes nothing; unslotted lessons still identical');
  -- The same plan re-sent with a new request id is judged afresh: stale.
  r2 := public.apply_builder_rebuild(g, current_date, e, pg_temp.dplan() || jsonb_build_object('request_id', 'eeeeeeee-0000-4000-8000-000000000002'), jsonb_build_object('start_at_lesson', 7));
  perform pg_temp.dcheck(r2->>'status' = 'stale' and pg_temp.dstate() = s1, 'a fresh request on the old plan is stale and writes nothing');

  -- 6. Ordinary slotted scheduling with settings still applies.
  perform pg_temp.reset_dates();
  e := pg_temp.dexpected() || jsonb_build_object('current_lesson_after', 1, 'rows_after_settings', pg_temp.drows());
  p := pg_temp.dplan() || jsonb_build_object('redates', jsonb_build_array(
         jsonb_build_object('id', 'dddddddd-0000-4000-8000-000000000008', 'to', (current_date + 6)::text)));
  r := public.apply_builder_rebuild(g, current_date, e, p, jsonb_build_object('lessons_per_day', 2));
  perform pg_temp.dcheck(r->>'status' = 'applied' and (select count(*) = 2 from public.lessons where scheduled_date = current_date + 6), 'slotted redate with a pace change applies');
end $$;

-- 7. The unslotted snapshot is taken before the settings write: a side effect
-- of that write on an unslotted lesson fails the save and rolls it all back.
create function pg_temp.touch_on_pointer() returns trigger language plpgsql as $$
begin
  update public.lessons set notes = 'side effect' where lesson_number = 2;
  return null;
end $$;
-- Only when the pointer rises (the settings write), not when seeding recomputes it.
create trigger dates_side_effect after update of current_lesson on public.curriculum_goals for each row
  when (new.current_lesson > old.current_lesson) execute function pg_temp.touch_on_pointer();
do $$
declare e jsonb; r jsonb; s0 jsonb; g constant uuid := 'aaaaaaaa-0000-4000-8000-000000000001';
begin
  perform pg_temp.reset_dates(); s0 := pg_temp.dstate();
  e := pg_temp.dexpected() || jsonb_build_object('current_lesson_after', 6, 'rows_after_settings', pg_temp.drows_clearing(array[4]));
  r := public.apply_builder_rebuild(g, current_date, e, pg_temp.dplan(), jsonb_build_object('start_at_lesson', 7));
  perform pg_temp.dcheck(r->>'status' = 'failed' and r->>'reason' = 'rooted_rebuild_unslotted_changed', 'a settings-write side effect on an unslotted lesson fails the save');
  perform pg_temp.dcheck(pg_temp.dstate() = s0, 'that failure rolls back settings, pointer and lessons');
end $$;
drop trigger dates_side_effect on public.curriculum_goals;
