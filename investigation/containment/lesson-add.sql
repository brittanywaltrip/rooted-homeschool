-- Explicit Plan Add / Log extra. Reuse only an untouched placeholder; no
-- arbitrary caller-supplied row, owner, slot, pin or completion timestamp.
CREATE FUNCTION public.commit_scheduler_add(p_operation_id uuid,p_goal_id uuid,p_expected jsonb,p_values jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE u uuid:=auth.uid();g public.curriculum_goals%rowtype;r public.lessons%rowtype;prior rooted_private.scheduler_action_receipts%rowtype;
 have jsonb;after_state jsonb;shape jsonb;before_undo jsonb;result jsonb;request_hash text:=rooted_private.scheduler_hash(jsonb_build_object('rpc','add','goal',p_goal_id,'expected',p_expected,'values',p_values));
 mode text;num integer;slot integer;mins integer;d date;done boolean;reuse boolean:=false;rid uuid;n integer;ids uuid[];fields text[]:=ARRAY['date','scheduled_date','scheduled_source','queue_pinned','completed','completed_at','is_backfill'];
BEGIN
 IF u IS NULL OR p_operation_id IS NULL THEN RETURN jsonb_build_object('status','invalid','reason','owner');END IF;
 BEGIN
  IF NOT pg_try_advisory_xact_lock(hashtextextended(p_operation_id::text,0)) THEN RAISE lock_not_available;END IF;
  SELECT * INTO prior FROM rooted_private.scheduler_action_receipts WHERE id=p_operation_id;
  IF FOUND THEN
   IF prior.user_id<>u OR prior.goal_id<>p_goal_id OR prior.request_hash<>request_hash THEN RETURN jsonb_build_object('status','invalid','reason','operation');END IF;
   RETURN prior.result||jsonb_build_object('status',CASE WHEN prior.undone_at IS NULL THEN 'already_applied' ELSE 'already_undone' END,'row',(SELECT to_jsonb(l) FROM public.lessons l WHERE l.id=(prior.result->>'rowId')::uuid AND user_id=u));
  END IF;
  PERFORM rooted_private.scheduler_lock_owner(u,false);
  SELECT * INTO g FROM public.curriculum_goals WHERE id=p_goal_id AND user_id=u FOR UPDATE NOWAIT;
  IF NOT FOUND THEN RETURN jsonb_build_object('status','invalid','reason','owner');END IF;
  SELECT m.mode INTO mode FROM rooted_private.scheduler_modes m WHERE goal_id=p_goal_id;
  IF mode IS NULL THEN RETURN jsonb_build_object('status','legacy');END IF;
  IF mode='paused' THEN RETURN jsonb_build_object('status','paused');END IF;
  PERFORM 1 FROM public.lessons WHERE curriculum_goal_id=p_goal_id ORDER BY id FOR UPDATE NOWAIT;
  PERFORM 1 FROM public.profiles WHERE id=u FOR SHARE NOWAIT;
  have:=rooted_private.scheduler_state(p_goal_id);
  IF have IS DISTINCT FROM p_expected THEN RETURN jsonb_build_object('status','stale','reason','schedule_changed');END IF;
  IF jsonb_typeof(p_values) IS DISTINCT FROM 'object' OR EXISTS(SELECT 1 FROM jsonb_object_keys(p_values) k WHERE k NOT IN ('title','child_id','lesson_number','minutes_spent','notes','scheduled_date','completed')) OR jsonb_typeof(p_values->'completed') IS DISTINCT FROM 'boolean' OR jsonb_typeof(p_values->'title') IS DISTINCT FROM 'string' OR p_values->>'scheduled_date' IS NULL THEN RAISE EXCEPTION 'scheduler_add_shape';END IF;
  IF (p_values->>'child_id')::uuid IS DISTINCT FROM g.child_id OR NOT EXISTS(SELECT 1 FROM public.children WHERE id=g.child_id AND user_id=u) THEN RAISE EXCEPTION 'scheduler_add_child';END IF;
  num:=(p_values->>'lesson_number')::integer;mins:=(p_values->>'minutes_spent')::integer;d:=(p_values->>'scheduled_date')::date;done:=(p_values->>'completed')::boolean;
  IF (num IS NOT NULL AND num<1) OR (mins IS NOT NULL AND mins<0) OR (NOT done AND num IS NULL) THEN RAISE EXCEPTION 'scheduler_add_shape';END IF;
  SELECT * INTO r FROM public.lessons WHERE curriculum_goal_id=p_goal_id AND lesson_number=num;
  reuse:=FOUND;
  IF reuse THEN
   IF r.completed OR r.skipped OR r.queue_pinned OR r.queue_preserved OR r.continues_lesson_id IS NOT NULL OR r.started_at IS NOT NULL OR coalesce(r.hours,0)>0 OR coalesce(r.minutes_spent,0)>0 OR nullif(btrim(r.notes),'') IS NOT NULL OR (r.scheduled_source IS NOT NULL AND r.scheduled_source NOT IN ('queue_resync','skip_respread','skip_undo','catchup_spread','catchup_pushback','plan_cascade_shift','recalibrate_respread','completion_respread','edit_respread','uncomplete_respread','undo_restore')) THEN RETURN jsonb_build_object('status','invalid','reason','existing_work');END IF;
   rid:=r.id;slot:=r.queue_position;
   IF NOT done AND slot IS NULL THEN RAISE EXCEPTION 'scheduler_add_unslotted_placeholder';END IF;
  ELSE
   rid:=gen_random_uuid();
   IF NOT done THEN
    slot:=num;
    IF EXISTS(SELECT 1 FROM public.lessons WHERE curriculum_goal_id=p_goal_id AND queue_position=slot) THEN
     SELECT greatest(coalesce(max(queue_position),0),coalesce(max(lesson_number),0),num)+1 INTO slot FROM public.lessons WHERE curriculum_goal_id=p_goal_id;
    END IF;
   END IF;
  END IF;
  ids:=ARRAY(SELECT id FROM public.lessons WHERE curriculum_goal_id=p_goal_id);
  IF NOT reuse THEN
   shape:=jsonb_build_object('id',rid,'user_id',u,'child_id',g.child_id,'curriculum_goal_id',g.id,'title',p_values->>'title','lesson_number',num,'queue_position',slot,'date',d,'scheduled_date',d,'notes',p_values->>'notes','minutes_spent',mins,'hours',coalesce((mins::double precision/60)::numeric,0),'completed',done,'completed_at',CASE WHEN done THEN (d::timestamp AT TIME ZONE 'UTC')+interval '12 hours' ELSE NULL END,'queue_pinned',NOT done AND slot IS NOT NULL,'is_backfill',false,'scheduled_source',CASE WHEN done THEN 'extra_log' ELSE 'plan_move' END);
  END IF;
  PERFORM rooted_private.scheduler_allow(g.id,'add',ids,fields,ARRAY['current_lesson','completed_at'],'{}'::uuid[],CASE WHEN reuse THEN '[]'::jsonb ELSE jsonb_build_array(shape) END);
  IF reuse THEN
   UPDATE public.lessons SET date=d,scheduled_date=d,completed=done,completed_at=CASE WHEN done THEN (d::timestamp AT TIME ZONE 'UTC')+interval '12 hours' ELSE NULL END,
    minutes_spent=CASE WHEN mins IS NOT NULL THEN mins ELSE minutes_spent END,hours=CASE WHEN mins IS NOT NULL THEN (mins::double precision/60)::numeric ELSE hours END,
    notes=CASE WHEN p_values->>'notes' IS NOT NULL THEN p_values->>'notes' ELSE notes END,
    queue_pinned=CASE WHEN NOT done AND slot IS NOT NULL THEN true ELSE queue_pinned END,scheduled_source=CASE WHEN done THEN 'extra_log' ELSE 'plan_move' END WHERE id=rid;
  ELSE
   INSERT INTO public.lessons(id,user_id,child_id,curriculum_goal_id,title,lesson_number,queue_position,date,scheduled_date,notes,minutes_spent,hours,completed,completed_at,queue_pinned,is_backfill,scheduled_source)
   SELECT x.id,x.user_id,x.child_id,x.curriculum_goal_id,x.title,x.lesson_number,x.queue_position,x.date,x.scheduled_date,x.notes,x.minutes_spent,x.hours,x.completed,x.completed_at,x.queue_pinned,x.is_backfill,x.scheduled_source FROM jsonb_populate_record(NULL::public.lessons,shape) x;
  END IF;
  GET DIAGNOSTICS n=ROW_COUNT;IF n<>1 THEN RAISE EXCEPTION 'scheduler_add_rowcount';END IF;
  IF done THEN PERFORM rooted_private.scheduler_respread_locked(g.id,'completion_respread',(now() AT TIME ZONE (SELECT timezone FROM public.profiles WHERE id=u))::date);END IF;
  SET CONSTRAINTS ALL IMMEDIATE;
  after_state:=rooted_private.scheduler_state(g.id);
  IF NOT EXISTS(SELECT 1 FROM public.lessons WHERE id=rid AND user_id=u AND curriculum_goal_id=g.id AND date=d AND scheduled_date=d AND completed=done AND (mins IS NULL OR minutes_spent=mins) AND (p_values->>'notes' IS NULL OR notes=p_values->>'notes')) THEN RAISE EXCEPTION 'scheduler_add_postcondition';END IF;
  IF (SELECT count(*) FROM jsonb_array_elements(after_state->'rows'))<>(SELECT count(*) FROM jsonb_array_elements(have->'rows'))+(CASE WHEN reuse THEN 0 ELSE 1 END)
   OR EXISTS(SELECT 1 FROM jsonb_array_elements(have->'rows') b LEFT JOIN jsonb_array_elements(after_state->'rows') a ON a->>'id'=b->>'id' WHERE a IS NULL OR CASE WHEN b->>'id'=rid::text THEN b-ARRAY['date','scheduled_date','completed','completed_at','minutes_spent','hours','notes','queue_pinned','scheduled_source','updated_at'] IS DISTINCT FROM a-ARRAY['date','scheduled_date','completed','completed_at','minutes_spent','hours','notes','queue_pinned','scheduled_source','updated_at'] ELSE b-ARRAY['date','scheduled_date','scheduled_source','updated_at'] IS DISTINCT FROM a-ARRAY['date','scheduled_date','scheduled_source','updated_at'] END) THEN RAISE EXCEPTION 'scheduler_add_preservation';END IF;
  SELECT jsonb_build_object('goal',jsonb_build_object('current_lesson',have->'goal'->'current_lesson','completed_at',have->'goal'->'completed_at'),'rows',jsonb_agg((SELECT jsonb_object_agg(k,v) FROM jsonb_each(x) e(k,v) WHERE k=ANY(ARRAY['id','date','scheduled_date','scheduled_source','queue_position','queue_pinned','queue_preserved','completed','completed_at','skipped','is_backfill'])))) INTO before_undo FROM jsonb_array_elements(have->'rows') x;
  before_undo:=jsonb_set(before_undo,'{rows}',coalesce(nullif(before_undo->'rows','null'::jsonb),'[]'::jsonb));
  result:=jsonb_build_object('status','applied','kind','add','rowId',rid,'updatedExisting',reuse,'operationId',p_operation_id);
  PERFORM rooted_private.scheduler_disallow(g.id);
  INSERT INTO rooted_private.scheduler_action_receipts(id,user_id,goal_id,request_hash,before_state,after_hash,result) VALUES(p_operation_id,u,g.id,request_hash,CASE WHEN reuse THEN NULL ELSE before_undo END,rooted_private.scheduler_hash(after_state),result);
  RETURN result||jsonb_build_object('row',(SELECT to_jsonb(l) FROM public.lessons l WHERE id=rid));
 EXCEPTION WHEN lock_not_available THEN RETURN jsonb_build_object('status','busy');END;
EXCEPTION WHEN invalid_text_representation OR datetime_field_overflow OR invalid_datetime_format OR check_violation OR not_null_violation THEN RETURN jsonb_build_object('status','invalid','reason','shape');
END $$;
REVOKE ALL ON FUNCTION public.commit_scheduler_add(uuid,uuid,jsonb,jsonb) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.commit_scheduler_add(uuid,uuid,jsonb,jsonb) TO authenticated;
