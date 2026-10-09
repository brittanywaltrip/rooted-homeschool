-- Fixed cross-course Edit for rows that do not hold a curriculum lesson number.
-- Serialize family membership; preserve all unrelated rows and recorded work.
CREATE FUNCTION public.commit_scheduler_reassign(p_operation_id uuid,p_expected jsonb,p_lesson_id uuid,p_changes jsonb,p_originals jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE u uuid:=auth.uid();r public.lessons%rowtype;next_row public.lessons%rowtype;g uuid;goals uuid[];before_state jsonb;after_state jsonb;desired jsonb;prior rooted_private.scheduler_action_receipts%rowtype;request_hash text;result jsonb;n integer;undo_state jsonb;
BEGIN
 BEGIN
  IF u IS NULL OR p_operation_id IS NULL OR jsonb_typeof(p_changes) IS DISTINCT FROM 'object' OR NOT p_changes?'curriculum_goal_id' OR EXISTS(SELECT 1 FROM jsonb_object_keys(p_changes) k WHERE k NOT IN ('curriculum_goal_id','child_id','title','lesson_number','minutes_spent','scheduled_date')) THEN RETURN jsonb_build_object('status','invalid','reason','shape');END IF;
  PERFORM rooted_private.scheduler_lock_owner(u,true);
  IF NOT pg_try_advisory_xact_lock(hashtextextended(p_operation_id::text,0)) THEN RAISE lock_not_available;END IF;
  request_hash:=rooted_private.scheduler_hash(jsonb_build_object('expected',p_expected,'lesson',p_lesson_id,'changes',p_changes,'originals',p_originals));
  SELECT * INTO prior FROM rooted_private.scheduler_action_receipts WHERE id=p_operation_id FOR UPDATE NOWAIT;
  IF FOUND THEN
   IF prior.user_id<>u OR prior.request_hash<>request_hash OR prior.result->>'kind' IS DISTINCT FROM 'reassign' THEN RETURN jsonb_build_object('status','invalid','reason','operation');END IF;
   RETURN prior.result||jsonb_build_object('status',CASE WHEN prior.undone_at IS NULL THEN 'already_applied' ELSE 'already_undone' END);
  END IF;
  PERFORM 1 FROM public.curriculum_goals WHERE user_id=u ORDER BY id FOR UPDATE NOWAIT;
  PERFORM 1 FROM public.lessons WHERE user_id=u ORDER BY id FOR UPDATE NOWAIT;
  PERFORM 1 FROM public.profiles WHERE id=u FOR SHARE NOWAIT;
  before_state:=rooted_private.scheduler_calendar_state(u);
  IF before_state IS DISTINCT FROM p_expected THEN RETURN jsonb_build_object('status','stale','reason','schedule_changed');END IF;
  SELECT * INTO r FROM public.lessons WHERE id=p_lesson_id AND user_id=u;
  IF NOT FOUND OR (r.curriculum_goal_id IS NOT NULL AND r.lesson_number IS NOT NULL) THEN RETURN jsonb_build_object('status','invalid','reason','slot_holder');END IF;
  IF jsonb_typeof(p_originals) IS DISTINCT FROM 'object' OR EXISTS(SELECT 1 FROM jsonb_object_keys(p_changes) k WHERE NOT p_originals?k) OR EXISTS(SELECT 1 FROM jsonb_each(p_originals) e WHERE CASE WHEN e.key='scheduled_date' THEN to_jsonb(coalesce(r.scheduled_date,r.date)) ELSE to_jsonb(r)->e.key END IS DISTINCT FROM e.value) THEN RETURN jsonb_build_object('status','invalid','reason','originals');END IF;
  desired:=to_jsonb(r)||p_changes;
  IF p_changes?'minutes_spent' THEN desired:=desired||jsonb_build_object('hours',coalesce(((p_changes->>'minutes_spent')::double precision/60)::numeric,0));END IF;
  IF p_changes?'scheduled_date' THEN
   IF p_changes->>'scheduled_date' IS NULL OR p_changes->>'scheduled_date' !~ '^\d{4}-\d{2}-\d{2}$' THEN RETURN jsonb_build_object('status','invalid','reason','date');END IF;
   desired:=desired||jsonb_build_object('date',p_changes->'scheduled_date','queue_pinned',true,'scheduled_source','plan_move');
  END IF;
  next_row:=jsonb_populate_record(NULL::public.lessons,desired);
  SELECT array_agg(x ORDER BY x) INTO goals FROM (SELECT DISTINCT x FROM unnest(ARRAY[r.curriculum_goal_id,next_row.curriculum_goal_id]) x WHERE x IS NOT NULL) q;
  IF cardinality(goals) IS NULL THEN RETURN jsonb_build_object('status','legacy');END IF;
  IF (SELECT count(*) FROM public.curriculum_goals WHERE id=ANY(goals) AND user_id=u AND NOT archived)<>cardinality(goals) THEN RETURN jsonb_build_object('status','invalid','reason','owner');END IF;
  IF NOT EXISTS(SELECT 1 FROM rooted_private.scheduler_modes WHERE goal_id=ANY(goals)) THEN RETURN jsonb_build_object('status','legacy');END IF;
  IF EXISTS(SELECT 1 FROM rooted_private.scheduler_modes WHERE goal_id=ANY(goals) AND mode='paused') THEN RETURN jsonb_build_object('status','paused');END IF;
  IF next_row.child_id IS NULL AND next_row.curriculum_goal_id IS NOT NULL THEN SELECT child_id INTO next_row.child_id FROM public.curriculum_goals WHERE id=next_row.curriculum_goal_id;desired:=desired||jsonb_build_object('child_id',next_row.child_id);END IF;
  IF next_row.child_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.children WHERE id=next_row.child_id AND user_id=u) THEN RETURN jsonb_build_object('status','invalid','reason','child');END IF;
  FOREACH g IN ARRAY goals LOOP
   PERFORM rooted_private.scheduler_allow(g,'reassign',ARRAY[r.id],ARRAY['curriculum_goal_id','child_id','lesson_number','date','scheduled_date','scheduled_source','queue_pinned'],ARRAY['current_lesson','completed_at']);
  END LOOP;
  UPDATE public.lessons SET curriculum_goal_id=next_row.curriculum_goal_id,child_id=next_row.child_id,title=next_row.title,lesson_number=next_row.lesson_number,minutes_spent=next_row.minutes_spent,hours=next_row.hours,date=next_row.date,scheduled_date=next_row.scheduled_date,scheduled_source=next_row.scheduled_source,queue_pinned=next_row.queue_pinned WHERE id=r.id AND user_id=u;
  GET DIAGNOSTICS n=ROW_COUNT;IF n<>1 THEN RAISE EXCEPTION 'scheduler_reassign_rowcount';END IF;
  SET CONSTRAINTS ALL IMMEDIATE;
  after_state:=rooted_private.scheduler_calendar_state(u);
  IF NOT EXISTS(SELECT 1 FROM public.lessons l WHERE l.id=r.id AND to_jsonb(l)-'updated_at'=desired-'updated_at') OR before_state-ARRAY['rows','goals'] IS DISTINCT FROM after_state-ARRAY['rows','goals'] OR jsonb_array_length(before_state->'rows')<>jsonb_array_length(after_state->'rows') OR EXISTS(SELECT 1 FROM jsonb_array_elements(before_state->'rows') b WHERE b->>'id'<>r.id::text AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(after_state->'rows') a WHERE a-'updated_at'=b-'updated_at')) OR EXISTS(SELECT 1 FROM jsonb_array_elements(before_state->'goals') b WHERE NOT EXISTS(SELECT 1 FROM jsonb_array_elements(after_state->'goals') a WHERE a-(CASE WHEN (b->>'id')::uuid=ANY(goals) THEN ARRAY['current_lesson','completed_at','updated_at'] ELSE ARRAY['updated_at'] END)=b-(CASE WHEN (b->>'id')::uuid=ANY(goals) THEN ARRAY['current_lesson','completed_at','updated_at'] ELSE ARRAY['updated_at'] END))) THEN RAISE EXCEPTION 'scheduler_reassign_postcondition';END IF;
  IF jsonb_array_length(before_state->'goals')<>jsonb_array_length(after_state->'goals') OR EXISTS(
   SELECT 1 FROM public.curriculum_goals c JOIN jsonb_array_elements(before_state->'goals') b ON b->>'id'=c.id::text WHERE c.id=ANY(goals) AND (
    to_jsonb(c)->'completed_at' IS DISTINCT FROM b->'completed_at' OR c.current_lesson IS DISTINCT FROM CASE WHEN r.curriculum_goal_id IS DISTINCT FROM next_row.curriculum_goal_id THEN least(c.total_lessons,greatest(coalesce(c.start_at_lesson,1)-1,coalesce((SELECT max(l.queue_position) FROM public.lessons l WHERE l.curriculum_goal_id=c.id AND l.completed AND l.queue_position IS NOT NULL),0))) ELSE (b->>'current_lesson')::integer END)
  ) THEN RAISE EXCEPTION 'scheduler_reassign_goal_postcondition';END IF;
  SELECT jsonb_build_object('row',(SELECT jsonb_object_agg(k,v) FROM jsonb_each(to_jsonb(r)) e(k,v) WHERE k=ANY(ARRAY['id','curriculum_goal_id','child_id','title','lesson_number','minutes_spent','hours','date','scheduled_date','scheduled_source','queue_pinned'])),'goals',(SELECT jsonb_agg(jsonb_build_object('id',x->'id','current_lesson',x->'current_lesson','completed_at',x->'completed_at')) FROM jsonb_array_elements(before_state->'goals') x WHERE (x->>'id')::uuid=ANY(goals))) INTO undo_state;
  result:=jsonb_build_object('status','applied','kind','reassign','operationId',p_operation_id,'lessonId',r.id,'goals',to_jsonb(goals));
  INSERT INTO rooted_private.scheduler_action_receipts(id,user_id,goal_id,request_hash,before_state,after_hash,result) VALUES(p_operation_id,u,goals[1],request_hash,undo_state,rooted_private.scheduler_hash(after_state),result);
  FOREACH g IN ARRAY goals LOOP PERFORM rooted_private.scheduler_disallow(g);END LOOP;
  RETURN result;
 EXCEPTION WHEN lock_not_available THEN RETURN jsonb_build_object('status','busy');END;
