-- LOCAL REVIEW DRAFT. Fixed calendar actions; no existing family data changes.
-- Requires scheduler containment and calendar-guard recognition of operation='calendar'.
CREATE TABLE rooted_private.scheduler_calendar_receipts (
 id uuid PRIMARY KEY,user_id uuid NOT NULL,request_hash text NOT NULL,
 before_state jsonb,after_state jsonb,after_hash text NOT NULL,result jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),undone_at timestamptz
);
ALTER TABLE rooted_private.scheduler_calendar_receipts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON rooted_private.scheduler_calendar_receipts FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION rooted_private.scheduler_calendar_state(p_owner uuid) RETURNS jsonb
LANGUAGE sql STABLE SET search_path=pg_catalog,pg_temp AS $$
 SELECT jsonb_build_object(
  'profile',(SELECT jsonb_build_object('id',id,'school_days',school_days,'timezone',timezone) FROM public.profiles WHERE id=p_owner),
  'goals',coalesce((SELECT jsonb_agg(to_jsonb(g) ORDER BY id) FROM public.curriculum_goals g WHERE user_id=p_owner),'[]'::jsonb),
  'rows',coalesce((SELECT jsonb_agg(to_jsonb(l) ORDER BY id) FROM public.lessons l WHERE user_id=p_owner),'[]'::jsonb),
  'vacations',coalesce((SELECT jsonb_agg(to_jsonb(v) ORDER BY id) FROM public.vacation_blocks v WHERE user_id=p_owner),'[]'::jsonb))
$$;
CREATE FUNCTION public.read_scheduler_calendar() RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE state jsonb;zone text;
BEGIN
 IF auth.uid() IS NULL THEN RETURN jsonb_build_object('status','invalid','reason','owner');END IF;
 state:=rooted_private.scheduler_calendar_state(auth.uid());zone:=state->'profile'->>'timezone';
 IF zone IS NULL OR NOT EXISTS(SELECT 1 FROM pg_timezone_names WHERE name=zone) THEN RETURN jsonb_build_object('status','invalid','reason','calendar');END IF;
 RETURN jsonb_build_object('status','ready','mode',CASE WHEN EXISTS(SELECT 1 FROM rooted_private.scheduler_modes m JOIN public.curriculum_goals g ON g.id=m.goal_id WHERE g.user_id=auth.uid() AND m.mode='paused') THEN 'paused' WHEN EXISTS(SELECT 1 FROM rooted_private.scheduler_modes m JOIN public.curriculum_goals g ON g.id=m.goal_id WHERE g.user_id=auth.uid()) THEN 'atomic_v2' ELSE 'legacy' END,'snapshot',state,'localDay',(now() AT TIME ZONE zone)::date);
END $$;
-- Validate a proposed target; date selection stays in the existing TS helpers.
CREATE FUNCTION rooted_private.calendar_teaching(p_day date,p_days jsonb,p_blocks jsonb) RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path=pg_catalog,pg_temp AS $$
 SELECT EXISTS(SELECT 1 FROM jsonb_array_elements_text(coalesce(p_days,'["Mon","Tue","Wed","Thu","Fri"]'::jsonb)) d
 WHERE CASE lower(btrim(d)) WHEN 'sun' THEN 0 WHEN 'sunday' THEN 0 WHEN 'mon' THEN 1 WHEN 'monday' THEN 1 WHEN 'tue' THEN 2 WHEN 'tues' THEN 2 WHEN 'tuesday' THEN 2 WHEN 'wed' THEN 3 WHEN 'wednesday' THEN 3 WHEN 'thu' THEN 4 WHEN 'thur' THEN 4 WHEN 'thurs' THEN 4 WHEN 'thursday' THEN 4 WHEN 'fri' THEN 5 WHEN 'friday' THEN 5 WHEN 'sat' THEN 6 WHEN 'saturday' THEN 6 END=extract(dow FROM p_day)::integer)
 AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(p_blocks) v WHERE p_day BETWEEN (v->>'start_date')::date AND (v->>'end_date')::date)
