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
  LOCK TABLE public.curriculum_goals,public.lessons IN ROW EXCLUSIVE MODE NOWAIT;
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
