-- Synthetic-only assertions for 20261001000000 (settings and lessons commit
-- together). Load stub.sql, all Builder migrations and unslotted.sql first.
-- No production connection or customer ids.
create temporary table atomic_checks (label text primary key);
create function pg_temp.check(ok boolean, label text) returns void language plpgsql as $$
begin
  if ok is distinct from true then raise exception 'FAIL %', label; end if;
  insert into atomic_checks values (label);
end $$;

-- The production triggers a settings write can fire (copied from the live
-- definitions): the empty school_days guard and the orphan cleanup that runs
-- when current_lesson rises.
create function public.enforce_curriculum_school_days_nonempty() returns trigger language plpgsql as $$
begin
  if new.school_days is null or cardinality(new.school_days) = 0 then new.school_days := array['Mon','Tue','Wed','Thu','Fri']; end if;
  return new;
end $$;
create trigger curriculum_goals_school_days_guard before insert or update on public.curriculum_goals
  for each row execute function public.enforce_curriculum_school_days_nonempty();
create function public.curriculum_goals_cleanup_orphans_trg() returns trigger language plpgsql as $$
begin
  if current_setting('rooted.skip_orphan_cleanup', true) = 'true' then return new; end if;
  if new.current_lesson > old.current_lesson then
    perform set_config('rooted.skip_orphan_cleanup', 'true', true);
    update public.lessons set scheduled_date = null
     where curriculum_goal_id = new.id and completed = false and scheduled_date is not null and queue_pinned = false
       and lesson_number is not null and lesson_number <= new.current_lesson and (notes is null or notes = '');
  end if;
  return new;
end $$;
create trigger trg_curriculum_goals_cleanup_orphans after update of current_lesson on public.curriculum_goals
  for each row when (new.current_lesson is distinct from old.current_lesson) execute function public.curriculum_goals_cleanup_orphans_trg();

-- Six lessons: 1 done (slot 1), 2 unslotted pinned past, 3..6 forward slots 3..6.
create function pg_temp.reset_atomic() returns void language plpgsql as $$
begin
  perform set_config('rooted.skip_orphan_cleanup', '', false);
  delete from rooted_private.builder_commit_log;
  delete from public.lessons; delete from public.curriculum_goals;
  insert into public.curriculum_goals(id,user_id,total_lessons,current_lesson,start_at_lesson,lessons_per_day,school_days,start_date)
  values ('aaaaaaaa-0000-4000-8000-000000000001','bbbbbbbb-0000-4000-8000-000000000001',6,1,1,1,array['Mon','Tue','Wed','Thu','Fri','Sat','Sun'],current_date-10);
  insert into public.lessons(id,user_id,curriculum_goal_id,lesson_number,queue_position,title,scheduled_date,date,scheduled_source,completed,completed_at,minutes_spent,notes,queue_pinned)
  values
  ('cccccccc-0000-4000-8000-000000000001','bbbbbbbb-0000-4000-8000-000000000001','aaaaaaaa-0000-4000-8000-000000000001',1,1,'Done',current_date-10,current_date-10,'manual',true,now()-interval '10 days',30,'parent note',false),
  ('cccccccc-0000-4000-8000-000000000002','bbbbbbbb-0000-4000-8000-000000000001','aaaaaaaa-0000-4000-8000-000000000001',2,null,'Unslotted pin',current_date-5,current_date-5,'cleanup_sql',false,null,null,null,true),
  ('cccccccc-0000-4000-8000-000000000003','bbbbbbbb-0000-4000-8000-000000000001','aaaaaaaa-0000-4000-8000-000000000001',3,3,'L3',current_date+1,current_date+1,'wizard_create',false,null,null,null,false),
  ('cccccccc-0000-4000-8000-000000000004','bbbbbbbb-0000-4000-8000-000000000001','aaaaaaaa-0000-4000-8000-000000000001',4,4,'L4',current_date+2,current_date+2,'wizard_create',false,null,null,null,false),
  ('cccccccc-0000-4000-8000-000000000005','bbbbbbbb-0000-4000-8000-000000000001','aaaaaaaa-0000-4000-8000-000000000001',5,5,'L5',current_date+3,current_date+3,'wizard_create',false,null,null,null,false),
  ('cccccccc-0000-4000-8000-000000000006','bbbbbbbb-0000-4000-8000-000000000001','aaaaaaaa-0000-4000-8000-000000000001',6,6,'L6',current_date+4,current_date+4,'wizard_create',false,null,null,null,false);
