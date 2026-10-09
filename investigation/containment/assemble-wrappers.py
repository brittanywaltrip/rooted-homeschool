from pathlib import Path
import json,re
root=Path(__file__).resolve().parents[2]
fs=json.loads((root/'investigation/containment/baseline-functions.json').read_text())
rowsfields="ARRAY['date','scheduled_date','scheduled_source','queue_position','queue_pinned','queue_preserved','completed','completed_at','skipped','is_backfill']"
gfields="ARRAY['current_lesson','total_lessons','start_date','start_at_lesson','target_date','school_days','lessons_per_day','lessons_per_day_overrides','placement_mode','completed_at']"
out=[]
for f in fs:
 name=f['name'];args=f['args'];ident=f['identity'];types=', '.join(s.strip().split(' ',1)[1] for s in ident.split(','));call=','.join(s.strip().split()[0] for s in ident.split(',')); sig=f'public.{name}({types})';inner=f'rooted_private.contained_{name}'
 out.append(f"DO $$ BEGIN IF (SELECT md5(prosrc) FROM pg_proc WHERE oid='{sig}'::regprocedure) IS DISTINCT FROM '{f['md5']}' THEN RAISE EXCEPTION 'Containment baseline drift: {name}';END IF;END $$;")
 out.append(f'ALTER FUNCTION {sig} SET SCHEMA rooted_private; ALTER FUNCTION rooted_private.{name}({types}) RENAME TO contained_{name}; REVOKE ALL ON FUNCTION {inner}({types}) FROM PUBLIC,anon,authenticated,service_role;')
 # Preserve inherited function bodies except their global vacation membership
 # lock: row triggers and the public wrapper now hold the owner barrier.
 if name in ('commit_cascade_shift','undo_cascade_shift'):
  definition=f['definition'].replace('public.'+name+'(',inner+'(').replace('lock table public.vacation_blocks in share mode;', 'PERFORM rooted_private.scheduler_lock_owner(auth.uid(),false);')
  out.append(definition.rstrip().rstrip(';')+';')
 # 4-arg Builder routes through guarded 5-arg public overload (no nested cap).
 if name=='apply_builder_rebuild' and len(ident.split(','))==4:
  body='RETURN public.apply_builder_rebuild(p_goal_id,p_local_day,p_expected,p_plan,NULL);'
 else:
  goal="p_goal_id" if 'p_goal_id' in ident else "(SELECT curriculum_goal_id FROM public.lessons WHERE id=p_lesson_id AND user_id=auth.uid())" if 'p_lesson_id' in ident else "(SELECT goal_id FROM rooted_private.cascade_shift_receipts WHERE id=p_operation_id AND user_id=auth.uid())"
  invoke=f'{inner}({call})'
  direct='PERFORM '+invoke+'; RETURN;' if f['result']=='void' else 'RETURN '+invoke+';'
  body=f'PERFORM rooted_private.scheduler_lock_owner(auth.uid(),false); g:={goal}; IF g IS NULL THEN {direct} END IF; PERFORM 1 FROM public.curriculum_goals WHERE id=g AND user_id=auth.uid() FOR UPDATE NOWAIT; IF NOT FOUND THEN RAISE EXCEPTION \'scheduler_owner_refused\';END IF; SELECT mode INTO m FROM rooted_private.scheduler_modes WHERE goal_id=g; IF m IS NULL THEN {direct} END IF;'
  body+=' PERFORM rooted_private.scheduler_lock_owner(auth.uid(),false);'
  if name in ('move_lesson_keep_slot','move_lesson_to_date','restore_queue_book_order'):
   # restore order is a multistage recalibration's first write; block until replacement.
   body += " RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='scheduler_client_upgrade_required', HINT='Reload and review the schedule before retrying.';" if f['result']=='void' else " RETURN jsonb_build_object('status','invalid','reason','client_upgrade_required');"
  else:
   replay='false'
   if name=='commit_cascade_shift':replay="EXISTS(SELECT 1 FROM rooted_private.cascade_shift_receipts WHERE id=p_operation_id AND user_id=auth.uid())"
   if name=='undo_cascade_shift':replay='true'
   if name=='apply_builder_rebuild':replay="EXISTS(SELECT 1 FROM rooted_private.builder_commit_log WHERE request_id=(p_plan->>'request_id')::uuid AND user_id=auth.uid())"
   body+=f" IF m='paused' AND NOT ({replay}) THEN RETURN jsonb_build_object('status','invalid','reason','scheduler_paused');END IF; PERFORM 1 FROM public.lessons WHERE curriculum_goal_id=g ORDER BY id FOR UPDATE NOWAIT; PERFORM 1 FROM public.profiles WHERE id=auth.uid() FOR SHARE NOWAIT; PERFORM rooted_private.scheduler_lock_owner(auth.uid(),false);"
   if name=='undo_cascade_shift':body+=" PERFORM 1 FROM rooted_private.cascade_shift_receipts WHERE id=p_operation_id AND user_id=auth.uid() FOR UPDATE NOWAIT;"
   if 'p_operation_id' in ident:body+=" IF NOT pg_try_advisory_xact_lock(hashtextextended(p_operation_id::text,0)) THEN RAISE lock_not_available;END IF;"
   ids="ARRAY(SELECT id FROM public.lessons WHERE curriculum_goal_id=g)";fields=rowsfields;goalf=gfields;deletes="'{}'::uuid[]";ins="'[]'::jsonb"
   if name=='commit_cascade_shift':ids="ARRAY(SELECT (x->>'id')::uuid FROM jsonb_array_elements(p_moves||p_preserved) x)";fields="ARRAY['date','scheduled_date','scheduled_source','queue_pinned','queue_preserved']";goalf="'{}'::text[]"
   if name=='undo_cascade_shift':ids="ARRAY(SELECT (x->>'id')::uuid FROM rooted_private.cascade_shift_receipts r,jsonb_array_elements(r.moves) x WHERE r.id=p_operation_id)";fields="ARRAY['date','scheduled_date','scheduled_source','queue_pinned','queue_preserved']";goalf="'{}'::text[]"
   if name=='apply_daily_reconcile':ids="ARRAY(SELECT (x->>'id')::uuid FROM jsonb_array_elements(p_writes) x)";fields="ARRAY['date','scheduled_date','scheduled_source']";goalf="'{}'::text[]"
   if name=='apply_builder_rebuild':
    deletes=ids
    ins="coalesce((SELECT jsonb_agg(jsonb_build_object('lesson_number',x->'lesson_number','queue_position',x->'queue_position','title',x->'title','scheduled_date',x->'scheduled_date','date',x->'scheduled_date','scheduled_source','wizard_create')) FROM jsonb_array_elements(p_plan->'inserts') x),'[]'::jsonb)"
   body+=f" PERFORM rooted_private.scheduler_allow(g,'{name}',{ids},{fields},{goalf},{deletes},{ins}); result:={invoke}; PERFORM rooted_private.scheduler_disallow(g); RETURN result;"
  body="BEGIN "+body+" EXCEPTION WHEN lock_not_available THEN "+("RAISE;" if f['result']=='void' else "RETURN jsonb_build_object('status','stale','reason','busy');")+" END;"
 roles='authenticated,service_role' if name in ('apply_builder_rebuild','reopen_lesson','restore_queue_book_order','move_lesson_keep_slot','move_lesson_to_date') else 'authenticated'
 out.append(f"CREATE FUNCTION public.{name}({args}) RETURNS {f['result']} LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $wrapper$ DECLARE g uuid;m text;result jsonb; BEGIN {body} END $wrapper$; REVOKE ALL ON FUNCTION {sig} FROM PUBLIC,anon,authenticated,service_role; GRANT EXECUTE ON FUNCTION {sig} TO {roles};")
(root/'investigation/containment/wrappers.sql').write_text('\n'.join(out)+'\n')
