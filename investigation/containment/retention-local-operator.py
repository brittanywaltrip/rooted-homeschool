"""Bounded local operator rehearsal. Hard-wired to isolated Colima; no scheduler installed."""
import argparse,json,subprocess,time
D=['/Users/brittanywaltrip/.docker/bin/docker','--host','unix:///Users/brittanywaltrip/.colima/rooted-isolated/docker.sock']
a=argparse.ArgumentParser();a.add_argument('--batch',type=int,default=500);a.add_argument('--rounds',type=int,default=3);args=a.parse_args()
assert 1<=args.batch<=2000 and 1<=args.rounds<=20
info=json.loads(subprocess.check_output(D+['inspect','supabase_db_rooted-isolated-local'],text=True))[0]
assert list(info['NetworkSettings']['Networks'])==['rooted-isolated-loopback']
assert info['NetworkSettings']['Ports']['5432/tcp']==[{'HostIp':'127.0.0.1','HostPort':'54322'}]
def sql(q):return subprocess.check_output(D+['exec','supabase_db_rooted-isolated-local','psql','-X','-qAt','-U','postgres','-d','rooted_containment_rehearsal','-v','ON_ERROR_STOP=1','-c',q],text=True).strip()
count="""SELECT jsonb_build_object('remaining',(SELECT count(*) FROM rooted_private.scheduler_action_receipts WHERE (created_at<clock_timestamp()-interval '10 minutes' OR undone_at IS NOT NULL) AND (before_state IS NOT NULL OR result?'row'))+(SELECT count(*) FROM rooted_private.scheduler_calendar_receipts WHERE (created_at<clock_timestamp()-interval '10 minutes' OR undone_at IS NOT NULL) AND (before_state IS NOT NULL OR after_state IS NOT NULL)));"""
for i in range(args.rounds):
 start=time.monotonic();changed=json.loads(sql(f"BEGIN; SET LOCAL statement_timeout='3s'; SET LOCAL lock_timeout='100ms'; SELECT rooted_private.expire_scheduler_receipts({args.batch}); COMMIT;"));backlog=json.loads(sql(count))
 print(json.dumps({'iteration':i+1,'scrubbed':changed,**backlog,'elapsed_ms':round((time.monotonic()-start)*1000),'alert':backlog['remaining']>0}),flush=True)
 if not backlog['remaining']:break
# Nonzero status lets an actual future privileged operator detect a backlog.
raise SystemExit(2 if backlog['remaining'] else 0)
