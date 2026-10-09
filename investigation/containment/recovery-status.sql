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