EXCEPTION WHEN invalid_text_representation OR datetime_field_overflow OR invalid_datetime_format OR check_violation OR not_null_violation THEN RETURN jsonb_build_object('status','invalid','reason','shape');
END $$;
CREATE FUNCTION public.undo_scheduler_reassign(p_operation_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE u uuid:=auth.uid();r rooted_private.scheduler_action_receipts%rowtype;g uuid;goals uuid[];w jsonb;s jsonb;after_state jsonb;n integer;
BEGIN
 BEGIN
  IF u IS NULL THEN RETURN jsonb_build_object('status','invalid','reason','owner');END IF;
  PERFORM rooted_private.scheduler_lock_owner(u,true);
  IF NOT pg_try_advisory_xact_lock(hashtextextended(p_operation_id::text,0)) THEN RAISE lock_not_available;END IF;
  SELECT * INTO r FROM rooted_private.scheduler_action_receipts WHERE id=p_operation_id AND user_id=u FOR UPDATE NOWAIT;
  IF NOT FOUND OR r.result->>'kind' IS DISTINCT FROM 'reassign' THEN RETURN jsonb_build_object('status','invalid','reason','operation');END IF;
  IF r.undone_at IS NOT NULL THEN RETURN jsonb_build_object('status','already_undone');END IF;
  IF r.before_state IS NULL OR clock_timestamp()>r.created_at+interval '10 minutes' THEN RETURN jsonb_build_object('status','invalid','reason','expired');END IF;
  PERFORM 1 FROM public.curriculum_goals WHERE user_id=u ORDER BY id FOR UPDATE NOWAIT;
  PERFORM 1 FROM public.lessons WHERE user_id=u ORDER BY id FOR UPDATE NOWAIT;
  PERFORM 1 FROM public.profiles WHERE id=u FOR SHARE NOWAIT;
  s:=rooted_private.scheduler_calendar_state(u);
  IF rooted_private.scheduler_hash(s)<>r.after_hash THEN RETURN jsonb_build_object('status','stale','reason','later_edit');END IF;
  SELECT array_agg(value::uuid) INTO goals FROM jsonb_array_elements_text(r.result->'goals');w:=r.before_state->'row';
  FOREACH g IN ARRAY goals LOOP PERFORM rooted_private.scheduler_allow(g,'reassign_undo',ARRAY[(w->>'id')::uuid],ARRAY['curriculum_goal_id','child_id','lesson_number','date','scheduled_date','scheduled_source','queue_pinned'],ARRAY['current_lesson','completed_at']);END LOOP;
  UPDATE public.lessons SET curriculum_goal_id=(w->>'curriculum_goal_id')::uuid,child_id=(w->>'child_id')::uuid,title=w->>'title',lesson_number=(w->>'lesson_number')::integer,minutes_spent=(w->>'minutes_spent')::integer,hours=(w->>'hours')::numeric,date=(w->>'date')::date,scheduled_date=(w->>'scheduled_date')::date,scheduled_source=w->>'scheduled_source',queue_pinned=(w->>'queue_pinned')::boolean WHERE id=(w->>'id')::uuid AND user_id=u;
  GET DIAGNOSTICS n=ROW_COUNT;IF n<>1 THEN RAISE EXCEPTION 'scheduler_reassign_undo_rowcount';END IF;
  FOR w IN SELECT * FROM jsonb_array_elements(r.before_state->'goals') LOOP UPDATE public.curriculum_goals SET current_lesson=(w->>'current_lesson')::integer,completed_at=(w->>'completed_at')::timestamptz WHERE id=(w->>'id')::uuid AND user_id=u AND (current_lesson IS DISTINCT FROM (w->>'current_lesson')::integer OR completed_at IS DISTINCT FROM (w->>'completed_at')::timestamptz);END LOOP;
  SET CONSTRAINTS ALL IMMEDIATE;
  after_state:=rooted_private.scheduler_calendar_state(u);w:=r.before_state->'row';
  IF NOT EXISTS(SELECT 1 FROM public.lessons l WHERE l.id=(w->>'id')::uuid AND to_jsonb(l)-'updated_at'=((SELECT b FROM jsonb_array_elements(s->'rows') b WHERE b->>'id'=w->>'id')||w)-'updated_at') OR EXISTS(SELECT 1 FROM jsonb_array_elements(r.before_state->'goals') b WHERE NOT EXISTS(SELECT 1 FROM public.curriculum_goals c WHERE to_jsonb(c) @> b)) OR jsonb_array_length(s->'rows')<>jsonb_array_length(after_state->'rows') OR EXISTS(SELECT 1 FROM jsonb_array_elements(s->'rows') b WHERE b->>'id'<>w->>'id' AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(after_state->'rows') a WHERE a-'updated_at'=b-'updated_at')) OR s-ARRAY['rows','goals'] IS DISTINCT FROM after_state-ARRAY['rows','goals'] OR jsonb_array_length(s->'goals')<>jsonb_array_length(after_state->'goals') OR EXISTS(SELECT 1 FROM jsonb_array_elements(s->'goals') b WHERE NOT EXISTS(SELECT 1 FROM jsonb_array_elements(after_state->'goals') a WHERE a-'updated_at'=(b||coalesce((SELECT x FROM jsonb_array_elements(r.before_state->'goals') x WHERE x->>'id'=b->>'id'),'{}'::jsonb))-'updated_at')) THEN RAISE EXCEPTION 'scheduler_reassign_undo_postcondition';END IF;
  FOREACH g IN ARRAY goals LOOP PERFORM rooted_private.scheduler_disallow(g);END LOOP;
  UPDATE rooted_private.scheduler_action_receipts SET undone_at=clock_timestamp(),before_state=NULL WHERE id=r.id;
  RETURN jsonb_build_object('status','undone');
 EXCEPTION WHEN lock_not_available THEN RETURN jsonb_build_object('status','busy');END;
