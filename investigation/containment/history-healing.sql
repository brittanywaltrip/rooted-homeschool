-- Fixed recovery inserts. This endpoint cannot update existing lesson contents.
CREATE FUNCTION public.commit_scheduler_history_heal(p_operation_id uuid,p_goal_id uuid,p_expected jsonb,p_action jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE u uuid:=auth.uid(); g public.curriculum_goals%rowtype; m text; have jsonb; prior rooted_private.scheduler_action_receipts%rowtype;
 request_hash text:=rooted_private.scheduler_hash(jsonb_build_object('rpc','history_heal','goal',p_goal_id,'expected',p_expected,'action',p_action));
 kind text:=p_action->>'kind'; day date; slot integer; next_slot integer; d date; slots jsonb; item jsonb; shapes jsonb:='[]'; shape jsonb;
 n integer:=0; result jsonb; canonical jsonb; subject uuid; mins integer; inserted uuid; ids uuid[]; root public.lessons%rowtype; requested public.lessons%rowtype; new_row jsonb; after_state jsonb;
BEGIN
 IF u IS NULL OR p_operation_id IS NULL OR kind IS NULL OR kind NOT IN ('history_insert','heal_next','heal_empty','continue') THEN RETURN jsonb_build_object('status','invalid','reason','action');END IF;
 BEGIN
  IF NOT pg_try_advisory_xact_lock(hashtextextended(p_operation_id::text,0)) THEN RAISE lock_not_available;END IF;
  SELECT * INTO prior FROM rooted_private.scheduler_action_receipts WHERE id=p_operation_id;
  IF FOUND THEN
   IF prior.user_id<>u OR prior.goal_id<>p_goal_id OR prior.request_hash<>request_hash THEN RETURN jsonb_build_object('status','invalid','reason','operation');END IF;
   result:=prior.result;
   IF prior.result->>'kind'='continue' THEN
    SELECT to_jsonb(l) INTO new_row FROM public.lessons l WHERE id=coalesce((prior.result->>'rowId')::uuid,(prior.result->'row'->>'id')::uuid) AND curriculum_goal_id=p_goal_id AND user_id=u;
    result:=(result-'row')||jsonb_build_object('row',new_row);
   END IF;
   RETURN result||jsonb_build_object('status',CASE WHEN prior.undone_at IS NULL THEN 'already_applied' ELSE 'already_undone' END);
  END IF;
  SELECT * INTO g FROM public.curriculum_goals WHERE id=p_goal_id AND user_id=u AND NOT archived FOR UPDATE NOWAIT;
  IF NOT FOUND OR g.child_id IS NULL THEN RETURN jsonb_build_object('status','invalid','reason','owner');END IF;
  SELECT mode INTO m FROM rooted_private.scheduler_modes WHERE goal_id=p_goal_id;
  IF m IS NULL THEN RETURN jsonb_build_object('status','invalid','reason','not_protected');END IF;
  IF m='paused' THEN RETURN jsonb_build_object('status','paused');END IF;
  PERFORM 1 FROM public.lessons WHERE curriculum_goal_id=p_goal_id ORDER BY id FOR UPDATE NOWAIT;
  PERFORM 1 FROM public.profiles WHERE id=u FOR SHARE NOWAIT;
  LOCK TABLE public.vacation_blocks IN SHARE MODE NOWAIT;
  have:=rooted_private.scheduler_state(p_goal_id);
  IF have IS DISTINCT FROM p_expected THEN RETURN jsonb_build_object('status','stale','reason','schedule_changed');END IF;
  day:=(now() AT TIME ZONE (SELECT timezone FROM public.profiles WHERE id=u))::date;
  IF day IS NULL OR (p_action->>'localDay')::date IS DISTINCT FROM day THEN RETURN jsonb_build_object('status','stale','reason','local_day');END IF;
  IF kind='continue' THEN
   SELECT * INTO requested FROM public.lessons WHERE id=(p_action->>'parentLessonId')::uuid AND curriculum_goal_id=p_goal_id AND user_id=u;
   IF NOT FOUND THEN RETURN jsonb_build_object('status','invalid','reason','parent');END IF;
   SELECT * INTO root FROM public.lessons WHERE id=coalesce(requested.continues_lesson_id,requested.id) AND curriculum_goal_id=p_goal_id AND user_id=u;
   d:=(p_action->>'targetDate')::date;
   IF NOT FOUND OR root.continues_lesson_id IS NOT NULL OR d IS NULL THEN RETURN jsonb_build_object('status','invalid','reason','root');END IF;
   IF EXISTS(SELECT 1 FROM public.lessons WHERE curriculum_goal_id=p_goal_id AND continues_lesson_id=root.id AND NOT completed) THEN RETURN jsonb_build_object('status','stale','reason','continuation_exists');END IF;
   slots:='[]'::jsonb;
   shapes:=jsonb_build_array(jsonb_build_object('user_id',u,'child_id',coalesce(root.child_id,g.child_id),'curriculum_goal_id',g.id,'title',root.title,
    'date',d,'scheduled_date',d,'scheduled_source','continuation','completed',false,'completed_at',NULL,'is_backfill',false,'queue_pinned',false,'queue_preserved',false,
    'hours',0,'minutes_spent',NULL,'notes',NULL,'lesson_number',NULL,'queue_position',NULL,'continues_lesson_id',root.id,'subject_id',root.subject_id));
  ELSIF kind='heal_empty' THEN
   IF jsonb_array_length(have->'rows')<>0 OR g.created_at IS NULL OR g.created_at>clock_timestamp()-interval '2 minutes' THEN RETURN jsonb_build_object('status','stale','reason','goal_not_empty_or_recent');END IF;
   slots:=p_action->'slots';
   IF jsonb_typeof(slots) IS DISTINCT FROM 'array' OR jsonb_array_length(slots)=0 OR jsonb_array_length(slots)>3650 THEN RETURN jsonb_build_object('status','invalid','reason','slots');END IF;
   -- No holes or duplicates can be silently accepted in a rebuilt empty queue.
   IF jsonb_array_length(slots) IS DISTINCT FROM greatest(0,g.total_lessons-g.current_lesson) OR
      (SELECT count(DISTINCT (x->>'slot')::integer) FROM jsonb_array_elements(slots) x)<>jsonb_array_length(slots) THEN RETURN jsonb_build_object('status','invalid','reason','slots');END IF;
  ELSE
   slot:=(p_action->>'slot')::integer; d:=(p_action->>'date')::date;
   IF slot IS NULL OR slot<1 OR slot>g.total_lessons OR d IS NULL OR EXISTS(SELECT 1 FROM public.lessons WHERE curriculum_goal_id=p_goal_id AND (queue_position=slot OR lesson_number=slot)) THEN RETURN jsonb_build_object('status','stale','reason','slot_occupied_or_invalid');END IF;
   IF kind='history_insert' AND d>day THEN RETURN jsonb_build_object('status','invalid','reason','future_history');END IF;
   IF kind='heal_next' THEN
    next_slot:=g.current_lesson+1;
    WHILE EXISTS(SELECT 1 FROM public.lessons WHERE curriculum_goal_id=p_goal_id AND queue_position=next_slot AND skipped) LOOP next_slot:=next_slot+1;END LOOP;
    IF jsonb_array_length(have->'rows')=0 OR slot<>next_slot OR EXISTS(SELECT 1 FROM public.lessons WHERE curriculum_goal_id=p_goal_id AND completed AND queue_position>slot) THEN RETURN jsonb_build_object('status','invalid','reason','not_next');END IF;
   END IF;
   slots:=jsonb_build_array(jsonb_build_object('slot',slot,'date',d));
  END IF;
  IF kind<>'continue' AND (g.total_lessons IS NULL OR g.total_lessons<=0) THEN RETURN jsonb_build_object('status','invalid','reason','total_lessons');END IF;
  -- Derive metadata from the locked goal, never trust client ownership or text.
  IF kind='history_insert' THEN
   SELECT id INTO subject FROM public.subjects WHERE user_id=u AND lower(name)=lower(trim(g.subject_label)) ORDER BY id LIMIT 1;
   mins:=coalesce(g.default_minutes,30);
  END IF;
  FOR item IN SELECT * FROM jsonb_array_elements(slots) LOOP
   slot:=(item->>'slot')::integer; d:=(item->>'date')::date;
   IF slot IS NULL OR slot<1 OR slot>g.total_lessons OR d IS NULL OR (kind='heal_empty' AND slot<=g.current_lesson) THEN RAISE EXCEPTION 'scheduler_heal_slot';END IF;
   shape:=jsonb_build_object('user_id',u,'child_id',g.child_id,'curriculum_goal_id',g.id,'lesson_number',slot,'queue_position',slot,
    'title',CASE WHEN kind='history_insert' THEN coalesce(g.subject_label,g.curriculum_name,'Lesson')||': Lesson '||slot ELSE coalesce(nullif(trim(g.curriculum_name),''),'Lesson')||' — Lesson '||slot END,
    'date',d,'scheduled_date',d,'scheduled_source',CASE kind WHEN 'history_insert' THEN 'completion_picked' WHEN 'heal_next' THEN 'today_self_heal' ELSE 'self_heal' END,
    'completed',kind='history_insert','completed_at',CASE WHEN kind='history_insert' THEN CASE WHEN d<day THEN (d::text||'T12:00:00Z')::timestamptz ELSE now() END ELSE NULL END,
    'is_backfill',kind='history_insert','queue_pinned',kind='history_insert','queue_preserved',false,'hours',CASE WHEN kind='history_insert' THEN mins::numeric/60 ELSE 0 END,
    'minutes_spent',mins,'subject_id',subject);
   shapes:=shapes||jsonb_build_array(shape);
  END LOOP;
  ids:=ARRAY(SELECT id FROM public.lessons WHERE curriculum_goal_id=p_goal_id);
  -- Completion triggers may update the pointer/clear orphan dates. No other existing-row fields are authorized.
  PERFORM rooted_private.scheduler_allow(p_goal_id,kind,ids,ARRAY['scheduled_date'],ARRAY['current_lesson','completed_at'],'{}'::uuid[],shapes);
  FOR shape IN SELECT * FROM jsonb_array_elements(shapes) LOOP
   INSERT INTO public.lessons(user_id,child_id,curriculum_goal_id,lesson_number,queue_position,title,date,scheduled_date,scheduled_source,completed,completed_at,is_backfill,queue_pinned,queue_preserved,hours,minutes_spent,subject_id,continues_lesson_id,notes)
   SELECT x.user_id,x.child_id,x.curriculum_goal_id,x.lesson_number,x.queue_position,x.title,x.date,x.scheduled_date,x.scheduled_source,x.completed,x.completed_at,x.is_backfill,x.queue_pinned,x.queue_preserved,x.hours,x.minutes_spent,x.subject_id,x.continues_lesson_id,x.notes FROM jsonb_populate_record(NULL::public.lessons,shape) x RETURNING id INTO inserted;
   IF inserted IS NULL THEN RAISE EXCEPTION 'scheduler_heal_insert_refused';END IF;
   n:=n+1;
  END LOOP;
  SET CONSTRAINTS ALL IMMEDIATE;
  IF kind IN ('heal_next','heal_empty') THEN
   canonical:=rooted_private.cascade_local_window(u,day);
   IF NOT rooted_private.cascade_projection_matches(rooted_private.cascade_snapshot(p_goal_id,day,canonical->>'dayStartIso',canonical->>'dayEndIso')) THEN RAISE EXCEPTION 'scheduler_heal_projection';END IF;
  END IF;
  IF kind='history_insert' AND EXISTS(
   SELECT 1 FROM jsonb_array_elements(have->'rows') old_row
   LEFT JOIN public.lessons l ON l.id=(old_row->>'id')::uuid
   WHERE (coalesce((old_row->>'completed')::boolean,false) OR coalesce((old_row->>'queue_pinned')::boolean,false) OR coalesce((old_row->>'queue_preserved')::boolean,false) OR rooted_private.lesson_carries_work(old_row->>'notes',(old_row->>'minutes_spent')::integer) OR coalesce((old_row->>'hours')::numeric,0)>0 OR old_row->>'started_at' IS NOT NULL)
    AND to_jsonb(l) IS DISTINCT FROM old_row
  ) THEN RAISE EXCEPTION 'scheduler_history_changed_work';END IF;
  PERFORM rooted_private.scheduler_disallow(p_goal_id);
  IF kind='continue' THEN
   SELECT to_jsonb(l) INTO new_row FROM public.lessons l WHERE id=inserted;
   after_state:=rooted_private.scheduler_state(p_goal_id);
   after_state:=jsonb_set(after_state,'{rows}',coalesce((SELECT jsonb_agg(x ORDER BY x->>'id') FROM jsonb_array_elements(after_state->'rows') x WHERE x->>'id'<>inserted::text),'[]'::jsonb));
   IF after_state IS DISTINCT FROM have THEN RAISE EXCEPTION 'scheduler_continuation_changed_schedule';END IF;
  END IF;
  result:=jsonb_build_object('status','applied','written',n,'operationId',p_operation_id,'kind',kind)||CASE WHEN kind='continue' THEN jsonb_build_object('row',new_row,'rowId',inserted) ELSE '{}'::jsonb END;
  INSERT INTO rooted_private.scheduler_action_receipts(id,user_id,goal_id,request_hash,before_state,after_hash,result) VALUES(p_operation_id,u,p_goal_id,request_hash,NULL,rooted_private.scheduler_hash(rooted_private.scheduler_state(p_goal_id)),result);
  RETURN result;
 EXCEPTION WHEN lock_not_available THEN RETURN jsonb_build_object('status','busy');END;
EXCEPTION WHEN invalid_text_representation OR datetime_field_overflow OR invalid_datetime_format OR check_violation OR not_null_violation THEN RETURN jsonb_build_object('status','invalid','reason','shape');
END $$;
REVOKE ALL ON FUNCTION public.commit_scheduler_history_heal(uuid,uuid,jsonb,jsonb) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.commit_scheduler_history_heal(uuid,uuid,jsonb,jsonb) TO authenticated;

CREATE FUNCTION public.undo_scheduler_continuation(p_operation_id uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE u uuid:=auth.uid(); r rooted_private.scheduler_action_receipts%rowtype; state jsonb; row_id uuid; m text; n integer;
BEGIN
 BEGIN
  IF u IS NULL THEN RETURN jsonb_build_object('status','invalid','reason','owner');END IF;
  IF NOT pg_try_advisory_xact_lock(hashtextextended(p_operation_id::text,0)) THEN RAISE lock_not_available;END IF;
  SELECT * INTO r FROM rooted_private.scheduler_action_receipts WHERE id=p_operation_id AND user_id=u FOR UPDATE NOWAIT;
  IF NOT FOUND OR r.result->>'kind' IS DISTINCT FROM 'continue' THEN RETURN jsonb_build_object('status','invalid','reason','operation');END IF;
  IF r.undone_at IS NOT NULL THEN RETURN jsonb_build_object('status','already_undone');END IF;
  IF clock_timestamp()>r.created_at+interval '10 minutes' THEN RETURN jsonb_build_object('status','invalid','reason','expired');END IF;
  PERFORM 1 FROM public.curriculum_goals WHERE id=r.goal_id AND user_id=u FOR UPDATE NOWAIT;
  IF NOT FOUND THEN RETURN jsonb_build_object('status','invalid','reason','owner');END IF;
  SELECT mode INTO m FROM rooted_private.scheduler_modes WHERE goal_id=r.goal_id;
  IF m IS DISTINCT FROM 'atomic_v2' THEN RETURN jsonb_build_object('status','paused');END IF;
  PERFORM 1 FROM public.lessons WHERE curriculum_goal_id=r.goal_id ORDER BY id FOR UPDATE NOWAIT;
  PERFORM 1 FROM public.profiles WHERE id=u FOR SHARE NOWAIT;
  LOCK TABLE public.vacation_blocks IN SHARE MODE NOWAIT;
  state:=rooted_private.scheduler_state(r.goal_id);
  IF rooted_private.scheduler_hash(state) IS DISTINCT FROM r.after_hash THEN RETURN jsonb_build_object('status','stale','reason','schedule_changed');END IF;
  row_id:=(r.result->'row'->>'id')::uuid;
  IF NOT EXISTS(SELECT 1 FROM public.lessons l WHERE id=row_id AND user_id=u AND curriculum_goal_id=r.goal_id AND to_jsonb(l)=r.result->'row' AND NOT completed AND coalesce(hours,0)=0 AND minutes_spent IS NULL AND notes IS NULL AND started_at IS NULL) THEN RETURN jsonb_build_object('status','stale','reason','continuation_changed');END IF;
  PERFORM rooted_private.scheduler_allow(r.goal_id,'undo_continuation',ARRAY[row_id],'{}'::text[],'{}'::text[],ARRAY[row_id]);
  DELETE FROM public.lessons WHERE id=row_id;
  GET DIAGNOSTICS n=ROW_COUNT;IF n<>1 THEN RAISE EXCEPTION 'scheduler_continuation_delete_refused';END IF;
  SET CONSTRAINTS ALL IMMEDIATE;
  PERFORM rooted_private.scheduler_disallow(r.goal_id);
  UPDATE rooted_private.scheduler_action_receipts SET undone_at=clock_timestamp() WHERE id=r.id;
  RETURN jsonb_build_object('status','undone');
 EXCEPTION WHEN lock_not_available THEN RETURN jsonb_build_object('status','busy');END;
END $$;
REVOKE ALL ON FUNCTION public.undo_scheduler_continuation(uuid) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.undo_scheduler_continuation(uuid) TO authenticated;