end $$;
create function pg_temp.rows_now() returns jsonb language sql as $$
select coalesce(jsonb_agg(jsonb_build_array(id::text,lesson_number,queue_position,completed,queue_pinned,skipped,scheduled_date::text) order by id),'[]'::jsonb) from public.lessons
$$;
create function pg_temp.expected_now() returns jsonb language sql as $$
select jsonb_build_object(
 'goal',(select jsonb_build_object('total_lessons',total_lessons,'current_lesson',current_lesson,'start_at_lesson',start_at_lesson,
   'lessons_per_day',lessons_per_day,'lessons_per_day_overrides',lessons_per_day_overrides,'school_days',to_jsonb(school_days),'start_date',start_date::text)
   from public.curriculum_goals),
 'rows',pg_temp.rows_now(),'day_start',date_trunc('day',now()),'day_end',date_trunc('day',now())+interval '1 day')
$$;
create function pg_temp.empty_plan() returns jsonb language sql as $$
select jsonb_build_object('unpin_ids','[]'::jsonb,'makeup_ids','[]'::jsonb,'delete_ids','[]'::jsonb,'inserts','[]'::jsonb,'redates','[]'::jsonb,'retire_above',null,'retire_keep_ids','[]'::jsonb)
$$;
-- Redate L5 and L6 onto tomorrow (alongside L3), which needs 3 a day.
create function pg_temp.pack_plan() returns jsonb language sql as $$
select pg_temp.empty_plan() || jsonb_build_object('redates', jsonb_build_array(
  jsonb_build_object('id','cccccccc-0000-4000-8000-000000000004','to',(current_date+1)::text),
  jsonb_build_object('id','cccccccc-0000-4000-8000-000000000005','to',(current_date+1)::text)))
$$;
-- Callers built for this flow pass settings as the fifth argument.
create function pg_temp.rebuild(g uuid, d date, e jsonb, p jsonb) returns jsonb language sql as $$
select public.apply_builder_rebuild(g, d, e, p - 'goal_settings', p -> 'goal_settings')
$$;
create function pg_temp.state() returns jsonb language sql as $$
select jsonb_build_object('lessons',(select jsonb_agg(to_jsonb(l) order by id) from public.lessons l),'goal',(select to_jsonb(g) from public.curriculum_goals g))
$$;

