-- SOURCE: core.sql
-- LOCAL ONLY: protected cohorts remain empty until separately approved activation.
BEGIN;
SET LOCAL lock_timeout='5s';
CREATE TABLE rooted_private.scheduler_modes(goal_id uuid PRIMARY KEY REFERENCES public.curriculum_goals(id) ON DELETE CASCADE, mode text NOT NULL CHECK(mode IN ('atomic_v2','paused')));
CREATE TABLE rooted_private.scheduler_capabilities(tx bigint NOT NULL,goal_id uuid NOT NULL,owner_id uuid NOT NULL,operation text NOT NULL,row_ids uuid[] NOT NULL,lesson_fields text[] NOT NULL,goal_fields text[] NOT NULL,delete_ids uuid[] NOT NULL DEFAULT '{}',insert_shapes jsonb NOT NULL DEFAULT '[]',PRIMARY KEY(tx,goal_id));
CREATE TABLE rooted_private.scheduler_action_receipts(id uuid PRIMARY KEY,user_id uuid NOT NULL,goal_id uuid NOT NULL,request_hash text NOT NULL,before_state jsonb,after_hash text NOT NULL,result jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT clock_timestamp(),undone_at timestamptz);
ALTER TABLE rooted_private.scheduler_modes ENABLE ROW LEVEL SECURITY;
ALTER TABLE rooted_private.scheduler_capabilities ENABLE ROW LEVEL SECURITY;
ALTER TABLE rooted_private.scheduler_action_receipts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON rooted_private.scheduler_modes,rooted_private.scheduler_capabilities,rooted_private.scheduler_action_receipts FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION rooted_private.scheduler_state(p_goal uuid) RETURNS jsonb LANGUAGE sql STABLE SET search_path=pg_catalog,pg_temp AS $$
 SELECT jsonb_build_object('goal',to_jsonb(g),'rows',coalesce((SELECT jsonb_agg(to_jsonb(l) ORDER BY id) FROM public.lessons l WHERE curriculum_goal_id=g.id),'[]'::jsonb),'vacations',coalesce((SELECT jsonb_agg(to_jsonb(v) ORDER BY id) FROM public.vacation_blocks v WHERE user_id=g.user_id),'[]'::jsonb)) FROM public.curriculum_goals g WHERE id=p_goal
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
DECLARE oldj jsonb;newj jsonb;g uuid; m text;c rooted_private.scheduler_capabilities%rowtype; fields text[]; changed text[]; shape jsonb;
BEGIN
 IF TG_OP<>'INSERT' THEN oldj:=to_jsonb(OLD);END IF;
 IF TG_OP<>'DELETE' THEN newj:=to_jsonb(NEW);END IF;
 fields:=CASE WHEN TG_TABLE_NAME='lessons' THEN ARRAY['id','user_id','child_id','date','scheduled_date','lesson_number','counts_toward_goal','goal_id','scheduled_source','curriculum_goal_id','school_year','is_backfill','school_year_id','queue_position','queue_pinned','continues_lesson_id','skipped','queue_preserved','completed','completed_at'] ELSE ARRAY['id','user_id','child_id','total_lessons','current_lesson','target_date','school_days','school_year','start_date','start_at_lesson','school_year_id','lessons_per_day','completed_at','lessons_per_day_overrides','archived','placement_mode','placement_migrated_at','lessons_per_unit'] END;
 IF TG_OP='UPDATE' THEN
  SELECT array_agg(k) INTO changed FROM unnest(fields) k WHERE oldj->k IS DISTINCT FROM newj->k;
  IF changed IS NULL THEN RETURN NEW;END IF;
 END IF;
 -- Every scheduler writer, including legacy mode, locks before reading mode.
 -- The early trigger raises: a mixed statement cannot silently drop some rows.
 FOR g IN SELECT DISTINCT x FROM unnest(CASE WHEN TG_TABLE_NAME='lessons' THEN ARRAY[(oldj->>'curriculum_goal_id')::uuid,(newj->>'curriculum_goal_id')::uuid] ELSE ARRAY[(oldj->>'id')::uuid,(newj->>'id')::uuid] END) x WHERE x IS NOT NULL ORDER BY x LOOP
  PERFORM 1 FROM public.curriculum_goals WHERE id=g FOR UPDATE NOWAIT;
  SELECT mode INTO m FROM rooted_private.scheduler_modes WHERE goal_id=g;
  IF m IS NULL THEN CONTINUE;END IF;
  SELECT * INTO c FROM rooted_private.scheduler_capabilities WHERE tx=txid_current() AND goal_id=g AND owner_id=auth.uid();
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='scheduler_client_upgrade_required',HINT='Reload and review the schedule before retrying.';END IF;
  IF TG_TABLE_NAME='curriculum_goals' THEN
   IF TG_OP<>'UPDATE' OR NOT changed <@ c.goal_fields THEN RAISE EXCEPTION 'scheduler_goal_scope_refused';END IF;
  ELSIF TG_OP='UPDATE' THEN
   IF NOT (OLD.id=ANY(c.row_ids)) OR NOT changed <@ c.lesson_fields OR OLD.curriculum_goal_id IS DISTINCT FROM NEW.curriculum_goal_id OR OLD.user_id IS DISTINCT FROM NEW.user_id THEN RAISE EXCEPTION 'scheduler_row_scope_refused';END IF;
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
 IF p_mode NOT IN ('atomic_v2','paused') THEN RAISE EXCEPTION 'Cannot downgrade a protected goal to legacy';END IF;
 PERFORM 1 FROM public.curriculum_goals WHERE id=p_goal FOR UPDATE NOWAIT;
 IF NOT FOUND THEN RAISE EXCEPTION 'No goal';END IF;
 PERFORM 1 FROM public.lessons WHERE curriculum_goal_id=p_goal ORDER BY id FOR UPDATE NOWAIT;
 LOCK TABLE public.vacation_blocks IN SHARE MODE NOWAIT;
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
 FOR g IN SELECT id FROM public.curriculum_goals WHERE user_id=ANY(owners) ORDER BY id FOR UPDATE NOWAIT LOOP
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
CREATE FUNCTION public.apply_builder_rebuild(p_goal_id uuid, p_local_day date, p_expected jsonb, p_plan jsonb, p_settings jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $wrapper$ DECLARE g uuid;m text;result jsonb; BEGIN BEGIN g:=p_goal_id; IF g IS NULL THEN RETURN rooted_private.contained_apply_builder_rebuild(p_goal_id,p_local_day,p_expected,p_plan,p_settings); END IF; PERFORM 1 FROM public.curriculum_goals WHERE id=g AND user_id=auth.uid() FOR UPDATE NOWAIT; IF NOT FOUND THEN RAISE EXCEPTION 'scheduler_owner_refused';END IF; SELECT mode INTO m FROM rooted_private.scheduler_modes WHERE goal_id=g; IF m IS NULL THEN RETURN rooted_private.contained_apply_builder_rebuild(p_goal_id,p_local_day,p_expected,p_plan,p_settings); END IF; IF m='paused' AND NOT (EXISTS(SELECT 1 FROM rooted_private.builder_commit_log WHERE request_id=(p_plan->>'request_id')::uuid AND user_id=auth.uid())) THEN RETURN jsonb_build_object('status','invalid','reason','scheduler_paused');END IF; PERFORM 1 FROM public.lessons WHERE curriculum_goal_id=g ORDER BY id FOR UPDATE NOWAIT; PERFORM 1 FROM public.profiles WHERE id=auth.uid() FOR SHARE NOWAIT; LOCK TABLE public.vacation_blocks IN SHARE MODE NOWAIT; PERFORM rooted_private.scheduler_allow(g,'apply_builder_rebuild',ARRAY(SELECT id FROM public.lessons WHERE curriculum_goal_id=g),ARRAY['date','scheduled_date','scheduled_source','queue_position','queue_pinned','queue_preserved','completed','completed_at','skipped','is_backfill'],ARRAY['current_lesson','total_lessons','start_date','start_at_lesson','target_date','school_days','lessons_per_day','lessons_per_day_overrides','placement_mode','completed_at'],ARRAY(SELECT id FROM public.lessons WHERE curriculum_goal_id=g),coalesce((SELECT jsonb_agg(jsonb_build_object('lesson_number',x->'lesson_number','queue_position',x->'queue_position','title',x->'title','scheduled_date',x->'scheduled_date','date',x->'scheduled_date','scheduled_source','wizard_create')) FROM jsonb_array_elements(p_plan->'inserts') x),'[]'::jsonb)); result:=rooted_private.contained_apply_builder_rebuild(p_goal_id,p_local_day,p_expected,p_plan,p_settings); PERFORM rooted_private.scheduler_disallow(g); RETURN result; EXCEPTION WHEN lock_not_available THEN RETURN jsonb_build_object('status','stale','reason','busy'); END; END $wrapper$; REVOKE ALL ON FUNCTION public.apply_builder_rebuild(uuid, date, jsonb, jsonb, jsonb) FROM PUBLIC,anon,authenticated,service_role; GRANT EXECUTE ON FUNCTION public.apply_builder_rebuild(uuid, date, jsonb, jsonb, jsonb) TO authenticated,service_role;
DO $$ BEGIN IF (SELECT md5(prosrc) FROM pg_proc WHERE oid='public.apply_daily_reconcile(uuid, date, jsonb, jsonb)'::regprocedure) IS DISTINCT FROM '1a4b8ed5380c8c680bc4d736a6310a81' THEN RAISE EXCEPTION 'Containment baseline drift: apply_daily_reconcile';END IF;END $$;
ALTER FUNCTION public.apply_daily_reconcile(uuid, date, jsonb, jsonb) SET SCHEMA rooted_private; ALTER FUNCTION rooted_private.apply_daily_reconcile(uuid, date, jsonb, jsonb) RENAME TO contained_apply_daily_reconcile; REVOKE ALL ON FUNCTION rooted_private.contained_apply_daily_reconcile(uuid, date, jsonb, jsonb) FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION public.apply_daily_reconcile(p_goal_id uuid, p_local_day date, p_expected jsonb, p_writes jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $wrapper$ DECLARE g uuid;m text;result jsonb; BEGIN BEGIN g:=p_goal_id; IF g IS NULL THEN RETURN rooted_private.contained_apply_daily_reconcile(p_goal_id,p_local_day,p_expected,p_writes); END IF; PERFORM 1 FROM public.curriculum_goals WHERE id=g AND user_id=auth.uid() FOR UPDATE NOWAIT; IF NOT FOUND THEN RAISE EXCEPTION 'scheduler_owner_refused';END IF; SELECT mode INTO m FROM rooted_private.scheduler_modes WHERE goal_id=g; IF m IS NULL THEN RETURN rooted_private.contained_apply_daily_reconcile(p_goal_id,p_local_day,p_expected,p_writes); END IF; IF m='paused' AND NOT (false) THEN RETURN jsonb_build_object('status','invalid','reason','scheduler_paused');END IF; PERFORM 1 FROM public.lessons WHERE curriculum_goal_id=g ORDER BY id FOR UPDATE NOWAIT; PERFORM 1 FROM public.profiles WHERE id=auth.uid() FOR SHARE NOWAIT; LOCK TABLE public.vacation_blocks IN SHARE MODE NOWAIT; PERFORM rooted_private.scheduler_allow(g,'apply_daily_reconcile',ARRAY(SELECT (x->>'id')::uuid FROM jsonb_array_elements(p_writes) x),ARRAY['date','scheduled_date','scheduled_source'],'{}'::text[],'{}'::uuid[],'[]'::jsonb); result:=rooted_private.contained_apply_daily_reconcile(p_goal_id,p_local_day,p_expected,p_writes); PERFORM rooted_private.scheduler_disallow(g); RETURN result; EXCEPTION WHEN lock_not_available THEN RETURN jsonb_build_object('status','stale','reason','busy'); END; END $wrapper$; REVOKE ALL ON FUNCTION public.apply_daily_reconcile(uuid, date, jsonb, jsonb) FROM PUBLIC,anon,authenticated,service_role; GRANT EXECUTE ON FUNCTION public.apply_daily_reconcile(uuid, date, jsonb, jsonb) TO authenticated;
DO $$ BEGIN IF (SELECT md5(prosrc) FROM pg_proc WHERE oid='public.commit_cascade_shift(uuid, uuid, jsonb, jsonb, jsonb, jsonb)'::regprocedure) IS DISTINCT FROM '100a0f4e3da54e205bd7cecfe22822cf' THEN RAISE EXCEPTION 'Containment baseline drift: commit_cascade_shift';END IF;END $$;
ALTER FUNCTION public.commit_cascade_shift(uuid, uuid, jsonb, jsonb, jsonb, jsonb) SET SCHEMA rooted_private; ALTER FUNCTION rooted_private.commit_cascade_shift(uuid, uuid, jsonb, jsonb, jsonb, jsonb) RENAME TO contained_commit_cascade_shift; REVOKE ALL ON FUNCTION rooted_private.contained_commit_cascade_shift(uuid, uuid, jsonb, jsonb, jsonb, jsonb) FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION public.commit_cascade_shift(p_operation_id uuid, p_goal_id uuid, p_expected jsonb, p_choice jsonb, p_moves jsonb, p_preserved jsonb DEFAULT '[]'::jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $wrapper$ DECLARE g uuid;m text;result jsonb; BEGIN BEGIN g:=p_goal_id; IF g IS NULL THEN RETURN rooted_private.contained_commit_cascade_shift(p_operation_id,p_goal_id,p_expected,p_choice,p_moves,p_preserved); END IF; PERFORM 1 FROM public.curriculum_goals WHERE id=g AND user_id=auth.uid() FOR UPDATE NOWAIT; IF NOT FOUND THEN RAISE EXCEPTION 'scheduler_owner_refused';END IF; SELECT mode INTO m FROM rooted_private.scheduler_modes WHERE goal_id=g; IF m IS NULL THEN RETURN rooted_private.contained_commit_cascade_shift(p_operation_id,p_goal_id,p_expected,p_choice,p_moves,p_preserved); END IF; IF m='paused' AND NOT (EXISTS(SELECT 1 FROM rooted_private.cascade_shift_receipts WHERE id=p_operation_id AND user_id=auth.uid())) THEN RETURN jsonb_build_object('status','invalid','reason','scheduler_paused');END IF; PERFORM 1 FROM public.lessons WHERE curriculum_goal_id=g ORDER BY id FOR UPDATE NOWAIT; PERFORM 1 FROM public.profiles WHERE id=auth.uid() FOR SHARE NOWAIT; LOCK TABLE public.vacation_blocks IN SHARE MODE NOWAIT; IF NOT pg_try_advisory_xact_lock(hashtextextended(p_operation_id::text,0)) THEN RAISE lock_not_available;END IF; PERFORM rooted_private.scheduler_allow(g,'commit_cascade_shift',ARRAY(SELECT (x->>'id')::uuid FROM jsonb_array_elements(p_moves||p_preserved) x),ARRAY['date','scheduled_date','scheduled_source','queue_pinned','queue_preserved'],'{}'::text[],'{}'::uuid[],'[]'::jsonb); result:=rooted_private.contained_commit_cascade_shift(p_operation_id,p_goal_id,p_expected,p_choice,p_moves,p_preserved); PERFORM rooted_private.scheduler_disallow(g); RETURN result; EXCEPTION WHEN lock_not_available THEN RETURN jsonb_build_object('status','stale','reason','busy'); END; END $wrapper$; REVOKE ALL ON FUNCTION public.commit_cascade_shift(uuid, uuid, jsonb, jsonb, jsonb, jsonb) FROM PUBLIC,anon,authenticated,service_role; GRANT EXECUTE ON FUNCTION public.commit_cascade_shift(uuid, uuid, jsonb, jsonb, jsonb, jsonb) TO authenticated;
DO $$ BEGIN IF (SELECT md5(prosrc) FROM pg_proc WHERE oid='public.move_lesson_keep_slot(uuid, date, date, boolean)'::regprocedure) IS DISTINCT FROM '1a339b9ab5e1a57a3a164d77c46ac660' THEN RAISE EXCEPTION 'Containment baseline drift: move_lesson_keep_slot';END IF;END $$;
ALTER FUNCTION public.move_lesson_keep_slot(uuid, date, date, boolean) SET SCHEMA rooted_private; ALTER FUNCTION rooted_private.move_lesson_keep_slot(uuid, date, date, boolean) RENAME TO contained_move_lesson_keep_slot; REVOKE ALL ON FUNCTION rooted_private.contained_move_lesson_keep_slot(uuid, date, date, boolean) FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION public.move_lesson_keep_slot(p_lesson_id uuid, p_target_date date, p_local_day date, p_hold_between boolean) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $wrapper$ DECLARE g uuid;m text;result jsonb; BEGIN BEGIN g:=(SELECT curriculum_goal_id FROM public.lessons WHERE id=p_lesson_id AND user_id=auth.uid()); IF g IS NULL THEN RETURN rooted_private.contained_move_lesson_keep_slot(p_lesson_id,p_target_date,p_local_day,p_hold_between); END IF; PERFORM 1 FROM public.curriculum_goals WHERE id=g AND user_id=auth.uid() FOR UPDATE NOWAIT; IF NOT FOUND THEN RAISE EXCEPTION 'scheduler_owner_refused';END IF; SELECT mode INTO m FROM rooted_private.scheduler_modes WHERE goal_id=g; IF m IS NULL THEN RETURN rooted_private.contained_move_lesson_keep_slot(p_lesson_id,p_target_date,p_local_day,p_hold_between); END IF; RETURN jsonb_build_object('status','invalid','reason','client_upgrade_required'); EXCEPTION WHEN lock_not_available THEN RETURN jsonb_build_object('status','stale','reason','busy'); END; END $wrapper$; REVOKE ALL ON FUNCTION public.move_lesson_keep_slot(uuid, date, date, boolean) FROM PUBLIC,anon,authenticated,service_role; GRANT EXECUTE ON FUNCTION public.move_lesson_keep_slot(uuid, date, date, boolean) TO authenticated,service_role;
DO $$ BEGIN IF (SELECT md5(prosrc) FROM pg_proc WHERE oid='public.move_lesson_to_date(uuid, date)'::regprocedure) IS DISTINCT FROM '1d49673948e1c7d32e81bd56277caee1' THEN RAISE EXCEPTION 'Containment baseline drift: move_lesson_to_date';END IF;END $$;
ALTER FUNCTION public.move_lesson_to_date(uuid, date) SET SCHEMA rooted_private; ALTER FUNCTION rooted_private.move_lesson_to_date(uuid, date) RENAME TO contained_move_lesson_to_date; REVOKE ALL ON FUNCTION rooted_private.contained_move_lesson_to_date(uuid, date) FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION public.move_lesson_to_date(p_lesson_id uuid, p_target_date date) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $wrapper$ DECLARE g uuid;m text;result jsonb; BEGIN BEGIN g:=(SELECT curriculum_goal_id FROM public.lessons WHERE id=p_lesson_id AND user_id=auth.uid()); IF g IS NULL THEN PERFORM rooted_private.contained_move_lesson_to_date(p_lesson_id,p_target_date); RETURN; END IF; PERFORM 1 FROM public.curriculum_goals WHERE id=g AND user_id=auth.uid() FOR UPDATE NOWAIT; IF NOT FOUND THEN RAISE EXCEPTION 'scheduler_owner_refused';END IF; SELECT mode INTO m FROM rooted_private.scheduler_modes WHERE goal_id=g; IF m IS NULL THEN PERFORM rooted_private.contained_move_lesson_to_date(p_lesson_id,p_target_date); RETURN; END IF; RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='scheduler_client_upgrade_required', HINT='Reload and review the schedule before retrying.'; EXCEPTION WHEN lock_not_available THEN RAISE; END; END $wrapper$; REVOKE ALL ON FUNCTION public.move_lesson_to_date(uuid, date) FROM PUBLIC,anon,authenticated,service_role; GRANT EXECUTE ON FUNCTION public.move_lesson_to_date(uuid, date) TO authenticated,service_role;
DO $$ BEGIN IF (SELECT md5(prosrc) FROM pg_proc WHERE oid='public.reopen_lesson(uuid, date)'::regprocedure) IS DISTINCT FROM '85752dd922bc2b31012f7202b72f09f1' THEN RAISE EXCEPTION 'Containment baseline drift: reopen_lesson';END IF;END $$;
ALTER FUNCTION public.reopen_lesson(uuid, date) SET SCHEMA rooted_private; ALTER FUNCTION rooted_private.reopen_lesson(uuid, date) RENAME TO contained_reopen_lesson; REVOKE ALL ON FUNCTION rooted_private.contained_reopen_lesson(uuid, date) FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION public.reopen_lesson(p_lesson_id uuid, p_local_day date) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $wrapper$ DECLARE g uuid;m text;result jsonb; BEGIN BEGIN g:=(SELECT curriculum_goal_id FROM public.lessons WHERE id=p_lesson_id AND user_id=auth.uid()); IF g IS NULL THEN RETURN rooted_private.contained_reopen_lesson(p_lesson_id,p_local_day); END IF; PERFORM 1 FROM public.curriculum_goals WHERE id=g AND user_id=auth.uid() FOR UPDATE NOWAIT; IF NOT FOUND THEN RAISE EXCEPTION 'scheduler_owner_refused';END IF; SELECT mode INTO m FROM rooted_private.scheduler_modes WHERE goal_id=g; IF m IS NULL THEN RETURN rooted_private.contained_reopen_lesson(p_lesson_id,p_local_day); END IF; IF m='paused' AND NOT (false) THEN RETURN jsonb_build_object('status','invalid','reason','scheduler_paused');END IF; PERFORM 1 FROM public.lessons WHERE curriculum_goal_id=g ORDER BY id FOR UPDATE NOWAIT; PERFORM 1 FROM public.profiles WHERE id=auth.uid() FOR SHARE NOWAIT; LOCK TABLE public.vacation_blocks IN SHARE MODE NOWAIT; PERFORM rooted_private.scheduler_allow(g,'reopen_lesson',ARRAY(SELECT id FROM public.lessons WHERE curriculum_goal_id=g),ARRAY['date','scheduled_date','scheduled_source','queue_position','queue_pinned','queue_preserved','completed','completed_at','skipped','is_backfill'],ARRAY['current_lesson','total_lessons','start_date','start_at_lesson','target_date','school_days','lessons_per_day','lessons_per_day_overrides','placement_mode','completed_at'],'{}'::uuid[],'[]'::jsonb); result:=rooted_private.contained_reopen_lesson(p_lesson_id,p_local_day); PERFORM rooted_private.scheduler_disallow(g); RETURN result; EXCEPTION WHEN lock_not_available THEN RETURN jsonb_build_object('status','stale','reason','busy'); END; END $wrapper$; REVOKE ALL ON FUNCTION public.reopen_lesson(uuid, date) FROM PUBLIC,anon,authenticated,service_role; GRANT EXECUTE ON FUNCTION public.reopen_lesson(uuid, date) TO authenticated,service_role;
DO $$ BEGIN IF (SELECT md5(prosrc) FROM pg_proc WHERE oid='public.restore_queue_book_order(uuid, date)'::regprocedure) IS DISTINCT FROM '66e870fb2f447c9e5f60e41cae18d4e5' THEN RAISE EXCEPTION 'Containment baseline drift: restore_queue_book_order';END IF;END $$;
ALTER FUNCTION public.restore_queue_book_order(uuid, date) SET SCHEMA rooted_private; ALTER FUNCTION rooted_private.restore_queue_book_order(uuid, date) RENAME TO contained_restore_queue_book_order; REVOKE ALL ON FUNCTION rooted_private.contained_restore_queue_book_order(uuid, date) FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION public.restore_queue_book_order(p_goal_id uuid, p_local_day date) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $wrapper$ DECLARE g uuid;m text;result jsonb; BEGIN BEGIN g:=p_goal_id; IF g IS NULL THEN RETURN rooted_private.contained_restore_queue_book_order(p_goal_id,p_local_day); END IF; PERFORM 1 FROM public.curriculum_goals WHERE id=g AND user_id=auth.uid() FOR UPDATE NOWAIT; IF NOT FOUND THEN RAISE EXCEPTION 'scheduler_owner_refused';END IF; SELECT mode INTO m FROM rooted_private.scheduler_modes WHERE goal_id=g; IF m IS NULL THEN RETURN rooted_private.contained_restore_queue_book_order(p_goal_id,p_local_day); END IF; RETURN jsonb_build_object('status','invalid','reason','client_upgrade_required'); EXCEPTION WHEN lock_not_available THEN RETURN jsonb_build_object('status','stale','reason','busy'); END; END $wrapper$; REVOKE ALL ON FUNCTION public.restore_queue_book_order(uuid, date) FROM PUBLIC,anon,authenticated,service_role; GRANT EXECUTE ON FUNCTION public.restore_queue_book_order(uuid, date) TO authenticated,service_role;
DO $$ BEGIN IF (SELECT md5(prosrc) FROM pg_proc WHERE oid='public.undo_cascade_shift(uuid)'::regprocedure) IS DISTINCT FROM '991b676c0d3c282810cc2d3e300103e7' THEN RAISE EXCEPTION 'Containment baseline drift: undo_cascade_shift';END IF;END $$;
ALTER FUNCTION public.undo_cascade_shift(uuid) SET SCHEMA rooted_private; ALTER FUNCTION rooted_private.undo_cascade_shift(uuid) RENAME TO contained_undo_cascade_shift; REVOKE ALL ON FUNCTION rooted_private.contained_undo_cascade_shift(uuid) FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION public.undo_cascade_shift(p_operation_id uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $wrapper$ DECLARE g uuid;m text;result jsonb; BEGIN BEGIN g:=(SELECT goal_id FROM rooted_private.cascade_shift_receipts WHERE id=p_operation_id AND user_id=auth.uid()); IF g IS NULL THEN RETURN rooted_private.contained_undo_cascade_shift(p_operation_id); END IF; PERFORM 1 FROM public.curriculum_goals WHERE id=g AND user_id=auth.uid() FOR UPDATE NOWAIT; IF NOT FOUND THEN RAISE EXCEPTION 'scheduler_owner_refused';END IF; SELECT mode INTO m FROM rooted_private.scheduler_modes WHERE goal_id=g; IF m IS NULL THEN RETURN rooted_private.contained_undo_cascade_shift(p_operation_id); END IF; IF m='paused' AND NOT (true) THEN RETURN jsonb_build_object('status','invalid','reason','scheduler_paused');END IF; PERFORM 1 FROM public.lessons WHERE curriculum_goal_id=g ORDER BY id FOR UPDATE NOWAIT; PERFORM 1 FROM public.profiles WHERE id=auth.uid() FOR SHARE NOWAIT; LOCK TABLE public.vacation_blocks IN SHARE MODE NOWAIT; PERFORM 1 FROM rooted_private.cascade_shift_receipts WHERE id=p_operation_id AND user_id=auth.uid() FOR UPDATE NOWAIT; IF NOT pg_try_advisory_xact_lock(hashtextextended(p_operation_id::text,0)) THEN RAISE lock_not_available;END IF; PERFORM rooted_private.scheduler_allow(g,'undo_cascade_shift',ARRAY(SELECT (x->>'id')::uuid FROM rooted_private.cascade_shift_receipts r,jsonb_array_elements(r.moves) x WHERE r.id=p_operation_id),ARRAY['date','scheduled_date','scheduled_source','queue_pinned','queue_preserved'],'{}'::text[],'{}'::uuid[],'[]'::jsonb); result:=rooted_private.contained_undo_cascade_shift(p_operation_id); PERFORM rooted_private.scheduler_disallow(g); RETURN result; EXCEPTION WHEN lock_not_available THEN RETURN jsonb_build_object('status','stale','reason','busy'); END; END $wrapper$; REVOKE ALL ON FUNCTION public.undo_cascade_shift(uuid) FROM PUBLIC,anon,authenticated,service_role; GRANT EXECUTE ON FUNCTION public.undo_cascade_shift(uuid) TO authenticated;

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
  PERFORM 1 FROM public.lessons WHERE curriculum_goal_id=p_goal_id ORDER BY id FOR UPDATE NOWAIT;
  PERFORM 1 FROM public.profiles WHERE id=u FOR SHARE NOWAIT;
  LOCK TABLE public.vacation_blocks IN SHARE MODE NOWAIT;
  have:=rooted_private.scheduler_state(p_goal_id);
  IF have IS DISTINCT FROM p_expected THEN RETURN jsonb_build_object('status','stale','reason','schedule_changed');END IF;
  SELECT * INTO r FROM public.lessons WHERE id=(CASE WHEN kind='set_skipped' THEN p_action->'lessonIds'->>0 ELSE p_action->>'lessonId' END)::uuid AND curriculum_goal_id=p_goal_id AND user_id=u;
  IF NOT FOUND THEN RETURN jsonb_build_object('status','invalid','reason','lesson');END IF;
  ids:=ARRAY(SELECT id FROM public.lessons WHERE curriculum_goal_id=p_goal_id);
  IF kind IS NULL OR kind NOT IN ('single_move','complete','skip','delete','set_skipped') THEN RETURN jsonb_build_object('status','invalid','reason','action');END IF;
  fields:=CASE kind WHEN 'single_move' THEN ARRAY['date','scheduled_date','scheduled_source','queue_position','queue_pinned'] WHEN 'complete' THEN ARRAY['date','scheduled_date','scheduled_source','queue_pinned','completed','completed_at','is_backfill'] WHEN 'set_skipped' THEN ARRAY['skipped','date','scheduled_date','queue_pinned','scheduled_source'] WHEN 'skip' THEN ARRAY['skipped','scheduled_date','queue_pinned'] ELSE ARRAY['scheduled_date'] END;
  -- Scope includes preexisting rows only: reviewed pointer cleanup can unschedule
  -- earlier orphan rows. No insert, reassignment or arbitrary content capability.
  PERFORM rooted_private.scheduler_allow(p_goal_id,kind,ids,fields,ARRAY['current_lesson','completed_at'],CASE WHEN kind='delete' THEN ARRAY[r.id] ELSE '{}'::uuid[] END);
  IF kind='single_move' THEN
   IF r.completed OR r.skipped OR r.queue_preserved OR p_action->>'targetDate' IS NULL THEN PERFORM rooted_private.scheduler_disallow(p_goal_id); RETURN jsonb_build_object('status','invalid','reason','protected_lesson');END IF;
   IF (p_action->>'localDay')::date IS DISTINCT FROM (now() AT TIME ZONE (SELECT timezone FROM public.profiles WHERE id=u))::date THEN PERFORM rooted_private.scheduler_disallow(p_goal_id); RETURN jsonb_build_object('status','invalid','reason','local_day');END IF;
   IF (p_action->>'targetDate')::date>coalesce(r.scheduled_date,r.date) AND r.queue_position IS NOT NULL THEN
    result:=rooted_private.contained_move_lesson_keep_slot(r.id,(p_action->>'targetDate')::date,(p_action->>'localDay')::date,true);
    IF result->>'status' IS DISTINCT FROM 'moved' THEN RAISE EXCEPTION 'scheduler_move_refused';END IF;
   ELSE
    PERFORM rooted_private.contained_move_lesson_to_date(r.id,(p_action->>'targetDate')::date);
   END IF;
   IF NOT EXISTS(SELECT 1 FROM public.lessons WHERE id=r.id AND date=(p_action->>'targetDate')::date AND scheduled_date=(p_action->>'targetDate')::date) THEN RAISE EXCEPTION 'scheduler_move_postcondition';END IF;
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
  -- Only fields needed for move/skip Undo are retained; never notes or titles.
  SELECT jsonb_build_object('goal',jsonb_build_object('current_lesson',have->'goal'->'current_lesson','completed_at',have->'goal'->'completed_at'),'rows',jsonb_agg((SELECT jsonb_object_agg(k,v) FROM jsonb_each(x) e(k,v) WHERE k=ANY(ARRAY['id','date','scheduled_date','scheduled_source','queue_position','queue_pinned','queue_preserved','completed','completed_at','skipped','is_backfill'])))) INTO undo_state FROM jsonb_array_elements(have->'rows') x;
  IF kind NOT IN ('single_move','skip','set_skipped') THEN undo_state:=NULL;END IF;
  result:=jsonb_build_object('status','applied','operationId',p_operation_id,'held',coalesce(jsonb_array_length(result->'held'),0));
  INSERT INTO rooted_private.scheduler_action_receipts(id,user_id,goal_id,request_hash,before_state,after_hash,result) VALUES(p_operation_id,u,p_goal_id,request_hash,undo_state,rooted_private.scheduler_hash(after_state),result);
  RETURN result;
 EXCEPTION WHEN lock_not_available THEN RETURN jsonb_build_object('status','busy','reason','busy');END;
EXCEPTION WHEN invalid_text_representation OR datetime_field_overflow OR invalid_datetime_format OR check_violation OR not_null_violation THEN RETURN jsonb_build_object('status','invalid','reason','shape');
END $$;
CREATE FUNCTION public.undo_scheduler_action(p_operation_id uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE r rooted_private.scheduler_action_receipts%rowtype;s jsonb;w jsonb;fields text[]:=ARRAY['date','scheduled_date','scheduled_source','queue_position','queue_pinned','queue_preserved','completed','completed_at','skipped','is_backfill'];
BEGIN
 BEGIN
  IF auth.uid() IS NULL THEN RETURN jsonb_build_object('status','invalid','reason','owner');END IF;
  IF NOT pg_try_advisory_xact_lock(hashtextextended(p_operation_id::text,0)) THEN RAISE lock_not_available;END IF;
  SELECT * INTO r FROM rooted_private.scheduler_action_receipts WHERE id=p_operation_id AND user_id=auth.uid() FOR UPDATE NOWAIT;
  IF NOT FOUND THEN RETURN jsonb_build_object('status','invalid','reason','operation');END IF;
  IF r.undone_at IS NOT NULL THEN RETURN jsonb_build_object('status','already_undone');END IF;
  IF r.before_state IS NULL OR clock_timestamp()>r.created_at+interval '10 minutes' THEN RETURN jsonb_build_object('status','invalid','reason','expired');END IF;
  PERFORM 1 FROM public.curriculum_goals WHERE id=r.goal_id AND user_id=auth.uid() FOR UPDATE NOWAIT;
  PERFORM 1 FROM public.lessons WHERE curriculum_goal_id=r.goal_id ORDER BY id FOR UPDATE NOWAIT;
  LOCK TABLE public.vacation_blocks IN SHARE MODE NOWAIT;
  s:=rooted_private.scheduler_state(r.goal_id);
  IF rooted_private.scheduler_hash(s)<>r.after_hash THEN RETURN jsonb_build_object('status','stale','reason','later_edit');END IF;
  PERFORM rooted_private.scheduler_allow(r.goal_id,'undo',ARRAY(SELECT (x->>'id')::uuid FROM jsonb_array_elements(r.before_state->'rows') x),fields,ARRAY['current_lesson','completed_at']);
  -- Clear changed slots first so restoring a legacy earlier move cannot collide.
  UPDATE public.lessons l SET queue_position=NULL FROM jsonb_array_elements(r.before_state->'rows') x WHERE l.id=(x->>'id')::uuid AND to_jsonb(l.queue_position) IS DISTINCT FROM x->'queue_position';
  FOR w IN SELECT * FROM jsonb_array_elements(r.before_state->'rows') LOOP
   UPDATE public.lessons SET date=(w->>'date')::date,scheduled_date=(w->>'scheduled_date')::date,scheduled_source=w->>'scheduled_source',queue_position=(w->>'queue_position')::integer,queue_pinned=(w->>'queue_pinned')::boolean,queue_preserved=(w->>'queue_preserved')::boolean,completed=(w->>'completed')::boolean,completed_at=(w->>'completed_at')::timestamptz,skipped=(w->>'skipped')::boolean,is_backfill=(w->>'is_backfill')::boolean WHERE id=(w->>'id')::uuid AND EXISTS(SELECT 1 FROM jsonb_each(w) e WHERE e.key<>'id' AND to_jsonb(lessons)->e.key IS DISTINCT FROM e.value);
  END LOOP;
  UPDATE public.curriculum_goals SET current_lesson=(r.before_state->'goal'->>'current_lesson')::integer,completed_at=(r.before_state->'goal'->>'completed_at')::timestamptz WHERE id=r.goal_id AND (current_lesson IS DISTINCT FROM (r.before_state->'goal'->>'current_lesson')::integer OR completed_at IS DISTINCT FROM (r.before_state->'goal'->>'completed_at')::timestamptz);
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

-- SOURCE: recalibration.sql
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
  LOCK TABLE public.vacation_blocks IN SHARE MODE NOWAIT;
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
  -- newly created goals. These are intentionally wider than per-goal actions.
  LOCK TABLE public.curriculum_goals IN SHARE MODE NOWAIT;
  FOR g IN SELECT id FROM public.curriculum_goals WHERE user_id=owner_id ORDER BY id FOR UPDATE NOWAIT LOOP NULL;END LOOP;
  LOCK TABLE public.lessons IN SHARE ROW EXCLUSIVE MODE NOWAIT;
  PERFORM 1 FROM public.lessons WHERE user_id=owner_id ORDER BY id FOR UPDATE NOWAIT;
  PERFORM 1 FROM public.profiles WHERE id=owner_id FOR UPDATE NOWAIT;
  LOCK TABLE public.vacation_blocks IN SHARE ROW EXCLUSIVE MODE NOWAIT;
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
  LOCK TABLE public.curriculum_goals IN SHARE MODE NOWAIT;
  FOR g IN SELECT id FROM public.curriculum_goals WHERE user_id=owner_id ORDER BY id FOR UPDATE NOWAIT LOOP NULL;END LOOP;
  LOCK TABLE public.lessons IN SHARE ROW EXCLUSIVE MODE NOWAIT;
  PERFORM 1 FROM public.lessons WHERE user_id=owner_id ORDER BY id FOR UPDATE NOWAIT;
  PERFORM 1 FROM public.profiles WHERE id=owner_id FOR UPDATE NOWAIT;
  LOCK TABLE public.vacation_blocks IN SHARE ROW EXCLUSIVE MODE NOWAIT;
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
  UPDATE rooted_private.scheduler_action_receipts SET undone_at=clock_timestamp(),result=(result-'row')||jsonb_build_object('rowId',row_id) WHERE id=r.id;
  RETURN jsonb_build_object('status','undone');
 EXCEPTION WHEN lock_not_available THEN RETURN jsonb_build_object('status','busy');END;
END $$;
REVOKE ALL ON FUNCTION public.undo_scheduler_continuation(uuid) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.undo_scheduler_continuation(uuid) TO authenticated;

COMMIT;