$$;
CREATE FUNCTION rooted_private.calendar_count(p_start date,p_end date,p_days jsonb,p_blocks jsonb) RETURNS integer
LANGUAGE sql IMMUTABLE SET search_path=pg_catalog,pg_temp AS $$
 SELECT count(*)::integer FROM generate_series(p_start,p_end,interval '1 day') d WHERE rooted_private.calendar_teaching(d::date,p_days,p_blocks)
$$;
CREATE FUNCTION public.commit_scheduler_calendar(p_operation_id uuid,p_expected jsonb,p_action jsonb,p_writes jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE owner_id uuid:=auth.uid();g uuid;before_state jsonb;after_state jsonb;request_hash text;receipt rooted_private.scheduler_calendar_receipts%rowtype;
 kind text:=p_action->>'kind';block public.vacation_blocks%rowtype;block_id uuid;start_day date;end_day date;local_day date;days jsonb;old_blocks jsonb;new_blocks jsonb;
 shift_count integer:=0;needs_shift boolean:=false;origin date;target date;n integer;r jsonb;w jsonb;actual jsonb;result jsonb;shifted integer:=0;
BEGIN
 BEGIN
  IF owner_id IS NULL OR p_operation_id IS NULL OR kind NOT IN ('add','edit','remove','endnow') OR kind IS NULL OR jsonb_typeof(p_writes) IS DISTINCT FROM 'array' THEN RETURN jsonb_build_object('status','invalid','reason','request');END IF;
  IF (p_action-CASE kind WHEN 'add' THEN ARRAY['kind','name','startDate','endDate','shift','localDay'] WHEN 'edit' THEN ARRAY['kind','id','name','startDate','endDate','localDay'] WHEN 'remove' THEN ARRAY['kind','id','shift','localDay'] ELSE ARRAY['kind','id','localDay'] END)<>'{}'::jsonb THEN RETURN jsonb_build_object('status','invalid','reason','action_fields');END IF;
  -- Bounded fail-fast locks protect complete membership, including one-offs and
  -- newly created goals. Every row writer participates in this owner barrier.
  PERFORM rooted_private.scheduler_lock_owner(owner_id,true);
  FOR g IN SELECT id FROM public.curriculum_goals WHERE user_id=owner_id ORDER BY id FOR UPDATE NOWAIT LOOP NULL;END LOOP;
  PERFORM 1 FROM public.lessons WHERE user_id=owner_id ORDER BY id FOR UPDATE NOWAIT;
  PERFORM 1 FROM public.profiles WHERE id=owner_id FOR UPDATE NOWAIT;
  IF NOT pg_try_advisory_xact_lock(hashtextextended(p_operation_id::text,0)) THEN RAISE lock_not_available;END IF;
  request_hash:=rooted_private.scheduler_hash(jsonb_build_object('expected',p_expected,'action',p_action,'writes',p_writes));
  SELECT * INTO receipt FROM rooted_private.scheduler_calendar_receipts WHERE id=p_operation_id FOR UPDATE NOWAIT;
  IF FOUND THEN
   IF receipt.user_id<>owner_id OR receipt.request_hash<>request_hash THEN RETURN jsonb_build_object('status','invalid','reason','operation_reused');END IF;
   IF receipt.undone_at IS NOT NULL THEN RETURN jsonb_build_object('status','already_undone','operationId',p_operation_id);END IF;
   RETURN receipt.result||jsonb_build_object('status','already_applied');
  END IF;
  IF EXISTS(SELECT 1 FROM rooted_private.scheduler_modes m JOIN public.curriculum_goals c ON c.id=m.goal_id WHERE c.user_id=owner_id AND m.mode='paused') THEN RETURN jsonb_build_object('status','paused');END IF;
  before_state:=rooted_private.scheduler_calendar_state(owner_id);
  IF before_state IS DISTINCT FROM p_expected THEN RETURN jsonb_build_object('status','stale');END IF;
  IF before_state->'profile'->>'timezone' IS NULL THEN RETURN jsonb_build_object('status','invalid','reason','timezone');END IF;
  local_day:=(now() AT TIME ZONE (before_state->'profile'->>'timezone'))::date;
  IF (p_action->>'localDay')::date IS DISTINCT FROM local_day THEN RETURN jsonb_build_object('status','stale','reason','local_day');END IF;
  days:=before_state->'profile'->'school_days';IF days IS NULL OR days='null'::jsonb OR jsonb_array_length(days)=0 THEN days:='["Mon","Tue","Wed","Thu","Fri"]'::jsonb;END IF;
  old_blocks:=before_state->'vacations';
  IF kind<>'add' THEN
   block_id:=(p_action->>'id')::uuid;SELECT * INTO block FROM public.vacation_blocks WHERE id=block_id AND user_id=owner_id;
   IF NOT FOUND THEN RETURN jsonb_build_object('status','invalid','reason','block_owner');END IF;
  ELSE block_id:=gen_random_uuid();END IF;
  IF kind IN ('add','edit') THEN start_day:=(p_action->>'startDate')::date;end_day:=(p_action->>'endDate')::date;
  ELSIF kind='endnow' THEN start_day:=block.start_date;end_day:=greatest(block.start_date,local_day);
  ELSE start_day:=block.start_date;end_day:=block.end_date;END IF;
  IF start_day IS NULL OR end_day IS NULL OR end_day<start_day OR end_day-start_day>3660 OR (kind IN ('add','edit') AND nullif(btrim(p_action->>'name'),'') IS NULL) THEN RETURN jsonb_build_object('status','invalid','reason','period');END IF;
  IF kind IN ('add','remove') AND coalesce((p_action->>'shift')::boolean,false) AND (kind='add' OR block.shift_applied) THEN
   IF kind='add' AND end_day<local_day THEN RETURN jsonb_build_object('status','invalid','reason','past_shift');END IF;
   shift_count:=rooted_private.calendar_count(start_day,end_day,days,coalesce((SELECT jsonb_agg(v) FROM jsonb_array_elements(old_blocks) v WHERE v->>'id'<>block_id::text),'[]'::jsonb));
   needs_shift:=shift_count>0;
  END IF;
  IF kind IN ('edit','endnow') AND coalesce((p_action->>'shift')::boolean,false) THEN RETURN jsonb_build_object('status','invalid','reason','shift_choice');END IF;
  new_blocks:=coalesce((SELECT jsonb_agg(v) FROM jsonb_array_elements(old_blocks) v WHERE v->>'id'<>block_id::text),'[]'::jsonb);
  IF kind<>'remove' THEN new_blocks:=new_blocks||jsonb_build_array(jsonb_build_object('id',block_id,'start_date',start_day,'end_date',end_day));END IF;
  IF jsonb_array_length(p_writes)<>(SELECT count(DISTINCT x->>'id') FROM jsonb_array_elements(p_writes) x) THEN RETURN jsonb_build_object('status','invalid','reason','duplicate_write');END IF;
  FOR r IN SELECT * FROM jsonb_array_elements(before_state->'rows') LOOP
   SELECT x INTO w FROM jsonb_array_elements(p_writes) x WHERE x->>'id'=r->>'id';
   IF needs_shift AND coalesce((r->>'completed')::boolean,false)=false AND (r->>'scheduled_date')::date>=start_day THEN
    IF w IS NULL OR (w-ARRAY['id','date'])<>'{}'::jsonb THEN RETURN jsonb_build_object('status','invalid','reason','shift_scope');END IF;
    origin:=(r->>'scheduled_date')::date;target:=(w->>'date')::date;
    IF coalesce((r->>'queue_preserved')::boolean,false) AND NOT coalesce((r->>'skipped')::boolean,false) AND target IS DISTINCT FROM origin THEN RETURN jsonb_build_object('status','invalid','reason','preserved_work');END IF;
    IF target IS NULL OR NOT rooted_private.calendar_teaching(target,days,new_blocks) THEN RETURN jsonb_build_object('status','invalid','reason','shift_target');END IF;
    IF kind='remove' THEN
     IF target>=origin OR origin-target>365 OR rooted_private.calendar_count(target,origin-1,days,new_blocks)<>shift_count THEN RETURN jsonb_build_object('status','invalid','reason','inverse_target');END IF;
    ELSIF origin BETWEEN start_day AND end_day AND rooted_private.calendar_count(start_day,origin,days,'[]'::jsonb)>0 THEN
     n:=rooted_private.calendar_count(start_day,origin,days,'[]'::jsonb);
     IF target<=end_day OR target-end_day>365 OR rooted_private.calendar_count(end_day+1,target,days,new_blocks)<>n THEN RETURN jsonb_build_object('status','invalid','reason','inside_target');END IF;
    ELSIF target<=origin OR target-origin>365 OR rooted_private.calendar_count(origin+1,target,days,new_blocks)<>shift_count THEN RETURN jsonb_build_object('status','invalid','reason','forward_target');END IF;
    shifted:=shifted+1;
   ELSIF w IS NOT NULL THEN RETURN jsonb_build_object('status','invalid','reason','extra_write');END IF;
  END LOOP;
  IF shifted<>jsonb_array_length(p_writes) THEN RETURN jsonb_build_object('status','invalid','reason','write_membership');END IF;
  FOR g IN SELECT id FROM public.curriculum_goals WHERE user_id=owner_id ORDER BY id LOOP
   PERFORM rooted_private.scheduler_allow(g,'calendar',ARRAY(SELECT (x->>'id')::uuid FROM jsonb_array_elements(p_writes) x JOIN jsonb_array_elements(before_state->'rows') row_before ON row_before->>'id'=x->>'id' WHERE row_before->>'curriculum_goal_id'=g::text),ARRAY['date','scheduled_date','scheduled_source'],'{}'::text[]);
  END LOOP;
  IF kind='add' THEN INSERT INTO public.vacation_blocks(id,user_id,name,start_date,end_date,shift_applied) VALUES(block_id,owner_id,p_action->>'name',start_day,end_day,shifted>0);
  ELSIF kind='edit' THEN UPDATE public.vacation_blocks SET name=p_action->>'name',start_date=start_day,end_date=end_day WHERE id=block_id;
  ELSIF kind='endnow' THEN UPDATE public.vacation_blocks SET end_date=end_day WHERE id=block_id;
  ELSE DELETE FROM public.vacation_blocks WHERE id=block_id;END IF;
  FOR w IN SELECT * FROM jsonb_array_elements(p_writes) LOOP
   UPDATE public.lessons SET date=(w->>'date')::date,scheduled_date=(w->>'date')::date,scheduled_source='vacation_resched' WHERE id=(w->>'id')::uuid AND user_id=owner_id;
  END LOOP;
  after_state:=rooted_private.scheduler_calendar_state(owner_id);
  IF (before_state-ARRAY['rows','vacations']) IS DISTINCT FROM (after_state-ARRAY['rows','vacations']) OR jsonb_array_length(before_state->'rows')<>jsonb_array_length(after_state->'rows') THEN RAISE EXCEPTION 'calendar_post_scope';END IF;
  SELECT x INTO actual FROM jsonb_array_elements(after_state->'vacations') x WHERE x->>'id'=block_id::text;
  IF kind='remove' THEN IF actual IS NOT NULL THEN RAISE EXCEPTION 'calendar_remove_failed';END IF;
  ELSIF kind='add' THEN
   IF NOT actual @> jsonb_build_object('id',block_id,'user_id',owner_id,'name',p_action->>'name','start_date',start_day,'end_date',end_day,'shift_applied',shifted>0) THEN RAISE EXCEPTION 'calendar_add_postcondition';END IF;
  ELSIF kind='edit' THEN
   IF actual IS DISTINCT FROM (to_jsonb(block)||jsonb_build_object('name',p_action->>'name','start_date',start_day,'end_date',end_day)) THEN RAISE EXCEPTION 'calendar_edit_postcondition';END IF;
  ELSIF actual IS DISTINCT FROM (to_jsonb(block)||jsonb_build_object('end_date',end_day)) THEN RAISE EXCEPTION 'calendar_end_postcondition';END IF;
  IF jsonb_array_length(after_state->'vacations')<>jsonb_array_length(before_state->'vacations')+(CASE kind WHEN 'add' THEN 1 WHEN 'remove' THEN -1 ELSE 0 END) THEN RAISE EXCEPTION 'calendar_block_count';END IF;
  FOR r IN SELECT * FROM jsonb_array_elements(before_state->'vacations') WHERE value->>'id'<>block_id::text LOOP
   SELECT x INTO actual FROM jsonb_array_elements(after_state->'vacations') x WHERE x->>'id'=r->>'id';
   IF actual IS DISTINCT FROM r THEN RAISE EXCEPTION 'calendar_other_block_changed';END IF;
  END LOOP;
  FOR r IN SELECT * FROM jsonb_array_elements(before_state->'rows') LOOP
   SELECT x INTO actual FROM jsonb_array_elements(after_state->'rows') x WHERE x->>'id'=r->>'id';
   SELECT x INTO w FROM jsonb_array_elements(p_writes) x WHERE x->>'id'=r->>'id';
   IF w IS NULL THEN IF actual IS DISTINCT FROM r THEN RAISE EXCEPTION 'calendar_untargeted_change';END IF;
   ELSIF (actual-'updated_at') IS DISTINCT FROM ((r||jsonb_build_object('date',w->'date','scheduled_date',w->'date','scheduled_source','vacation_resched'))-'updated_at') THEN RAISE EXCEPTION 'calendar_work_changed';END IF;
  END LOOP;
  result:=jsonb_build_object('status','applied','operationId',p_operation_id,'blockId',block_id,'written',shifted);
  INSERT INTO rooted_private.scheduler_calendar_receipts(id,user_id,request_hash,before_state,after_state,after_hash,result) VALUES(p_operation_id,owner_id,request_hash,before_state,after_state,rooted_private.scheduler_hash(after_state),result);
  FOR g IN SELECT id FROM public.curriculum_goals WHERE user_id=owner_id LOOP PERFORM rooted_private.scheduler_disallow(g);END LOOP;
  RETURN result;
 EXCEPTION WHEN lock_not_available THEN RETURN jsonb_build_object('status','busy');
 WHEN invalid_text_representation OR invalid_datetime_format OR datetime_field_overflow THEN RETURN jsonb_build_object('status','invalid','reason','format');
 WHEN raise_exception THEN RETURN jsonb_build_object('status','invalid','reason',SQLERRM);
 END;
END $$;
REVOKE ALL ON FUNCTION rooted_private.scheduler_calendar_state(uuid),rooted_private.calendar_teaching(date,jsonb,jsonb),rooted_private.calendar_count(date,date,jsonb,jsonb) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.read_scheduler_calendar(),public.commit_scheduler_calendar(uuid,jsonb,jsonb,jsonb) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.read_scheduler_calendar(),public.commit_scheduler_calendar(uuid,jsonb,jsonb,jsonb) TO authenticated;
CREATE FUNCTION public.undo_scheduler_calendar(p_operation_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE owner_id uuid:=auth.uid();receipt rooted_private.scheduler_calendar_receipts%rowtype;g uuid;r jsonb;a jsonb;actual jsonb;restored jsonb;v jsonb;block_id uuid;
BEGIN
 BEGIN
  IF owner_id IS NULL THEN RETURN jsonb_build_object('status','invalid','reason','owner');END IF;
  PERFORM rooted_private.scheduler_lock_owner(owner_id,true);
  FOR g IN SELECT id FROM public.curriculum_goals WHERE user_id=owner_id ORDER BY id FOR UPDATE NOWAIT LOOP NULL;END LOOP;
  PERFORM 1 FROM public.lessons WHERE user_id=owner_id ORDER BY id FOR UPDATE NOWAIT;
  PERFORM 1 FROM public.profiles WHERE id=owner_id FOR UPDATE NOWAIT;
  IF NOT pg_try_advisory_xact_lock(hashtextextended(p_operation_id::text,0)) THEN RAISE lock_not_available;END IF;
  SELECT * INTO receipt FROM rooted_private.scheduler_calendar_receipts WHERE id=p_operation_id AND user_id=owner_id FOR UPDATE NOWAIT;
  IF NOT FOUND THEN RETURN jsonb_build_object('status','invalid','reason','receipt');END IF;
  IF receipt.undone_at IS NOT NULL THEN RETURN jsonb_build_object('status','already_undone');END IF;
  IF receipt.before_state IS NULL OR receipt.after_state IS NULL OR receipt.created_at < clock_timestamp()-interval '10 minutes' THEN
   UPDATE rooted_private.scheduler_calendar_receipts SET before_state=NULL,after_state=NULL WHERE id=p_operation_id;
   RETURN jsonb_build_object('status','invalid','reason','undo_expired');
  END IF;
  IF rooted_private.scheduler_calendar_state(owner_id) IS DISTINCT FROM receipt.after_state THEN RETURN jsonb_build_object('status','stale');END IF;
  block_id:=(receipt.result->>'blockId')::uuid;
  FOR g IN SELECT id FROM public.curriculum_goals WHERE user_id=owner_id LOOP
   PERFORM rooted_private.scheduler_allow(g,'calendar',ARRAY(SELECT (x->>'id')::uuid FROM jsonb_array_elements(receipt.before_state->'rows') x JOIN jsonb_array_elements(receipt.after_state->'rows') y ON y->>'id'=x->>'id' WHERE x->>'curriculum_goal_id'=g::text AND (x-'updated_at') IS DISTINCT FROM (y-'updated_at')),ARRAY['date','scheduled_date','scheduled_source'],'{}'::text[]);
  END LOOP;
  SELECT x INTO v FROM jsonb_array_elements(receipt.before_state->'vacations') x WHERE x->>'id'=block_id::text;
  IF v IS NULL THEN DELETE FROM public.vacation_blocks WHERE id=block_id AND user_id=owner_id;
  ELSIF EXISTS(SELECT 1 FROM public.vacation_blocks WHERE id=block_id AND user_id=owner_id) THEN
   UPDATE public.vacation_blocks SET name=v->>'name',start_date=(v->>'start_date')::date,end_date=(v->>'end_date')::date,shift_applied=(v->>'shift_applied')::boolean WHERE id=block_id;
  ELSE
   INSERT INTO public.vacation_blocks(id,user_id,name,start_date,end_date,created_at,shift_applied)
   VALUES(block_id,owner_id,v->>'name',(v->>'start_date')::date,(v->>'end_date')::date,(v->>'created_at')::timestamptz,(v->>'shift_applied')::boolean);
  END IF;
  FOR r IN SELECT * FROM jsonb_array_elements(receipt.before_state->'rows') LOOP
   SELECT x INTO a FROM jsonb_array_elements(receipt.after_state->'rows') x WHERE x->>'id'=r->>'id';
   IF (r- 'updated_at') IS DISTINCT FROM (a-'updated_at') THEN
    UPDATE public.lessons SET date=(r->>'date')::date,scheduled_date=(r->>'scheduled_date')::date,scheduled_source=r->>'scheduled_source' WHERE id=(r->>'id')::uuid AND user_id=owner_id;
   END IF;
  END LOOP;
  restored:=rooted_private.scheduler_calendar_state(owner_id);
  IF (restored-'rows') IS DISTINCT FROM (receipt.before_state-'rows') OR jsonb_array_length(restored->'rows')<>jsonb_array_length(receipt.before_state->'rows') THEN RAISE EXCEPTION 'calendar_undo_scope';END IF;
  FOR r IN SELECT * FROM jsonb_array_elements(receipt.before_state->'rows') LOOP
   SELECT x INTO a FROM jsonb_array_elements(receipt.after_state->'rows') x WHERE x->>'id'=r->>'id';
   SELECT x INTO actual FROM jsonb_array_elements(restored->'rows') x WHERE x->>'id'=r->>'id';
   IF (r-'updated_at') IS DISTINCT FROM (a-'updated_at') THEN
    IF (actual-'updated_at') IS DISTINCT FROM (r-'updated_at') THEN RAISE EXCEPTION 'calendar_undo_work';END IF;
   ELSIF actual IS DISTINCT FROM r THEN RAISE EXCEPTION 'calendar_undo_untargeted';END IF;
  END LOOP;
  UPDATE rooted_private.scheduler_calendar_receipts SET undone_at=clock_timestamp(),before_state=NULL,after_state=NULL WHERE id=p_operation_id;
  FOR g IN SELECT id FROM public.curriculum_goals WHERE user_id=owner_id LOOP PERFORM rooted_private.scheduler_disallow(g);END LOOP;
  RETURN jsonb_build_object('status','undone');
 EXCEPTION WHEN lock_not_available THEN RETURN jsonb_build_object('status','busy');
 WHEN raise_exception THEN RETURN jsonb_build_object('status','invalid','reason',SQLERRM);
 END;
END $$;
REVOKE ALL ON FUNCTION public.undo_scheduler_calendar(uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.undo_scheduler_calendar(uuid) TO authenticated;
