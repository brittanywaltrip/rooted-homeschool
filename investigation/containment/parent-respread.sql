-- Fixed server-owned parent-action projection. Private helper is pure over its locked snapshot.
create function rooted_private.scheduler_project_dates(state jsonb)
returns jsonb language plpgsql stable set search_path=pg_catalog,pg_temp as $$
declare
 g jsonb:=state->'goal'; r jsonb; slot integer; pointer integer:=(g->>'current_lesson')::int;
 total integer:=(g->>'total_lessons')::int; day date:=(state->>'localDay')::date;
 cursor_day date:=greatest(day,(g->>'start_date')::date); end_day date:=day+3650;
 pin_dates jsonb:='{}'; skipped jsonb:='{}'; used jsonb:='{}'; emitted jsonb:='{}'; projected jsonb:='{}'; makeups jsonb:='{}';
 d date; next_slot integer; done_count integer; back integer; cap integer; used_count integer;
 first_applied boolean:=false; placed boolean; safety integer:=0; label text; override_value jsonb;
begin
 if day is null or pointer is null or total is null or pointer<0 or total<0 or total>10000 then raise exception 'scheduler_projection_shape';end if;
 select count(*) into done_count from jsonb_array_elements(state->'rows') x where (x->>'completed')::boolean and x->>'queue_position' is not null
  and (x->>'completed_at')::timestamptz >= (state->>'dayStartIso')::timestamptz
  and (x->>'completed_at')::timestamptz < (state->>'dayEndIso')::timestamptz;
 for r in select * from jsonb_array_elements(state->'rows') loop
  slot:=(r->>'queue_position')::int;
  if slot is not null and not coalesce((r->>'completed')::boolean,false) and coalesce((r->>'skipped')::boolean,false) then skipped:=skipped||jsonb_build_object(slot::text,true); end if;
 end loop;
 -- Reserve an unslotted row's own number only when no row holds that slot.
 for r in select * from jsonb_array_elements(state->'rows') loop
  slot:=(r->>'lesson_number')::int;
  if r->>'queue_position' is null and slot>pointer and not exists(select 1 from jsonb_array_elements(state->'rows') x where (x->>'queue_position')::int=slot) then skipped:=skipped||jsonb_build_object(slot::text,true);end if;
  d:=(r->>'scheduled_date')::date;
  if r->>'queue_position' is null and not coalesce((r->>'completed')::boolean,false) and not coalesce((r->>'skipped')::boolean,false) and d>=day and d<end_day then used:=used||jsonb_build_object(d::text,coalesce((used->>d::text)::int,0)+1);end if;
  if r->>'queue_position' is null and coalesce((r->>'completed')::boolean,false) and (r->>'completed_at')::timestamptz >= (state->>'dayStartIso')::timestamptz and (r->>'completed_at')::timestamptz < (state->>'dayEndIso')::timestamptz then used:=used||jsonb_build_object(day::text,coalesce((used->>day::text)::int,0)+1);end if;
 end loop;
 for r in select * from jsonb_array_elements(state->'rows') loop
  slot:=(r->>'queue_position')::int;d:=coalesce(r->>'scheduled_date',r->>'date')::date;
  if slot is not null and d is not null and slot>=1 and slot<=total and not coalesce((r->>'completed')::boolean,false) and not skipped ? slot::text and coalesce((r->>'queue_preserved')::boolean,false) then
   emitted:=emitted||jsonb_build_object(slot::text,true);makeups:=makeups||jsonb_build_object(slot::text,true);
   if d<end_day then projected:=projected||jsonb_build_object(slot::text,d);used:=used||jsonb_build_object(d::text,coalesce((used->>d::text)::int,0)+1);end if;continue;
  end if;
  if slot is null or d is null or coalesce((r->>'completed')::boolean,false) or not coalesce((r->>'queue_pinned')::boolean,false) or skipped ? slot::text then continue; end if;
  if slot>pointer and slot<=total then
   if pin_dates ? slot::text then raise exception 'scheduler_duplicate_pin';end if;
   pin_dates:=pin_dates||jsonb_build_object(slot::text,d);used:=used||jsonb_build_object(d::text,coalesce((used->>d::text)::int,0)+1);
  elsif slot>=1 and slot<=pointer and d>=day and d<end_day then
   if makeups ? slot::text then raise exception 'scheduler_duplicate_pin';end if;
   makeups:=makeups||jsonb_build_object(slot::text,true);emitted:=emitted||jsonb_build_object(slot::text,true);
   used:=used||jsonb_build_object(d::text,coalesce((used->>d::text)::int,0)+1);projected:=projected||jsonb_build_object(slot::text,d);
  end if;
 end loop;
 next_slot:=pointer+1;
 while next_slot<=total and safety<10000 loop
  safety:=safety+1;
  if emitted ? next_slot::text or skipped ? next_slot::text then next_slot:=next_slot+1;continue; end if;
  if pin_dates ? next_slot::text then
   d:=(pin_dates->>next_slot::text)::date;if d>=end_day then exit;end if;
   projected:=projected||jsonb_build_object(next_slot::text,d);emitted:=emitted||jsonb_build_object(next_slot::text,true);
   cursor_day:=greatest(cursor_day,d);next_slot:=next_slot+1;continue;
  end if;
  placed:=false;
  while cursor_day<end_day and safety<10000 loop
   safety:=safety+1;
   if (array['Sun','Mon','Tue','Wed','Thu','Fri','Sat'])[extract(dow from cursor_day)::int+1] = any(case when jsonb_typeof(g->'school_days')='array' and jsonb_array_length(g->'school_days')>0 then ARRAY(select jsonb_array_elements_text(g->'school_days')) else ARRAY['Mon','Tue','Wed','Thu','Fri'] end) and not exists(select 1 from jsonb_array_elements(state->'vacations') v where cursor_day between (v->>'start_date')::date and (v->>'end_date')::date) then
    label:=(array['Sun','Mon','Tue','Wed','Thu','Fri','Sat'])[extract(dow from cursor_day)::int+1];
    override_value:=g->'lessons_per_day_overrides'->label;
    cap:=greatest(1,(g->>'lessons_per_day')::int);
    if jsonb_typeof(override_value)='number' and (override_value::text)::numeric>=0 then cap:=floor((override_value::text)::numeric)::int;end if;
    if cap>0 then
     if not first_applied and cursor_day=day then
      next_slot:=pointer+1;back:=done_count;
      while back>0 and next_slot>1 loop next_slot:=next_slot-1;if not skipped ? next_slot::text and not makeups ? next_slot::text then back:=back-1;end if;end loop;
      while skipped ? next_slot::text or makeups ? next_slot::text loop next_slot:=next_slot+1;end loop;
      first_applied:=true;
      if next_slot>total or pin_dates ? next_slot::text then exit;end if;
     end if;
     used_count:=coalesce((used->>cursor_day::text)::int,0);
     if used_count<cap or (first_applied and cursor_day=day and next_slot<=pointer) then
      projected:=projected||jsonb_build_object(next_slot::text,cursor_day);emitted:=emitted||jsonb_build_object(next_slot::text,true);
      used:=used||jsonb_build_object(cursor_day::text,used_count+1);next_slot:=next_slot+1;placed:=true;exit;
     end if;
    end if;
   end if;
   cursor_day:=cursor_day+1;
  end loop;
  if not placed then if pin_dates ? next_slot::text and cursor_day<end_day then continue;end if;exit;end if;
 end loop;
 return projected;