select set_config('request.jwt.claims','{"sub":"bbbbbbbb-0000-4000-8000-000000000001","role":"authenticated"}',false);
do $$
declare e jsonb; p jsonb; r jsonb; r2 jsonb; s0 jsonb; s1 jsonb; g constant uuid := 'aaaaaaaa-0000-4000-8000-000000000001';
begin
  -- 1. Settings and lessons commit together; capacity is judged on the NEW pace.
  perform pg_temp.reset_atomic(); e := pg_temp.expected_now();
  e := e || jsonb_build_object('current_lesson_after', 1, 'rows_after_settings', pg_temp.rows_now());
  p := pg_temp.pack_plan() || jsonb_build_object('goal_settings', jsonb_build_object('lessons_per_day', 3, 'school_days', jsonb_build_array('Mon','Tue','Wed','Thu','Fri','Sat','Sun')));
  r := pg_temp.rebuild(g, current_date, e, p);
  perform pg_temp.check(r->>'status' = 'applied' and (r->>'settings_applied')::boolean, 'settings and lessons applied together');
  perform pg_temp.check((select lessons_per_day = 3 from public.curriculum_goals), 'new pace written');
  perform pg_temp.check((select count(*) = 3 from public.lessons where scheduled_date = current_date + 1 and not completed), 'lessons packed under the new pace');

  -- 2. The same plan with the OLD pace is refused, and nothing is written.
  perform pg_temp.reset_atomic(); s0 := pg_temp.state(); e := pg_temp.expected_now();
  r := pg_temp.rebuild(g, current_date, e, pg_temp.pack_plan());
  perform pg_temp.check(r->>'status' = 'refused', 'overcapacity without the pace change is refused');
  -- A pace too small for the plan refuses settings and lessons together.
  e := e || jsonb_build_object('current_lesson_after', 1, 'rows_after_settings', pg_temp.rows_now());
  r := pg_temp.rebuild(g, current_date, e, pg_temp.pack_plan() || jsonb_build_object('goal_settings', jsonb_build_object('lessons_per_day', 2, 'total_lessons', 8)));
  perform pg_temp.check(r->>'status' = 'refused', 'refused rebuild with settings');
  perform pg_temp.check(pg_temp.state() = s0, 'refusal rolls back settings and lessons');

  -- 3. Settings-only save (no lesson changes) commits atomically.
  perform pg_temp.reset_atomic(); e := pg_temp.expected_now() || jsonb_build_object('current_lesson_after', 1, 'rows_after_settings', pg_temp.rows_now());
  r := pg_temp.rebuild(g, current_date, e, pg_temp.empty_plan() || jsonb_build_object('goal_settings', jsonb_build_object('start_date', null, 'lessons_per_day_overrides', jsonb_build_object('Sat', 0))));
  perform pg_temp.check(r->>'status' = 'applied', 'settings-only save applied');
  perform pg_temp.check((select start_date is null and lessons_per_day_overrides = '{"Sat":0}'::jsonb from public.curriculum_goals), 'settings-only values written');

  -- 4. Concurrent parent work: notes land on a row the plan deletes.
  perform pg_temp.reset_atomic(); e := pg_temp.expected_now() || jsonb_build_object('current_lesson_after', 1, 'rows_after_settings', pg_temp.rows_now());
  update public.lessons set notes = 'parent wrote this meanwhile' where lesson_number = 6;
  s0 := pg_temp.state();
  r := pg_temp.rebuild(g, current_date, e, pg_temp.empty_plan()
        || jsonb_build_object('delete_ids', jsonb_build_array('cccccccc-0000-4000-8000-000000000006'), 'goal_settings', jsonb_build_object('total_lessons', 5)));
  perform pg_temp.check(r->>'status' = 'stale' and r->>'reason' = 'delete_rows', 'parent notes refuse the delete');
  perform pg_temp.check(pg_temp.state() = s0, 'parent-work refusal leaves settings and lessons as they were');
  -- A completion in another tab changes the rows the plan was made from.
  perform pg_temp.reset_atomic(); e := pg_temp.expected_now() || jsonb_build_object('current_lesson_after', 1, 'rows_after_settings', pg_temp.rows_now());
  update public.lessons set completed = true, completed_at = now() where lesson_number = 3;
  s0 := pg_temp.state();
  r := pg_temp.rebuild(g, current_date, e, pg_temp.empty_plan() || jsonb_build_object('goal_settings', jsonb_build_object('lessons_per_day', 2)));
  perform pg_temp.check(r->>'status' = 'stale', 'completion in another tab makes the plan stale');
  perform pg_temp.check(pg_temp.state() = s0, 'stale plan writes no settings');
  -- Settings changed in another tab since the plan was read.
  perform pg_temp.reset_atomic(); e := pg_temp.expected_now() || jsonb_build_object('current_lesson_after', 1, 'rows_after_settings', pg_temp.rows_now());
  update public.curriculum_goals set lessons_per_day = 4;
  s0 := pg_temp.state();
  r := pg_temp.rebuild(g, current_date, e, pg_temp.empty_plan() || jsonb_build_object('goal_settings', jsonb_build_object('lessons_per_day', 2)));
  perform pg_temp.check(r->>'status' = 'stale' and r->>'reason' = 'goal', 'other-tab settings change is stale');
  perform pg_temp.check(pg_temp.state() = s0, 'the other tab''s settings stand');

  -- 5. A raised starting point moves the pointer and runs the orphan cleanup.
  perform pg_temp.reset_atomic(); e := pg_temp.expected_now();
  s0 := pg_temp.state();
  -- start_at_lesson 4: pointer 3; cleanup unschedules L3 (unpinned, no notes).
  r := pg_temp.rebuild(g, current_date, e || jsonb_build_object('current_lesson_after', 3, 'rows_after_settings', pg_temp.rows_now()),
        pg_temp.empty_plan() || jsonb_build_object('goal_settings', jsonb_build_object('start_at_lesson', 4)));
  perform pg_temp.check(r->>'status' = 'stale' and r->>'reason' = 'rooted_rebuild_stale_settings', 'an unpredicted cleanup is a stale plan');
  perform pg_temp.check(pg_temp.state() = s0, 'the cleanup and settings roll back together');
  r := pg_temp.rebuild(g, current_date, e || jsonb_build_object('current_lesson_after', 3,
        'rows_after_settings', (select jsonb_agg(case when x->>0 = 'cccccccc-0000-4000-8000-000000000003' then jsonb_set(x, '{6}', 'null'::jsonb) else x end) from jsonb_array_elements(pg_temp.rows_now()) x)),
        pg_temp.empty_plan() || jsonb_build_object('goal_settings', jsonb_build_object('start_at_lesson', 4)));
  perform pg_temp.check(r->>'status' = 'applied', 'a predicted cleanup applies');
  perform pg_temp.check((select current_lesson = 3 and start_at_lesson = 4 from public.curriculum_goals), 'pointer recomputed by the database rule');
  r := pg_temp.rebuild(g, current_date, pg_temp.expected_now() || jsonb_build_object('current_lesson_after', 9, 'rows_after_settings', pg_temp.rows_now()),
        pg_temp.empty_plan() || jsonb_build_object('goal_settings', jsonb_build_object('start_at_lesson', 5)));
  perform pg_temp.check(r->>'status' = 'stale' and r->>'reason' = 'pointer', 'a wrong pointer expectation is stale');

  -- 6. Invalid settings write nothing.
  perform pg_temp.reset_atomic(); s0 := pg_temp.state(); e := pg_temp.expected_now() || jsonb_build_object('current_lesson_after', 1, 'rows_after_settings', pg_temp.rows_now());
  foreach p in array array[
    jsonb_build_object('current_lesson', 9), jsonb_build_object('school_days', '[]'::jsonb), jsonb_build_object('school_days', jsonb_build_array('Funday')),
    jsonb_build_object('total_lessons', 0), jsonb_build_object('lessons_per_day', 1.5), jsonb_build_object('lessons_per_day_overrides', jsonb_build_object('Mon', -1)),
    jsonb_build_object('start_date', 'tomorrow'), '"not an object"'::jsonb] loop
    r := pg_temp.rebuild(g, current_date, e, pg_temp.empty_plan() || jsonb_build_object('goal_settings', p));
    perform pg_temp.check(r->>'status' = 'invalid' and r->>'reason' = 'goal_settings', 'invalid settings refused: ' || p::text);
  end loop;
  perform pg_temp.check(pg_temp.state() = s0, 'invalid settings write nothing');

  -- 7. A lost response: re-sending the identical call returns the logged outcome.
  perform pg_temp.reset_atomic(); e := pg_temp.expected_now() || jsonb_build_object('current_lesson_after', 1, 'rows_after_settings', pg_temp.rows_now());
  p := pg_temp.pack_plan() || jsonb_build_object('goal_settings', jsonb_build_object('lessons_per_day', 3), 'request_id', 'dddddddd-0000-4000-8000-000000000001');
  r := pg_temp.rebuild(g, current_date, e, p);
  s1 := pg_temp.state();
  r2 := pg_temp.rebuild(g, current_date, e, p);
  perform pg_temp.check(r->>'status' = 'applied' and (r2->>'replayed')::boolean and (r2 - 'replayed') = r, 'identical retry returns the first outcome');
  perform pg_temp.check(pg_temp.state() = s1, 'the retry writes nothing more');
  r2 := pg_temp.rebuild(g, current_date, e, pg_temp.empty_plan() || jsonb_build_object('request_id', 'not-a-uuid'));
  perform pg_temp.check(r2->>'reason' = 'request_id', 'malformed request id refused');
  -- A refused attempt is not logged, so its retry is judged afresh.
  perform pg_temp.reset_atomic(); e := pg_temp.expected_now();
  p := pg_temp.pack_plan() || jsonb_build_object('request_id', 'dddddddd-0000-4000-8000-000000000002');
  r := pg_temp.rebuild(g, current_date, e, p);
  perform pg_temp.check(r->>'status' = 'refused' and not exists (select 1 from rooted_private.builder_commit_log), 'refusals are not logged');

  -- 8. #137 protections hold with settings in the same call.
  perform pg_temp.reset_atomic(); s0 := pg_temp.state(); e := pg_temp.expected_now() || jsonb_build_object('current_lesson_after', 1, 'rows_after_settings', pg_temp.rows_now());
  foreach p in array array[
    pg_temp.empty_plan() || jsonb_build_object('delete_ids', jsonb_build_array('cccccccc-0000-4000-8000-000000000002')),
    pg_temp.empty_plan() || jsonb_build_object('unpin_ids', jsonb_build_array('cccccccc-0000-4000-8000-000000000002')),
    pg_temp.empty_plan() || jsonb_build_object('redates', jsonb_build_array(jsonb_build_object('id','cccccccc-0000-4000-8000-000000000002','to',(current_date+1)::text)))] loop
    r := pg_temp.rebuild(g, current_date, e, p || jsonb_build_object('goal_settings', jsonb_build_object('lessons_per_day', 2)));
    perform pg_temp.check(r->>'status' = 'stale', 'unslotted row protected with settings: ' || (select string_agg(k, ',') from jsonb_object_keys(p) k where jsonb_array_length(case when jsonb_typeof(p->k) = 'array' then p->k else '[]'::jsonb end) > 0));
  end loop;
  -- Shortening below the unslotted row keeps it.
  r := pg_temp.rebuild(g, current_date, e, pg_temp.empty_plan() || jsonb_build_object('retire_above', 1, 'goal_settings', jsonb_build_object('total_lessons', 1)));
  perform pg_temp.check(r->>'status' = 'applied' and exists (select 1 from public.lessons where lesson_number = 2), 'shortening with settings keeps the unslotted row');
  perform pg_temp.check((select total_lessons = 1 from public.curriculum_goals), 'shortened total written with the retirement');
  perform pg_temp.check((select (to_jsonb(l) - 'updated_at') = ((s0->'lessons'->1) - 'updated_at') from public.lessons l where lesson_number = 2), 'unslotted row unchanged by the shortening');
