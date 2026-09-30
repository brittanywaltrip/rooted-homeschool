-- Synthetic-only PostgreSQL assertions. Load stub.sql and all Builder migrations first.
-- Runs in one session; no production connection or customer ids.
create temporary table unslotted_checks (label text primary key);
create function pg_temp.assert_ok(ok boolean, label text) returns void language plpgsql as $$
begin
  if ok is distinct from true then raise exception 'FAIL %', label; end if;
  insert into unslotted_checks values (label);
end $$;
create function pg_temp.reset_unslotted() returns void language plpgsql as $$
begin
  delete from public.lessons; delete from public.curriculum_goals;
  insert into public.curriculum_goals(id,user_id,total_lessons,current_lesson,start_at_lesson,lessons_per_day,school_days,start_date)
  values ('aaaaaaaa-0000-4000-8000-000000000001','bbbbbbbb-0000-4000-8000-000000000001',4,1,2,1,array['Mon','Tue','Wed','Thu','Fri','Sat','Sun'],current_date-10);
  insert into public.lessons(id,user_id,curriculum_goal_id,lesson_number,queue_position,title,scheduled_date,date,scheduled_source,completed,completed_at,minutes_spent,notes,queue_pinned)
  values
  ('cccccccc-0000-4000-8000-000000000001','bbbbbbbb-0000-4000-8000-000000000001','aaaaaaaa-0000-4000-8000-000000000001',1,1,'Parent work',current_date-10,current_date-10,'manual',true,now()-interval '10 days',30,'parent note',false),
  ('cccccccc-0000-4000-8000-000000000002','bbbbbbbb-0000-4000-8000-000000000001','aaaaaaaa-0000-4000-8000-000000000001',2,null,'Unslotted past pin',current_date-5,current_date-5,'cleanup_sql',false,null,null,null,true),
  ('cccccccc-0000-4000-8000-000000000003','bbbbbbbb-0000-4000-8000-000000000001','aaaaaaaa-0000-4000-8000-000000000001',3,3,'Forward',current_date+1,current_date+1,'wizard_create',false,null,null,null,false),
  ('cccccccc-0000-4000-8000-000000000004','bbbbbbbb-0000-4000-8000-000000000001','aaaaaaaa-0000-4000-8000-000000000001',4,null,'Unslotted hidden',null,current_date-5,'cleanup_sql',false,null,null,null,false);
end $$;
create function pg_temp.unslotted_expected() returns jsonb language sql as $$
select jsonb_build_object(
 'goal',(select jsonb_build_object('total_lessons',total_lessons,'current_lesson',current_lesson,'start_at_lesson',start_at_lesson,
 'lessons_per_day',lessons_per_day,'lessons_per_day_overrides',lessons_per_day_overrides,'school_days',to_jsonb(school_days),'start_date',start_date::text)
 from public.curriculum_goals where id='aaaaaaaa-0000-4000-8000-000000000001'),
 'rows',(select jsonb_agg(jsonb_build_array(id::text,lesson_number,queue_position,completed,queue_pinned,skipped,scheduled_date::text) order by id) from public.lessons),
 'day_start',date_trunc('day',now()),'day_end',date_trunc('day',now())+interval '1 day')
$$;
create function pg_temp.unslotted_plan() returns jsonb language sql as $$
select jsonb_build_object('unpin_ids','[]'::jsonb,'makeup_ids','[]'::jsonb,
 'delete_ids',jsonb_build_array('cccccccc-0000-4000-8000-000000000003'),
 'inserts',jsonb_build_array(jsonb_build_object('lesson_number',3,'queue_position',3,'title','Forward','scheduled_date',(current_date+1)::text,'scheduled_source','wizard_create','completed',false,'hours',0)),
 'redates','[]'::jsonb,'retire_above',4,'retire_keep_ids','[]'::jsonb)
$$;
create function pg_temp.unslotted_state() returns jsonb language sql as $$
select jsonb_build_object('lessons',(select jsonb_agg(to_jsonb(l) order by id) from public.lessons l),'goals',(select jsonb_agg(to_jsonb(g) order by id) from public.curriculum_goals g))
$$;