end $$;
CREATE FUNCTION rooted_private.scheduler_respread_locked(p_goal uuid,p_source text,p_day date) RETURNS jsonb
LANGUAGE plpgsql SET search_path=pg_catalog,pg_temp AS $$
DECLARE g public.curriculum_goals%rowtype;day_window jsonb;before_state jsonb;projection jsonb;r record;target date;written uuid[]:='{}';n integer;
BEGIN
 SELECT * INTO g FROM public.curriculum_goals WHERE id=p_goal AND user_id=auth.uid();
 IF NOT FOUND OR p_source IS NULL OR p_source NOT IN ('completion_respread','uncomplete_respread','catchup_spread','skip_undo','skip_respread','edit_respread') THEN RAISE EXCEPTION 'scheduler_respread_scope';END IF;
 day_window:=rooted_private.cascade_local_window(g.user_id,p_day);
 IF day_window IS NULL OR p_day IS DISTINCT FROM (now() AT TIME ZONE (day_window->>'timeZone'))::date THEN RAISE EXCEPTION 'scheduler_respread_day';END IF;
 before_state:=rooted_private.cascade_snapshot(p_goal,p_day,day_window->>'dayStartIso',day_window->>'dayEndIso');
 projection:=rooted_private.scheduler_project_dates(before_state);
 PERFORM rooted_private.scheduler_lock_owner(auth.uid(),false);
 FOR r IN SELECT * FROM public.lessons WHERE curriculum_goal_id=p_goal AND queue_position>g.current_lesson AND NOT completed AND NOT skipped AND NOT coalesce(is_backfill,false) AND continues_lesson_id IS NULL AND NOT queue_pinned AND NOT queue_preserved ORDER BY id LOOP
  target:=(projection->>r.queue_position::text)::date;
  IF target IS NULL THEN RAISE EXCEPTION 'scheduler_respread_unprojected';END IF;
  IF r.scheduled_date IS DISTINCT FROM target OR r.date IS DISTINCT FROM target THEN
   UPDATE public.lessons SET date=target,scheduled_date=target,scheduled_source=p_source WHERE id=r.id;
   GET DIAGNOSTICS n=ROW_COUNT;IF n<>1 THEN RAISE EXCEPTION 'scheduler_respread_refused';END IF;
   written:=array_append(written,r.id);
  END IF;
 END LOOP;
 -- A trigger may neither skip a required write nor mutate a protected row/content.
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(before_state->'rows') old JOIN public.lessons l ON l.id=(old->>'id')::uuid WHERE
  (l.id=ANY(written) AND ((to_jsonb(l)-ARRAY['date','scheduled_date','scheduled_source','updated_at']) IS DISTINCT FROM (old-ARRAY['date','scheduled_date','scheduled_source','updated_at']) OR l.date IS DISTINCT FROM (projection->>l.queue_position::text)::date OR l.scheduled_date IS DISTINCT FROM l.date OR l.scheduled_source IS DISTINCT FROM p_source)) OR
  (NOT l.id=ANY(written) AND to_jsonb(l) IS DISTINCT FROM old)) OR
  (SELECT count(*) FROM public.lessons WHERE curriculum_goal_id=p_goal)<>jsonb_array_length(before_state->'rows') OR
  (SELECT to_jsonb(x) FROM public.curriculum_goals x WHERE id=p_goal) IS DISTINCT FROM before_state->'goal' THEN RAISE EXCEPTION 'scheduler_respread_postcondition';END IF;
 RETURN jsonb_build_object('written',cardinality(written),'writtenIds',to_jsonb(written));
