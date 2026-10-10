BEGIN;
INSERT INTO auth.users(id) VALUES('20000000-0000-4000-8000-000000000001');
INSERT INTO public.profiles(id,display_name,timezone,school_days) VALUES('20000000-0000-4000-8000-000000000001','Migration rehearsal','UTC',ARRAY['Mon','Tue','Wed','Thu','Fri','Sat','Sun']);
INSERT INTO public.children(id,user_id,name) VALUES('20000000-0000-4000-8000-000000000002','20000000-0000-4000-8000-000000000001','Synthetic only');
INSERT INTO public.curriculum_goals(id,user_id,child_id,curriculum_name,total_lessons,current_lesson,start_at_lesson,start_date,school_days,lessons_per_day)
VALUES('20000000-0000-4000-8000-000000000003','20000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000002','Synthetic transition',8,0,1,current_date,ARRAY['Mon','Tue','Wed','Thu','Fri','Sat','Sun'],1);
INSERT INTO public.lessons(id,user_id,child_id,curriculum_goal_id,title,date,scheduled_date,lesson_number,queue_position,scheduled_source)
SELECT ('20000000-0000-4000-8000-'||lpad((100+n)::text,12,'0'))::uuid,'20000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000002','20000000-0000-4000-8000-000000000003','Synthetic lesson '||n,current_date+n-1,current_date+n-1,n,n,'wizard_create' FROM generate_series(1,8) n;
SELECT set_config('request.jwt.claims','{"sub":"20000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
DO $$DECLARE g uuid:='20000000-0000-4000-8000-000000000003';r jsonb;s jsonb;expected jsonb;BEGIN
 s:=rooted_private.scheduler_state(g);
 -- Exact b9904b6 expected shape: seven goal keys, seven row values, no version.
 SELECT jsonb_build_object('goal',jsonb_build_object('total_lessons',c.total_lessons,'current_lesson',c.current_lesson,'start_at_lesson',c.start_at_lesson,'lessons_per_day',c.lessons_per_day,'lessons_per_day_overrides',c.lessons_per_day_overrides,'school_days',c.school_days,'start_date',c.start_date),'rows',(SELECT jsonb_agg(jsonb_build_array(l.id,l.lesson_number,l.queue_position,l.completed,l.queue_pinned,l.skipped,l.scheduled_date) ORDER BY l.id) FROM public.lessons l WHERE curriculum_goal_id=g),'day_start',current_date::timestamptz,'day_end',(current_date+1)::timestamptz) INTO expected FROM public.curriculum_goals c WHERE id=g;
 EXECUTE 'SET LOCAL ROLE authenticated';
 r:=public.apply_builder_rebuild(g,current_date,expected,'{"inserts":[],"redates":[]}'::jsonb);
 EXECUTE 'RESET ROLE';
 IF r->>'reason'<>'client_upgrade_required' THEN RAISE EXCEPTION 'Expected old Builder refusal, got %',r;END IF;
 IF rooted_private.scheduler_state(g) IS DISTINCT FROM s THEN RAISE EXCEPTION 'Old Builder refusal wrote state';END IF;
 RAISE NOTICE 'PASS old-main Builder fails closed before state change; rollout requires reload';
 EXECUTE 'SET LOCAL ROLE authenticated';
 r:=public.move_lesson_keep_slot('20000000-0000-4000-8000-000000000103',current_date+4,current_date,false);
 EXECUTE 'RESET ROLE';
 IF r->>'status' NOT IN ('moved','kept_slot') THEN RAISE EXCEPTION 'Legacy ordinary move unexpected %',r;END IF;
 RAISE NOTICE 'PASS old keep-slot path on unprotected course remains callable: %',r;
END $$;
-- Reopen an unslotted completed curriculum row in legacy and protected modes.
DO $$DECLARE mode text;g uuid:='20000000-0000-4000-8000-000000000003';v_id uuid:='20000000-0000-4000-8000-000000000108';before_row jsonb;after_row jsonb;r jsonb;BEGIN
 FOREACH mode IN ARRAY ARRAY['legacy','atomic_v2'] LOOP
  UPDATE public.lessons SET queue_position=null,queue_pinned=true,is_backfill=true,scheduled_source='plan_move',completed=true,completed_at=now(),notes='Keep newer work',minutes_spent=23,hours=0.38333333333333336 WHERE lessons.id=v_id;
  IF mode='atomic_v2' THEN PERFORM rooted_private.set_scheduler_mode(g,rooted_private.scheduler_state(g),'atomic_v2');END IF;
  SELECT to_jsonb(l) INTO before_row FROM public.lessons l WHERE l.id=v_id;
 EXECUTE 'SET LOCAL ROLE authenticated';
  r:=public.reopen_lesson(v_id,current_date);
 EXECUTE 'RESET ROLE';
  SELECT to_jsonb(l) INTO after_row FROM public.lessons l WHERE l.id=v_id;
  IF r->>'status'<>'requeued' OR r->>'in_place'<>'true' THEN RAISE EXCEPTION 'Unslotted reopen % response %',mode,r;END IF;
  IF after_row-'completed'-'completed_at'-'updated_at' IS DISTINCT FROM before_row-'completed'-'completed_at'-'updated_at' OR (after_row->>'completed')::boolean OR after_row->'completed_at'<>'null'::jsonb THEN RAISE EXCEPTION 'Unslotted reopen lost parent work in %',mode;END IF;
  RAISE NOTICE 'PASS unslotted reopen % preserves dates/pin/source/backfill/notes/time/identity',mode;
 END LOOP;
END $$;
DO $$DECLARE g uuid:='20000000-0000-4000-8000-000000000003';s jsonb;r jsonb;BEGIN
 s:=rooted_private.scheduler_state(g);
 EXECUTE 'SET LOCAL ROLE authenticated';
 r:=public.move_lesson_keep_slot('20000000-0000-4000-8000-000000000103',current_date+9,current_date,false);
 EXECUTE 'RESET ROLE';
 IF r->>'reason'<>'client_upgrade_required' THEN RAISE EXCEPTION 'Protected old move unexpected %',r;END IF;
 EXECUTE 'SET LOCAL ROLE authenticated';
 BEGIN
  UPDATE public.lessons SET date=current_date+12,scheduled_date=current_date+12,scheduled_source='plan_move' WHERE id='20000000-0000-4000-8000-000000000104';
  RAISE EXCEPTION 'Protected direct writer unexpectedly accepted';
 EXCEPTION WHEN raise_exception THEN
  IF SQLERRM NOT LIKE '%scheduler_client_upgrade_required%' THEN RAISE;END IF;
 END;
 EXECUTE 'RESET ROLE';
 IF rooted_private.scheduler_state(g) IS DISTINCT FROM s THEN RAISE EXCEPTION 'Protected refusal changed state';END IF;
 IF EXISTS(SELECT 1 FROM rooted_private.scheduler_capabilities) THEN RAISE EXCEPTION 'Leaked capability';END IF;
 RAISE NOTICE 'PASS protected old RPC and delayed direct PATCH refuse with exact unchanged state';
END $$;
ROLLBACK;
