from pathlib import Path
import json,hashlib,re
r=Path(__file__).resolve().parents[2]
manifest=json.loads((r/'investigation/release-package/baseline.json').read_text())
sources=['cascade_shift_atomic.sql','preserved_cleanup_guard.sql','preserved_daily_reconcile.sql','remaining_completion_locks.sql']
pre=["-- Generated from reviewed a10838ae proposals. Local packaging only; not rollout authorization.","-- Requires the reviewed PR146/goal-guard stack and existing completion/move functions.","BEGIN;","SET LOCAL lock_timeout='5s';","SET LOCAL statement_timeout='60s';","DO $preflight$ BEGIN", "IF to_regclass('rooted_private.cascade_shift_receipts') IS NOT NULL OR EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid='public.lessons'::regclass AND attname='queue_preserved' AND NOT attisdropped) THEN RAISE EXCEPTION 'Unexpected preexisting cascade/preservation schema; reconcile instead of replay'; END IF;", "IF to_regclass('rooted_private.builder_commit_log') IS NULL OR to_regclass('rooted_private.daily_reconcile_log') IS NULL OR to_regclass('rooted_private.app_switches') IS NULL THEN RAISE EXCEPTION 'Missing reviewed Builder/daily dependencies'; END IF;"]
for f in manifest['new_functions']:
 sig=f['signature'];md5=f['body_md5']
 pre.append("IF (SELECT md5(prosrc) FROM pg_proc WHERE oid=to_regprocedure('%s')) IS DISTINCT FROM '%s' THEN RAISE EXCEPTION 'Baseline function drift: %s'; END IF;"%(sig,md5,sig))
pre.append('END $preflight$;')
# Match the reviewed receipt-table isolation on a production-derived baseline.
pre.append('ALTER TABLE rooted_private.builder_commit_log ENABLE ROW LEVEL SECURITY;')
chunks=[]
for name in sources:
 s=(r/'supabase/proposals'/name).read_text();s=re.sub(r'(?m)^BEGIN;\s*$','',s);s=re.sub(r'(?m)^COMMIT;\s*$','',s)
 chunks.append('-- SOURCE: supabase/proposals/'+name+'\n'+s)
post="""DO $postflight$ BEGIN
IF NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid='public.lessons'::regclass AND attname='queue_preserved' AND atttypid='boolean'::regtype AND attnotnull) THEN RAISE EXCEPTION 'Missing preservation column'; END IF;
IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid='rooted_private.cascade_shift_receipts'::regclass) OR has_table_privilege('authenticated','rooted_private.cascade_shift_receipts','SELECT') OR has_table_privilege('anon','rooted_private.cascade_shift_receipts','SELECT') THEN RAISE EXCEPTION 'Private receipt access mismatch'; END IF;
IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid='public.lessons'::regclass AND tgname='guard_preserved_work' AND NOT tgisinternal) THEN RAISE EXCEPTION 'Missing preservation guard'; END IF;
END $postflight$;
COMMIT;
"""
p=next((r/'supabase/migrations').glob('*_kandl_preserved_cascade_and_completion_locks.sql'))
p.write_text('\n'.join(pre)+'\n\n'+'\n\n'.join(chunks)+'\n'+post)
meta={'base_commit':'a10838ae366b33eee0060be694e47d947d9dc5c2','migration':str(p.relative_to(r)),'sources':{n:hashlib.sha256((r/'supabase/proposals'/n).read_bytes()).hexdigest() for n in sources},'migration_sha256':hashlib.sha256(p.read_bytes()).hexdigest(),'baseline_functions':[{'signature':f['signature'],'body_md5':f['body_md5']} for f in manifest['new_functions']],'not_remote_apply_authorization':True}
(r/'investigation/release-package/manifest.json').write_text(json.dumps(meta,indent=2))
print(json.dumps(meta,indent=2))
