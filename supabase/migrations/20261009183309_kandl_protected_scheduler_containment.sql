-- SOURCE: core.sql
-- LOCAL ONLY: protected cohorts remain empty until separately approved activation.
BEGIN;
SET LOCAL lock_timeout='5s';
-- Shared ordinary mutations / exclusive calendar membership, scoped to a family.
-- All lesson and goal mutations participate, including content-only and legacy.
CREATE FUNCTION rooted_private.scheduler_lock_owner(p_owner uuid,p_exclusive boolean DEFAULT false) RETURNS void LANGUAGE plpgsql SET search_path=pg_catalog,pg_temp AS $$
DECLARE key bigint; ok boolean;
BEGIN
 IF p_owner IS NULL THEN RETURN;END IF;
 key:=hashtextextended('rooted_scheduler_owner:'||p_owner::text,0);
 IF p_exclusive THEN ok:=pg_try_advisory_xact_lock(key);ELSE ok:=pg_try_advisory_xact_lock_shared(key);END IF;
 IF NOT ok THEN RAISE lock_not_available;END IF;
END $$;
REVOKE ALL ON FUNCTION rooted_private.scheduler_lock_owner(uuid,boolean) FROM PUBLIC,anon,authenticated,service_role;

CREATE TABLE rooted_private.scheduler_modes(goal_id uuid PRIMARY KEY REFERENCES public.curriculum_goals(id) ON DELETE CASCADE, mode text NOT NULL CHECK(mode IN ('atomic_v2','paused')));
CREATE TABLE rooted_private.scheduler_capabilities(tx bigint NOT NULL,goal_id uuid NOT NULL,owner_id uuid NOT NULL,operation text NOT NULL,row_ids uuid[] NOT NULL,lesson_fields text[] NOT NULL,goal_fields text[] NOT NULL,delete_ids uuid[] NOT NULL DEFAULT '{}',insert_shapes jsonb NOT NULL DEFAULT '[]',explicit_ids uuid[] NOT NULL DEFAULT '{}',PRIMARY KEY(tx,goal_id));
CREATE TABLE rooted_private.scheduler_action_receipts(id uuid PRIMARY KEY,user_id uuid NOT NULL,goal_id uuid NOT NULL,request_hash text NOT NULL,before_state jsonb,after_hash text NOT NULL,result jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT clock_timestamp(),undone_at timestamptz);
ALTER TABLE rooted_private.scheduler_modes ENABLE ROW LEVEL SECURITY;
ALTER TABLE rooted_private.scheduler_capabilities ENABLE ROW LEVEL SECURITY;
ALTER TABLE rooted_private.scheduler_action_receipts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON rooted_private.scheduler_modes,rooted_private.scheduler_capabilities,rooted_private.scheduler_action_receipts FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION rooted_private.scheduler_state(p_goal uuid) RETURNS jsonb LANGUAGE sql STABLE SET search_path=pg_catalog,pg_temp AS $$
 SELECT jsonb_build_object('goal',to_jsonb(g),'profile',(SELECT jsonb_build_object('timezone',p.timezone,'school_days',p.school_days) FROM public.profiles p WHERE p.id=g.user_id),'rows',coalesce((SELECT jsonb_agg(to_jsonb(l) ORDER BY id) FROM public.lessons l WHERE curriculum_goal_id=g.id),'[]'::jsonb),'vacations',coalesce((SELECT jsonb_agg(to_jsonb(v) ORDER BY id) FROM public.vacation_blocks v WHERE user_id=g.user_id),'[]'::jsonb)) FROM public.curriculum_goals g WHERE id=p_goal