END $$;
REVOKE ALL ON FUNCTION public.commit_scheduler_reassign(uuid,jsonb,uuid,jsonb,jsonb),public.undo_scheduler_reassign(uuid) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.commit_scheduler_reassign(uuid,jsonb,uuid,jsonb,jsonb),public.undo_scheduler_reassign(uuid) TO authenticated;

-- Only an exact, unexpired, unchanged receipt can enter reassign_undo.
DO $$ BEGIN IF (SELECT md5(prosrc) FROM pg_proc WHERE oid='public.block_lesson_goal_detach()'::regprocedure) IS DISTINCT FROM '7c6c4acece1559d36d72a967d94ef3b9' THEN RAISE EXCEPTION 'Goal detach baseline drift';END IF;END $$;
CREATE OR REPLACE FUNCTION public.block_lesson_goal_detach()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
BEGIN
  IF OLD.curriculum_goal_id IS NULL OR NEW.curriculum_goal_id IS NOT NULL THEN
    RETURN NEW;
  END IF;
  IF EXISTS(SELECT 1 FROM rooted_private.scheduler_capabilities c WHERE c.tx=txid_current() AND c.goal_id=OLD.curriculum_goal_id AND c.owner_id=auth.uid() AND c.owner_id=OLD.user_id AND c.operation='reassign_undo' AND OLD.id=ANY(c.row_ids) AND 'curriculum_goal_id'=ANY(c.lesson_fields)) THEN RETURN NEW;END IF;
  IF OLD.lesson_number IS NULL THEN
    RETURN NEW;
  END IF;
  IF current_setting('rooted.allow_goal_detach', true) = 'true' THEN
    RETURN NEW;
  END IF;
  -- Both exemptions in one test: the goal is gone (an ON DELETE SET NULL
  -- cascade is running) or it is archived (its slots are not projected).
  IF NOT EXISTS (
    SELECT 1 FROM public.curriculum_goals g
    WHERE g.id = OLD.curriculum_goal_id AND g.archived = false
  ) THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION
    'Lesson % of this curriculum cannot be moved out of it: the curriculum would be left with a blank day nothing refills. Add a separate lesson instead.',
    OLD.lesson_number
    USING ERRCODE = 'check_violation';
END;
$function$;
REVOKE ALL ON FUNCTION public.block_lesson_goal_detach() FROM PUBLIC,anon,authenticated,service_role;
