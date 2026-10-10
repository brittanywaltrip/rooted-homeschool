"""Only disposable local DB cloned from installed live-chain template; no migrations."""
from pathlib import Path
import subprocess,json,uuid,datetime,threading,queue
B=Path(__file__).parent;R=B.parents[1]
D=['/Users/brittanywaltrip/.docker/bin/docker','--host','unix:///Users/brittanywaltrip/.colima/rooted-isolated/docker.sock']
meta=json.loads(subprocess.check_output(D+['inspect','supabase_db_rooted-isolated-local'],text=True))[0]
assert list(meta['NetworkSettings']['Networks'])==['rooted-isolated-loopback'];assert meta['NetworkSettings']['Ports']['5432/tcp']==[{'HostIp':'127.0.0.1','HostPort':'54322'}]
D+=['exec','-i','supabase_db_rooted-isolated-local','psql','-X','-qAt','-U','postgres','-v','ON_ERROR_STOP=1']
DB='rooted_resume_release_'+uuid.uuid4().hex[:8];checks=[]
def sql(q,db=None,fail=False):
 p=subprocess.run(D+['-d',db or DB],input=q,text=True,capture_output=True)
 if fail:assert p.returncode!=0,p.stdout
 else:assert p.returncode==0,p.stderr
 return p.stdout.strip()
def lit(x):return "'"+str(x).replace("'","''")+"'"
def jb(x):return lit(json.dumps(x))+'::jsonb'
def rpc(name,args,u):
 q='BEGIN;SET LOCAL ROLE authenticated;SET LOCAL request.jwt.claims='+lit(json.dumps({'sub':u,'role':'authenticated'}))+';SELECT public.'+name+'('+','.join(args)+');COMMIT;'
 return json.loads(sql(q))
def state(g):return json.loads(sql(f"SELECT rooted_private.scheduler_state('{g}')"))
def mark(s):checks.append(s);print('PASS '+s,flush=True)
sql('CREATE DATABASE '+DB+' TEMPLATE rooted_production_chain_fixed_v2','postgres')
assert sql('SELECT count(*) FROM public.lessons')=='0'
assert sql("SELECT to_regprocedure('public.commit_scheduler_correction(uuid,uuid,uuid,uuid[],text,jsonb)') IS NULL")=='t'
day=datetime.date.fromisoformat(sql("SELECT (now() AT TIME ZONE 'America/Denver')::date"))
def seed():
 u,c,c2,g,other=[str(uuid.uuid4()) for _ in range(5)];ids=[str(uuid.uuid4()) for _ in range(6)];claims=lit(json.dumps({'sub':u,'role':'authenticated'}))
 q=f"BEGIN;SET LOCAL request.jwt.claims={claims};INSERT INTO auth.users(id) VALUES('{u}');INSERT INTO profiles(id,display_name,timezone,school_days) VALUES('{u}','Synthetic release','America/Denver',ARRAY['Mon','Tue','Wed','Thu','Fri','Sat','Sun']);INSERT INTO children(id,user_id,name) VALUES('{c}','{u}','Child A'),('{c2}','{u}','Child B');"
 for goal,child in [(g,c),(other,c2)]:
  q+=f"INSERT INTO curriculum_goals(id,user_id,child_id,curriculum_name,total_lessons,current_lesson,start_at_lesson,start_date,school_days,lessons_per_day) VALUES('{goal}','{u}','{child}','Synthetic release',6,0,1,'{day-datetime.timedelta(days=7)}',ARRAY['Mon','Tue','Wed','Thu','Fri','Sat','Sun'],1);"
  for n in range(1,7):
   id=ids[n-1] if goal==g else str(uuid.uuid4());done=n in [1,3,4];date=day+datetime.timedelta(days=-2 if done else -1 if n==2 else n-2)
   q+=f"INSERT INTO lessons(id,user_id,child_id,curriculum_goal_id,title,date,scheduled_date,lesson_number,queue_position,queue_pinned,queue_preserved,scheduled_source,completed,completed_at,notes,minutes_spent,hours) VALUES('{id}','{u}','{child}','{goal}','Synthetic lesson {n}','{date}','{date}',{n},{n},{str(n==5).lower()},{str(n==2).lower()},'wizard_create',{str(done).lower()},{lit(str(date)+'T18:00:00Z') if done else 'NULL'},{lit('Retained synthetic note') if done else 'NULL'},{30 if done else 'NULL'},{'0.5' if done else '0'});"
  q+=f"UPDATE curriculum_goals SET current_lesson=4 WHERE id='{goal}';INSERT INTO rooted_private.scheduler_modes VALUES('{goal}','atomic_v2');"
 sql(q+'COMMIT;');return {'u':u,'g':g,'other':other,'ids':ids}
