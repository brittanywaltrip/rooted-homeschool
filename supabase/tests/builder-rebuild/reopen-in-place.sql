-- Synthetic-only assertions for 20261006000000 (reopening a lesson with no
-- queue slot restores it exactly). Load stub.sql and the Builder migrations
-- (which define reopen_lesson) first. No production connection or customer ids.
create temporary table reopen_checks (label text primary key);
create function pg_temp.rcheck(ok boolean, label text) returns void language plpgsql as $$
begin
  if ok is distinct from true then raise exception 'FAIL %', label; end if;
  insert into reopen_checks values (label);
end $$;
create function pg_temp.reset_reopen_in_place() returns void language plpgsql as $$
declare g constant uuid := 'aaaaaaaa-0000-4000-8000-000000000001'; u constant uuid := 'bbbbbbbb-0000-4000-8000-000000000001';
begin
  delete from public.lessons; delete from public.curriculum_goals;
  insert into public.curriculum_goals(id,user_id,total_lessons,current_lesson,start_at_lesson,lessons_per_day,school_days,start_date)
  values (g,u,10,3,4,1,array['Mon','Tue','Wed','Thu','Fri','Sat','Sun'],current_date-10);
  insert into public.lessons(id,user_id,curriculum_goal_id,lesson_number,queue_position,title,scheduled_date,date,scheduled_source,completed,completed_at,minutes_spent,notes,queue_pinned,is_backfill)
  values
  -- Unslotted, pinned, a plan move, completed in place today.
  ('ffffffff-0000-4000-8000-000000000001',u,g,2,null,'L2',current_date,current_date-1,'plan_move',true,now(),20,'parent note',true,true),
  -- Unslotted, unpinned, completed in place on its own past day.
  ('ffffffff-0000-4000-8000-000000000002',u,g,3,null,'L3',current_date-2,current_date-2,'continuation',true,(current_date-2)::timestamptz + interval '12 hours',null,null,false,false),
  -- Queue lessons: slot 1 behind the pointer, slot 5 ahead of it.
  ('ffffffff-0000-4000-8000-000000000003',u,g,1,1,'L1',current_date-3,current_date-3,'completion_today',true,now()-interval '3 days',30,null,false,false),
  ('ffffffff-0000-4000-8000-000000000005',u,g,5,5,'L5',current_date,current_date,'completion_today',true,now(),30,null,false,false);
end $$;
create function pg_temp.row_of(n int) returns jsonb language sql as $$ select to_jsonb(l) - 'updated_at' from public.lessons l where lesson_number = n $$;

select set_config('request.jwt.claims','{"sub":"bbbbbbbb-0000-4000-8000-000000000001","role":"authenticated"}',false);
do $$
declare r jsonb; before jsonb; after jsonb;
begin
  perform pg_temp.reset_reopen_in_place();
  before := pg_temp.row_of(2);
  r := public.reopen_lesson('ffffffff-0000-4000-8000-000000000001', current_date);
  after := pg_temp.row_of(2);
  perform pg_temp.rcheck(r->>'status' = 'requeued' and (r->>'in_place')::boolean, 'unslotted reopen reports requeued, in place (old clients read success)');
  perform pg_temp.rcheck(after = (before || '{"completed": false, "completed_at": null}'::jsonb), 'unslotted pinned lesson: only the completion comes off (dates, pin, source, backfill, notes, minutes kept)');
  perform pg_temp.rcheck(after->'queue_position' = 'null'::jsonb, 'never given a queue slot');

  before := pg_temp.row_of(3);
  r := public.reopen_lesson('ffffffff-0000-4000-8000-000000000002', current_date);
  perform pg_temp.rcheck(pg_temp.row_of(3) = (before || '{"completed": false, "completed_at": null}'::jsonb), 'unslotted past-dated continuation: keeps its own day and source');

  -- Queue lessons keep the existing rules.
  r := public.reopen_lesson('ffffffff-0000-4000-8000-000000000003', current_date);
  perform pg_temp.rcheck(r->>'status' = 'made_up' and (select queue_pinned and scheduled_source = 'reopened' and scheduled_date = current_date and queue_position = 1 from public.lessons where lesson_number = 1), 'queue lesson behind the pointer still becomes a make-up');
  r := public.reopen_lesson('ffffffff-0000-4000-8000-000000000005', current_date);
  perform pg_temp.rcheck(r->>'status' = 'requeued' and r->'in_place' is null and (select scheduled_source = 'manual_uncomplete' and not completed from public.lessons where lesson_number = 5), 'queue lesson ahead of the pointer is still requeued the usual way');
  r := public.reopen_lesson('ffffffff-0000-4000-8000-000000000001', current_date);
  perform pg_temp.rcheck(r->>'status' = 'not_completed', 'reopening an unfinished lesson changes nothing');
end $$;
