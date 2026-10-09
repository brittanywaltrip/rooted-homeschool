-- Fixed recalibration command. No caller-defined patch fields and no history deletion.
CREATE FUNCTION public.commit_scheduler_recalibration(p_operation_id uuid,p_goal_id uuid,p_expected jsonb,p_current integer,p_day date,p_history boolean,p_confirmed uuid[],p_dates jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE u uuid:=auth.uid();g public.curriculum_goals%rowtype;m text;before_state jsonb;after_state jsonb;canonical jsonb;
 prior rooted_private.scheduler_action_receipts%rowtype;request_hash text:=rooted_private.scheduler_hash(jsonb_build_object('kind','recalibration','goal',p_goal_id,'expected',p_expected,'current',p_current,'day',p_day,'history',p_history,'confirmed',p_confirmed,'dates',p_dates));
 gap uuid[];history_ids uuid[];unscheduled_ids uuid[];tail_ids uuid[];kept jsonb;changed_order boolean;w jsonb;r record;n integer;anchor date;first_day date;span integer;i integer:=0;estimate_day date;result jsonb;old_pointer integer;tz text;ordered jsonb;released uuid[];restore_result jsonb;projection jsonb;resumed uuid[];undo_state jsonb;
BEGIN
 IF u IS NULL OR p_operation_id IS NULL THEN RETURN jsonb_build_object('status','invalid','reason','owner');END IF;
 BEGIN
  IF NOT pg_try_advisory_xact_lock(hashtextextended(p_operation_id::text,0)) THEN RAISE lock_not_available;END IF;
  SELECT * INTO prior FROM rooted_private.scheduler_action_receipts WHERE id=p_operation_id;
  IF FOUND THEN
   IF prior.user_id<>u OR prior.goal_id<>p_goal_id OR prior.request_hash<>request_hash THEN RETURN jsonb_build_object('status','invalid','reason','operation');END IF;
   IF prior.undone_at IS NOT NULL THEN RETURN prior.result||jsonb_build_object('status','already_undone');END IF;
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
  IF p_day IS DISTINCT FROM (now() AT TIME ZONE tz)::date THEN RETURN jsonb_build_object('status','stale','reason','local_day_changed');END IF;
  IF p_current IS NULL OR p_current<1 OR p_current>g.total_lessons OR g.total_lessons>2000 OR p_history IS NULL OR p_day IS DISTINCT FROM (now() AT TIME ZONE tz)::date OR p_confirmed IS NULL OR jsonb_typeof(p_dates) IS DISTINCT FROM 'array' THEN RETURN jsonb_build_object('status','invalid','reason','shape');END IF;
  -- Restore the same occupied slots in book order, including sparse queues.
  WITH numbered AS (SELECT id,lesson_number,queue_position,row_number() OVER(ORDER BY lesson_number) rank FROM public.lessons WHERE curriculum_goal_id=p_goal_id AND lesson_number IS NOT NULL AND queue_position IS NOT NULL),
  slots AS (SELECT queue_position,row_number() OVER(ORDER BY queue_position) rank FROM numbered), mapping AS (SELECT n.id,s.queue_position FROM numbered n JOIN slots s USING(rank))
  SELECT jsonb_agg(to_jsonb(l)||jsonb_build_object('queue_position',coalesce(m.queue_position,l.queue_position)) ORDER BY l.id),bool_or(l.queue_position IS DISTINCT FROM coalesce(m.queue_position,l.queue_position)) INTO ordered,changed_order FROM public.lessons l LEFT JOIN mapping m ON m.id=l.id WHERE l.curriculum_goal_id=p_goal_id;
  ordered:=coalesce(ordered,'[]'::jsonb);changed_order:=coalesce(changed_order,false);
  old_pointer:=CASE WHEN changed_order THEN least(g.total_lessons,greatest(coalesce(g.start_at_lesson,1)-1,coalesce((SELECT max(queue_position) FROM jsonb_populate_recordset(NULL::public.lessons,ordered) WHERE completed),0))) ELSE greatest(0,coalesce(g.current_lesson,0)) END;
  SELECT coalesce(array_agg(id ORDER BY lesson_number),'{}') INTO gap FROM jsonb_populate_recordset(NULL::public.lessons,ordered) WHERE NOT completed AND lesson_number>old_pointer AND lesson_number<p_current AND (queue_position IS NULL OR queue_position>old_pointer);
  SELECT coalesce(array_agg(id ORDER BY lesson_number),'{}') INTO history_ids FROM public.lessons WHERE id=ANY(gap) AND NOT queue_pinned AND NOT skipped AND NOT queue_preserved;
  SELECT coalesce(jsonb_agg(lesson_number ORDER BY lesson_number),'[]') INTO kept FROM public.lessons WHERE id=ANY(gap) AND queue_pinned AND NOT skipped;
  IF p_history AND ((SELECT array_agg(x ORDER BY x) FROM unnest(p_confirmed) x) IS DISTINCT FROM (SELECT array_agg(x ORDER BY x) FROM unnest(history_ids) x)) THEN RETURN jsonb_build_object('status','stale','reason','history_list');END IF;
  -- Explicit resume releases only the selected preserved lesson. Sparse or
  -- unslotted mismatches refuse before writes rather than resume a different row.
  SELECT coalesce(array_agg(id),'{}') INTO resumed FROM public.lessons WHERE curriculum_goal_id=p_goal_id AND lesson_number=p_current AND NOT completed AND queue_preserved;
  IF cardinality(resumed)>1 OR EXISTS(SELECT 1 FROM jsonb_populate_recordset(NULL::public.lessons,ordered) WHERE id=ANY(resumed) AND (queue_position IS DISTINCT FROM p_current OR skipped OR coalesce(is_backfill,false))) THEN RETURN jsonb_build_object('status','invalid','reason','selected_queue');END IF;
  SELECT coalesce(array_agg(id),'{}') INTO released FROM public.lessons WHERE curriculum_goal_id=p_goal_id AND lesson_number=p_current AND NOT completed AND queue_pinned;
  SELECT coalesce(array_agg(id),'{}') INTO unscheduled_ids FROM public.lessons WHERE id=ANY(gap) AND NOT queue_pinned AND NOT queue_preserved AND scheduled_date IS NOT NULL;
  SELECT coalesce(array_agg(id),'{}') INTO tail_ids FROM jsonb_populate_recordset(NULL::public.lessons,ordered) WHERE queue_position>=p_current AND NOT completed AND NOT skipped AND NOT coalesce(is_backfill,false) AND (NOT queue_pinned OR id=ANY(released)) AND (NOT queue_preserved OR id=ANY(resumed));
  IF jsonb_array_length(p_dates)<>cardinality(tail_ids) OR (SELECT count(DISTINCT x->>'id') FROM jsonb_array_elements(p_dates) x)<>cardinality(tail_ids) OR EXISTS(SELECT 1 FROM jsonb_array_elements(p_dates) x WHERE jsonb_typeof(x)<>'object' OR NOT ((x->>'id')::uuid=ANY(tail_ids)) OR (x->>'date')::date<p_day OR (x->>'date')::date>=p_day+3650 OR x->>'date' IS NULL OR EXISTS(SELECT 1 FROM jsonb_object_keys(x) k WHERE k NOT IN ('id','date'))) THEN RETURN jsonb_build_object('status','invalid','reason','tail_scope');END IF;
  canonical:=rooted_private.cascade_local_window(u,p_day);
  PERFORM rooted_private.scheduler_allow(p_goal_id,'recalibration',ARRAY(SELECT id FROM public.lessons WHERE curriculum_goal_id=p_goal_id),ARRAY['queue_position','date','scheduled_date','scheduled_source','queue_pinned','queue_preserved','completed','completed_at'],ARRAY['current_lesson','start_at_lesson','completed_at']);
  UPDATE rooted_private.scheduler_capabilities SET explicit_ids=resumed WHERE tx=txid_current() AND goal_id=p_goal_id;
  IF changed_order THEN
   restore_result:=rooted_private.contained_restore_queue_book_order(p_goal_id,p_day);
   IF restore_result->>'status' IS DISTINCT FROM 'restored' THEN RAISE EXCEPTION 'scheduler_recalibration_order';END IF;
  END IF;
  UPDATE public.lessons SET queue_preserved=false,queue_pinned=false,scheduled_source='recalibrate_respread' WHERE id=ANY(resumed);
  UPDATE public.lessons SET queue_pinned=false,scheduled_source='recalibrate_respread' WHERE id=ANY(released);
  UPDATE public.curriculum_goals SET current_lesson=p_current-1,start_at_lesson=p_current WHERE id=p_goal_id;
  IF p_history THEN
   SELECT max((completed_at AT TIME ZONE tz)::date) INTO anchor FROM public.lessons WHERE curriculum_goal_id=p_goal_id AND completed AND scheduled_source IS DISTINCT FROM 'recalibrate_estimate';
   anchor:=coalesce(anchor,g.start_date,(g.created_at AT TIME ZONE tz)::date,p_day-1);
   first_day:=least(anchor+1,p_day-1);span:=p_day-1-first_day;
   IF span>36500 THEN RAISE EXCEPTION 'scheduler_recalibration_history_window';END IF;
   FOR r IN SELECT id FROM public.lessons WHERE id=ANY(history_ids) ORDER BY lesson_number LOOP
    estimate_day:=first_day+CASE WHEN cardinality(history_ids)<=1 THEN 0 ELSE floor(i::numeric*span/(cardinality(history_ids)-1))::integer END;
    UPDATE public.lessons SET completed=true,completed_at=(estimate_day::text||'T12:00:00Z')::timestamptz,date=estimate_day,scheduled_date=estimate_day,scheduled_source='recalibrate_estimate' WHERE id=r.id;
    GET DIAGNOSTICS n=ROW_COUNT;IF n<>1 OR NOT EXISTS(SELECT 1 FROM public.lessons WHERE id=r.id AND completed AND date=estimate_day AND scheduled_date=estimate_day AND completed_at=(estimate_day::text||'T12:00:00Z')::timestamptz AND scheduled_source='recalibrate_estimate') THEN RAISE EXCEPTION 'scheduler_recalibration_refused';END IF;i:=i+1;
   END LOOP;
  ELSE
   UPDATE public.lessons SET scheduled_date=NULL,scheduled_source='recalibrate_respread' WHERE id=ANY(unscheduled_ids);
  END IF;
  projection:=rooted_private.scheduler_project_dates(rooted_private.cascade_snapshot(p_goal_id,p_day,canonical->>'dayStartIso',canonical->>'dayEndIso'));
  FOR w IN SELECT * FROM jsonb_array_elements(p_dates) LOOP
   IF w->>'date' IS DISTINCT FROM projection->>(SELECT queue_position::text FROM public.lessons WHERE id=(w->>'id')::uuid) THEN RAISE EXCEPTION 'scheduler_recalibration_proposal';END IF;
   UPDATE public.lessons SET date=(w->>'date')::date,scheduled_date=(w->>'date')::date,scheduled_source='recalibrate_respread' WHERE id=(w->>'id')::uuid;
   GET DIAGNOSTICS n=ROW_COUNT;IF n<>1 THEN RAISE EXCEPTION 'scheduler_recalibration_refused';END IF;
  END LOOP;
  SET CONSTRAINTS ALL IMMEDIATE;
  IF EXISTS(SELECT 1 FROM public.lessons l WHERE l.id=ANY(tail_ids) AND (l.scheduled_date IS DISTINCT FROM (projection->>l.queue_position::text)::date OR l.date IS DISTINCT FROM l.scheduled_date OR l.scheduled_source IS DISTINCT FROM 'recalibrate_respread')) OR NOT EXISTS(SELECT 1 FROM public.curriculum_goals WHERE id=p_goal_id AND current_lesson=p_current-1 AND start_at_lesson=p_current) THEN RAISE EXCEPTION 'scheduler_recalibration_projection';END IF;
  IF EXISTS(SELECT 1 FROM jsonb_populate_recordset(NULL::public.lessons,ordered) b JOIN public.lessons l USING(id) WHERE l.queue_position IS DISTINCT FROM b.queue_position) OR (NOT p_history AND EXISTS(SELECT 1 FROM public.lessons WHERE id=ANY(unscheduled_ids) AND (scheduled_date IS NOT NULL OR scheduled_source IS DISTINCT FROM 'recalibrate_respread'))) THEN RAISE EXCEPTION 'scheduler_recalibration_incomplete';END IF;
  -- Certify each changed field against its explicit operation membership.
  IF EXISTS(SELECT 1 FROM jsonb_array_elements(before_state->'rows') b JOIN public.lessons l ON l.id=(b->>'id')::uuid, jsonb_each(b) e WHERE e.value IS DISTINCT FROM to_jsonb(l)->e.key AND e.key NOT IN ('updated_at','queue_position')
   AND NOT (p_history AND l.id=ANY(history_ids) AND e.key=ANY(ARRAY['completed','completed_at','date','scheduled_date','scheduled_source']))
   AND NOT (l.id=ANY(tail_ids) AND e.key=ANY(ARRAY['date','scheduled_date','scheduled_source']))
   AND NOT (NOT p_history AND l.id=ANY(unscheduled_ids) AND e.key=ANY(ARRAY['scheduled_date','scheduled_source']))
   AND NOT (l.id=ANY(released) AND e.key=ANY(ARRAY['queue_pinned','scheduled_source']))
   AND NOT (l.id=ANY(resumed) AND e.key=ANY(ARRAY['queue_preserved','queue_pinned','scheduled_source'])))
   OR EXISTS(SELECT 1 FROM public.lessons WHERE id=ANY(resumed) AND (queue_preserved OR queue_pinned OR completed OR queue_position IS DISTINCT FROM p_current OR scheduled_date IS DISTINCT FROM (projection->>p_current::text)::date))
   OR EXISTS(SELECT 1 FROM public.lessons WHERE id=ANY(released) AND queue_pinned)
   OR (SELECT count(*) FROM public.lessons WHERE curriculum_goal_id=p_goal_id)<>jsonb_array_length(before_state->'rows')
   THEN RAISE EXCEPTION 'scheduler_recalibration_preservation';END IF;
  PERFORM rooted_private.scheduler_disallow(p_goal_id);
  after_state:=rooted_private.scheduler_state(p_goal_id);
  IF (after_state->'goal')-'updated_at' IS DISTINCT FROM ((before_state->'goal')||jsonb_build_object('current_lesson',p_current-1,'start_at_lesson',p_current))-'updated_at' OR before_state-ARRAY['goal','rows'] IS DISTINCT FROM after_state-ARRAY['goal','rows'] OR (SELECT array_agg(x->>'id' ORDER BY x->>'id') FROM jsonb_array_elements(before_state->'rows') x) IS DISTINCT FROM (SELECT array_agg(x->>'id' ORDER BY x->>'id') FROM jsonb_array_elements(after_state->'rows') x) THEN RAISE EXCEPTION 'scheduler_recalibration_membership';END IF;
  result:=jsonb_build_object('status','applied','kind','recalibration','resumedLessonIds',to_jsonb(resumed),'gapCount',cardinality(gap),'keptPinned',kept,'estimates',CASE WHEN p_history THEN to_jsonb(history_ids) ELSE '[]'::jsonb END,'unscheduled',CASE WHEN p_history THEN '[]'::jsonb ELSE to_jsonb(unscheduled_ids) END,'respread',to_jsonb(tail_ids),'bookOrderRestored',changed_order,'releasedPin',to_jsonb(released));
  SELECT jsonb_build_object('goal',jsonb_build_object('current_lesson',before_state->'goal'->'current_lesson','start_at_lesson',before_state->'goal'->'start_at_lesson','completed_at',before_state->'goal'->'completed_at'),'rows',coalesce(jsonb_agg((SELECT jsonb_object_agg(k,v) FROM jsonb_each(x) e(k,v) WHERE k=ANY(ARRAY['id','date','scheduled_date','scheduled_source','queue_position','queue_pinned','queue_preserved','completed','completed_at','skipped','is_backfill']))),'[]'::jsonb)) INTO undo_state FROM jsonb_array_elements(before_state->'rows') x;
  INSERT INTO rooted_private.scheduler_action_receipts(id,user_id,goal_id,request_hash,before_state,after_hash,result) VALUES(p_operation_id,u,p_goal_id,request_hash,undo_state,rooted_private.scheduler_hash(after_state),result);
  RETURN result;
 EXCEPTION WHEN lock_not_available THEN RETURN jsonb_build_object('status','busy','reason','busy');END;
EXCEPTION WHEN invalid_text_representation OR datetime_field_overflow OR invalid_datetime_format OR check_violation OR not_null_violation THEN RETURN jsonb_build_object('status','invalid','reason','shape');
END $$;
REVOKE ALL ON FUNCTION public.commit_scheduler_recalibration(uuid,uuid,jsonb,integer,date,boolean,uuid[],jsonb) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.commit_scheduler_recalibration(uuid,uuid,jsonb,integer,date,boolean,uuid[],jsonb) TO authenticated;

CREATE FUNCTION public.undo_scheduler_recalibration(p_operation_id uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE r rooted_private.scheduler_action_receipts%rowtype;s jsonb;w jsonb;after_state jsonb;fields text[]:=ARRAY['date','scheduled_date','scheduled_source','queue_position','queue_pinned','queue_preserved','completed','completed_at','skipped','is_backfill'];
BEGIN
 BEGIN
  IF auth.uid() IS NULL THEN RETURN jsonb_build_object('status','invalid','reason','owner');END IF;
  IF NOT pg_try_advisory_xact_lock(hashtextextended(p_operation_id::text,0)) THEN RAISE lock_not_available;END IF;
  SELECT * INTO r FROM rooted_private.scheduler_action_receipts WHERE id=p_operation_id AND user_id=auth.uid() FOR UPDATE NOWAIT;
  IF NOT FOUND THEN RETURN jsonb_build_object('status','stale','reason','later_edit');END IF;
  IF r.result->>'kind' IS DISTINCT FROM 'recalibration' THEN RETURN jsonb_build_object('status','invalid','reason','operation');END IF;
  IF r.undone_at IS NOT NULL THEN RETURN jsonb_build_object('status','already_undone');END IF;
  IF r.before_state IS NULL OR clock_timestamp()>r.created_at+interval '10 minutes' THEN RETURN jsonb_build_object('status','invalid','reason','expired');END IF;
  PERFORM rooted_private.scheduler_lock_owner(auth.uid(),false);
  PERFORM 1 FROM public.curriculum_goals WHERE id=r.goal_id AND user_id=auth.uid() FOR UPDATE NOWAIT;
  IF NOT FOUND THEN RETURN jsonb_build_object('status','stale','reason','later_edit');END IF;
  PERFORM 1 FROM public.lessons WHERE curriculum_goal_id=r.goal_id ORDER BY id FOR UPDATE NOWAIT;
  s:=rooted_private.scheduler_state(r.goal_id);
  IF rooted_private.scheduler_hash(s) IS DISTINCT FROM r.after_hash THEN RETURN jsonb_build_object('status','stale','reason','later_edit');END IF;
  PERFORM rooted_private.scheduler_allow(r.goal_id,'undo',ARRAY(SELECT (x->>'id')::uuid FROM jsonb_array_elements(r.before_state->'rows') x),fields,ARRAY['current_lesson','start_at_lesson','completed_at']);
  -- Clear changed slots first so restoring a legacy earlier move cannot collide.
  UPDATE public.lessons l SET queue_position=NULL FROM jsonb_array_elements(r.before_state->'rows') x WHERE l.id=(x->>'id')::uuid AND to_jsonb(l.queue_position) IS DISTINCT FROM x->'queue_position';
  FOR w IN SELECT x FROM jsonb_array_elements(r.before_state->'rows') x ORDER BY (x->>'queue_position')::integer DESC NULLS LAST,x->>'id' LOOP
   UPDATE public.lessons SET date=(w->>'date')::date,scheduled_date=(w->>'scheduled_date')::date,scheduled_source=w->>'scheduled_source',queue_position=(w->>'queue_position')::integer,queue_pinned=(w->>'queue_pinned')::boolean,queue_preserved=(w->>'queue_preserved')::boolean,completed=(w->>'completed')::boolean,completed_at=(w->>'completed_at')::timestamptz,skipped=(w->>'skipped')::boolean,is_backfill=(w->>'is_backfill')::boolean WHERE id=(w->>'id')::uuid AND EXISTS(SELECT 1 FROM jsonb_each(w) e WHERE e.key<>'id' AND to_jsonb(lessons)->e.key IS DISTINCT FROM e.value);
  END LOOP;
  UPDATE public.curriculum_goals SET start_at_lesson=(r.before_state->'goal'->>'start_at_lesson')::integer,current_lesson=(r.before_state->'goal'->>'current_lesson')::integer,completed_at=(r.before_state->'goal'->>'completed_at')::timestamptz WHERE id=r.goal_id AND (start_at_lesson IS DISTINCT FROM (r.before_state->'goal'->>'start_at_lesson')::integer OR current_lesson IS DISTINCT FROM (r.before_state->'goal'->>'current_lesson')::integer OR completed_at IS DISTINCT FROM (r.before_state->'goal'->>'completed_at')::timestamptz);
  IF (SELECT array_agg(x->>'id' ORDER BY x->>'id') FROM jsonb_array_elements(r.before_state->'rows') x) IS DISTINCT FROM (SELECT array_agg(id::text ORDER BY id::text) FROM public.lessons WHERE curriculum_goal_id=r.goal_id) THEN RAISE EXCEPTION 'scheduler_undo_membership';END IF;
  IF EXISTS(SELECT 1 FROM jsonb_array_elements(r.before_state->'rows') x JOIN public.lessons l ON l.id=(x->>'id')::uuid, jsonb_each(x) e WHERE to_jsonb(l)->e.key IS DISTINCT FROM e.value) THEN RAISE EXCEPTION 'scheduler_undo_postcondition';END IF;
  SET CONSTRAINTS ALL IMMEDIATE;
  after_state:=rooted_private.scheduler_state(r.goal_id);
  IF (after_state->'goal')-'updated_at' IS DISTINCT FROM ((s->'goal')||(r.before_state->'goal'))-'updated_at' OR s-ARRAY['goal','rows'] IS DISTINCT FROM after_state-ARRAY['goal','rows']
   OR EXISTS(SELECT 1 FROM jsonb_array_elements(s->'rows') b JOIN jsonb_array_elements(r.before_state->'rows') wanted ON wanted->>'id'=b->>'id' JOIN jsonb_array_elements(after_state->'rows') actual ON actual->>'id'=b->>'id' WHERE actual-'updated_at' IS DISTINCT FROM (b||wanted)-'updated_at') THEN RAISE EXCEPTION 'scheduler_recalibration_undo_preservation';END IF;
  PERFORM rooted_private.scheduler_disallow(r.goal_id);
  UPDATE rooted_private.scheduler_action_receipts SET undone_at=clock_timestamp(),before_state=NULL WHERE id=r.id;
  RETURN jsonb_build_object('status','undone');
 EXCEPTION WHEN lock_not_available THEN RETURN jsonb_build_object('status','busy','reason','busy');END;
END $$;
REVOKE ALL ON FUNCTION public.undo_scheduler_recalibration(uuid) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.undo_scheduler_recalibration(uuid) TO authenticated;
