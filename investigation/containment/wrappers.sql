DO $$ BEGIN IF (SELECT md5(prosrc) FROM pg_proc WHERE oid='public.apply_builder_rebuild(uuid, date, jsonb, jsonb)'::regprocedure) IS DISTINCT FROM '0f6e208035a1d29e4a5172eef0f04c07' THEN RAISE EXCEPTION 'Containment baseline drift: apply_builder_rebuild';END IF;END $$;
ALTER FUNCTION public.apply_builder_rebuild(uuid, date, jsonb, jsonb) SET SCHEMA rooted_private; ALTER FUNCTION rooted_private.apply_builder_rebuild(uuid, date, jsonb, jsonb) RENAME TO contained_apply_builder_rebuild; REVOKE ALL ON FUNCTION rooted_private.contained_apply_builder_rebuild(uuid, date, jsonb, jsonb) FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION public.apply_builder_rebuild(p_goal_id uuid, p_local_day date, p_expected jsonb, p_plan jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $wrapper$ DECLARE g uuid;m text;result jsonb; BEGIN RETURN public.apply_builder_rebuild(p_goal_id,p_local_day,p_expected,p_plan,NULL); END $wrapper$; REVOKE ALL ON FUNCTION public.apply_builder_rebuild(uuid, date, jsonb, jsonb) FROM PUBLIC,anon,authenticated,service_role; GRANT EXECUTE ON FUNCTION public.apply_builder_rebuild(uuid, date, jsonb, jsonb) TO authenticated,service_role;
DO $$ BEGIN IF (SELECT md5(prosrc) FROM pg_proc WHERE oid='public.apply_builder_rebuild(uuid, date, jsonb, jsonb, jsonb)'::regprocedure) IS DISTINCT FROM '5ea0cb0551ea562e90c07b3731309229' THEN RAISE EXCEPTION 'Containment baseline drift: apply_builder_rebuild';END IF;END $$;
ALTER FUNCTION public.apply_builder_rebuild(uuid, date, jsonb, jsonb, jsonb) SET SCHEMA rooted_private; ALTER FUNCTION rooted_private.apply_builder_rebuild(uuid, date, jsonb, jsonb, jsonb) RENAME TO contained_apply_builder_rebuild; REVOKE ALL ON FUNCTION rooted_private.contained_apply_builder_rebuild(uuid, date, jsonb, jsonb, jsonb) FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION public.apply_builder_rebuild(p_goal_id uuid, p_local_day date, p_expected jsonb, p_plan jsonb, p_settings jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $wrapper$ DECLARE g uuid;m text;result jsonb; BEGIN BEGIN PERFORM rooted_private.scheduler_lock_owner(auth.uid(),false); g:=p_goal_id; IF g IS NULL THEN RETURN rooted_private.contained_apply_builder_rebuild(p_goal_id,p_local_day,p_expected,p_plan,p_settings); END IF; PERFORM 1 FROM public.curriculum_goals WHERE id=g AND user_id=auth.uid() FOR UPDATE NOWAIT; IF NOT FOUND THEN RAISE EXCEPTION 'scheduler_owner_refused';END IF; SELECT mode INTO m FROM rooted_private.scheduler_modes WHERE goal_id=g; IF m IS NULL THEN RETURN rooted_private.contained_apply_builder_rebuild(p_goal_id,p_local_day,p_expected,p_plan,p_settings); END IF; PERFORM rooted_private.scheduler_lock_owner(auth.uid(),false); IF m='paused' AND NOT (EXISTS(SELECT 1 FROM rooted_private.builder_commit_log WHERE request_id=(p_plan->>'request_id')::uuid AND user_id=auth.uid())) THEN RETURN jsonb_build_object('status','invalid','reason','scheduler_paused');END IF; PERFORM 1 FROM public.lessons WHERE curriculum_goal_id=g ORDER BY id FOR UPDATE NOWAIT; PERFORM 1 FROM public.profiles WHERE id=auth.uid() FOR SHARE NOWAIT; PERFORM rooted_private.scheduler_lock_owner(auth.uid(),false); PERFORM rooted_private.scheduler_allow(g,'apply_builder_rebuild',ARRAY(SELECT id FROM public.lessons WHERE curriculum_goal_id=g),ARRAY['date','scheduled_date','scheduled_source','queue_position','queue_pinned','queue_preserved','completed','completed_at','skipped','is_backfill'],ARRAY['current_lesson','total_lessons','start_date','start_at_lesson','target_date','school_days','lessons_per_day','lessons_per_day_overrides','placement_mode','completed_at'],ARRAY(SELECT id FROM public.lessons WHERE curriculum_goal_id=g),coalesce((SELECT jsonb_agg(jsonb_build_object('lesson_number',x->'lesson_number','queue_position',x->'queue_position','title',x->'title','scheduled_date',x->'scheduled_date','date',x->'scheduled_date','scheduled_source','wizard_create')) FROM jsonb_array_elements(p_plan->'inserts') x),'[]'::jsonb)); result:=rooted_private.contained_apply_builder_rebuild(p_goal_id,p_local_day,p_expected,p_plan,p_settings); PERFORM rooted_private.scheduler_disallow(g); RETURN result; EXCEPTION WHEN lock_not_available THEN RETURN jsonb_build_object('status','stale','reason','busy'); END; END $wrapper$; REVOKE ALL ON FUNCTION public.apply_builder_rebuild(uuid, date, jsonb, jsonb, jsonb) FROM PUBLIC,anon,authenticated,service_role; GRANT EXECUTE ON FUNCTION public.apply_builder_rebuild(uuid, date, jsonb, jsonb, jsonb) TO authenticated,service_role;
DO $$ BEGIN IF (SELECT md5(prosrc) FROM pg_proc WHERE oid='public.apply_daily_reconcile(uuid, date, jsonb, jsonb)'::regprocedure) IS DISTINCT FROM '1a4b8ed5380c8c680bc4d736a6310a81' THEN RAISE EXCEPTION 'Containment baseline drift: apply_daily_reconcile';END IF;END $$;
ALTER FUNCTION public.apply_daily_reconcile(uuid, date, jsonb, jsonb) SET SCHEMA rooted_private; ALTER FUNCTION rooted_private.apply_daily_reconcile(uuid, date, jsonb, jsonb) RENAME TO contained_apply_daily_reconcile; REVOKE ALL ON FUNCTION rooted_private.contained_apply_daily_reconcile(uuid, date, jsonb, jsonb) FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION public.apply_daily_reconcile(p_goal_id uuid, p_local_day date, p_expected jsonb, p_writes jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $wrapper$ DECLARE g uuid;m text;result jsonb; BEGIN BEGIN PERFORM rooted_private.scheduler_lock_owner(auth.uid(),false); g:=p_goal_id; IF g IS NULL THEN RETURN rooted_private.contained_apply_daily_reconcile(p_goal_id,p_local_day,p_expected,p_writes); END IF; PERFORM 1 FROM public.curriculum_goals WHERE id=g AND user_id=auth.uid() FOR UPDATE NOWAIT; IF NOT FOUND THEN RAISE EXCEPTION 'scheduler_owner_refused';END IF; SELECT mode INTO m FROM rooted_private.scheduler_modes WHERE goal_id=g; IF m IS NULL THEN RETURN rooted_private.contained_apply_daily_reconcile(p_goal_id,p_local_day,p_expected,p_writes); END IF; PERFORM rooted_private.scheduler_lock_owner(auth.uid(),false); IF m='paused' AND NOT (false) THEN RETURN jsonb_build_object('status','invalid','reason','scheduler_paused');END IF; PERFORM 1 FROM public.lessons WHERE curriculum_goal_id=g ORDER BY id FOR UPDATE NOWAIT; PERFORM 1 FROM public.profiles WHERE id=auth.uid() FOR SHARE NOWAIT; PERFORM rooted_private.scheduler_lock_owner(auth.uid(),false); PERFORM rooted_private.scheduler_allow(g,'apply_daily_reconcile',ARRAY(SELECT (x->>'id')::uuid FROM jsonb_array_elements(p_writes) x),ARRAY['date','scheduled_date','scheduled_source'],'{}'::text[],'{}'::uuid[],'[]'::jsonb); result:=rooted_private.contained_apply_daily_reconcile(p_goal_id,p_local_day,p_expected,p_writes); PERFORM rooted_private.scheduler_disallow(g); RETURN result; EXCEPTION WHEN lock_not_available THEN RETURN jsonb_build_object('status','stale','reason','busy'); END; END $wrapper$; REVOKE ALL ON FUNCTION public.apply_daily_reconcile(uuid, date, jsonb, jsonb) FROM PUBLIC,anon,authenticated,service_role; GRANT EXECUTE ON FUNCTION public.apply_daily_reconcile(uuid, date, jsonb, jsonb) TO authenticated;
DO $$ BEGIN IF (SELECT md5(prosrc) FROM pg_proc WHERE oid='public.commit_cascade_shift(uuid, uuid, jsonb, jsonb, jsonb, jsonb)'::regprocedure) IS DISTINCT FROM '100a0f4e3da54e205bd7cecfe22822cf' THEN RAISE EXCEPTION 'Containment baseline drift: commit_cascade_shift';END IF;END $$;
ALTER FUNCTION public.commit_cascade_shift(uuid, uuid, jsonb, jsonb, jsonb, jsonb) SET SCHEMA rooted_private; ALTER FUNCTION rooted_private.commit_cascade_shift(uuid, uuid, jsonb, jsonb, jsonb, jsonb) RENAME TO contained_commit_cascade_shift; REVOKE ALL ON FUNCTION rooted_private.contained_commit_cascade_shift(uuid, uuid, jsonb, jsonb, jsonb, jsonb) FROM PUBLIC,anon,authenticated,service_role;
CREATE OR REPLACE FUNCTION rooted_private.contained_commit_cascade_shift(p_operation_id uuid, p_goal_id uuid, p_expected jsonb, p_choice jsonb, p_moves jsonb, p_preserved jsonb DEFAULT '[]'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
declare
  u uuid:=auth.uid(); g public.curriculum_goals%rowtype; selected public.lessons%rowtype;
  prior rooted_private.cascade_shift_receipts%rowtype; actual jsonb; after_state jsonb;
  request jsonb:=jsonb_build_object('expected',p_expected,'choice',p_choice,'moves',p_moves,'preserved',p_preserved);
  all_moves jsonb:=p_moves||p_preserved; day date; target date; delta integer; required integer; got integer; bad integer; w jsonb;
begin
  if u is null or p_operation_id is null then return jsonb_build_object('status','invalid','reason','owner'); end if;
  perform pg_advisory_xact_lock(hashtextextended(p_operation_id::text,0));
  select * into prior from rooted_private.cascade_shift_receipts where id=p_operation_id;
  if found then
    if prior.user_id<>u or prior.goal_id<>p_goal_id or prior.request<>request then return jsonb_build_object('status','invalid','reason','operation'); end if;
    return jsonb_build_object('status',case when prior.undone_at is null then 'already_applied' else 'already_undone' end,'operationId',p_operation_id);
  end if;
  -- Completion locks a lesson before its trigger updates the goal. Never wait
  -- for its lesson while holding that goal. This subtransaction releases every
  -- acquired row lock on conflict, even if the caller keeps its transaction open.
  begin
    select * into g from public.curriculum_goals where id=p_goal_id and user_id=u and not archived for update nowait;
    if not found then return jsonb_build_object('status','invalid','reason','owner'); end if;
    perform 1 from public.lessons where curriculum_goal_id=p_goal_id order by id for update nowait;
  exception when lock_not_available then
    return jsonb_build_object('status','stale','reason','busy');
  end;
  -- Pin the authoritative timezone through validation and all writes.
  perform 1 from public.profiles where id=u for share;
  if not found then return jsonb_build_object('status','invalid','reason','time_zone');end if;
  -- Blocks a concurrent break insert/update during validation+commit. This is
  -- a short global write lock and requires performance review before release.
  PERFORM rooted_private.scheduler_lock_owner(auth.uid(),false);
  day:=(p_expected->>'localDay')::date;
  if day is null or abs(day-(now() at time zone 'UTC')::date)>1 then return jsonb_build_object('status','invalid','reason','local_day'); end if;
  if not rooted_private.cascade_window_valid(u,day,p_expected->>'dayStartIso',p_expected->>'dayEndIso') or day is distinct from (now() at time zone (rooted_private.cascade_local_window(u,day)->>'timeZone'))::date then return jsonb_build_object('status','invalid','reason','day_window');end if;
  actual:=rooted_private.cascade_snapshot(p_goal_id,day,p_expected->>'dayStartIso',p_expected->>'dayEndIso');
  if actual is distinct from p_expected then return jsonb_build_object('status','stale'); end if;
  if exists(select 1 from public.lessons where curriculum_goal_id=p_goal_id and queue_position is null) then
    return jsonb_build_object('status','invalid','reason','unsupported_queue');
  end if;
  if jsonb_typeof(p_moves) is distinct from 'array' or jsonb_array_length(p_moves)=0 then return jsonb_build_object('status','invalid','reason','moves'); end if;
  select * into selected from public.lessons where id=(p_choice->>'lessonId')::uuid and curriculum_goal_id=p_goal_id;
  target:=(p_choice->>'to')::date;
  if not found or selected.completed or selected.skipped or coalesce(selected.is_backfill,false) or selected.continues_lesson_id is not null
    or selected.queue_position is null or selected.queue_position<=g.current_lesson
    or selected.scheduled_date is distinct from (p_choice->>'from')::date
    or target<=selected.scheduled_date or target<day then return jsonb_build_object('status','invalid','reason','selection'); end if;
  delta:=rooted_private.cascade_steps(p_goal_id,selected.scheduled_date,target);
  if delta<1 then return jsonb_build_object('status','invalid','reason','offset'); end if;
  -- Existing book drift must not be silently repaired by a shift.
  select count(*) into bad from (select lesson_number,lag(lesson_number) over(order by queue_position) prev from public.lessons where curriculum_goal_id=p_goal_id and queue_position is not null and lesson_number is not null) q where lesson_number<prev;
  if bad>0 then return jsonb_build_object('status','invalid','reason','queue_order'); end if;
  select count(*) into required from public.lessons where curriculum_goal_id=p_goal_id and not completed and not skipped and not coalesce(is_backfill,false) and continues_lesson_id is null and queue_position>=selected.queue_position;
  select count(distinct x->>'id') into got from jsonb_array_elements(p_moves) x;
  if got<>required or jsonb_array_length(p_moves)<>required then return jsonb_build_object('status','invalid','reason','scope'); end if;
  for w in select * from jsonb_array_elements(p_moves) loop
    select count(*) into got from public.lessons l
      where l.id=(w->>'id')::uuid and l.curriculum_goal_id=p_goal_id and l.user_id=u
        and not l.completed and not l.skipped and not coalesce(l.is_backfill,false) and l.continues_lesson_id is null
        and l.queue_position>=selected.queue_position
        and jsonb_build_object('scheduled_date',l.scheduled_date,'date',l.date,'queue_pinned',l.queue_pinned,'scheduled_source',l.scheduled_source,'queue_preserved',l.queue_preserved)=w->'before';
    -- Payload keys are checked below; only these four columns are ever written.
    if got<>1 then return jsonb_build_object('status','invalid','reason','row'); end if;
    if (w->'after'->>'queue_preserved')::boolean is distinct from false or (w->'after'->>'date') is distinct from (w->'after'->>'scheduled_date')
      or (w->'after'->>'queue_pinned')::boolean is distinct from (case when (w->>'id')::uuid=selected.id then true else (w->'before'->>'queue_pinned')::boolean end)
      or (w->'after'->>'scheduled_source') is distinct from (case when (w->>'id')::uuid=selected.id then 'plan_move' else 'plan_cascade_shift' end)
      or (w->'after'->>'date')::date<day
      or rooted_private.cascade_steps(p_goal_id,(w->'before'->>'scheduled_date')::date,(w->'after'->>'date')::date)<>delta
      or rooted_private.cascade_steps(p_goal_id,(w->'after'->>'date')::date-1,(w->'after'->>'date')::date)<>1
      or ((w->>'id')::uuid=selected.id and (w->'after'->>'date')::date<>target)
    then return jsonb_build_object('status','invalid','reason','shape'); end if;
  end loop;
  -- Earlier unfinished dates remain authoritative without becoming pins or
  -- completions. The exact prefix is separate from the confirmed moved suffix.
  select count(*) into required from public.lessons where curriculum_goal_id=p_goal_id and not completed and not skipped and not coalesce(is_backfill,false) and continues_lesson_id is null and queue_position<selected.queue_position and scheduled_date is not null and not queue_preserved;
  if jsonb_typeof(p_preserved) is distinct from 'array' or jsonb_array_length(p_preserved)<>required or (select count(distinct x->>'id') from jsonb_array_elements(p_preserved) x)<>required then return jsonb_build_object('status','invalid','reason','preserved_scope');end if;
  for w in select * from jsonb_array_elements(p_preserved) loop
   select count(*) into got from public.lessons l where l.id=(w->>'id')::uuid and l.curriculum_goal_id=p_goal_id and l.user_id=u and not completed and not skipped and not coalesce(is_backfill,false) and continues_lesson_id is null and queue_position<selected.queue_position and scheduled_date is not null and not queue_preserved
    and jsonb_build_object('scheduled_date',l.scheduled_date,'date',l.date,'queue_pinned',l.queue_pinned,'scheduled_source',l.scheduled_source,'queue_preserved',l.queue_preserved)=w->'before';
   if got<>1 or w->'after' is distinct from ((w->'before')||'{"queue_preserved":true}'::jsonb) then return jsonb_build_object('status','invalid','reason','preserved_row');end if;
  end loop;
  -- A nested block is a subtransaction: any failure rolls EVERY date/pin back.
  begin
    for w in select * from jsonb_array_elements(all_moves) loop
      update public.lessons set scheduled_date=(w->'after'->>'scheduled_date')::date,date=(w->'after'->>'date')::date,
        queue_preserved=(w->'after'->>'queue_preserved')::boolean,queue_pinned=(w->'after'->>'queue_pinned')::boolean,scheduled_source=w->'after'->>'scheduled_source'
        where id=(w->>'id')::uuid;
      get diagnostics got=row_count;
      if got<>1 then raise exception 'cascade row refused'; end if;
    end loop;
    set constraints all immediate;
    -- No newly overloaded destination, including protected continuations and
    -- completed work. Existing unrelated stacked dates remain untouched.
    select count(*) into bad from (
      select l.scheduled_date,count(*) n from public.lessons l where l.curriculum_goal_id=p_goal_id and not l.skipped
        and l.scheduled_date in (select (x->'after'->>'date')::date from jsonb_array_elements(p_moves) x)
      group by l.scheduled_date
    ) d where d.n>coalesce((g.lessons_per_day_overrides->>((array['Sun','Mon','Tue','Wed','Thu','Fri','Sat'])[extract(dow from d.scheduled_date)::int+1]))::int,g.lessons_per_day);
    if bad>0 then raise exception 'cascade capacity'; end if;
    select count(*) into bad from (select scheduled_date,lag(scheduled_date) over(order by queue_position) prev from public.lessons where curriculum_goal_id=p_goal_id and not completed and not skipped and not coalesce(is_backfill,false) and queue_position>g.current_lesson) q where scheduled_date<prev;
    if bad>0 then raise exception 'cascade order'; end if;
    after_state:=rooted_private.cascade_snapshot(p_goal_id,day,p_expected->>'dayStartIso',p_expected->>'dayEndIso');
    if not rooted_private.cascade_postcondition(actual,after_state,all_moves,'after') then raise exception 'cascade postcondition';end if;
    if not rooted_private.cascade_projection_matches(after_state) then raise exception 'cascade projector mismatch';end if;
    insert into rooted_private.cascade_shift_receipts(id,user_id,goal_id,request,before_snapshot,after_snapshot,moves)
      values(p_operation_id,u,p_goal_id,request,actual,after_state,all_moves);
  exception when others then
    return jsonb_build_object('status','failed','reason','transaction');
  end;
  return jsonb_build_object('status','applied','operationId',p_operation_id,'snapshot',after_state);
exception when invalid_text_representation or invalid_datetime_format or datetime_field_overflow or numeric_value_out_of_range then
  return jsonb_build_object('status','invalid','reason','payload');
end $function$;
CREATE FUNCTION public.commit_cascade_shift(p_operation_id uuid, p_goal_id uuid, p_expected jsonb, p_choice jsonb, p_moves jsonb, p_preserved jsonb DEFAULT '[]'::jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $wrapper$ DECLARE g uuid;m text;result jsonb; BEGIN BEGIN PERFORM rooted_private.scheduler_lock_owner(auth.uid(),false); g:=p_goal_id; IF g IS NULL THEN RETURN rooted_private.contained_commit_cascade_shift(p_operation_id,p_goal_id,p_expected,p_choice,p_moves,p_preserved); END IF; PERFORM 1 FROM public.curriculum_goals WHERE id=g AND user_id=auth.uid() FOR UPDATE NOWAIT; IF NOT FOUND THEN RAISE EXCEPTION 'scheduler_owner_refused';END IF; SELECT mode INTO m FROM rooted_private.scheduler_modes WHERE goal_id=g; IF m IS NULL THEN RETURN rooted_private.contained_commit_cascade_shift(p_operation_id,p_goal_id,p_expected,p_choice,p_moves,p_preserved); END IF; PERFORM rooted_private.scheduler_lock_owner(auth.uid(),false); IF m='paused' AND NOT (EXISTS(SELECT 1 FROM rooted_private.cascade_shift_receipts WHERE id=p_operation_id AND user_id=auth.uid())) THEN RETURN jsonb_build_object('status','invalid','reason','scheduler_paused');END IF; PERFORM 1 FROM public.lessons WHERE curriculum_goal_id=g ORDER BY id FOR UPDATE NOWAIT; PERFORM 1 FROM public.profiles WHERE id=auth.uid() FOR SHARE NOWAIT; PERFORM rooted_private.scheduler_lock_owner(auth.uid(),false); IF NOT pg_try_advisory_xact_lock(hashtextextended(p_operation_id::text,0)) THEN RAISE lock_not_available;END IF; PERFORM rooted_private.scheduler_allow(g,'commit_cascade_shift',ARRAY(SELECT (x->>'id')::uuid FROM jsonb_array_elements(p_moves||p_preserved) x),ARRAY['date','scheduled_date','scheduled_source','queue_pinned','queue_preserved'],'{}'::text[],'{}'::uuid[],'[]'::jsonb); result:=rooted_private.contained_commit_cascade_shift(p_operation_id,p_goal_id,p_expected,p_choice,p_moves,p_preserved); PERFORM rooted_private.scheduler_disallow(g); RETURN result; EXCEPTION WHEN lock_not_available THEN RETURN jsonb_build_object('status','stale','reason','busy'); END; END $wrapper$; REVOKE ALL ON FUNCTION public.commit_cascade_shift(uuid, uuid, jsonb, jsonb, jsonb, jsonb) FROM PUBLIC,anon,authenticated,service_role; GRANT EXECUTE ON FUNCTION public.commit_cascade_shift(uuid, uuid, jsonb, jsonb, jsonb, jsonb) TO authenticated;
DO $$ BEGIN IF (SELECT md5(prosrc) FROM pg_proc WHERE oid='public.move_lesson_keep_slot(uuid, date, date, boolean)'::regprocedure) IS DISTINCT FROM '1a339b9ab5e1a57a3a164d77c46ac660' THEN RAISE EXCEPTION 'Containment baseline drift: move_lesson_keep_slot';END IF;END $$;
ALTER FUNCTION public.move_lesson_keep_slot(uuid, date, date, boolean) SET SCHEMA rooted_private; ALTER FUNCTION rooted_private.move_lesson_keep_slot(uuid, date, date, boolean) RENAME TO contained_move_lesson_keep_slot; REVOKE ALL ON FUNCTION rooted_private.contained_move_lesson_keep_slot(uuid, date, date, boolean) FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION public.move_lesson_keep_slot(p_lesson_id uuid, p_target_date date, p_local_day date, p_hold_between boolean) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $wrapper$ DECLARE g uuid;m text;result jsonb; BEGIN BEGIN PERFORM rooted_private.scheduler_lock_owner(auth.uid(),false); g:=(SELECT curriculum_goal_id FROM public.lessons WHERE id=p_lesson_id AND user_id=auth.uid()); IF g IS NULL THEN RETURN rooted_private.contained_move_lesson_keep_slot(p_lesson_id,p_target_date,p_local_day,p_hold_between); END IF; PERFORM 1 FROM public.curriculum_goals WHERE id=g AND user_id=auth.uid() FOR UPDATE NOWAIT; IF NOT FOUND THEN RAISE EXCEPTION 'scheduler_owner_refused';END IF; SELECT mode INTO m FROM rooted_private.scheduler_modes WHERE goal_id=g; IF m IS NULL THEN RETURN rooted_private.contained_move_lesson_keep_slot(p_lesson_id,p_target_date,p_local_day,p_hold_between); END IF; PERFORM rooted_private.scheduler_lock_owner(auth.uid(),false); RETURN jsonb_build_object('status','invalid','reason','client_upgrade_required'); EXCEPTION WHEN lock_not_available THEN RETURN jsonb_build_object('status','stale','reason','busy'); END; END $wrapper$; REVOKE ALL ON FUNCTION public.move_lesson_keep_slot(uuid, date, date, boolean) FROM PUBLIC,anon,authenticated,service_role; GRANT EXECUTE ON FUNCTION public.move_lesson_keep_slot(uuid, date, date, boolean) TO authenticated,service_role;
DO $$ BEGIN IF (SELECT md5(prosrc) FROM pg_proc WHERE oid='public.move_lesson_to_date(uuid, date)'::regprocedure) IS DISTINCT FROM '1d49673948e1c7d32e81bd56277caee1' THEN RAISE EXCEPTION 'Containment baseline drift: move_lesson_to_date';END IF;END $$;
ALTER FUNCTION public.move_lesson_to_date(uuid, date) SET SCHEMA rooted_private; ALTER FUNCTION rooted_private.move_lesson_to_date(uuid, date) RENAME TO contained_move_lesson_to_date; REVOKE ALL ON FUNCTION rooted_private.contained_move_lesson_to_date(uuid, date) FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION public.move_lesson_to_date(p_lesson_id uuid, p_target_date date) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $wrapper$ DECLARE g uuid;m text;result jsonb; BEGIN BEGIN PERFORM rooted_private.scheduler_lock_owner(auth.uid(),false); g:=(SELECT curriculum_goal_id FROM public.lessons WHERE id=p_lesson_id AND user_id=auth.uid()); IF g IS NULL THEN PERFORM rooted_private.contained_move_lesson_to_date(p_lesson_id,p_target_date); RETURN; END IF; PERFORM 1 FROM public.curriculum_goals WHERE id=g AND user_id=auth.uid() FOR UPDATE NOWAIT; IF NOT FOUND THEN RAISE EXCEPTION 'scheduler_owner_refused';END IF; SELECT mode INTO m FROM rooted_private.scheduler_modes WHERE goal_id=g; IF m IS NULL THEN PERFORM rooted_private.contained_move_lesson_to_date(p_lesson_id,p_target_date); RETURN; END IF; PERFORM rooted_private.scheduler_lock_owner(auth.uid(),false); RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='scheduler_client_upgrade_required', HINT='Reload and review the schedule before retrying.'; EXCEPTION WHEN lock_not_available THEN RAISE; END; END $wrapper$; REVOKE ALL ON FUNCTION public.move_lesson_to_date(uuid, date) FROM PUBLIC,anon,authenticated,service_role; GRANT EXECUTE ON FUNCTION public.move_lesson_to_date(uuid, date) TO authenticated,service_role;
DO $$ BEGIN IF (SELECT md5(prosrc) FROM pg_proc WHERE oid='public.reopen_lesson(uuid, date)'::regprocedure) IS DISTINCT FROM '85752dd922bc2b31012f7202b72f09f1' THEN RAISE EXCEPTION 'Containment baseline drift: reopen_lesson';END IF;END $$;
ALTER FUNCTION public.reopen_lesson(uuid, date) SET SCHEMA rooted_private; ALTER FUNCTION rooted_private.reopen_lesson(uuid, date) RENAME TO contained_reopen_lesson; REVOKE ALL ON FUNCTION rooted_private.contained_reopen_lesson(uuid, date) FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION public.reopen_lesson(p_lesson_id uuid, p_local_day date) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $wrapper$ DECLARE g uuid;m text;result jsonb; BEGIN BEGIN PERFORM rooted_private.scheduler_lock_owner(auth.uid(),false); g:=(SELECT curriculum_goal_id FROM public.lessons WHERE id=p_lesson_id AND user_id=auth.uid()); IF g IS NULL THEN RETURN rooted_private.contained_reopen_lesson(p_lesson_id,p_local_day); END IF; PERFORM 1 FROM public.curriculum_goals WHERE id=g AND user_id=auth.uid() FOR UPDATE NOWAIT; IF NOT FOUND THEN RAISE EXCEPTION 'scheduler_owner_refused';END IF; SELECT mode INTO m FROM rooted_private.scheduler_modes WHERE goal_id=g; IF m IS NULL THEN RETURN rooted_private.contained_reopen_lesson(p_lesson_id,p_local_day); END IF; PERFORM rooted_private.scheduler_lock_owner(auth.uid(),false); IF m='paused' AND NOT (false) THEN RETURN jsonb_build_object('status','invalid','reason','scheduler_paused');END IF; PERFORM 1 FROM public.lessons WHERE curriculum_goal_id=g ORDER BY id FOR UPDATE NOWAIT; PERFORM 1 FROM public.profiles WHERE id=auth.uid() FOR SHARE NOWAIT; PERFORM rooted_private.scheduler_lock_owner(auth.uid(),false); PERFORM rooted_private.scheduler_allow(g,'reopen_lesson',ARRAY(SELECT id FROM public.lessons WHERE curriculum_goal_id=g),ARRAY['date','scheduled_date','scheduled_source','queue_position','queue_pinned','queue_preserved','completed','completed_at','skipped','is_backfill'],ARRAY['current_lesson','total_lessons','start_date','start_at_lesson','target_date','school_days','lessons_per_day','lessons_per_day_overrides','placement_mode','completed_at'],'{}'::uuid[],'[]'::jsonb); result:=rooted_private.contained_reopen_lesson(p_lesson_id,p_local_day); PERFORM rooted_private.scheduler_disallow(g); RETURN result; EXCEPTION WHEN lock_not_available THEN RETURN jsonb_build_object('status','stale','reason','busy'); END; END $wrapper$; REVOKE ALL ON FUNCTION public.reopen_lesson(uuid, date) FROM PUBLIC,anon,authenticated,service_role; GRANT EXECUTE ON FUNCTION public.reopen_lesson(uuid, date) TO authenticated,service_role;
DO $$ BEGIN IF (SELECT md5(prosrc) FROM pg_proc WHERE oid='public.restore_queue_book_order(uuid, date)'::regprocedure) IS DISTINCT FROM '66e870fb2f447c9e5f60e41cae18d4e5' THEN RAISE EXCEPTION 'Containment baseline drift: restore_queue_book_order';END IF;END $$;
ALTER FUNCTION public.restore_queue_book_order(uuid, date) SET SCHEMA rooted_private; ALTER FUNCTION rooted_private.restore_queue_book_order(uuid, date) RENAME TO contained_restore_queue_book_order; REVOKE ALL ON FUNCTION rooted_private.contained_restore_queue_book_order(uuid, date) FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION public.restore_queue_book_order(p_goal_id uuid, p_local_day date) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $wrapper$ DECLARE g uuid;m text;result jsonb; BEGIN BEGIN PERFORM rooted_private.scheduler_lock_owner(auth.uid(),false); g:=p_goal_id; IF g IS NULL THEN RETURN rooted_private.contained_restore_queue_book_order(p_goal_id,p_local_day); END IF; PERFORM 1 FROM public.curriculum_goals WHERE id=g AND user_id=auth.uid() FOR UPDATE NOWAIT; IF NOT FOUND THEN RAISE EXCEPTION 'scheduler_owner_refused';END IF; SELECT mode INTO m FROM rooted_private.scheduler_modes WHERE goal_id=g; IF m IS NULL THEN RETURN rooted_private.contained_restore_queue_book_order(p_goal_id,p_local_day); END IF; PERFORM rooted_private.scheduler_lock_owner(auth.uid(),false); RETURN jsonb_build_object('status','invalid','reason','client_upgrade_required'); EXCEPTION WHEN lock_not_available THEN RETURN jsonb_build_object('status','stale','reason','busy'); END; END $wrapper$; REVOKE ALL ON FUNCTION public.restore_queue_book_order(uuid, date) FROM PUBLIC,anon,authenticated,service_role; GRANT EXECUTE ON FUNCTION public.restore_queue_book_order(uuid, date) TO authenticated,service_role;
DO $$ BEGIN IF (SELECT md5(prosrc) FROM pg_proc WHERE oid='public.undo_cascade_shift(uuid)'::regprocedure) IS DISTINCT FROM '991b676c0d3c282810cc2d3e300103e7' THEN RAISE EXCEPTION 'Containment baseline drift: undo_cascade_shift';END IF;END $$;
ALTER FUNCTION public.undo_cascade_shift(uuid) SET SCHEMA rooted_private; ALTER FUNCTION rooted_private.undo_cascade_shift(uuid) RENAME TO contained_undo_cascade_shift; REVOKE ALL ON FUNCTION rooted_private.contained_undo_cascade_shift(uuid) FROM PUBLIC,anon,authenticated,service_role;
CREATE OR REPLACE FUNCTION rooted_private.contained_undo_cascade_shift(p_operation_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'pg_temp'
AS $function$
declare receipt rooted_private.cascade_shift_receipts%rowtype; actual jsonb; w jsonb; n integer;
begin
  if auth.uid() is null then return jsonb_build_object('status','invalid'); end if;
  perform pg_advisory_xact_lock(hashtextextended(p_operation_id::text,0));
  select * into receipt from rooted_private.cascade_shift_receipts where id=p_operation_id and user_id=auth.uid() for update;
  if not found then return jsonb_build_object('status','invalid'); end if;
  if receipt.undone_at is not null then return jsonb_build_object('status','already_undone'); end if;
  if clock_timestamp()-receipt.created_at>interval '10 minutes' then return jsonb_build_object('status','expired'); end if;
  -- Match commit's nonblocking goal/lesson acquisition and release semantics.
  begin
    perform 1 from public.curriculum_goals where id=receipt.goal_id and user_id=auth.uid() for update nowait;
    if not found then return jsonb_build_object('status','stale'); end if;
    perform 1 from public.lessons where curriculum_goal_id=receipt.goal_id order by id for update nowait;
  exception when lock_not_available then
    return jsonb_build_object('status','stale','reason','busy');
  end;
  perform 1 from public.profiles where id=auth.uid() for share;
  PERFORM rooted_private.scheduler_lock_owner(auth.uid(),false);
  actual:=rooted_private.cascade_snapshot(receipt.goal_id,(receipt.after_snapshot->>'localDay')::date,receipt.after_snapshot->>'dayStartIso',receipt.after_snapshot->>'dayEndIso');
  if actual is distinct from receipt.after_snapshot then return jsonb_build_object('status','stale'); end if;
  begin
    for w in select * from jsonb_array_elements(receipt.moves) loop
      update public.lessons set scheduled_date=(w->'before'->>'scheduled_date')::date,date=(w->'before'->>'date')::date,
        queue_preserved=(w->'before'->>'queue_preserved')::boolean,queue_pinned=(w->'before'->>'queue_pinned')::boolean,scheduled_source=w->'before'->>'scheduled_source'
        where id=(w->>'id')::uuid and curriculum_goal_id=receipt.goal_id;
      get diagnostics n=row_count;
      if n<>1 then raise exception 'undo row refused'; end if;
    end loop;
    set constraints all immediate;
    if not rooted_private.cascade_postcondition(actual,rooted_private.cascade_snapshot(receipt.goal_id,(receipt.after_snapshot->>'localDay')::date,receipt.after_snapshot->>'dayStartIso',receipt.after_snapshot->>'dayEndIso'),receipt.moves,'before') then raise exception 'undo postcondition';end if;
    update rooted_private.cascade_shift_receipts set undone_at=clock_timestamp() where id=p_operation_id;
  exception when others then return jsonb_build_object('status','failed'); end;
  return jsonb_build_object('status','undone');
end $function$;
CREATE FUNCTION public.undo_cascade_shift(p_operation_id uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $wrapper$ DECLARE g uuid;m text;result jsonb; BEGIN BEGIN PERFORM rooted_private.scheduler_lock_owner(auth.uid(),false); g:=(SELECT goal_id FROM rooted_private.cascade_shift_receipts WHERE id=p_operation_id AND user_id=auth.uid()); IF g IS NULL THEN RETURN rooted_private.contained_undo_cascade_shift(p_operation_id); END IF; PERFORM 1 FROM public.curriculum_goals WHERE id=g AND user_id=auth.uid() FOR UPDATE NOWAIT; IF NOT FOUND THEN RAISE EXCEPTION 'scheduler_owner_refused';END IF; SELECT mode INTO m FROM rooted_private.scheduler_modes WHERE goal_id=g; IF m IS NULL THEN RETURN rooted_private.contained_undo_cascade_shift(p_operation_id); END IF; PERFORM rooted_private.scheduler_lock_owner(auth.uid(),false); IF m='paused' AND NOT (true) THEN RETURN jsonb_build_object('status','invalid','reason','scheduler_paused');END IF; PERFORM 1 FROM public.lessons WHERE curriculum_goal_id=g ORDER BY id FOR UPDATE NOWAIT; PERFORM 1 FROM public.profiles WHERE id=auth.uid() FOR SHARE NOWAIT; PERFORM rooted_private.scheduler_lock_owner(auth.uid(),false); PERFORM 1 FROM rooted_private.cascade_shift_receipts WHERE id=p_operation_id AND user_id=auth.uid() FOR UPDATE NOWAIT; IF NOT pg_try_advisory_xact_lock(hashtextextended(p_operation_id::text,0)) THEN RAISE lock_not_available;END IF; PERFORM rooted_private.scheduler_allow(g,'undo_cascade_shift',ARRAY(SELECT (x->>'id')::uuid FROM rooted_private.cascade_shift_receipts r,jsonb_array_elements(r.moves) x WHERE r.id=p_operation_id),ARRAY['date','scheduled_date','scheduled_source','queue_pinned','queue_preserved'],'{}'::text[],'{}'::uuid[],'[]'::jsonb); result:=rooted_private.contained_undo_cascade_shift(p_operation_id); PERFORM rooted_private.scheduler_disallow(g); RETURN result; EXCEPTION WHEN lock_not_available THEN RETURN jsonb_build_object('status','stale','reason','busy'); END; END $wrapper$; REVOKE ALL ON FUNCTION public.undo_cascade_shift(uuid) FROM PUBLIC,anon,authenticated,service_role; GRANT EXECUTE ON FUNCTION public.undo_cascade_shift(uuid) TO authenticated;
