CREATE FUNCTION public.commit_scheduler_action(p_operation_id uuid,p_goal_id uuid,p_expected jsonb,p_action jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE u uuid:=auth.uid();m text; prior rooted_private.scheduler_action_receipts%rowtype; have jsonb;after_state jsonb;request_hash text:=rooted_private.scheduler_hash(jsonb_build_object('goal',p_goal_id,'expected',p_expected,'action',p_action));r public.lessons%rowtype; payload jsonb; result jsonb; key text;kind text:=p_action->>'kind'; ids uuid[]; undo_state jsonb; fields text[]; n integer; w jsonb; selected_ids uuid[]; canonical jsonb;
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
  IF m='paused' THEN RETURN jsonb_build_object('status','paused','reason','scheduler_paused');END IF;
  PERFORM rooted_private.scheduler_lock_owner(auth.uid(),false);
  PERFORM 1 FROM public.lessons WHERE curriculum_goal_id=p_goal_id ORDER BY id FOR UPDATE NOWAIT;
  PERFORM 1 FROM public.profiles WHERE id=u FOR SHARE NOWAIT;
  PERFORM rooted_private.scheduler_lock_owner(auth.uid(),false);
  have:=rooted_private.scheduler_state(p_goal_id);
  IF have IS DISTINCT FROM p_expected THEN RETURN jsonb_build_object('status','stale','reason','schedule_changed');END IF;
  SELECT * INTO r FROM public.lessons WHERE id=(CASE WHEN kind IN ('set_skipped','delete_selected','place_selected') THEN p_action->'lessonIds'->>0 ELSE p_action->>'lessonId' END)::uuid AND curriculum_goal_id=p_goal_id AND user_id=u;
  IF NOT FOUND THEN RETURN jsonb_build_object('status','invalid','reason','lesson');END IF;
  ids:=ARRAY(SELECT id FROM public.lessons WHERE curriculum_goal_id=p_goal_id);
  IF kind IS NULL OR kind NOT IN ('single_move','edit','complete','skip','delete','delete_selected','place_selected','set_skipped') THEN RETURN jsonb_build_object('status','invalid','reason','action');END IF;
  fields:=CASE kind WHEN 'place_selected' THEN ARRAY['date','scheduled_date','scheduled_source','queue_pinned'] WHEN 'edit' THEN ARRAY['date','scheduled_date','scheduled_source','queue_pinned','lesson_number','child_id'] WHEN 'single_move' THEN ARRAY['date','scheduled_date','scheduled_source','queue_position','queue_pinned'] WHEN 'complete' THEN ARRAY['date','scheduled_date','scheduled_source','queue_pinned','completed','completed_at','is_backfill'] WHEN 'set_skipped' THEN ARRAY['skipped','date','scheduled_date','queue_pinned','scheduled_source'] WHEN 'skip' THEN ARRAY['skipped','scheduled_date','queue_pinned'] ELSE ARRAY['scheduled_date'] END;
  IF kind IN ('delete_selected','place_selected') THEN
   IF jsonb_typeof(p_action->'lessonIds') IS DISTINCT FROM 'array' OR jsonb_array_length(p_action->'lessonIds')=0 THEN RAISE EXCEPTION 'scheduler_delete_shape';END IF;
   SELECT array_agg(value::uuid) INTO selected_ids FROM jsonb_array_elements_text(p_action->'lessonIds');
   IF cardinality(selected_ids)<>(SELECT count(DISTINCT x) FROM unnest(selected_ids) x) OR (SELECT count(*) FROM public.lessons WHERE id=ANY(selected_ids) AND user_id=u AND curriculum_goal_id=p_goal_id)<>cardinality(selected_ids) THEN RAISE EXCEPTION 'scheduler_delete_scope';END IF;
  END IF;
  -- Scope includes preexisting rows only: reviewed pointer cleanup can unschedule
  -- earlier orphan rows. No insert, reassignment or arbitrary content capability.
  PERFORM rooted_private.scheduler_allow(p_goal_id,kind,ids,fields,ARRAY['current_lesson','completed_at'],CASE WHEN kind='delete' THEN ARRAY[r.id] WHEN kind='delete_selected' THEN selected_ids ELSE '{}'::uuid[] END);
  IF kind='single_move' THEN
   IF r.skipped OR p_action->>'targetDate' IS NULL THEN PERFORM rooted_private.scheduler_disallow(p_goal_id); RETURN jsonb_build_object('status','invalid','reason','protected_lesson');END IF;
   IF (p_action->>'localDay')::date IS DISTINCT FROM (now() AT TIME ZONE (SELECT timezone FROM public.profiles WHERE id=u))::date THEN PERFORM rooted_private.scheduler_disallow(p_goal_id); RETURN jsonb_build_object('status','invalid','reason','local_day');END IF;
   IF r.completed THEN
    UPDATE public.lessons SET date=(p_action->>'targetDate')::date,scheduled_date=(p_action->>'targetDate')::date,scheduled_source='plan_move',queue_pinned=true WHERE id=r.id;
    GET DIAGNOSTICS n=ROW_COUNT;IF n<>1 THEN RAISE EXCEPTION 'scheduler_move_refused';END IF;
   ELSIF (p_action->>'targetDate')::date>coalesce(r.scheduled_date,r.date) AND r.queue_position IS NOT NULL THEN
    result:=rooted_private.contained_move_lesson_keep_slot(r.id,(p_action->>'targetDate')::date,(p_action->>'localDay')::date,true);
    IF result->>'status' IS DISTINCT FROM 'moved' THEN RAISE EXCEPTION 'scheduler_move_refused';END IF;
   ELSE
    PERFORM rooted_private.contained_move_lesson_to_date(r.id,(p_action->>'targetDate')::date);
   END IF;
   IF NOT EXISTS(SELECT 1 FROM public.lessons WHERE id=r.id AND date=(p_action->>'targetDate')::date AND scheduled_date=(p_action->>'targetDate')::date) THEN RAISE EXCEPTION 'scheduler_move_postcondition';END IF;
  ELSIF kind='place_selected' THEN
   IF p_action->>'targetDate' IS NULL THEN RAISE EXCEPTION 'scheduler_placement_shape';END IF;
   UPDATE public.lessons SET date=(p_action->>'targetDate')::date,scheduled_date=(p_action->>'targetDate')::date,queue_pinned=true,scheduled_source='plan_move' WHERE id=ANY(selected_ids);
   GET DIAGNOSTICS n=ROW_COUNT;IF n<>cardinality(selected_ids) THEN RAISE EXCEPTION 'scheduler_placement_rowcount';END IF;
  ELSIF kind='delete_selected' THEN
   -- Explicit Delete retains its existing semantics. The client captures this
   -- expectation before the Undo delay; later work makes the whole call stale.
   DELETE FROM public.lessons WHERE id=ANY(selected_ids) AND curriculum_goal_id=p_goal_id AND user_id=u;
   GET DIAGNOSTICS n=ROW_COUNT;IF n<>cardinality(selected_ids) THEN RAISE EXCEPTION 'scheduler_delete_refused';END IF;
  ELSIF kind='edit' THEN
   payload:=p_action->'changes';
   IF jsonb_typeof(payload) IS DISTINCT FROM 'object' OR payload='{}'::jsonb OR EXISTS(SELECT 1 FROM jsonb_object_keys(payload) k WHERE k NOT IN ('title','lesson_number','minutes_spent','scheduled_date','child_id')) THEN RAISE EXCEPTION 'scheduler_edit_shape';END IF;
   IF jsonb_typeof(p_action->'originals') IS DISTINCT FROM 'object' OR EXISTS(SELECT 1 FROM jsonb_object_keys(payload) k WHERE NOT (p_action->'originals' ? k)) OR EXISTS(SELECT 1 FROM jsonb_each(p_action->'originals') e WHERE CASE WHEN e.key='scheduled_date' THEN to_jsonb(coalesce(r.scheduled_date,r.date)) ELSE to_jsonb(r)->e.key END IS DISTINCT FROM e.value) THEN RAISE EXCEPTION 'scheduler_edit_originals';END IF;
   IF (payload?'scheduled_date' AND (payload->>'scheduled_date' IS NULL OR payload->>'scheduled_date' !~ '^\d{4}-\d{2}-\d{2}$')) OR (payload?'child_id' AND NOT EXISTS(SELECT 1 FROM public.children WHERE id=(payload->>'child_id')::uuid AND user_id=u)) THEN RAISE EXCEPTION 'scheduler_edit_shape';END IF;
   UPDATE public.lessons SET
    title=CASE WHEN payload?'title' THEN payload->>'title' ELSE title END,
    lesson_number=CASE WHEN payload?'lesson_number' THEN (payload->>'lesson_number')::integer ELSE lesson_number END,
    minutes_spent=CASE WHEN payload?'minutes_spent' THEN (payload->>'minutes_spent')::integer ELSE minutes_spent END,
    hours=CASE WHEN payload?'minutes_spent' THEN coalesce(((payload->>'minutes_spent')::double precision/60)::numeric,0) ELSE hours END,
    child_id=CASE WHEN payload?'child_id' THEN (payload->>'child_id')::uuid ELSE child_id END,
    date=CASE WHEN payload?'scheduled_date' THEN (payload->>'scheduled_date')::date ELSE date END,
    scheduled_date=CASE WHEN payload?'scheduled_date' THEN (payload->>'scheduled_date')::date ELSE scheduled_date END,
    queue_pinned=CASE WHEN payload?'scheduled_date' THEN true ELSE queue_pinned END,
    scheduled_source=CASE WHEN payload?'scheduled_date' THEN 'plan_move' ELSE scheduled_source END WHERE id=r.id;
   GET DIAGNOSTICS n=ROW_COUNT;IF n<>1 THEN RAISE EXCEPTION 'scheduler_edit_refused';END IF;
   IF NOT EXISTS(SELECT 1 FROM public.lessons l WHERE l.id=r.id AND to_jsonb(l)-'updated_at'=(to_jsonb(r)||payload||CASE WHEN payload?'minutes_spent' THEN jsonb_build_object('hours',coalesce(((payload->>'minutes_spent')::double precision/60)::numeric,0)) ELSE '{}'::jsonb END||CASE WHEN payload?'scheduled_date' THEN jsonb_build_object('date',payload->'scheduled_date','queue_pinned',true,'scheduled_source','plan_move') ELSE '{}'::jsonb END)-'updated_at') THEN RAISE EXCEPTION 'scheduler_edit_postcondition';END IF;
  ELSIF kind='complete' THEN
   payload:=p_action->'payload';
   IF jsonb_typeof(payload)<>'object' OR payload->>'completed' IS DISTINCT FROM 'true' OR EXISTS(SELECT 1 FROM jsonb_object_keys(payload) k WHERE k NOT IN ('completed','completed_at','scheduled_date','date','queue_pinned','scheduled_source','is_backfill','hours','minutes_spent','started_at')) THEN RAISE EXCEPTION 'scheduler_completion_shape';END IF;
   IF coalesce((p_action->>'onlyIfIncomplete')::boolean,false) AND r.completed THEN PERFORM rooted_private.scheduler_disallow(p_goal_id); RETURN jsonb_build_object('status','stale','reason','already_completed');END IF;
   IF p_action ? 'placement' AND EXISTS(SELECT 1 FROM jsonb_each(p_action->'placement') e WHERE to_jsonb(r)->e.key IS DISTINCT FROM e.value) THEN PERFORM rooted_private.scheduler_disallow(p_goal_id); RETURN jsonb_build_object('status','stale','reason','placement_changed');END IF;
   IF r.queue_position IS NULL AND r.scheduled_date IS NOT NULL AND EXISTS(SELECT 1 FROM jsonb_object_keys(payload) k WHERE k NOT IN ('completed','completed_at','hours','minutes_spent','started_at')) THEN RAISE EXCEPTION 'scheduler_unslotted_completion';END IF;
   UPDATE public.lessons SET completed=true,completed_at=(payload->>'completed_at')::timestamptz,
    date=CASE WHEN payload?'date' THEN (payload->>'date')::date ELSE date END,scheduled_date=CASE WHEN payload?'scheduled_date' THEN (payload->>'scheduled_date')::date ELSE scheduled_date END,
    queue_pinned=CASE WHEN payload?'queue_pinned' THEN (payload->>'queue_pinned')::boolean ELSE queue_pinned END,scheduled_source=CASE WHEN payload?'scheduled_source' THEN payload->>'scheduled_source' ELSE scheduled_source END,
    is_backfill=CASE WHEN payload?'is_backfill' THEN (payload->>'is_backfill')::boolean ELSE is_backfill END,
    hours=CASE WHEN payload?'hours' THEN (payload->>'hours')::numeric ELSE hours END,minutes_spent=CASE WHEN payload?'minutes_spent' THEN (payload->>'minutes_spent')::integer ELSE minutes_spent END,started_at=CASE WHEN payload?'started_at' THEN (payload->>'started_at')::time ELSE started_at END WHERE id=r.id;
   GET DIAGNOSTICS n=ROW_COUNT;IF n<>1 THEN RAISE EXCEPTION 'scheduler_completion_refused';END IF;
  ELSIF kind='set_skipped' THEN
   IF jsonb_typeof(p_action->'lessonIds') IS DISTINCT FROM 'array' OR jsonb_typeof(p_action->'writes') IS DISTINCT FROM 'array' OR jsonb_typeof(p_action->'skipped') IS DISTINCT FROM 'boolean' THEN RAISE EXCEPTION 'scheduler_bulk_shape';END IF;
   SELECT array_agg(value::uuid) INTO selected_ids FROM jsonb_array_elements_text(p_action->'lessonIds');
   IF cardinality(selected_ids) IS NULL OR cardinality(selected_ids)>100 OR cardinality(selected_ids)<>(SELECT count(DISTINCT x) FROM unnest(selected_ids) x) OR NOT r.id=ANY(selected_ids) OR (SELECT count(*) FROM public.lessons WHERE id=ANY(selected_ids) AND curriculum_goal_id=p_goal_id AND user_id=u AND NOT completed AND queue_position IS NOT NULL)<>cardinality(selected_ids) THEN RAISE EXCEPTION 'scheduler_bulk_scope';END IF;
   IF (p_action->>'localDay')::date IS DISTINCT FROM (now() AT TIME ZONE (SELECT timezone FROM public.profiles WHERE id=u))::date THEN RAISE EXCEPTION 'scheduler_bulk_day';END IF;
   canonical:=rooted_private.cascade_local_window(u,(p_action->>'localDay')::date);
   UPDATE public.lessons SET skipped=(p_action->>'skipped')::boolean,
    scheduled_date=CASE WHEN (p_action->>'skipped')::boolean THEN NULL WHEN queue_preserved THEN date ELSE coalesce((p_action->'restoreDates'->>id::text)::date,date) END,
    queue_pinned=CASE WHEN (p_action->>'skipped')::boolean THEN false ELSE queue_position<=(have->'goal'->>'current_lesson')::integer END
    WHERE id=ANY(selected_ids);
   GET DIAGNOSTICS n=ROW_COUNT;IF n<>cardinality(selected_ids) THEN RAISE EXCEPTION 'scheduler_bulk_refused';END IF;
   IF (SELECT count(DISTINCT x->>'id') FROM jsonb_array_elements(p_action->'writes') x)<>jsonb_array_length(p_action->'writes') THEN RAISE EXCEPTION 'scheduler_bulk_duplicate';END IF;
   FOR w IN SELECT * FROM jsonb_array_elements(p_action->'writes') LOOP
    IF NOT EXISTS(SELECT 1 FROM public.lessons WHERE id=(w->>'id')::uuid AND curriculum_goal_id=p_goal_id AND user_id=u AND NOT completed AND NOT skipped AND NOT coalesce(is_backfill,false) AND NOT queue_preserved AND queue_position IS NOT NULL AND (NOT queue_pinned OR id=ANY(selected_ids))) THEN RAISE EXCEPTION 'scheduler_bulk_write_scope';END IF;
    IF w?'queue_pinned' AND NOT (w->>'id')::uuid=ANY(selected_ids) THEN RAISE EXCEPTION 'scheduler_bulk_pin_scope';END IF;
    UPDATE public.lessons SET date=(w->>'date')::date,scheduled_date=(w->>'date')::date,queue_pinned=CASE WHEN w?'queue_pinned' THEN (w->>'queue_pinned')::boolean ELSE queue_pinned END,scheduled_source=CASE WHEN (p_action->>'skipped')::boolean THEN 'skip_respread' ELSE 'skip_undo' END WHERE id=(w->>'id')::uuid;
    GET DIAGNOSTICS n=ROW_COUNT;IF n<>1 THEN RAISE EXCEPTION 'scheduler_bulk_write_refused';END IF;
   END LOOP;
   IF NOT rooted_private.cascade_projection_matches(rooted_private.cascade_snapshot(p_goal_id,(p_action->>'localDay')::date,canonical->>'dayStartIso',canonical->>'dayEndIso')) THEN RAISE EXCEPTION 'scheduler_bulk_projection';END IF;
  ELSIF kind='skip' THEN
   IF r.completed THEN PERFORM rooted_private.scheduler_disallow(p_goal_id); RETURN jsonb_build_object('status','invalid','reason','completed_lesson');END IF;
   UPDATE public.lessons SET skipped=true,scheduled_date=NULL,queue_pinned=false WHERE id=r.id;
   GET DIAGNOSTICS n=ROW_COUNT;IF n<>1 THEN RAISE EXCEPTION 'scheduler_skip_refused';END IF;
  ELSE
   -- Avoid deleting actual work through this new narrow endpoint.
   IF r.completed OR r.queue_preserved OR coalesce(r.hours,0)>0 OR r.started_at IS NOT NULL OR rooted_private.lesson_carries_work(r.notes,r.minutes_spent) THEN PERFORM rooted_private.scheduler_disallow(p_goal_id); RETURN jsonb_build_object('status','invalid','reason','lesson_has_work');END IF;
   DELETE FROM public.lessons WHERE id=r.id;
   GET DIAGNOSTICS n=ROW_COUNT;IF n<>1 THEN RAISE EXCEPTION 'scheduler_delete_refused';END IF;
  END IF;
  SET CONSTRAINTS ALL IMMEDIATE;
  PERFORM rooted_private.scheduler_disallow(p_goal_id);
  after_state:=rooted_private.scheduler_state(p_goal_id);
  IF kind='place_selected' AND (
   (SELECT array_agg(x->>'id' ORDER BY x->>'id') FROM jsonb_array_elements(have->'rows') x) IS DISTINCT FROM (SELECT array_agg(x->>'id' ORDER BY x->>'id') FROM jsonb_array_elements(after_state->'rows') x)
   OR EXISTS(SELECT 1 FROM jsonb_array_elements(have->'rows') b JOIN jsonb_array_elements(after_state->'rows') a ON a->>'id'=b->>'id' WHERE a-'updated_at' IS DISTINCT FROM (CASE WHEN (b->>'id')::uuid=ANY(selected_ids) THEN b||jsonb_build_object('date',p_action->'targetDate','scheduled_date',p_action->'targetDate','queue_pinned',true,'scheduled_source','plan_move') ELSE b END)-'updated_at')
  ) THEN RAISE EXCEPTION 'scheduler_placement_preservation';END IF;
  IF kind='delete_selected' AND (
   (SELECT array_agg(x->>'id' ORDER BY x->>'id') FROM jsonb_array_elements(have->'rows') x WHERE NOT (x->>'id')::uuid=ANY(selected_ids)) IS DISTINCT FROM (SELECT array_agg(x->>'id' ORDER BY x->>'id') FROM jsonb_array_elements(after_state->'rows') x)
   OR
   EXISTS(SELECT 1 FROM jsonb_array_elements(after_state->'rows') a WHERE (a->>'id')::uuid=ANY(selected_ids))
   OR (SELECT count(*) FROM jsonb_array_elements(have->'rows'))-(SELECT count(*) FROM jsonb_array_elements(after_state->'rows'))<>cardinality(selected_ids)
   OR EXISTS(SELECT 1 FROM jsonb_array_elements(have->'rows') b JOIN jsonb_array_elements(after_state->'rows') a ON a->>'id'=b->>'id' WHERE b-ARRAY['scheduled_date','updated_at'] IS DISTINCT FROM a-ARRAY['scheduled_date','updated_at'])
  ) THEN RAISE EXCEPTION 'scheduler_delete_postcondition';END IF;
  IF kind='edit' AND (
   (SELECT array_agg(x->>'id' ORDER BY x->>'id') FROM jsonb_array_elements(have->'rows') x) IS DISTINCT FROM (SELECT array_agg(x->>'id' ORDER BY x->>'id') FROM jsonb_array_elements(after_state->'rows') x)
   OR EXISTS(SELECT 1 FROM jsonb_array_elements(have->'rows') b JOIN jsonb_array_elements(after_state->'rows') a ON a->>'id'=b->>'id' WHERE CASE WHEN b->>'id'=r.id::text THEN b-ARRAY['title','lesson_number','minutes_spent','hours','child_id','date','scheduled_date','queue_pinned','scheduled_source','updated_at'] IS DISTINCT FROM a-ARRAY['title','lesson_number','minutes_spent','hours','child_id','date','scheduled_date','queue_pinned','scheduled_source','updated_at'] ELSE b-'updated_at' IS DISTINCT FROM a-'updated_at' END)
   OR (have->'goal')-'updated_at' IS DISTINCT FROM (after_state->'goal')-'updated_at'
  ) THEN RAISE EXCEPTION 'scheduler_edit_scope_postcondition';END IF;
  -- Edit Undo retains only the selected row's editable content, never notes.

  SELECT jsonb_build_object('goal',jsonb_build_object('current_lesson',have->'goal'->'current_lesson','completed_at',have->'goal'->'completed_at'),'rows',jsonb_agg((SELECT jsonb_object_agg(k,v) FROM jsonb_each(x) e(k,v) WHERE k=ANY(ARRAY['id','date','scheduled_date','scheduled_source','queue_position','queue_pinned','queue_preserved','completed','completed_at','skipped','is_backfill'] || CASE WHEN kind='edit' AND x->>'id'=r.id::text THEN ARRAY['title','lesson_number','minutes_spent','hours','child_id'] ELSE '{}'::text[] END)))) INTO undo_state FROM jsonb_array_elements(have->'rows') x;
  IF kind NOT IN ('single_move','place_selected','edit','skip','set_skipped') THEN undo_state:=NULL;END IF;
  result:=jsonb_build_object('status','applied','operationId',p_operation_id,'held',coalesce(jsonb_array_length(result->'held'),0));
  INSERT INTO rooted_private.scheduler_action_receipts(id,user_id,goal_id,request_hash,before_state,after_hash,result) VALUES(p_operation_id,u,p_goal_id,request_hash,undo_state,rooted_private.scheduler_hash(after_state),result);
  RETURN result;
 EXCEPTION WHEN lock_not_available THEN RETURN jsonb_build_object('status','busy','reason','busy');END;
EXCEPTION WHEN invalid_text_representation OR datetime_field_overflow OR invalid_datetime_format OR check_violation OR not_null_violation THEN RETURN jsonb_build_object('status','invalid','reason','shape');
END $$;
CREATE FUNCTION public.undo_scheduler_action(p_operation_id uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE r rooted_private.scheduler_action_receipts%rowtype;s jsonb;w jsonb;fields text[]:=ARRAY['lesson_number','child_id','date','scheduled_date','scheduled_source','queue_position','queue_pinned','queue_preserved','completed','completed_at','skipped','is_backfill'];
BEGIN
 BEGIN
  IF auth.uid() IS NULL THEN RETURN jsonb_build_object('status','invalid','reason','owner');END IF;
  IF NOT pg_try_advisory_xact_lock(hashtextextended(p_operation_id::text,0)) THEN RAISE lock_not_available;END IF;
  SELECT * INTO r FROM rooted_private.scheduler_action_receipts WHERE id=p_operation_id AND user_id=auth.uid() FOR UPDATE NOWAIT;
  IF NOT FOUND THEN RETURN jsonb_build_object('status','invalid','reason','operation');END IF;
  IF r.undone_at IS NOT NULL THEN RETURN jsonb_build_object('status','already_undone');END IF;
  IF r.before_state IS NULL OR clock_timestamp()>r.created_at+interval '10 minutes' THEN RETURN jsonb_build_object('status','invalid','reason','expired');END IF;
  PERFORM 1 FROM public.curriculum_goals WHERE id=r.goal_id AND user_id=auth.uid() FOR UPDATE NOWAIT;
  PERFORM rooted_private.scheduler_lock_owner(auth.uid(),false);
  PERFORM 1 FROM public.lessons WHERE curriculum_goal_id=r.goal_id ORDER BY id FOR UPDATE NOWAIT;
  PERFORM rooted_private.scheduler_lock_owner(auth.uid(),false);
  s:=rooted_private.scheduler_state(r.goal_id);
  IF rooted_private.scheduler_hash(s)<>r.after_hash THEN RETURN jsonb_build_object('status','stale','reason','later_edit');END IF;
  PERFORM rooted_private.scheduler_allow(r.goal_id,'undo',ARRAY(SELECT (x->>'id')::uuid FROM jsonb_array_elements(r.before_state->'rows') x),fields,ARRAY['current_lesson','completed_at'],CASE WHEN r.result->>'kind'='add' THEN ARRAY[(r.result->>'rowId')::uuid] ELSE '{}'::uuid[] END);
  IF r.result->>'kind'='add' THEN
   DELETE FROM public.lessons WHERE id=(r.result->>'rowId')::uuid AND curriculum_goal_id=r.goal_id;
   IF FOUND IS NOT TRUE THEN RAISE EXCEPTION 'scheduler_add_undo_delete';END IF;
  END IF;
  -- Clear changed slots first so restoring a legacy earlier move cannot collide.
  UPDATE public.lessons l SET queue_position=NULL FROM jsonb_array_elements(r.before_state->'rows') x WHERE l.id=(x->>'id')::uuid AND to_jsonb(l.queue_position) IS DISTINCT FROM x->'queue_position';
  FOR w IN SELECT x FROM jsonb_array_elements(r.before_state->'rows') x ORDER BY (x->>'queue_position')::integer DESC NULLS LAST,x->>'id' LOOP
   UPDATE public.lessons SET title=CASE WHEN w?'title' THEN w->>'title' ELSE title END,lesson_number=CASE WHEN w?'lesson_number' THEN (w->>'lesson_number')::integer ELSE lesson_number END,minutes_spent=CASE WHEN w?'minutes_spent' THEN (w->>'minutes_spent')::integer ELSE minutes_spent END,hours=CASE WHEN w?'hours' THEN (w->>'hours')::numeric ELSE hours END,child_id=CASE WHEN w?'child_id' THEN (w->>'child_id')::uuid ELSE child_id END,date=(w->>'date')::date,scheduled_date=(w->>'scheduled_date')::date,scheduled_source=w->>'scheduled_source',queue_position=(w->>'queue_position')::integer,queue_pinned=(w->>'queue_pinned')::boolean,queue_preserved=(w->>'queue_preserved')::boolean,completed=(w->>'completed')::boolean,completed_at=(w->>'completed_at')::timestamptz,skipped=(w->>'skipped')::boolean,is_backfill=(w->>'is_backfill')::boolean WHERE id=(w->>'id')::uuid AND EXISTS(SELECT 1 FROM jsonb_each(w) e WHERE e.key<>'id' AND to_jsonb(lessons)->e.key IS DISTINCT FROM e.value);
  END LOOP;
  UPDATE public.curriculum_goals SET current_lesson=(r.before_state->'goal'->>'current_lesson')::integer,completed_at=(r.before_state->'goal'->>'completed_at')::timestamptz WHERE id=r.goal_id AND (current_lesson IS DISTINCT FROM (r.before_state->'goal'->>'current_lesson')::integer OR completed_at IS DISTINCT FROM (r.before_state->'goal'->>'completed_at')::timestamptz);
  IF (SELECT array_agg(x->>'id' ORDER BY x->>'id') FROM jsonb_array_elements(r.before_state->'rows') x) IS DISTINCT FROM (SELECT array_agg(id::text ORDER BY id::text) FROM public.lessons WHERE curriculum_goal_id=r.goal_id) THEN RAISE EXCEPTION 'scheduler_undo_membership';END IF;
  IF EXISTS(SELECT 1 FROM jsonb_array_elements(r.before_state->'rows') x JOIN public.lessons l ON l.id=(x->>'id')::uuid, jsonb_each(x) e WHERE to_jsonb(l)->e.key IS DISTINCT FROM e.value) THEN RAISE EXCEPTION 'scheduler_undo_postcondition';END IF;
  SET CONSTRAINTS ALL IMMEDIATE;
  PERFORM rooted_private.scheduler_disallow(r.goal_id);
  UPDATE rooted_private.scheduler_action_receipts SET undone_at=clock_timestamp(),before_state=NULL WHERE id=r.id;
  RETURN jsonb_build_object('status','undone');
 EXCEPTION WHEN lock_not_available THEN RETURN jsonb_build_object('status','busy','reason','busy');END;
END $$;
-- Private maintenance erases expired Undo content, retaining small replay proof.
CREATE FUNCTION rooted_private.expire_scheduler_undo() RETURNS bigint LANGUAGE plpgsql SET search_path=pg_catalog,pg_temp AS $$ DECLARE n bigint;BEGIN UPDATE rooted_private.scheduler_action_receipts SET before_state=NULL WHERE before_state IS NOT NULL AND created_at<clock_timestamp()-interval '10 minutes';GET DIAGNOSTICS n=ROW_COUNT;RETURN n;END $$;
REVOKE ALL ON FUNCTION public.read_scheduler_state(uuid),public.commit_scheduler_action(uuid,uuid,jsonb,jsonb),public.undo_scheduler_action(uuid) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.read_scheduler_state(uuid),public.commit_scheduler_action(uuid,uuid,jsonb,jsonb),public.undo_scheduler_action(uuid) TO authenticated;
DO $$ DECLARE f record;BEGIN FOR f IN SELECT oid::regprocedure sig FROM pg_proc WHERE pronamespace='rooted_private'::regnamespace AND (proname LIKE 'scheduler_%' OR proname IN ('set_scheduler_mode','expire_scheduler_undo')) LOOP EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,anon,authenticated,service_role',f.sig);END LOOP;END $$;
COMMIT;
