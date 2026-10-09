-- Fixed retirement commands. No customer activation or generic goal mutation.
CREATE FUNCTION public.commit_scheduler_retire(p_operation_id uuid,p_goal_id uuid,p_expected jsonb,p_kind text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE u uuid:=auth.uid();g public.curriculum_goals%rowtype;mode text;have jsonb;prior rooted_private.scheduler_action_receipts%rowtype;request_hash text:=rooted_private.scheduler_hash(jsonb_build_object('rpc','retire','goal',p_goal_id,'expected',p_expected,'kind',p_kind));
 ids uuid[];remove_ids uuid[];keep_ids uuid[];n integer;subject uuid;result jsonb;stopped timestamptz;after_rows jsonb;
BEGIN
 IF u IS NULL OR p_operation_id IS NULL OR p_kind IS NULL OR p_kind NOT IN ('stop','delete') THEN RETURN jsonb_build_object('status','invalid','reason','request');END IF;
 BEGIN
  IF NOT pg_try_advisory_xact_lock(hashtextextended(p_operation_id::text,0)) THEN RAISE lock_not_available;END IF;
  SELECT * INTO prior FROM rooted_private.scheduler_action_receipts WHERE id=p_operation_id;
  IF FOUND THEN
   IF prior.user_id<>u OR prior.goal_id<>p_goal_id OR prior.request_hash<>request_hash THEN RETURN jsonb_build_object('status','invalid','reason','operation');END IF;
   RETURN prior.result||jsonb_build_object('status','already_applied');
  END IF;
  PERFORM rooted_private.scheduler_lock_owner(u,false);
  SELECT * INTO g FROM public.curriculum_goals WHERE id=p_goal_id AND user_id=u FOR UPDATE NOWAIT;
  IF NOT FOUND THEN RETURN jsonb_build_object('status','invalid','reason','owner');END IF;
  SELECT m.mode INTO mode FROM rooted_private.scheduler_modes m WHERE goal_id=p_goal_id;
  IF mode IS NULL THEN RETURN jsonb_build_object('status','legacy');END IF;
  IF mode='paused' THEN RETURN jsonb_build_object('status','paused');END IF;
  PERFORM 1 FROM public.lessons WHERE curriculum_goal_id=p_goal_id ORDER BY id FOR UPDATE NOWAIT;
  have:=rooted_private.scheduler_state(p_goal_id);
  IF have IS DISTINCT FROM p_expected THEN RETURN jsonb_build_object('status','stale','reason','schedule_changed');END IF;
  ids:=ARRAY(SELECT id FROM public.lessons WHERE curriculum_goal_id=p_goal_id);
  remove_ids:=ARRAY(SELECT id FROM public.lessons WHERE curriculum_goal_id=p_goal_id AND NOT completed AND NOT rooted_private.lesson_carries_work(notes,minutes_spent) AND coalesce(hours,0)=0 AND started_at IS NULL);
  keep_ids:=ARRAY(SELECT id FROM public.lessons WHERE curriculum_goal_id=p_goal_id AND NOT id=ANY(remove_ids));
  PERFORM rooted_private.scheduler_allow(g.id,CASE WHEN p_kind='delete' THEN 'goal_delete' ELSE 'goal_stop' END,ids,ARRAY['scheduled_date','queue_position','queue_pinned','queue_preserved','curriculum_goal_id'],ARRAY['total_lessons','current_lesson','completed_at','start_at_lesson'],remove_ids);
  IF p_kind='delete' THEN
   SELECT CASE WHEN count(*)=1 THEN (array_agg(id))[1] ELSE NULL END INTO subject FROM public.subjects WHERE user_id=u AND lower(name)=lower(coalesce(nullif(btrim(g.subject_label),''),g.curriculum_name));
   IF subject IS NOT NULL THEN UPDATE public.lessons SET subject_id=subject WHERE id=ANY(keep_ids) AND subject_id IS NULL;END IF;
  END IF;
  UPDATE public.lessons SET scheduled_date=NULL,queue_position=NULL,queue_pinned=false,queue_preserved=false WHERE id=ANY(keep_ids) AND NOT completed;
  GET DIAGNOSTICS n=ROW_COUNT;IF n<>(SELECT count(*) FROM jsonb_array_elements(have->'rows') x WHERE (x->>'id')::uuid=ANY(keep_ids) AND NOT (x->>'completed')::boolean) THEN RAISE EXCEPTION 'scheduler_retire_unschedule';END IF;
  DELETE FROM public.lessons WHERE id=ANY(remove_ids);
  GET DIAGNOSTICS n=ROW_COUNT;IF n<>cardinality(remove_ids) THEN RAISE EXCEPTION 'scheduler_retire_delete';END IF;
  IF p_kind='delete' THEN
   DELETE FROM public.curriculum_goals WHERE id=g.id AND user_id=u;
   GET DIAGNOSTICS n=ROW_COUNT;IF n<>1 THEN RAISE EXCEPTION 'scheduler_retire_goal';END IF;
  ELSE
   stopped:=clock_timestamp();
   UPDATE public.curriculum_goals SET total_lessons=g.current_lesson,current_lesson=g.current_lesson,start_at_lesson=least(start_at_lesson,g.current_lesson+1),completed_at=stopped WHERE id=g.id;
   GET DIAGNOSTICS n=ROW_COUNT;IF n<>1 THEN RAISE EXCEPTION 'scheduler_retire_goal';END IF;
  END IF;
  SET CONSTRAINTS ALL IMMEDIATE;
  SELECT coalesce(jsonb_agg(to_jsonb(l) ORDER BY id),'[]'::jsonb) INTO after_rows FROM public.lessons l WHERE id=ANY(ids);
  IF (SELECT count(*) FROM jsonb_array_elements(after_rows))<>cardinality(keep_ids) OR EXISTS(SELECT 1 FROM public.lessons WHERE id=ANY(remove_ids))
   OR EXISTS(SELECT 1 FROM jsonb_array_elements(have->'rows') b JOIN jsonb_array_elements(after_rows) a ON a->>'id'=b->>'id' WHERE b-ARRAY['scheduled_date','queue_position','queue_pinned','queue_preserved','curriculum_goal_id','subject_id','updated_at'] IS DISTINCT FROM a-ARRAY['scheduled_date','queue_position','queue_pinned','queue_preserved','curriculum_goal_id','subject_id','updated_at'] OR ((b->>'completed')::boolean AND b-ARRAY['curriculum_goal_id','subject_id','updated_at'] IS DISTINCT FROM a-ARRAY['curriculum_goal_id','subject_id','updated_at']))
   OR EXISTS(SELECT 1 FROM public.lessons WHERE id=ANY(keep_ids) AND ((NOT completed AND (scheduled_date IS NOT NULL OR queue_position IS NOT NULL OR queue_pinned OR queue_preserved)) OR (p_kind='delete' AND curriculum_goal_id IS NOT NULL))) THEN RAISE EXCEPTION 'scheduler_retire_preservation';END IF;
  PERFORM rooted_private.scheduler_disallow(g.id);
  result:=jsonb_build_object('status','applied','kind',p_kind,'removed',cardinality(remove_ids),'retained',cardinality(keep_ids),'completedAt',stopped,'currentLesson',g.current_lesson);
  INSERT INTO rooted_private.scheduler_action_receipts(id,user_id,goal_id,request_hash,before_state,after_hash,result) VALUES(p_operation_id,u,g.id,request_hash,NULL,rooted_private.scheduler_hash(after_rows),result);
  RETURN result;
 EXCEPTION WHEN lock_not_available THEN RETURN jsonb_build_object('status','busy');END;
END $$;
REVOKE ALL ON FUNCTION public.commit_scheduler_retire(uuid,uuid,jsonb,text) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.commit_scheduler_retire(uuid,uuid,jsonb,text) TO authenticated;