END $$;
CREATE FUNCTION public.commit_scheduler_respread(p_operation_id uuid,p_goal_id uuid,p_expected jsonb,p_source text,p_day date) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE u uuid:=auth.uid();m text;prior rooted_private.scheduler_action_receipts%rowtype;have jsonb;result jsonb;hash text:=rooted_private.scheduler_hash(jsonb_build_object('rpc','respread','goal',p_goal_id,'expected',p_expected,'source',p_source,'day',p_day));ids uuid[];
BEGIN
 IF u IS NULL OR p_operation_id IS NULL OR p_source IS NULL OR p_source NOT IN ('completion_respread','uncomplete_respread','catchup_spread','skip_undo','skip_respread') THEN RETURN jsonb_build_object('status','invalid','reason','scope');END IF;
 BEGIN
  IF NOT pg_try_advisory_xact_lock(hashtextextended(p_operation_id::text,0)) THEN RAISE lock_not_available;END IF;
  SELECT * INTO prior FROM rooted_private.scheduler_action_receipts WHERE id=p_operation_id;
  IF FOUND THEN
   IF prior.user_id<>u OR prior.goal_id<>p_goal_id OR prior.request_hash<>hash THEN RETURN jsonb_build_object('status','invalid','reason','operation');END IF;
   RETURN prior.result||jsonb_build_object('status','already_applied');
  END IF;
  PERFORM rooted_private.scheduler_lock_owner(auth.uid(),false);
  PERFORM 1 FROM public.curriculum_goals WHERE id=p_goal_id AND user_id=u AND NOT archived FOR UPDATE NOWAIT;
  IF NOT FOUND THEN RETURN jsonb_build_object('status','invalid','reason','owner');END IF;
  SELECT mode INTO m FROM rooted_private.scheduler_modes WHERE goal_id=p_goal_id;
  IF m IS DISTINCT FROM 'atomic_v2' THEN RETURN jsonb_build_object('status',CASE WHEN m='paused' THEN 'paused' ELSE 'stale' END,'reason','mode');END IF;
  PERFORM 1 FROM public.lessons WHERE curriculum_goal_id=p_goal_id ORDER BY id FOR UPDATE NOWAIT;
  PERFORM 1 FROM public.profiles WHERE id=u FOR SHARE NOWAIT;
  PERFORM rooted_private.scheduler_lock_owner(auth.uid(),false);
  have:=rooted_private.scheduler_state(p_goal_id);
  IF have IS DISTINCT FROM p_expected THEN RETURN jsonb_build_object('status','stale','reason','schedule_changed');END IF;
  IF p_day IS DISTINCT FROM (now() AT TIME ZONE (SELECT timezone FROM public.profiles WHERE id=u))::date THEN RETURN jsonb_build_object('status','stale','reason','local_day_changed');END IF;
  SELECT coalesce(array_agg(l.id),'{}') INTO ids FROM public.lessons l JOIN public.curriculum_goals g ON g.id=l.curriculum_goal_id WHERE g.id=p_goal_id AND l.queue_position>g.current_lesson AND NOT l.completed AND NOT l.skipped AND NOT coalesce(l.is_backfill,false) AND l.continues_lesson_id IS NULL AND NOT l.queue_pinned AND NOT l.queue_preserved;
  PERFORM rooted_private.scheduler_allow(p_goal_id,'respread',ids,ARRAY['date','scheduled_date','scheduled_source'],'{}'::text[]);
  result:=rooted_private.scheduler_respread_locked(p_goal_id,p_source,p_day)||jsonb_build_object('status','applied');
  SET CONSTRAINTS ALL IMMEDIATE;
  PERFORM rooted_private.scheduler_disallow(p_goal_id);
  INSERT INTO rooted_private.scheduler_action_receipts(id,user_id,goal_id,request_hash,before_state,after_hash,result) VALUES(p_operation_id,u,p_goal_id,hash,NULL,rooted_private.scheduler_hash(rooted_private.scheduler_state(p_goal_id)),result);
  RETURN result;
 EXCEPTION WHEN lock_not_available THEN RETURN jsonb_build_object('status','busy','reason','busy');END;
END $$;
REVOKE ALL ON FUNCTION rooted_private.scheduler_project_dates(jsonb),rooted_private.scheduler_respread_locked(uuid,text,date) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.commit_scheduler_respread(uuid,uuid,jsonb,text,date) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.commit_scheduler_respread(uuid,uuid,jsonb,text,date) TO authenticated;
