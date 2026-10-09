-- Fixed per-goal completion batch; install after actions.sql and respread.sql.
BEGIN;
CREATE FUNCTION public.commit_scheduler_bulk_completion(p_operation_id uuid,p_goal_id uuid,p_expected jsonb,p_items jsonb,p_local_day date) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE u uuid:=auth.uid();m text;prior rooted_private.scheduler_action_receipts%rowtype;have jsonb;after_state jsonb;undo_state jsonb;result jsonb;w jsonb;payload jsonb;r public.lessons%rowtype;ids uuid[];selected_ids uuid[];request_hash text:=rooted_private.scheduler_hash(jsonb_build_object('goal',p_goal_id,'expected',p_expected,'bulkCompletion',p_items,'localDay',p_local_day));local_day date;n integer;
BEGIN
 IF u IS NULL OR p_operation_id IS NULL THEN RETURN jsonb_build_object('status','invalid','reason','owner');END IF;
 BEGIN
  IF NOT pg_try_advisory_xact_lock(hashtextextended(p_operation_id::text,0)) THEN RAISE lock_not_available;END IF;
  SELECT * INTO prior FROM rooted_private.scheduler_action_receipts WHERE id=p_operation_id;
  IF FOUND THEN
   IF prior.user_id<>u OR prior.goal_id<>p_goal_id OR prior.request_hash<>request_hash THEN RETURN jsonb_build_object('status','invalid','reason','operation');END IF;
   RETURN prior.result||jsonb_build_object('status',CASE WHEN prior.undone_at IS NULL THEN 'already_applied' ELSE 'already_undone' END);
  END IF;
  PERFORM 1 FROM public.curriculum_goals WHERE id=p_goal_id AND user_id=u AND NOT archived FOR UPDATE NOWAIT;
  IF NOT FOUND THEN RETURN jsonb_build_object('status','invalid','reason','owner');END IF;
  SELECT mode INTO m FROM rooted_private.scheduler_modes WHERE goal_id=p_goal_id;
  IF m IS NULL THEN RETURN jsonb_build_object('status','legacy');END IF;
  IF m='paused' THEN RETURN jsonb_build_object('status','paused');END IF;
  LOCK TABLE public.curriculum_goals,public.lessons IN ROW EXCLUSIVE MODE NOWAIT;
  PERFORM 1 FROM public.lessons WHERE curriculum_goal_id=p_goal_id ORDER BY id FOR UPDATE NOWAIT;
  PERFORM 1 FROM public.profiles WHERE id=u FOR SHARE NOWAIT;
  LOCK TABLE public.vacation_blocks IN SHARE MODE NOWAIT;
  have:=rooted_private.scheduler_state(p_goal_id);
  IF have IS DISTINCT FROM p_expected THEN RETURN jsonb_build_object('status','stale','reason','schedule_changed');END IF;
  local_day:=(now() AT TIME ZONE (SELECT timezone FROM public.profiles WHERE id=u))::date;
  IF p_local_day IS DISTINCT FROM local_day THEN RETURN jsonb_build_object('status','stale','reason','local_day_changed');END IF;
  IF jsonb_typeof(p_items) IS DISTINCT FROM 'array' OR jsonb_array_length(p_items) NOT BETWEEN 1 AND 100 THEN RAISE EXCEPTION 'scheduler_bulk_completion_shape';END IF;
  SELECT array_agg((x->>'lessonId')::uuid) INTO selected_ids FROM jsonb_array_elements(p_items) x;
  IF cardinality(selected_ids)<>(SELECT count(DISTINCT x) FROM unnest(selected_ids) x) OR (SELECT count(*) FROM public.lessons WHERE id=ANY(selected_ids) AND curriculum_goal_id=p_goal_id AND user_id=u AND NOT completed AND NOT skipped)<>cardinality(selected_ids) THEN RAISE EXCEPTION 'scheduler_bulk_completion_scope';END IF;
  ids:=ARRAY(SELECT id FROM public.lessons WHERE curriculum_goal_id=p_goal_id);
  PERFORM rooted_private.scheduler_allow(p_goal_id,'complete',ids,ARRAY['date','scheduled_date','scheduled_source','queue_pinned','completed','completed_at','is_backfill'],ARRAY['current_lesson','completed_at']);
  FOR w IN SELECT x FROM jsonb_array_elements(p_items) x JOIN public.lessons l ON l.id=(x->>'lessonId')::uuid ORDER BY l.queue_position NULLS LAST,l.id LOOP
   SELECT * INTO r FROM public.lessons WHERE id=(w->>'lessonId')::uuid;
   payload:=w->'payload';
   IF EXISTS(SELECT 1 FROM jsonb_object_keys(w) k WHERE k NOT IN ('lessonId','payload','placement')) OR jsonb_typeof(payload) IS DISTINCT FROM 'object' OR payload->>'completed' IS DISTINCT FROM 'true' OR payload->>'completed_at' IS NULL OR EXISTS(SELECT 1 FROM jsonb_object_keys(payload) k WHERE k NOT IN ('completed','completed_at','scheduled_date','date','queue_pinned','scheduled_source','is_backfill')) THEN RAISE EXCEPTION 'scheduler_bulk_completion_payload';END IF;
   -- Placement is checked against the original snapshot: earlier completions
   -- may legitimately run pointer cleanup before this selected row is updated.
   IF jsonb_typeof(w->'placement') IS DISTINCT FROM 'object' OR EXISTS(SELECT 1 FROM jsonb_each(w->'placement') e WHERE (SELECT x FROM jsonb_array_elements(have->'rows') x WHERE x->>'id'=w->>'lessonId')->e.key IS DISTINCT FROM e.value) THEN RAISE EXCEPTION 'scheduler_bulk_completion_placement';END IF;
   IF r.queue_position IS NULL AND r.scheduled_date IS NOT NULL AND EXISTS(SELECT 1 FROM jsonb_object_keys(payload) k WHERE k NOT IN ('completed','completed_at')) THEN RAISE EXCEPTION 'scheduler_bulk_unslotted';END IF;
   IF NOT (r.queue_position IS NULL AND r.scheduled_date IS NOT NULL) AND (
    (SELECT count(*) FROM jsonb_object_keys(payload))<>7 OR payload->>'date' IS NULL OR payload->>'date' IS DISTINCT FROM payload->>'scheduled_date'
    OR payload->>'scheduled_source' NOT IN ('completion_today','completion_planned','completion_picked')
    OR (payload->>'queue_pinned')::boolean IS DISTINCT FROM (payload->>'scheduled_source'<>'completion_today')
    OR (payload->>'is_backfill')::boolean IS DISTINCT FROM (payload->>'scheduled_source'<>'completion_today')
    OR (payload->>'scheduled_source'='completion_today' AND (payload->>'date')::date IS DISTINCT FROM local_day)
   ) THEN RAISE EXCEPTION 'scheduler_bulk_completion_choice';END IF;
   UPDATE public.lessons SET completed=true,completed_at=(payload->>'completed_at')::timestamptz,
    date=CASE WHEN payload?'date' THEN (payload->>'date')::date ELSE date END,
    scheduled_date=CASE WHEN payload?'scheduled_date' THEN (payload->>'scheduled_date')::date ELSE scheduled_date END,
    queue_pinned=CASE WHEN payload?'queue_pinned' THEN (payload->>'queue_pinned')::boolean ELSE queue_pinned END,
    scheduled_source=CASE WHEN payload?'scheduled_source' THEN payload->>'scheduled_source' ELSE scheduled_source END,
    is_backfill=CASE WHEN payload?'is_backfill' THEN (payload->>'is_backfill')::boolean ELSE is_backfill END WHERE id=r.id;
   GET DIAGNOSTICS n=ROW_COUNT;IF n<>1 THEN RAISE EXCEPTION 'scheduler_bulk_completion_refused';END IF;
  END LOOP;
  PERFORM rooted_private.scheduler_respread_locked(p_goal_id,'completion_respread',local_day);
  SET CONSTRAINTS ALL IMMEDIATE;
  after_state:=rooted_private.scheduler_state(p_goal_id);
  IF EXISTS(SELECT 1 FROM jsonb_array_elements(p_items) x JOIN public.lessons l ON l.id=(x->>'lessonId')::uuid, jsonb_each(x->'payload') e WHERE to_jsonb(l)->e.key IS DISTINCT FROM CASE WHEN e.key='completed_at' THEN to_jsonb((e.value#>>'{}')::timestamptz) ELSE e.value END) THEN RAISE EXCEPTION 'scheduler_bulk_completion_payload_postcondition';END IF;
  -- Full membership and all work/content must survive; only the declared
  -- scheduling fields plus trigger timestamps may change.
  IF (SELECT array_agg(x->>'id' ORDER BY x->>'id') FROM jsonb_array_elements(have->'rows') x) IS DISTINCT FROM (SELECT array_agg(x->>'id' ORDER BY x->>'id') FROM jsonb_array_elements(after_state->'rows') x)
   OR EXISTS(SELECT 1 FROM jsonb_array_elements(have->'rows') b JOIN jsonb_array_elements(after_state->'rows') a ON a->>'id'=b->>'id' WHERE b-ARRAY['date','scheduled_date','scheduled_source','queue_pinned','completed','completed_at','is_backfill','updated_at'] IS DISTINCT FROM a-ARRAY['date','scheduled_date','scheduled_source','queue_pinned','completed','completed_at','is_backfill','updated_at'])
   OR EXISTS(SELECT 1 FROM jsonb_array_elements(have->'rows') b JOIN jsonb_array_elements(after_state->'rows') a ON a->>'id'=b->>'id' WHERE NOT (b->>'id')::uuid=ANY(selected_ids) AND b-ARRAY['date','scheduled_date','scheduled_source','updated_at'] IS DISTINCT FROM a-ARRAY['date','scheduled_date','scheduled_source','updated_at']) THEN RAISE EXCEPTION 'scheduler_bulk_completion_postcondition';END IF;
  SELECT jsonb_build_object('goal',jsonb_build_object('current_lesson',have->'goal'->'current_lesson','completed_at',have->'goal'->'completed_at'),'rows',jsonb_agg((SELECT jsonb_object_agg(k,v) FROM jsonb_each(x) e(k,v) WHERE k=ANY(ARRAY['id','date','scheduled_date','scheduled_source','queue_position','queue_pinned','queue_preserved','completed','completed_at','skipped','is_backfill'])))) INTO undo_state FROM jsonb_array_elements(have->'rows') x;
  PERFORM rooted_private.scheduler_disallow(p_goal_id);
  result:=jsonb_build_object('status','applied','operationId',p_operation_id,'count',cardinality(selected_ids));
  INSERT INTO rooted_private.scheduler_action_receipts(id,user_id,goal_id,request_hash,before_state,after_hash,result) VALUES(p_operation_id,u,p_goal_id,request_hash,undo_state,rooted_private.scheduler_hash(after_state),result);
  RETURN result;
 EXCEPTION WHEN lock_not_available THEN RETURN jsonb_build_object('status','busy');END;
EXCEPTION WHEN invalid_text_representation OR datetime_field_overflow OR invalid_datetime_format OR check_violation OR not_null_violation THEN RETURN jsonb_build_object('status','invalid','reason','shape');
END $$;
REVOKE ALL ON FUNCTION public.commit_scheduler_bulk_completion(uuid,uuid,jsonb,jsonb,date) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.commit_scheduler_bulk_completion(uuid,uuid,jsonb,jsonb,date) TO authenticated;
COMMIT;
