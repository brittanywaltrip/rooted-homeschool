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
CREATE TABLE rooted_private.scheduler_capabilities(tx bigint NOT NULL,goal_id uuid NOT NULL,owner_id uuid NOT NULL,operation text NOT NULL,row_ids uuid[] NOT NULL,lesson_fields text[] NOT NULL,goal_fields text[] NOT NULL,delete_ids uuid[] NOT NULL DEFAULT '{}',insert_shapes jsonb NOT NULL DEFAULT '[]',PRIMARY KEY(tx,goal_id));
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
   IF NOT (OLD.id=ANY(c.row_ids)) OR NOT changed <@ c.lesson_fields OR (OLD.curriculum_goal_id IS DISTINCT FROM NEW.curriculum_goal_id AND NOT (c.operation='goal_delete' AND NEW.curriculum_goal_id IS NULL)) OR OLD.user_id IS DISTINCT FROM NEW.user_id THEN RAISE EXCEPTION 'scheduler_row_scope_refused';END IF;
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