select set_config('request.jwt.claims','{"sub":"bbbbbbbb-0000-4000-8000-000000000001","role":"authenticated"}',false);
do $$
declare e jsonb; p jsonb; r jsonb; before_state jsonb; protected jsonb; mode text;
begin
  foreach mode in array array['past pin','hidden','future pin','zero minutes'] loop
    perform pg_temp.reset_unslotted();
    if mode='hidden' then update public.lessons set scheduled_date=null,queue_pinned=false where lesson_number=2; end if;
    if mode='future pin' then update public.lessons set scheduled_date=current_date+3,date=current_date+3 where lesson_number=2; end if;
    if mode='zero minutes' then update public.lessons set minutes_spent=0 where lesson_number=2; end if;
    select jsonb_agg(to_jsonb(l) order by id) into protected from public.lessons l where lesson_number<>3;
    e:=pg_temp.unslotted_expected(); p:=pg_temp.unslotted_plan();
    r:=public.apply_builder_rebuild('aaaaaaaa-0000-4000-8000-000000000001',current_date,e,p);
    perform pg_temp.assert_ok(r->>'status'='applied','clean rebuild: '||mode);
    perform pg_temp.assert_ok(protected=(select jsonb_agg(to_jsonb(l) order by id) from public.lessons l where lesson_number<>3),'whole rows and parent work preserved: '||mode);
    perform pg_temp.assert_ok((select current_lesson=1 from public.curriculum_goals),'pointer preserved: '||mode);
    r:=public.apply_builder_rebuild('aaaaaaaa-0000-4000-8000-000000000001',current_date,e,p);
    perform pg_temp.assert_ok(r->>'status'='stale','repeat old plan refused: '||mode);
  end loop;
  foreach mode in array array['delete','unpin','redate'] loop
    perform pg_temp.reset_unslotted(); e:=pg_temp.unslotted_expected(); p:=pg_temp.unslotted_plan(); before_state:=pg_temp.unslotted_state();
    if mode='delete' then p:=jsonb_set(p,'{delete_ids}',p->'delete_ids'||jsonb_build_array('cccccccc-0000-4000-8000-000000000002')); end if;
    if mode='unpin' then p:=jsonb_set(p,'{unpin_ids}',jsonb_build_array('cccccccc-0000-4000-8000-000000000002')); end if;
    if mode='redate' then p:=jsonb_set(p,'{redates}',jsonb_build_array(jsonb_build_object('id','cccccccc-0000-4000-8000-000000000002','to',(current_date+2)::text))); end if;
    r:=public.apply_builder_rebuild('aaaaaaaa-0000-4000-8000-000000000001',current_date,e,p);
    perform pg_temp.assert_ok(r->>'status'='stale','forged or old-client '||mode||' refused');
    perform pg_temp.assert_ok(before_state=pg_temp.unslotted_state(),'no writes after '||mode||' refusal');
  end loop;
  perform pg_temp.reset_unslotted(); update public.curriculum_goals set total_lessons=1;
  select jsonb_agg(to_jsonb(l) order by id) into protected from public.lessons l where lesson_number<>3;
  e:=pg_temp.unslotted_expected(); p:=jsonb_set(jsonb_set(jsonb_set(pg_temp.unslotted_plan(),'{delete_ids}','[]'),'{inserts}','[]'),'{retire_above}','1');
  -- Even a client erroneously listing an unslotted work row for retirement cannot clear its date.
  p:=jsonb_set(p,'{retire_keep_ids}',jsonb_build_array('cccccccc-0000-4000-8000-000000000002'));
  r:=public.apply_builder_rebuild('aaaaaaaa-0000-4000-8000-000000000001',current_date,e,p);
  perform pg_temp.assert_ok(r->>'status'='applied','shortening applies to slotted rows');
  perform pg_temp.assert_ok(protected=(select jsonb_agg(to_jsonb(l) order by id) from public.lessons l),'shortening preserves unslotted rows and history exactly');

  perform pg_temp.reset_unslotted(); e:=pg_temp.unslotted_expected(); p:=pg_temp.unslotted_plan();
  update public.lessons set queue_position=2 where lesson_number=2; before_state:=pg_temp.unslotted_state();
  r:=public.apply_builder_rebuild('aaaaaaaa-0000-4000-8000-000000000001',current_date,e,p);
  perform pg_temp.assert_ok(r->>'reason'='rows' and r->>'status'='stale','concurrent drag makes snapshot stale');
  perform pg_temp.assert_ok(before_state=pg_temp.unslotted_state(),'concurrent drag stays untouched');

  perform pg_temp.reset_unslotted(); update public.lessons set scheduled_date=current_date+1,date=current_date+1 where lesson_number=2;
  e:=pg_temp.unslotted_expected(); p:=pg_temp.unslotted_plan(); before_state:=pg_temp.unslotted_state();
  r:=public.apply_builder_rebuild('aaaaaaaa-0000-4000-8000-000000000001',current_date,e,p);
  perform pg_temp.assert_ok(r->>'status'='refused','date collision refuses instead of moving unslotted pin');
  perform pg_temp.assert_ok(before_state=pg_temp.unslotted_state(),'capacity refusal rolls back every row');
end $$;

create function public._unslotted_test_side_effect() returns trigger language plpgsql as $$
begin
 if new.lesson_number=3 then update public.lessons set notes='injected side effect' where lesson_number=2; end if;
 return new;
end $$;
create trigger _unslotted_test_side_effect after insert on public.lessons for each row execute function public._unslotted_test_side_effect();
do $$ declare e jsonb; p jsonb; r jsonb; before_state jsonb;
begin
 perform pg_temp.reset_unslotted();
 -- Reset inserts also invoke the test trigger; remove its fixture-time edit
 -- so the subsequent rebuild must detect a genuinely new side effect.
 update public.lessons set notes=null where lesson_number=2;
 e:=pg_temp.unslotted_expected(); p:=pg_temp.unslotted_plan(); before_state:=pg_temp.unslotted_state();
 r:=public.apply_builder_rebuild('aaaaaaaa-0000-4000-8000-000000000001',current_date,e,p);
 perform pg_temp.assert_ok(r->>'reason'='rooted_rebuild_unslotted_changed' and r->>'status'='failed','trigger side effect caught');
 perform pg_temp.assert_ok(before_state=pg_temp.unslotted_state(),'trigger side effect rolls back every row');
end $$;
drop trigger _unslotted_test_side_effect on public.lessons;
drop function public._unslotted_test_side_effect();
select label from unslotted_checks order by label;