end $$;

-- 9. A trigger side effect on an unslotted row rolls back settings too.
create function pg_temp.touch_unslotted() returns trigger language plpgsql as $$
begin
  update public.lessons set notes = 'side effect' where lesson_number = 2 and new.lesson_number <> 2;
  return null;
end $$;
create trigger atomic_side_effect after update of scheduled_date on public.lessons for each row execute function pg_temp.touch_unslotted();
do $$
declare e jsonb; r jsonb; s0 jsonb; g constant uuid := 'aaaaaaaa-0000-4000-8000-000000000001';
begin
  perform pg_temp.reset_atomic(); s0 := pg_temp.state();
  e := pg_temp.expected_now() || jsonb_build_object('current_lesson_after', 1, 'rows_after_settings', pg_temp.rows_now());
  r := pg_temp.rebuild(g, current_date, e, pg_temp.pack_plan() || jsonb_build_object('goal_settings', jsonb_build_object('lessons_per_day', 3)));
  perform pg_temp.check(r->>'status' = 'failed' and r->>'reason' = 'rooted_rebuild_unslotted_changed', 'side effect on an unslotted row fails the save');
  perform pg_temp.check(pg_temp.state() = s0, 'side-effect failure rolls back settings and lessons');
end $$;

drop trigger atomic_side_effect on public.lessons;

-- 10. The four-argument form never writes settings, even if a plan carries them.
do $$
declare e jsonb; r jsonb; g constant uuid := 'aaaaaaaa-0000-4000-8000-000000000001';
begin
  perform pg_temp.reset_atomic(); e := pg_temp.expected_now();
  r := public.apply_builder_rebuild(g, current_date, e, pg_temp.empty_plan() || jsonb_build_object('goal_settings', jsonb_build_object('lessons_per_day', 5)));
  perform pg_temp.check(r->>'status' = 'applied' and not (r->>'settings_applied')::boolean, 'four-argument form ignores settings');
  perform pg_temp.check((select lessons_per_day = 1 from public.curriculum_goals), 'four-argument form leaves the pace alone');
end $$;
