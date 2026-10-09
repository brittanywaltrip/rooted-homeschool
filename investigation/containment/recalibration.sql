-- Fixed recalibration command. No caller-defined patch fields and no history deletion.
CREATE FUNCTION public.commit_scheduler_recalibration(p_operation_id uuid,p_goal_id uuid,p_expected jsonb,p_current integer,p_day date,p_history boolean,p_confirmed uuid[],p_dates jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE u uuid:=auth.uid();g public.curriculum_goals%rowtype;m text;before_state jsonb;after_state jsonb;canonical jsonb;
 prior rooted_private.scheduler_action_receipts%rowtype;request_hash text:=rooted_private.scheduler_hash(jsonb_build_object('kind','recalibration','goal',p_goal_id,'expected',p_expected,'current',p_current,'day',p_day,'history',p_history,'confirmed',p_confirmed,'dates',p_dates));
 gap uuid[];history_ids uuid[];unscheduled_ids uuid[];tail_ids uuid[];kept jsonb;changed_order boolean;w jsonb;r record;n integer;anchor date;first_day date;span integer;i integer:=0;estimate_day date;result jsonb;old_pointer integer;tz text;
BEGIN
 IF u IS NULL OR p_operation_id IS NULL THEN RETURN jsonb_build_object('status','invalid','reason','owner');END IF;
 BEGIN
  IF NOT pg_try_advisory_xact_lock(hashtextextended(p_operation_id::text,0)) THEN RAISE lock_not_available;END IF;
  SELECT * INTO prior FROM rooted_private.scheduler_action_receipts WHERE id=p_operation_id;
  IF FOUND THEN
   IF prior.user_id<>u OR prior.goal_id<>p_goal_id OR prior.request_hash<>request_hash THEN RETURN jsonb_build_object('status','invalid','reason','operation');END IF;
   RETURN prior.result||jsonb_build_object('status','already_applied');
  END IF;
  SELECT * INTO g FROM public.curriculum_goals WHERE id=p_goal_id AND user_id=u AND NOT archived FOR UPDATE NOWAIT;
  IF NOT FOUND THEN RETURN jsonb_build_object('status','invalid','reason','owner');END IF;
  SELECT mode INTO m FROM rooted_private.scheduler_modes WHERE goal_id=p_goal_id;
  IF m IS DISTINCT FROM 'atomic_v2' THEN RETURN jsonb_build_object('status',CASE WHEN m='paused' THEN 'paused' ELSE 'stale' END,'reason','mode');END IF;
  PERFORM 1 FROM public.lessons WHERE curriculum_goal_id=p_goal_id ORDER BY id FOR UPDATE NOWAIT;
  SELECT timezone INTO tz FROM public.profiles WHERE id=u FOR SHARE NOWAIT;
  PERFORM rooted_private.scheduler_lock_owner(auth.uid(),false);
  before_state:=rooted_private.scheduler_state(p_goal_id);
  IF before_state IS DISTINCT FROM p_expected THEN RETURN jsonb_build_object('status','stale','reason','schedule_changed');END IF;
  IF p_current IS NULL OR p_current<1 OR p_current>g.total_lessons OR g.total_lessons>2000 OR p_history IS NULL OR p_day IS DISTINCT FROM (now() AT TIME ZONE tz)::date OR p_confirmed IS NULL OR jsonb_typeof(p_dates) IS DISTINCT FROM 'array' THEN RETURN jsonb_build_object('status','invalid','reason','shape');END IF;
  -- The canonical validator cannot certify sparse/unslotted continuations.
  IF (SELECT count(*) FROM public.lessons WHERE curriculum_goal_id=p_goal_id)<>g.total_lessons OR
   (SELECT count(DISTINCT lesson_number) FROM public.lessons WHERE curriculum_goal_id=p_goal_id AND lesson_number BETWEEN 1 AND g.total_lessons)<>g.total_lessons OR
   EXISTS(SELECT 1 FROM public.lessons WHERE curriculum_goal_id=p_goal_id AND (user_id<>u OR queue_position IS NULL OR is_backfill OR continues_lesson_id IS NOT NULL)) THEN RETURN jsonb_build_object('status','invalid','reason','queue_shape');END IF;
  old_pointer:=greatest(0,coalesce(g.current_lesson,0));
  SELECT coalesce(array_agg(id ORDER BY lesson_number),'{}') INTO gap FROM public.lessons WHERE curriculum_goal_id=p_goal_id AND NOT completed AND lesson_number>old_pointer AND lesson_number<p_current;
  SELECT coalesce(array_agg(id ORDER BY lesson_number),'{}') INTO history_ids FROM public.lessons WHERE id=ANY(gap) AND NOT queue_pinned AND NOT skipped;
  SELECT coalesce(jsonb_agg(lesson_number ORDER BY lesson_number),'[]') INTO kept FROM public.lessons WHERE id=ANY(gap) AND queue_pinned AND NOT skipped;
  IF p_history AND ((SELECT array_agg(x ORDER BY x) FROM unnest(p_confirmed) x) IS DISTINCT FROM (SELECT array_agg(x ORDER BY x) FROM unnest(history_ids) x)) THEN RETURN jsonb_build_object('status','stale','reason','history_list');END IF;
  -- Preserve real work and every manual/protected placement. Refuse the entire
  -- command if restoring order, passing a protected prefix or estimating work
  -- would require changing it. Existing history above the new pointer also refuses.
  IF EXISTS(SELECT 1 FROM public.lessons WHERE curriculum_goal_id=p_goal_id AND (
   (completed AND lesson_number>=p_current) OR
   ((queue_pinned OR queue_preserved) AND (queue_position IS DISTINCT FROM lesson_number OR (lesson_number<p_current AND lesson_number>old_pointer) OR lesson_number=p_current)) OR
   (id=ANY(gap) AND (rooted_private.lesson_carries_work(notes,minutes_spent) OR coalesce(hours,0)>0 OR started_at IS NOT NULL)))) THEN RETURN jsonb_build_object('status','invalid','reason','protected_work');END IF;
  SELECT EXISTS(SELECT 1 FROM public.lessons WHERE curriculum_goal_id=p_goal_id AND queue_position IS DISTINCT FROM lesson_number) INTO changed_order;
  SELECT coalesce(array_agg(id),'{}') INTO unscheduled_ids FROM public.lessons WHERE id=ANY(gap) AND NOT queue_pinned AND NOT queue_preserved AND scheduled_date IS NOT NULL;
  SELECT coalesce(array_agg(id),'{}') INTO tail_ids FROM public.lessons WHERE curriculum_goal_id=p_goal_id AND lesson_number>=p_current AND NOT completed AND NOT skipped AND NOT queue_pinned AND NOT queue_preserved;
  IF jsonb_array_length(p_dates)<>cardinality(tail_ids) OR (SELECT count(DISTINCT x->>'id') FROM jsonb_array_elements(p_dates) x)<>cardinality(tail_ids) OR EXISTS(SELECT 1 FROM jsonb_array_elements(p_dates) x WHERE jsonb_typeof(x)<>'object' OR NOT ((x->>'id')::uuid=ANY(tail_ids)) OR (x->>'date')::date<p_day OR (x->>'date')::date>=p_day+3650 OR x->>'date' IS NULL OR EXISTS(SELECT 1 FROM jsonb_object_keys(x) k WHERE k NOT IN ('id','date'))) THEN RETURN jsonb_build_object('status','invalid','reason','tail_scope');END IF;
  canonical:=rooted_private.cascade_local_window(u,p_day);
  PERFORM rooted_private.scheduler_allow(p_goal_id,'recalibration',ARRAY(SELECT id FROM public.lessons WHERE curriculum_goal_id=p_goal_id),ARRAY['queue_position','date','scheduled_date','scheduled_source','completed','completed_at'],ARRAY['current_lesson','start_at_lesson','completed_at']);
  IF changed_order THEN
   UPDATE public.lessons SET queue_position=NULL WHERE curriculum_goal_id=p_goal_id AND queue_position IS DISTINCT FROM lesson_number;
   UPDATE public.lessons SET queue_position=lesson_number WHERE curriculum_goal_id=p_goal_id AND queue_position IS NULL;
  END IF;
  UPDATE public.curriculum_goals SET current_lesson=p_current-1,start_at_lesson=p_current WHERE id=p_goal_id;
  IF p_history THEN
   SELECT max((completed_at AT TIME ZONE tz)::date) INTO anchor FROM public.lessons WHERE curriculum_goal_id=p_goal_id AND completed AND scheduled_source IS DISTINCT FROM 'recalibrate_estimate';
   anchor:=coalesce(anchor,g.start_date,(g.created_at AT TIME ZONE tz)::date,p_day-1);
   first_day:=least(anchor+1,p_day-1);span:=p_day-1-first_day;
   IF span>36500 THEN RAISE EXCEPTION 'scheduler_recalibration_history_window';END IF;
   FOR r IN SELECT id FROM public.lessons WHERE id=ANY(history_ids) ORDER BY lesson_number LOOP
    estimate_day:=first_day+CASE WHEN cardinality(history_ids)<=1 THEN 0 ELSE floor(i::numeric*span/(cardinality(history_ids)-1))::integer END;
    UPDATE public.lessons SET completed=true,completed_at=(estimate_day::text||'T12:00:00Z')::timestamptz,date=estimate_day,scheduled_date=estimate_day,scheduled_source='recalibrate_estimate' WHERE id=r.id;
    GET DIAGNOSTICS n=ROW_COUNT;IF n<>1 THEN RAISE EXCEPTION 'scheduler_recalibration_refused';END IF;i:=i+1;
   END LOOP;
  ELSE
   UPDATE public.lessons SET scheduled_date=NULL,scheduled_source='recalibrate_respread' WHERE id=ANY(unscheduled_ids);
  END IF;
  FOR w IN SELECT * FROM jsonb_array_elements(p_dates) LOOP
   UPDATE public.lessons SET date=(w->>'date')::date,scheduled_date=(w->>'date')::date,scheduled_source='recalibrate_respread' WHERE id=(w->>'id')::uuid;
   GET DIAGNOSTICS n=ROW_COUNT;IF n<>1 THEN RAISE EXCEPTION 'scheduler_recalibration_refused';END IF;
  END LOOP;
  SET CONSTRAINTS ALL IMMEDIATE;
  IF NOT rooted_private.cascade_projection_matches(rooted_private.cascade_snapshot(p_goal_id,p_day,canonical->>'dayStartIso',canonical->>'dayEndIso')) OR NOT EXISTS(SELECT 1 FROM public.curriculum_goals WHERE id=p_goal_id AND current_lesson=p_current-1 AND start_at_lesson=p_current) THEN RAISE EXCEPTION 'scheduler_recalibration_projection';END IF;
  IF EXISTS(SELECT 1 FROM public.lessons WHERE curriculum_goal_id=p_goal_id AND queue_position IS DISTINCT FROM lesson_number) OR (NOT p_history AND EXISTS(SELECT 1 FROM public.lessons WHERE id=ANY(unscheduled_ids) AND scheduled_date IS NOT NULL)) THEN RAISE EXCEPTION 'scheduler_recalibration_incomplete';END IF;
  -- Detect trigger side effects on content or manual/protected placements.
  IF EXISTS(SELECT 1 FROM jsonb_array_elements(before_state->'rows') b JOIN public.lessons l ON l.id=(b->>'id')::uuid WHERE
   EXISTS(SELECT 1 FROM jsonb_each(b) e WHERE e.key NOT IN ('updated_at','queue_position','date','scheduled_date','scheduled_source','completed','completed_at') AND e.value IS DISTINCT FROM to_jsonb(l)->e.key) OR
   ((b->>'queue_pinned')::boolean OR (b->>'queue_preserved')::boolean) AND EXISTS(SELECT 1 FROM jsonb_each(b) e WHERE e.key<>'updated_at' AND e.value IS DISTINCT FROM to_jsonb(l)->e.key) OR
   ((b->>'completed')::boolean OR (b->>'lesson_number')::integer<=old_pointer) AND EXISTS(SELECT 1 FROM jsonb_each(b) e WHERE e.key NOT IN ('updated_at','queue_position') AND e.value IS DISTINCT FROM to_jsonb(l)->e.key)) THEN RAISE EXCEPTION 'scheduler_recalibration_preservation';END IF;
  PERFORM rooted_private.scheduler_disallow(p_goal_id);
  after_state:=rooted_private.scheduler_state(p_goal_id);
  result:=jsonb_build_object('status','applied','gapCount',cardinality(gap),'keptPinned',kept,'estimates',CASE WHEN p_history THEN to_jsonb(history_ids) ELSE '[]'::jsonb END,'unscheduled',CASE WHEN p_history THEN '[]'::jsonb ELSE to_jsonb(unscheduled_ids) END,'respread',to_jsonb(tail_ids),'bookOrderRestored',changed_order);
  INSERT INTO rooted_private.scheduler_action_receipts(id,user_id,goal_id,request_hash,before_state,after_hash,result) VALUES(p_operation_id,u,p_goal_id,request_hash,NULL,rooted_private.scheduler_hash(after_state),result);
  RETURN result;
 EXCEPTION WHEN lock_not_available THEN RETURN jsonb_build_object('status','busy','reason','busy');END;
EXCEPTION WHEN invalid_text_representation OR datetime_field_overflow OR invalid_datetime_format OR check_violation OR not_null_violation THEN RETURN jsonb_build_object('status','invalid','reason','shape');
END $$;
REVOKE ALL ON FUNCTION public.commit_scheduler_recalibration(uuid,uuid,jsonb,integer,date,boolean,uuid[],jsonb) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.commit_scheduler_recalibration(uuid,uuid,jsonb,integer,date,boolean,uuid[],jsonb) TO authenticated;