def params(f):
 s=rpc('read_scheduler_state',[lit(f['g'])],f['u']);assert s['status']=='ready' and s['mode']=='atomic_v2'
 p=subprocess.run(['/opt/homebrew/bin/node',str(B/'plan.mjs')],input=json.dumps(s),text=True,capture_output=True);assert p.returncode==0,p.stderr;dates=json.loads(p.stdout);assert dates
 return {'op':str(uuid.uuid4()),'expected':s['snapshot'],'dates':dates}
def call(f,p):return rpc('commit_scheduler_recalibration',[lit(p['op']),lit(f['g']),jb(p['expected']),'2',lit(day),'false','ARRAY[]::uuid[]',jb(p['dates'])],f['u'])
f=seed();before=state(f['g']);neighbor=state(f['other']);p=params(f)
# Server rejects a planner mismatch after entering its write transaction.
bad=json.loads(json.dumps(p));bad['dates'][0]['date']=str(day+datetime.timedelta(days=100))
q='BEGIN;SET LOCAL ROLE authenticated;SET LOCAL request.jwt.claims='+lit(json.dumps({'sub':f['u'],'role':'authenticated'}))+';SELECT public.commit_scheduler_recalibration('+','.join([lit(bad['op']),lit(f['g']),jb(bad['expected']),'2',lit(day),'false','ARRAY[]::uuid[]',jb(bad['dates'])])+');COMMIT;'
sql(q,fail=True);assert state(f['g'])==before;assert sql('SELECT count(*) FROM rooted_private.scheduler_capabilities')=='0';mark('invalid server projection rolls back pointer, rows and capability')
# Fresh note after snapshot invalidates commit without erasing new work.
sql(f"UPDATE lessons SET notes='Synthetic concurrent note' WHERE id='{f['ids'][5]}'")
newer=state(f['g']);assert call(f,p)['status']=='stale';assert state(f['g'])==newer;mark('newer note rejects stale recalibration with exact preservation')
p=params(f);result=call(f,p);assert result['status']=='applied',result;after=state(f['g']);by={r['id']:r for r in after['rows']}
for r in newer['rows']:
 a=by[r['id']]
 if r['completed'] or r['queue_pinned']:assert a==r
 for k in ['id','lesson_number','completed','completed_at','notes','minutes_spent','hours']:assert a[k]==r[k]
assert after['goal']['current_lesson']==1 and after['goal']['start_at_lesson']==2
assert by[f['ids'][1]]['scheduled_date']==str(day) and not by[f['ids'][1]]['queue_preserved']
assert state(f['other'])==neighbor;mark('atomic current lesson 2 preserves later completed history, time, pin and other child exactly')
assert call(f,p)['status']=='already_applied' and state(f['g'])==after;mark('identical operation replay is write-free')
changed=json.loads(json.dumps(p));changed['dates'][0]['date']=str(day+datetime.timedelta(days=1));assert call(f,changed)['reason']=='operation';assert state(f['g'])==after;mark('altered operation reuse refuses without changes')
sql(f"UPDATE lessons SET notes='Synthetic work after saved resume' WHERE id='{f['ids'][5]}'");newer=state(f['g']);undo=rpc('undo_scheduler_recalibration',[lit(p['op'])],f['u']);assert undo['status']=='stale',undo;assert state(f['g'])==newer;mark('Undo refuses newer work without erasing it')
# Independent untouched operation permits exact bounded undo and replay.
f2=seed();old=state(f2['g']);p2=params(f2);assert call(f2,p2)['status']=='applied';assert rpc('undo_scheduler_recalibration',[lit(p2['op'])],f2['u'])['status']=='undone';restored=state(f2['g'])
def stable(s):return {'goal':{k:v for k,v in s['goal'].items() if k!='updated_at'},'rows':[{k:v for k,v in r.items() if k!='updated_at'} for r in s['rows']]}
assert stable(restored)==stable(old);assert call(f2,p2)['status']=='already_undone' and state(f2['g'])==restored;mark('bounded Undo restores original fields; original operation cannot reapply afterward')
assert sql('SELECT count(*) FROM rooted_private.scheduler_capabilities')=='0';assert state(f['other'])==neighbor
fingerprints=json.loads(sql("SELECT jsonb_object_agg(p.proname,md5(pg_get_functiondef(p.oid))) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname IN ('read_scheduler_state','commit_scheduler_recalibration','undo_scheduler_recalibration')"))
(B/'database-results.json').write_text(json.dumps({'database':DB,'template':'rooted_production_chain_fixed_v2','newMigrations':[],'checks':checks,'functionFingerprints':fingerprints},indent=2))