$$;
CREATE FUNCTION public.read_scheduler_state(p_goal_id uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
BEGIN
 IF auth.uid() IS NULL OR NOT EXISTS(SELECT 1 FROM public.curriculum_goals WHERE id=p_goal_id AND user_id=auth.uid()) THEN RETURN jsonb_build_object('status','invalid','reason','owner');END IF;
 RETURN jsonb_build_object('status','ready','mode',coalesce((SELECT mode FROM rooted_private.scheduler_modes WHERE goal_id=p_goal_id),'legacy'),'snapshot',rooted_private.scheduler_state(p_goal_id),'localDay',(now() AT TIME ZONE (SELECT timezone FROM public.profiles WHERE id=auth.uid()))::date)||coalesce(rooted_private.cascade_local_window(auth.uid(),(now() AT TIME ZONE (SELECT timezone FROM public.profiles WHERE id=auth.uid()))::date),'{}'::jsonb);
END $$;
CREATE FUNCTION rooted_private.scheduler_allow(p_goal uuid,p_op text,p_ids uuid[],p_fields text[],p_goal_fields text[],p_delete uuid[] DEFAULT '{}',p_inserts jsonb DEFAULT '[]') RETURNS void LANGUAGE plpgsql SET search_path=pg_catalog,pg_temp AS $$
BEGIN
 IF auth.uid() IS NULL OR NOT EXISTS(SELECT 1 FROM public.curriculum_goals WHERE id=p_goal AND user_id=auth.uid()) THEN RAISE EXCEPTION 'scheduler owner refused';END IF;
 INSERT INTO rooted_private.scheduler_capabilities VALUES(txid_current(),p_goal,auth.uid(),p_op,coalesce(p_ids,'{}'),p_fields,p_goal_fields,p_delete,p_inserts);
END $$;
CREATE FUNCTION rooted_private.scheduler_disallow(p_goal uuid) RETURNS void LANGUAGE sql SET search_path=pg_catalog,pg_temp AS $$ DELETE FROM rooted_private.scheduler_capabilities WHERE tx=txid_current() AND goal_id=p_goal $$;
CREATE FUNCTION rooted_private.scheduler_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE oldj jsonb;newj jsonb;g uuid; m text;c rooted_private.scheduler_capabilities%rowtype; fields text[]; changed text[]; shape jsonb; owner_key uuid;
BEGIN
 IF TG_OP<>'INSERT' THEN oldj:=to_jsonb(OLD);END IF;
 IF TG_OP<>'DELETE' THEN newj:=to_jsonb(NEW);END IF;
 FOR owner_key IN SELECT DISTINCT x FROM unnest(ARRAY[(oldj->>'user_id')::uuid,(newj->>'user_id')::uuid]) x WHERE x IS NOT NULL ORDER BY x LOOP PERFORM rooted_private.scheduler_lock_owner(owner_key,false);END LOOP;
 -- Archive visibility and unit wording do not rewrite scheduling or work.
 -- They remain in full expected snapshots, so conflicting receipts go stale.
 fields:=CASE WHEN TG_TABLE_NAME='lessons' THEN ARRAY['id','user_id','child_id','date','scheduled_date','lesson_number','counts_toward_goal','goal_id','scheduled_source','curriculum_goal_id','school_year','is_backfill','school_year_id','queue_position','queue_pinned','continues_lesson_id','skipped','queue_preserved','completed','completed_at'] ELSE ARRAY['id','user_id','child_id','total_lessons','current_lesson','target_date','school_days','school_year','start_date','start_at_lesson','school_year_id','lessons_per_day','completed_at','lessons_per_day_overrides','placement_mode','placement_migrated_at'] END;
 IF TG_OP='UPDATE' THEN
  SELECT array_agg(k) INTO changed FROM unnest(fields) k WHERE oldj->k IS DISTINCT FROM newj->k;
  IF changed IS NULL THEN RETURN NEW;END IF;
  -- Close-year compatibility: stamp only an unstamped goal onto its owner's
  -- already archived year. No scheduling/content change can piggyback.
  IF TG_TABLE_NAME='curriculum_goals' AND oldj->>'school_year_id' IS NULL AND newj->>'school_year_id' IS NOT NULL
   AND newj->>'archived'='true' AND oldj-ARRAY['school_year_id','archived','updated_at'] IS NOT DISTINCT FROM newj-ARRAY['school_year_id','archived','updated_at']
   AND EXISTS(SELECT 1 FROM public.school_years y WHERE y.id=(newj->>'school_year_id')::uuid AND y.user_id=(newj->>'user_id')::uuid AND y.status='archived') THEN RETURN NEW;END IF;
 END IF;
 -- The owner shared lock serializes activation, even for legacy writers.
 -- The early trigger raises: a mixed statement cannot silently drop some rows.
 FOR g IN SELECT DISTINCT x FROM unnest(CASE WHEN TG_TABLE_NAME='lessons' THEN ARRAY[(oldj->>'curriculum_goal_id')::uuid,(newj->>'curriculum_goal_id')::uuid] ELSE ARRAY[(oldj->>'id')::uuid,(newj->>'id')::uuid] END) x WHERE x IS NOT NULL ORDER BY x LOOP
  SELECT mode INTO m FROM rooted_private.scheduler_modes WHERE goal_id=g;
  IF m IS NULL THEN CONTINUE;END IF;
  PERFORM 1 FROM public.curriculum_goals WHERE id=g FOR UPDATE NOWAIT;
  SELECT * INTO c FROM rooted_private.scheduler_capabilities WHERE tx=txid_current() AND goal_id=g AND owner_id=auth.uid();
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='scheduler_client_upgrade_required',HINT='Reload and review the schedule before retrying.';END IF;
  IF TG_TABLE_NAME='curriculum_goals' THEN
   IF TG_OP='DELETE' AND c.operation='goal_delete' THEN NULL;
   ELSIF TG_OP<>'UPDATE' OR NOT changed <@ c.goal_fields THEN RAISE EXCEPTION 'scheduler_goal_scope_refused';END IF;
  ELSIF TG_OP='UPDATE' THEN
   IF NOT (OLD.id=ANY(c.row_ids)) OR NOT changed <@ c.lesson_fields OR (OLD.curriculum_goal_id IS DISTINCT FROM NEW.curriculum_goal_id AND NOT ((c.operation='goal_delete' AND NEW.curriculum_goal_id IS NULL) OR c.operation IN ('reassign','reassign_undo'))) OR OLD.user_id IS DISTINCT FROM NEW.user_id THEN RAISE EXCEPTION 'scheduler_row_scope_refused';END IF;
  ELSIF TG_OP='DELETE' THEN
   IF NOT OLD.id=ANY(c.delete_ids) THEN RAISE EXCEPTION 'scheduler_delete_scope_refused';END IF;
  ELSE
   -- Builder-generated UUIDs are not known beforehand. Match the exact validated
   -- insert shape rather than grant arbitrary insert permission for the goal.
   IF NEW.user_id IS DISTINCT FROM auth.uid() THEN RAISE EXCEPTION 'scheduler_insert_owner_refused';END IF;
   SELECT x INTO shape FROM jsonb_array_elements(c.insert_shapes) x WHERE newj @> x LIMIT 1;
   IF shape IS NULL THEN RAISE EXCEPTION 'scheduler_insert_scope_refused';END IF;
   UPDATE rooted_private.scheduler_capabilities SET insert_shapes=insert_shapes-(SELECT ordinality::integer-1 FROM jsonb_array_elements(insert_shapes) WITH ORDINALITY a(value,ordinality) WHERE value=shape LIMIT 1),row_ids=array_append(row_ids,NEW.id) WHERE tx=c.tx AND goal_id=g;
  END IF;
 END LOOP;
 IF TG_OP='DELETE' THEN RETURN OLD;END IF;RETURN NEW;
END $$;
CREATE TRIGGER "000_scheduler_guard" BEFORE INSERT OR UPDATE OR DELETE ON public.lessons FOR EACH ROW EXECUTE FUNCTION rooted_private.scheduler_guard();
CREATE TRIGGER "000_scheduler_guard" BEFORE INSERT OR UPDATE OR DELETE ON public.curriculum_goals FOR EACH ROW EXECUTE FUNCTION rooted_private.scheduler_guard();
-- Private cohort transition/pause: deployment never calls this or changes a goal.
CREATE FUNCTION rooted_private.set_scheduler_mode(p_goal uuid,p_expected jsonb,p_mode text) RETURNS void LANGUAGE plpgsql SET search_path=pg_catalog,pg_temp AS $$
BEGIN
 PERFORM rooted_private.scheduler_lock_owner((SELECT user_id FROM public.curriculum_goals WHERE id=p_goal),true);
 IF p_mode NOT IN ('atomic_v2','paused') THEN RAISE EXCEPTION 'Cannot downgrade a protected goal to legacy';END IF;
 PERFORM 1 FROM public.curriculum_goals WHERE id=p_goal FOR UPDATE NOWAIT;
 IF NOT FOUND THEN RAISE EXCEPTION 'No goal';END IF;
 PERFORM 1 FROM public.lessons WHERE curriculum_goal_id=p_goal ORDER BY id FOR UPDATE NOWAIT;
 PERFORM rooted_private.scheduler_lock_owner(auth.uid(),false);
 IF rooted_private.scheduler_state(p_goal) IS DISTINCT FROM p_expected THEN RAISE EXCEPTION 'scheduler_activation_stale';END IF;
 INSERT INTO rooted_private.scheduler_modes VALUES(p_goal,p_mode) ON CONFLICT(goal_id) DO UPDATE SET mode=excluded.mode;
END $$;

CREATE FUNCTION rooted_private.scheduler_hash(p_value jsonb) RETURNS text LANGUAGE sql IMMUTABLE SET search_path=pg_catalog,pg_temp AS $$ SELECT encode(sha256(convert_to(p_value::text,'UTF8')),'hex') $$;
-- Calendar/profile edits change projections without touching lesson dates.
-- Until an atomic replacement owns these operations, refuse before first write.
CREATE FUNCTION rooted_private.scheduler_calendar_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE owners uuid[];g uuid;
BEGIN
 IF TG_TABLE_NAME='profiles' THEN
  IF OLD.timezone IS NOT DISTINCT FROM NEW.timezone AND OLD.school_days IS NOT DISTINCT FROM NEW.school_days THEN RETURN NEW;END IF;
  owners:=ARRAY[OLD.id,NEW.id];
 ELSE
  owners:=ARRAY[CASE WHEN TG_OP<>'INSERT' THEN OLD.user_id END,CASE WHEN TG_OP<>'DELETE' THEN NEW.user_id END];
 END IF;
 FOR g IN SELECT DISTINCT x FROM unnest(owners) x WHERE x IS NOT NULL ORDER BY x LOOP PERFORM rooted_private.scheduler_lock_owner(g,true);END LOOP;
 FOR g IN SELECT id FROM public.curriculum_goals WHERE user_id=ANY(owners) ORDER BY id FOR UPDATE NOWAIT LOOP
  IF TG_TABLE_NAME='profiles' THEN CONTINUE;END IF;
  IF EXISTS(SELECT 1 FROM rooted_private.scheduler_modes WHERE goal_id=g) THEN
   IF TG_TABLE_NAME<>'profiles' AND EXISTS(SELECT 1 FROM rooted_private.scheduler_capabilities WHERE tx=txid_current() AND goal_id=g AND owner_id=auth.uid() AND operation='calendar') THEN CONTINUE;END IF;
   RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='scheduler_calendar_upgrade_required',HINT='The calendar was not changed. Reload and review before retrying.';
  END IF;
 END LOOP;
 IF TG_OP='DELETE' THEN RETURN OLD;END IF;RETURN NEW;
END $$;
CREATE TRIGGER "000_scheduler_calendar_guard" BEFORE INSERT OR UPDATE OR DELETE ON public.vacation_blocks FOR EACH ROW EXECUTE FUNCTION rooted_private.scheduler_calendar_guard();
CREATE TRIGGER "000_scheduler_timezone_guard" BEFORE UPDATE OF timezone,school_days ON public.profiles FOR EACH ROW EXECUTE FUNCTION rooted_private.scheduler_calendar_guard();

-- SOURCE: wrappers.sql
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
  if actual is distinct from p_expected then return jsonb_build_object('status','stale','reason','schedule_changed'); end if;
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

-- SOURCE: actions.sql
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
  UPDATE rooted_private.scheduler_capabilities SET explicit_ids=CASE WHEN kind IN ('delete_selected','place_selected') THEN selected_ids ELSE ARRAY[r.id] END WHERE tx=txid_current() AND goal_id=p_goal_id;
  IF kind='single_move' THEN
   IF r.skipped OR p_action->>'targetDate' IS NULL THEN PERFORM rooted_private.scheduler_disallow(p_goal_id); RETURN jsonb_build_object('status','invalid','reason','protected_lesson');END IF;
   IF (p_action->>'localDay')::date IS DISTINCT FROM (now() AT TIME ZONE (SELECT timezone FROM public.profiles WHERE id=u))::date THEN PERFORM rooted_private.scheduler_disallow(p_goal_id); RETURN jsonb_build_object('status','invalid','reason','local_day');END IF;
   IF NOT r.completed AND (p_action->>'targetDate')::date>coalesce(r.scheduled_date,r.date) AND r.queue_position IS NOT NULL THEN
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
  -- Finish Edit's derived dates in this same transaction, before its Undo
  -- after-hash. A same-day reload must not invalidate Undo merely by finishing
  -- the projection implied by this edit. No new receipt or public source.
  IF kind='edit' AND (payload?'scheduled_date' OR payload?'lesson_number') THEN
   canonical:=rooted_private.cascade_local_window(u,(now() AT TIME ZONE (SELECT timezone FROM public.profiles WHERE id=u))::date);
   PERFORM rooted_private.scheduler_allow(p_goal_id,'edit_respread',ARRAY(SELECT id FROM public.lessons WHERE curriculum_goal_id=p_goal_id AND queue_position>(have->'goal'->>'current_lesson')::integer AND NOT completed AND NOT skipped AND NOT coalesce(is_backfill,false) AND continues_lesson_id IS NULL AND NOT queue_pinned AND NOT queue_preserved),ARRAY['date','scheduled_date','scheduled_source'],'{}');
   PERFORM rooted_private.scheduler_respread_locked(p_goal_id,'edit_respread',(now() AT TIME ZONE (canonical->>'timeZone'))::date);
   SET CONSTRAINTS ALL IMMEDIATE;
   PERFORM rooted_private.scheduler_disallow(p_goal_id);
   after_state:=rooted_private.scheduler_state(p_goal_id);
  END IF;
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
  IF NOT FOUND OR r.result->>'kind'='recalibration' THEN RETURN jsonb_build_object('status','invalid','reason','operation');END IF;
  IF r.undone_at IS NOT NULL THEN RETURN jsonb_build_object('status','already_undone');END IF;
  IF r.before_state IS NULL OR clock_timestamp()>r.created_at+interval '10 minutes' THEN RETURN jsonb_build_object('status','invalid','reason','expired');END IF;
  PERFORM 1 FROM public.curriculum_goals WHERE id=r.goal_id AND user_id=auth.uid() FOR UPDATE NOWAIT;
  PERFORM rooted_private.scheduler_lock_owner(auth.uid(),false);
  PERFORM 1 FROM public.lessons WHERE curriculum_goal_id=r.goal_id ORDER BY id FOR UPDATE NOWAIT;
  PERFORM rooted_private.scheduler_lock_owner(auth.uid(),false);
  s:=rooted_private.scheduler_state(r.goal_id);
  IF rooted_private.scheduler_hash(s) IS DISTINCT FROM r.after_hash THEN RETURN jsonb_build_object('status','stale','reason','later_edit');END IF;
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

-- SOURCE: work-preservation.sql
-- Preserve all forms of recorded unfinished work during pointer cleanup.
DO $$ BEGIN IF (SELECT md5(prosrc) FROM pg_proc WHERE oid='public.curriculum_goals_cleanup_orphans_trg()'::regprocedure) IS DISTINCT FROM '3fc51969d09a433b1f375182dfa4bf06' THEN RAISE EXCEPTION 'Cleanup baseline drift';END IF;END $$;
-- LOCAL REVIEW DRAFT. Prevent pointer cleanup and unaware writers from erasing
-- explicitly preserved earlier unfinished work. No existing data updates.
CREATE OR REPLACE FUNCTION public.curriculum_goals_cleanup_orphans_trg()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_skip text;
BEGIN
  -- Re-entry guard, kept from 20260519180000. It blocks re-entry into THIS
  -- function only. That was never sufficient on its own (see the header of
  -- 20260824000000), but the statement below no longer flips `completed`, so
  -- lessons_recompute_current_lesson_trg is not fired by it and there is no
  -- second path back into this function to guard against.
  v_skip := current_setting('rooted.skip_orphan_cleanup', true);
  IF v_skip = 'true' THEN
    RETURN NEW;
  END IF;

  IF NEW.current_lesson > OLD.current_lesson THEN
    PERFORM set_config('rooted.skip_orphan_cleanup', 'true', true);

    -- UNSCHEDULE orphans. Do not complete them, do not re-date them.
    --
    -- An orphan is an incomplete row that the queue pointer has moved past.
    -- The harm it does is holding a calendar day the live queue has already
    -- given to a lesson ahead of it, so releasing the day is the entire fix.
    -- Whether the family ever did that lesson is not something this trigger
    -- can know, and it must not guess: every row it guessed about is in the
    -- 289 this migration exists to stop.
    UPDATE public.lessons
      SET scheduled_date = NULL
      WHERE curriculum_goal_id = NEW.id
        AND completed = false
        AND scheduled_date IS NOT NULL
        -- Preserve PR146's placement rule for lessons outside the queue.
        AND queue_position IS NOT NULL
        AND queue_pinned = false
        AND queue_preserved = false
        AND lesson_number IS NOT NULL
        AND lesson_number <= NEW.current_lesson
        AND (notes IS NULL OR notes = '')
        AND coalesce(minutes_spent,0)=0
        AND coalesce(hours,0)=0
        AND started_at IS NULL;
  END IF;

  RETURN NEW;
END;
$$;

-- Standing rule: re-assert grants whenever a SECURITY DEFINER function is
-- recreated. CREATE OR REPLACE preserves them, but stating them keeps a fresh
-- environment identical to production and stops a future DROP + CREATE from
-- silently widening access. Trigger function; never called over /rest/v1/rpc.
REVOKE EXECUTE ON FUNCTION public.curriculum_goals_cleanup_orphans_trg() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.curriculum_goals_cleanup_orphans_trg() FROM anon;
REVOKE EXECUTE ON FUNCTION public.curriculum_goals_cleanup_orphans_trg() FROM authenticated;
GRANT EXECUTE ON FUNCTION public.curriculum_goals_cleanup_orphans_trg() TO service_role;

-- Explicit parent operations retain the marker while changing only their
-- validated selection. Legacy and automatic writers retain the old refusal.
CREATE OR REPLACE FUNCTION public.guard_preserved_work() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE c rooted_private.scheduler_capabilities%rowtype;permitted boolean:=false;changed text[];
BEGIN
 IF OLD.queue_preserved AND NOT OLD.completed AND NOT OLD.skipped THEN
  IF TG_OP='DELETE' OR (NEW.queue_preserved AND NOT NEW.completed AND NOT NEW.skipped AND
   (NEW.scheduled_date IS DISTINCT FROM OLD.scheduled_date OR NEW.date IS DISTINCT FROM OLD.date OR NEW.queue_position IS DISTINCT FROM OLD.queue_position OR NEW.curriculum_goal_id IS DISTINCT FROM OLD.curriculum_goal_id)) THEN
   SELECT * INTO c FROM rooted_private.scheduler_capabilities WHERE tx=txid_current() AND goal_id=OLD.curriculum_goal_id AND owner_id=auth.uid() AND owner_id=OLD.user_id;
   IF FOUND THEN
    IF TG_OP='DELETE' THEN permitted:=c.operation IN ('delete_selected','goal_stop','goal_delete','undo') AND OLD.id=ANY(c.delete_ids);
    ELSE
     SELECT coalesce(array_agg(k),'{}') INTO changed FROM unnest(ARRAY['date','scheduled_date','queue_position','curriculum_goal_id']) k WHERE to_jsonb(OLD)->k IS DISTINCT FROM to_jsonb(NEW)->k;
     permitted:=OLD.id=ANY(c.row_ids) AND changed<@c.lesson_fields AND (
      (c.operation IN ('edit','place_selected','single_move') AND OLD.id=ANY(c.explicit_ids)) OR
      (c.operation='single_move' AND to_jsonb(OLD)-ARRAY['queue_position','updated_at'] IS NOT DISTINCT FROM to_jsonb(NEW)-ARRAY['queue_position','updated_at']) OR
      c.operation IN ('calendar','undo','goal_stop','goal_delete','reassign','reassign_undo') OR
      (c.operation='recalibration' AND OLD.id=ANY(c.explicit_ids)) OR
      (c.operation='recalibration' AND to_jsonb(OLD)-ARRAY['queue_position','updated_at'] IS NOT DISTINCT FROM to_jsonb(NEW)-ARRAY['queue_position','updated_at'])
     );
    END IF;
   END IF;
   IF NOT permitted AND (TG_OP<>'DELETE' OR EXISTS(SELECT 1 FROM public.curriculum_goals WHERE id=OLD.curriculum_goal_id)) THEN RAISE EXCEPTION 'Preserved unfinished work requires a confirmed explicit change';END IF;
  END IF;
 END IF;
 IF TG_OP='DELETE' THEN RETURN OLD;END IF;RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.guard_preserved_work() FROM PUBLIC,anon,authenticated,service_role;

-- SOURCE: recalibration.sql
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

-- SOURCE: history-healing.sql
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
  PERFORM rooted_private.scheduler_lock_owner(auth.uid(),false);
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
  PERFORM rooted_private.scheduler_lock_owner(auth.uid(),false);
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

-- SOURCE: recovery-inserts.sql
-- Follow-up fixed insert semantics for offered catch-up and prior-card answers.
-- Fixed recovery inserts. This endpoint cannot update existing lesson contents.
CREATE OR REPLACE FUNCTION public.commit_scheduler_history_heal(p_operation_id uuid,p_goal_id uuid,p_expected jsonb,p_action jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE u uuid:=auth.uid(); g public.curriculum_goals%rowtype; m text; have jsonb; prior rooted_private.scheduler_action_receipts%rowtype;
 request_hash text:=rooted_private.scheduler_hash(jsonb_build_object('rpc','history_heal','goal',p_goal_id,'expected',p_expected,'action',p_action));
 kind text:=p_action->>'kind'; day date; slot integer; next_slot integer; d date; slots jsonb; item jsonb; shapes jsonb:='[]'; shape jsonb;
 n integer:=0; result jsonb; canonical jsonb; subject uuid; mins integer; inserted uuid; ids uuid[]; root public.lessons%rowtype; requested public.lessons%rowtype; new_row jsonb; after_state jsonb; choice text:=coalesce(p_action->>'choice','picked'); prior_card boolean:=coalesce(p_action->>'origin','')='prior_card';
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
  PERFORM rooted_private.scheduler_lock_owner(auth.uid(),false);
  PERFORM 1 FROM public.lessons WHERE curriculum_goal_id=p_goal_id ORDER BY id FOR UPDATE NOWAIT;
  PERFORM 1 FROM public.profiles WHERE id=u FOR SHARE NOWAIT;
  PERFORM rooted_private.scheduler_lock_owner(auth.uid(),false);
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
  IF kind='history_insert' AND (choice NOT IN ('planned','picked','today') OR (p_action?'origin' AND p_action->>'origin' IS DISTINCT FROM 'prior_card') OR (choice='today' AND d IS DISTINCT FROM day)) THEN RETURN jsonb_build_object('status','invalid','reason','completion_choice');END IF;
  -- Derive metadata from the locked goal, never trust client ownership or text.
  IF kind='history_insert' THEN
   SELECT id INTO subject FROM public.subjects WHERE user_id=u AND lower(name)=lower(trim(g.subject_label)) ORDER BY id LIMIT 1;
   mins:=CASE WHEN prior_card THEN NULL ELSE coalesce(g.default_minutes,30) END;
   IF prior_card THEN subject:=NULL;END IF;
  END IF;
  FOR item IN SELECT * FROM jsonb_array_elements(slots) LOOP
   slot:=(item->>'slot')::integer; d:=(item->>'date')::date;
   IF slot IS NULL OR slot<1 OR slot>g.total_lessons OR d IS NULL OR (kind='heal_empty' AND slot<=g.current_lesson) THEN RAISE EXCEPTION 'scheduler_heal_slot';END IF;
   shape:=jsonb_build_object('user_id',u,'child_id',g.child_id,'curriculum_goal_id',g.id,'lesson_number',slot,'queue_position',slot,
    'title',CASE WHEN kind='history_insert' AND NOT prior_card THEN coalesce(g.subject_label,g.curriculum_name,'Lesson')||': Lesson '||slot ELSE coalesce(nullif(trim(g.curriculum_name),''),'Lesson')||' — Lesson '||slot END,
    'date',d,'scheduled_date',d,'scheduled_source',CASE kind WHEN 'history_insert' THEN 'completion_'||choice WHEN 'heal_next' THEN 'today_self_heal' ELSE 'self_heal' END,
    'completed',kind='history_insert','completed_at',CASE WHEN kind='history_insert' THEN CASE WHEN d<day THEN (d::text||'T12:00:00Z')::timestamptz ELSE now() END ELSE NULL END,
    'is_backfill',kind='history_insert' AND choice<>'today','queue_pinned',kind='history_insert' AND choice<>'today','queue_preserved',false,'hours',CASE WHEN kind='history_insert' THEN coalesce(mins,0)::numeric/60 ELSE 0 END,
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

-- SOURCE: calendar.sql
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
  IF before_state IS DISTINCT FROM p_expected THEN RETURN jsonb_build_object('status','stale','reason','schedule_changed');END IF;
  IF before_state->'profile'->>'timezone' IS NULL THEN RETURN jsonb_build_object('status','invalid','reason','timezone');END IF;
  local_day:=(now() AT TIME ZONE (before_state->'profile'->>'timezone'))::date;
  IF (p_action->>'localDay')::date IS DISTINCT FROM local_day THEN RETURN jsonb_build_object('status','stale','reason','local_day_changed');END IF;
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

-- SOURCE: retention.sql
-- Private bounded maintenance. No schedule or invocation is installed here.
-- Append after calendar/history definitions. Replay identity and compact results
-- are retained; never delete operation IDs while old requests can be replayed.
CREATE FUNCTION rooted_private.expire_scheduler_receipts(p_limit integer DEFAULT 500)
RETURNS jsonb LANGUAGE plpgsql SET search_path=pg_catalog,pg_temp AS $$
DECLARE action_count integer;calendar_count integer;
BEGIN
 IF p_limit IS NULL OR p_limit<1 OR p_limit>2000 THEN RAISE EXCEPTION 'receipt_batch_limit';END IF;
 WITH expired AS (
  SELECT id FROM rooted_private.scheduler_action_receipts
  WHERE (created_at<=clock_timestamp()-interval '10 minutes' OR undone_at IS NOT NULL)
   AND (before_state IS NOT NULL OR result ? 'row')
  ORDER BY created_at,id LIMIT p_limit FOR UPDATE SKIP LOCKED
 )
 UPDATE rooted_private.scheduler_action_receipts r SET before_state=NULL,
  result=CASE WHEN r.result ? 'row' THEN (r.result-'row')||jsonb_build_object('rowId',coalesce(r.result->'rowId',r.result->'row'->'id')) ELSE r.result END
 FROM expired e WHERE r.id=e.id;
 GET DIAGNOSTICS action_count=ROW_COUNT;
 WITH expired AS (
  SELECT id FROM rooted_private.scheduler_calendar_receipts
  WHERE (created_at<=clock_timestamp()-interval '10 minutes' OR undone_at IS NOT NULL)
   AND (before_state IS NOT NULL OR after_state IS NOT NULL)
  ORDER BY created_at,id LIMIT p_limit FOR UPDATE SKIP LOCKED
 )
 UPDATE rooted_private.scheduler_calendar_receipts r SET before_state=NULL,after_state=NULL
 FROM expired e WHERE r.id=e.id;
 GET DIAGNOSTICS calendar_count=ROW_COUNT;
 RETURN jsonb_build_object('actions',action_count,'calendars',calendar_count);
END $$;
REVOKE ALL ON FUNCTION rooted_private.expire_scheduler_receipts(integer) FROM PUBLIC,anon,authenticated,service_role;
-- Preserve the earlier private maintenance entry point, now with bounded work.
CREATE OR REPLACE FUNCTION rooted_private.expire_scheduler_undo() RETURNS bigint
LANGUAGE plpgsql SET search_path=pg_catalog,pg_temp AS $$
DECLARE counts jsonb;BEGIN counts:=rooted_private.expire_scheduler_receipts(500);RETURN (counts->>'actions')::bigint+(counts->>'calendars')::bigint;END $$;
REVOKE ALL ON FUNCTION rooted_private.expire_scheduler_undo() FROM PUBLIC,anon,authenticated,service_role;

-- Pause blocks new changes, not exact, unexpired Undo of untouched work.
CREATE OR REPLACE FUNCTION public.undo_scheduler_continuation(p_operation_id uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
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
  IF m IS NULL OR m NOT IN ('atomic_v2','paused') THEN RETURN jsonb_build_object('status','invalid','reason','mode');END IF;
  PERFORM rooted_private.scheduler_lock_owner(auth.uid(),false);
  PERFORM 1 FROM public.lessons WHERE curriculum_goal_id=r.goal_id ORDER BY id FOR UPDATE NOWAIT;
  PERFORM 1 FROM public.profiles WHERE id=u FOR SHARE NOWAIT;
  PERFORM rooted_private.scheduler_lock_owner(auth.uid(),false);
  state:=rooted_private.scheduler_state(r.goal_id);
  IF rooted_private.scheduler_hash(state) IS DISTINCT FROM r.after_hash THEN RETURN jsonb_build_object('status','stale','reason','schedule_changed');END IF;
  row_id:=(r.result->'row'->>'id')::uuid;
  IF NOT EXISTS(SELECT 1 FROM public.lessons l WHERE id=row_id AND user_id=u AND curriculum_goal_id=r.goal_id AND to_jsonb(l)=r.result->'row' AND NOT completed AND coalesce(hours,0)=0 AND minutes_spent IS NULL AND notes IS NULL AND started_at IS NULL) THEN RETURN jsonb_build_object('status','stale','reason','continuation_changed');END IF;
  PERFORM rooted_private.scheduler_allow(r.goal_id,'undo_continuation',ARRAY[row_id],'{}'::text[],'{}'::text[],ARRAY[row_id]);
  DELETE FROM public.lessons WHERE id=row_id;
  GET DIAGNOSTICS n=ROW_COUNT;IF n<>1 THEN RAISE EXCEPTION 'scheduler_continuation_delete_refused';END IF;
  SET CONSTRAINTS ALL IMMEDIATE;
  PERFORM rooted_private.scheduler_disallow(r.goal_id);
  UPDATE rooted_private.scheduler_action_receipts SET undone_at=clock_timestamp(),result=(result-'row')||jsonb_build_object('rowId',row_id) WHERE id=r.id;
  RETURN jsonb_build_object('status','undone');
 EXCEPTION WHEN lock_not_available THEN RETURN jsonb_build_object('status','busy');END;
END $$;
REVOKE ALL ON FUNCTION public.undo_scheduler_continuation(uuid) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.undo_scheduler_continuation(uuid) TO authenticated;

-- SOURCE: parent-respread.sql
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

-- SOURCE: bulk-completion.sql
-- Fixed per-goal completion batch; install after actions.sql and respread.sql.
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
  PERFORM rooted_private.scheduler_lock_owner(auth.uid(),false);
  PERFORM 1 FROM public.lessons WHERE curriculum_goal_id=p_goal_id ORDER BY id FOR UPDATE NOWAIT;
  PERFORM 1 FROM public.profiles WHERE id=u FOR SHARE NOWAIT;
  PERFORM rooted_private.scheduler_lock_owner(auth.uid(),false);
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

-- SOURCE: lesson-add.sql
-- Explicit Plan Add / Log extra. Reuse only an untouched placeholder; no
-- arbitrary caller-supplied row, owner, slot, pin or completion timestamp.
CREATE FUNCTION public.commit_scheduler_add(p_operation_id uuid,p_goal_id uuid,p_expected jsonb,p_values jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE u uuid:=auth.uid();g public.curriculum_goals%rowtype;r public.lessons%rowtype;prior rooted_private.scheduler_action_receipts%rowtype;
 have jsonb;after_state jsonb;shape jsonb;before_undo jsonb;result jsonb;request_hash text:=rooted_private.scheduler_hash(jsonb_build_object('rpc','add','goal',p_goal_id,'expected',p_expected,'values',p_values));
 mode text;num integer;slot integer;mins integer;d date;done boolean;reuse boolean:=false;rid uuid;n integer;ids uuid[];fields text[]:=ARRAY['date','scheduled_date','scheduled_source','queue_pinned','completed','completed_at','is_backfill'];
BEGIN
 IF u IS NULL OR p_operation_id IS NULL THEN RETURN jsonb_build_object('status','invalid','reason','owner');END IF;
 BEGIN
  IF NOT pg_try_advisory_xact_lock(hashtextextended(p_operation_id::text,0)) THEN RAISE lock_not_available;END IF;
  SELECT * INTO prior FROM rooted_private.scheduler_action_receipts WHERE id=p_operation_id;
  IF FOUND THEN
   IF prior.user_id<>u OR prior.goal_id<>p_goal_id OR prior.request_hash<>request_hash THEN RETURN jsonb_build_object('status','invalid','reason','operation');END IF;
   RETURN prior.result||jsonb_build_object('status',CASE WHEN prior.undone_at IS NULL THEN 'already_applied' ELSE 'already_undone' END,'row',(SELECT to_jsonb(l) FROM public.lessons l WHERE l.id=(prior.result->>'rowId')::uuid AND user_id=u));
  END IF;
  PERFORM rooted_private.scheduler_lock_owner(u,false);
  SELECT * INTO g FROM public.curriculum_goals WHERE id=p_goal_id AND user_id=u FOR UPDATE NOWAIT;
  IF NOT FOUND THEN RETURN jsonb_build_object('status','invalid','reason','owner');END IF;
  SELECT m.mode INTO mode FROM rooted_private.scheduler_modes m WHERE goal_id=p_goal_id;
  IF mode IS NULL THEN RETURN jsonb_build_object('status','legacy');END IF;
  IF mode='paused' THEN RETURN jsonb_build_object('status','paused');END IF;
  PERFORM 1 FROM public.lessons WHERE curriculum_goal_id=p_goal_id ORDER BY id FOR UPDATE NOWAIT;
  PERFORM 1 FROM public.profiles WHERE id=u FOR SHARE NOWAIT;
  have:=rooted_private.scheduler_state(p_goal_id);
  IF have IS DISTINCT FROM p_expected THEN RETURN jsonb_build_object('status','stale','reason','schedule_changed');END IF;
  IF jsonb_typeof(p_values) IS DISTINCT FROM 'object' OR EXISTS(SELECT 1 FROM jsonb_object_keys(p_values) k WHERE k NOT IN ('title','child_id','lesson_number','minutes_spent','notes','scheduled_date','completed')) OR jsonb_typeof(p_values->'completed') IS DISTINCT FROM 'boolean' OR jsonb_typeof(p_values->'title') IS DISTINCT FROM 'string' OR p_values->>'scheduled_date' IS NULL THEN RAISE EXCEPTION 'scheduler_add_shape';END IF;
  IF (p_values->>'child_id')::uuid IS DISTINCT FROM g.child_id OR NOT EXISTS(SELECT 1 FROM public.children WHERE id=g.child_id AND user_id=u) THEN RAISE EXCEPTION 'scheduler_add_child';END IF;
  num:=(p_values->>'lesson_number')::integer;mins:=(p_values->>'minutes_spent')::integer;d:=(p_values->>'scheduled_date')::date;done:=(p_values->>'completed')::boolean;
  IF (num IS NOT NULL AND num<1) OR (mins IS NOT NULL AND mins<0) OR (NOT done AND num IS NULL) THEN RAISE EXCEPTION 'scheduler_add_shape';END IF;
  SELECT * INTO r FROM public.lessons WHERE curriculum_goal_id=p_goal_id AND lesson_number=num;
  reuse:=FOUND;
  IF reuse THEN
   IF r.completed OR r.skipped OR r.queue_pinned OR r.queue_preserved OR r.continues_lesson_id IS NOT NULL OR r.started_at IS NOT NULL OR coalesce(r.hours,0)>0 OR coalesce(r.minutes_spent,0)>0 OR nullif(btrim(r.notes),'') IS NOT NULL OR (r.scheduled_source IS NOT NULL AND r.scheduled_source NOT IN ('queue_resync','skip_respread','skip_undo','catchup_spread','catchup_pushback','plan_cascade_shift','recalibrate_respread','completion_respread','edit_respread','uncomplete_respread','undo_restore')) THEN RETURN jsonb_build_object('status','invalid','reason','existing_work');END IF;
   rid:=r.id;slot:=r.queue_position;
   IF NOT done AND slot IS NULL THEN RAISE EXCEPTION 'scheduler_add_unslotted_placeholder';END IF;
  ELSE
   rid:=gen_random_uuid();
   IF NOT done THEN
    slot:=num;
    IF EXISTS(SELECT 1 FROM public.lessons WHERE curriculum_goal_id=p_goal_id AND queue_position=slot) THEN
     SELECT greatest(coalesce(max(queue_position),0),coalesce(max(lesson_number),0),num)+1 INTO slot FROM public.lessons WHERE curriculum_goal_id=p_goal_id;
    END IF;
   END IF;
  END IF;
  ids:=ARRAY(SELECT id FROM public.lessons WHERE curriculum_goal_id=p_goal_id);
  IF NOT reuse THEN
   shape:=jsonb_build_object('id',rid,'user_id',u,'child_id',g.child_id,'curriculum_goal_id',g.id,'title',p_values->>'title','lesson_number',num,'queue_position',slot,'date',d,'scheduled_date',d,'notes',p_values->>'notes','minutes_spent',mins,'hours',coalesce((mins::double precision/60)::numeric,0),'completed',done,'completed_at',CASE WHEN done THEN (d::timestamp AT TIME ZONE 'UTC')+interval '12 hours' ELSE NULL END,'queue_pinned',NOT done AND slot IS NOT NULL,'is_backfill',false,'scheduled_source',CASE WHEN done THEN 'extra_log' ELSE 'plan_move' END);
  END IF;
  PERFORM rooted_private.scheduler_allow(g.id,'add',ids,fields,ARRAY['current_lesson','completed_at'],'{}'::uuid[],CASE WHEN reuse THEN '[]'::jsonb ELSE jsonb_build_array(shape) END);
  IF reuse THEN
   UPDATE public.lessons SET date=d,scheduled_date=d,completed=done,completed_at=CASE WHEN done THEN (d::timestamp AT TIME ZONE 'UTC')+interval '12 hours' ELSE NULL END,
    minutes_spent=CASE WHEN mins IS NOT NULL THEN mins ELSE minutes_spent END,hours=CASE WHEN mins IS NOT NULL THEN (mins::double precision/60)::numeric ELSE hours END,
    notes=CASE WHEN p_values->>'notes' IS NOT NULL THEN p_values->>'notes' ELSE notes END,
    queue_pinned=CASE WHEN NOT done AND slot IS NOT NULL THEN true ELSE queue_pinned END,scheduled_source=CASE WHEN done THEN 'extra_log' ELSE 'plan_move' END WHERE id=rid;
  ELSE
   INSERT INTO public.lessons(id,user_id,child_id,curriculum_goal_id,title,lesson_number,queue_position,date,scheduled_date,notes,minutes_spent,hours,completed,completed_at,queue_pinned,is_backfill,scheduled_source)
   SELECT x.id,x.user_id,x.child_id,x.curriculum_goal_id,x.title,x.lesson_number,x.queue_position,x.date,x.scheduled_date,x.notes,x.minutes_spent,x.hours,x.completed,x.completed_at,x.queue_pinned,x.is_backfill,x.scheduled_source FROM jsonb_populate_record(NULL::public.lessons,shape) x;
  END IF;
  GET DIAGNOSTICS n=ROW_COUNT;IF n<>1 THEN RAISE EXCEPTION 'scheduler_add_rowcount';END IF;
  IF done THEN PERFORM rooted_private.scheduler_respread_locked(g.id,'completion_respread',(now() AT TIME ZONE (SELECT timezone FROM public.profiles WHERE id=u))::date);END IF;
  SET CONSTRAINTS ALL IMMEDIATE;
  after_state:=rooted_private.scheduler_state(g.id);
  IF NOT EXISTS(SELECT 1 FROM public.lessons WHERE id=rid AND user_id=u AND curriculum_goal_id=g.id AND date=d AND scheduled_date=d AND completed=done AND (mins IS NULL OR minutes_spent=mins) AND (p_values->>'notes' IS NULL OR notes=p_values->>'notes')) THEN RAISE EXCEPTION 'scheduler_add_postcondition';END IF;
  IF (SELECT count(*) FROM jsonb_array_elements(after_state->'rows'))<>(SELECT count(*) FROM jsonb_array_elements(have->'rows'))+(CASE WHEN reuse THEN 0 ELSE 1 END)
   OR EXISTS(SELECT 1 FROM jsonb_array_elements(have->'rows') b LEFT JOIN jsonb_array_elements(after_state->'rows') a ON a->>'id'=b->>'id' WHERE a IS NULL OR CASE WHEN b->>'id'=rid::text THEN b-ARRAY['date','scheduled_date','completed','completed_at','minutes_spent','hours','notes','queue_pinned','scheduled_source','updated_at'] IS DISTINCT FROM a-ARRAY['date','scheduled_date','completed','completed_at','minutes_spent','hours','notes','queue_pinned','scheduled_source','updated_at'] ELSE b-ARRAY['date','scheduled_date','scheduled_source','updated_at'] IS DISTINCT FROM a-ARRAY['date','scheduled_date','scheduled_source','updated_at'] END) THEN RAISE EXCEPTION 'scheduler_add_preservation';END IF;
  SELECT jsonb_build_object('goal',jsonb_build_object('current_lesson',have->'goal'->'current_lesson','completed_at',have->'goal'->'completed_at'),'rows',jsonb_agg((SELECT jsonb_object_agg(k,v) FROM jsonb_each(x) e(k,v) WHERE k=ANY(ARRAY['id','date','scheduled_date','scheduled_source','queue_position','queue_pinned','queue_preserved','completed','completed_at','skipped','is_backfill'])))) INTO before_undo FROM jsonb_array_elements(have->'rows') x;
  before_undo:=jsonb_set(before_undo,'{rows}',coalesce(nullif(before_undo->'rows','null'::jsonb),'[]'::jsonb));
  result:=jsonb_build_object('status','applied','kind','add','rowId',rid,'updatedExisting',reuse,'operationId',p_operation_id);
  PERFORM rooted_private.scheduler_disallow(g.id);
  INSERT INTO rooted_private.scheduler_action_receipts(id,user_id,goal_id,request_hash,before_state,after_hash,result) VALUES(p_operation_id,u,g.id,request_hash,CASE WHEN reuse THEN NULL ELSE before_undo END,rooted_private.scheduler_hash(after_state),result);
  RETURN result||jsonb_build_object('row',(SELECT to_jsonb(l) FROM public.lessons l WHERE id=rid));
 EXCEPTION WHEN lock_not_available THEN RETURN jsonb_build_object('status','busy');END;
EXCEPTION WHEN invalid_text_representation OR datetime_field_overflow OR invalid_datetime_format OR check_violation OR not_null_violation THEN RETURN jsonb_build_object('status','invalid','reason','shape');
END $$;
REVOKE ALL ON FUNCTION public.commit_scheduler_add(uuid,uuid,jsonb,jsonb) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.commit_scheduler_add(uuid,uuid,jsonb,jsonb) TO authenticated;

-- SOURCE: goal-lifecycle.sql
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

-- SOURCE: reassignment.sql
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

-- SOURCE: recovery-status.sql
-- Read-only lifecycle evidence for durable browser recovery. A verified deletion
-- supersedes pending course work; it does NOT prove an absent request never ran.
CREATE FUNCTION public.read_scheduler_recovery(p_operation_id uuid,p_rpc text,p_goal_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE u uuid:=auth.uid();g public.curriculum_goals%rowtype;resolved_goal uuid:=p_goal_id;receipt_found boolean:=false;undone boolean:=false;goal_state text:='unknown';
BEGIN
 IF u IS NULL OR p_operation_id IS NULL OR p_rpc IS NULL OR p_rpc NOT IN ('commit_scheduler_action','commit_scheduler_add','commit_scheduler_retire','commit_scheduler_history_heal','commit_scheduler_bulk_completion','commit_scheduler_respread','commit_scheduler_recalibration','commit_cascade_shift','undo_cascade_shift') THEN RETURN jsonb_build_object('status','invalid','reason','request');END IF;
 BEGIN
  IF NOT pg_try_advisory_xact_lock(hashtextextended(p_operation_id::text,0)) THEN RAISE lock_not_available;END IF;
  PERFORM rooted_private.scheduler_lock_owner(u,true);
  IF p_rpc='undo_cascade_shift' AND resolved_goal IS NULL THEN
   SELECT r.goal_id INTO resolved_goal FROM rooted_private.cascade_shift_receipts r WHERE r.id=p_operation_id AND r.user_id=u;
  END IF;
  IF resolved_goal IS NULL THEN RETURN jsonb_build_object('status','invalid','reason','receipt');END IF;
  IF p_rpc IN ('commit_cascade_shift','undo_cascade_shift') THEN
   SELECT true,r.undone_at IS NOT NULL INTO receipt_found,undone FROM rooted_private.cascade_shift_receipts r WHERE r.id=p_operation_id AND r.user_id=u AND r.goal_id=resolved_goal;
  ELSE
   SELECT true,r.undone_at IS NOT NULL INTO receipt_found,undone FROM rooted_private.scheduler_action_receipts r WHERE r.id=p_operation_id AND r.user_id=u AND r.goal_id=resolved_goal;
  END IF;
  SELECT * INTO g FROM public.curriculum_goals WHERE id=resolved_goal AND user_id=u FOR SHARE NOWAIT;
  IF FOUND THEN goal_state:=CASE WHEN g.archived THEN 'archived' ELSE 'active' END;
  ELSIF NOT EXISTS(SELECT 1 FROM public.curriculum_goals WHERE id=resolved_goal)
   AND EXISTS(SELECT 1 FROM rooted_private.scheduler_action_receipts r WHERE r.user_id=u AND r.goal_id=resolved_goal AND r.result->>'kind'='delete') THEN goal_state:='deleted_verified';END IF;
  RETURN jsonb_build_object('status','ready','goalId',resolved_goal,'goalState',goal_state,'receiptPresent',coalesce(receipt_found,false),'undone',coalesce(undone,false));
 EXCEPTION WHEN lock_not_available THEN RETURN jsonb_build_object('status','busy');END;
END $$;
REVOKE ALL ON FUNCTION public.read_scheduler_recovery(uuid,text,uuid) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.read_scheduler_recovery(uuid,text,uuid) TO authenticated;

COMMIT;
