"""Read-only exact catalog comparison: installed fixture DB vs empty full migration rehearsal."""
import json,subprocess
from pathlib import Path
D=['/Users/brittanywaltrip/.docker/bin/docker','--host','unix:///Users/brittanywaltrip/.colima/rooted-isolated/docker.sock']
info=json.loads(subprocess.check_output(D+['inspect','supabase_db_rooted-isolated-local'],text=True))[0]
assert list(info['NetworkSettings']['Networks'])==['rooted-isolated-loopback']
q="""SELECT jsonb_agg(jsonb_build_object('schema',n.nspname,'name',p.proname,'args',pg_get_function_identity_arguments(p.oid),'body',md5(p.prosrc),'definer',p.prosecdef,'config',p.proconfig,'acl',p.proacl::text) ORDER BY n.nspname,p.proname,pg_get_function_identity_arguments(p.oid)) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE (n.nspname='rooted_private' AND (p.proname LIKE 'scheduler_%' OR p.proname LIKE 'contained_%' OR p.proname LIKE 'calendar_%' OR p.proname IN ('set_scheduler_mode','expire_scheduler_undo','expire_scheduler_receipts'))) OR (n.nspname='public' AND (p.proname LIKE '%scheduler%' OR p.proname='curriculum_goals_cleanup_orphans_trg' OR p.proname IN ('apply_builder_rebuild','apply_daily_reconcile','commit_cascade_shift','undo_cascade_shift','move_lesson_keep_slot','move_lesson_to_date','restore_queue_book_order','reopen_lesson')));"""
def query(db,q):return json.loads(subprocess.check_output(D+['exec','supabase_db_rooted-isolated-local','psql','-X','-qAt','-U','postgres','-d',db,'-v','ON_ERROR_STOP=1','-c',q],text=True))
a=query('postgres',q);b=query('rooted_containment_rehearsal',q)
assert a==b,[(x,y) for x,y in zip(a,b) if x!=y]
print('PASS exact function body/security/search-path/ACL comparison:',len(a),'functions')
q="SELECT jsonb_agg(jsonb_build_object('name',relname,'rls',relrowsecurity,'acl',relacl::text) ORDER BY relname) FROM pg_class WHERE relnamespace='rooted_private'::regnamespace AND relname IN ('scheduler_modes','scheduler_capabilities','scheduler_action_receipts','scheduler_calendar_receipts');"
assert query('postgres',q)==query('rooted_containment_rehearsal',q)
print('PASS four private table RLS/ACL definitions match')
q="SELECT jsonb_build_object('modes',(SELECT count(*) FROM rooted_private.scheduler_modes),'capabilities',(SELECT count(*) FROM rooted_private.scheduler_capabilities));"
r=query('postgres',q);assert r=={'modes':0,'capabilities':0},r
print('PASS no active synthetic cohorts or reusable capabilities remain')
