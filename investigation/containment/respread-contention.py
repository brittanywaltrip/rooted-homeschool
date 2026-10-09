import json,subprocess,uuid,urllib.request,urllib.error,datetime,threading,queue,time
from pathlib import Path
B=Path(__file__).resolve().parents[3]/'synthetic-runtime'; private=json.loads((B/'local-private.json').read_text());assert private['url']=='http://127.0.0.1:54321'
D=['/Users/brittanywaltrip/.docker/bin/docker','--host','unix:///Users/brittanywaltrip/.colima/rooted-isolated/docker.sock']
info=json.loads(subprocess.check_output(D+['inspect','supabase_db_rooted-isolated-local'],text=True))[0];assert list(info['NetworkSettings']['Networks'])==['rooted-isolated-loopback'];assert info['NetworkSettings']['Ports']['5432/tcp']==[{'HostIp':'127.0.0.1','HostPort':'54322'}]
def sql(s):
 p=subprocess.run(D+['exec','-i','supabase_db_rooted-isolated-local','psql','-X','-qAt','-U','postgres','-d','postgres','-v','ON_ERROR_STOP=1'],input=s,text=True,capture_output=True);assert p.returncode==0,p.stderr;return p.stdout.strip()

class Conn:
 def __init__(self):
  self.p=subprocess.Popen(D+['exec','-i','supabase_db_rooted-isolated-local','psql','-X','-qAt','-U','postgres','-d','postgres','-v','ON_ERROR_STOP=1'],stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.STDOUT,text=True,bufsize=1);self.q=queue.Queue();self.n=0
  def read():
   for line in self.p.stdout:self.q.put(line.rstrip())
   self.q.put(None)
  threading.Thread(target=read,daemon=True).start()
 def run(self,text):
  self.n+=1;tag='DONE_'+str(self.n);self.p.stdin.write(text+'\n\\echo '+tag+'\n');self.p.stdin.flush();out=[]
  while True:
   line=self.q.get(timeout=10)
   if line is None:raise RuntimeError('\n'.join(out))
   if line==tag:return '\n'.join(out)
   out.append(line)
 def close(self):
  if self.p.poll() is None:self.p.stdin.close();self.p.wait(timeout=5)

def lit(x):return "'"+str(x).replace("'","''")+"'"
def http(path,data=None,method='POST',token=None):
 body=None if data is None else json.dumps(data).encode();req=urllib.request.Request(private['url']+path,body,{'apikey':private['anon_key'],'Authorization':'Bearer '+(token or private['access_token']),'Content-Type':'application/json','Prefer':'return=representation'},method=method)
 try:
  with urllib.request.urlopen(req,timeout=20) as r:return r.status,json.load(r) if r.status!=204 else None
 except urllib.error.HTTPError as e:return e.code,json.load(e)
status,s=http('/auth/v1/token?grant_type=password',{'email':private['email'],'password':private['password']});assert status==200;private['access_token']=s['access_token']

from concurrent.futures import ThreadPoolExecutor
fixture=json.loads((B/'fixture-shape.json').read_text());uid=fixture['user'];goals=[str(uuid.uuid4()),str(uuid.uuid4())];results=[];timings={}
def rpc(name,p):return http('/rest/v1/rpc/'+name,p)
def state(g):
 code,r=rpc('read_scheduler_state',{'p_goal_id':g});assert code==200 and r['status']=='ready',r;return r['snapshot']
def request(g,s):return {'p_operation_id':str(uuid.uuid4()),'p_goal_id':g,'p_expected':s,'p_source':'catchup_spread','p_day':day}
def timed(p):
 start=time.perf_counter();code,result=rpc('commit_scheduler_respread',p);return code,result,round((time.perf_counter()-start)*1000,2)
def mark(x):results.append(x);print('PASS '+x,flush=True)
try:
 day=sql("SELECT (now() AT TIME ZONE (SELECT timezone FROM profiles WHERE id="+lit(uid)+"))::date;")
 for g in goals:
  sql("INSERT INTO curriculum_goals(id,user_id,child_id,school_year_id,curriculum_name,total_lessons,current_lesson,start_date,start_at_lesson,school_days,lessons_per_day) VALUES("+','.join(map(lit,[g,uid,fixture['child'],fixture['year'],'Synthetic 500-row respread '+g]))+",500,0,"+lit(day)+",1,ARRAY['Mon','Tue','Wed','Thu','Fri','Sat','Sun'],2); INSERT INTO lessons(id,user_id,child_id,school_year_id,curriculum_goal_id,title,date,scheduled_date,lesson_number,queue_position,scheduled_source,queue_pinned,queue_preserved,notes,minutes_spent,hours) SELECT gen_random_uuid(),"+','.join(map(lit,[uid,fixture['child'],fixture['year'],g]))+",'Synthetic row '||n,"+lit(day)+"::date+400+n,"+lit(day)+"::date+400+n,n,n,'wizard_create',n=200,n=100,CASE WHEN n%50=0 THEN 'Synthetic parent work' END,CASE WHEN n%50=0 THEN 17 END,CASE WHEN n%50=0 THEN 0.25 ELSE 0 END FROM generate_series(1,500) n;")
  snap=state(g);sql('SELECT rooted_private.set_scheduler_mode('+lit(g)+','+lit(json.dumps(snap))+"::jsonb,'atomic_v2');")
 before={g:state(g) for g in goals}
 def preserved(g,old):
  new=state(g);byid={r['id']:r for r in new['rows']};assert len(byid)==500
  for r in old['rows']:
   changed=byid[r['id']]
   assert {k:v for k,v in r.items() if k not in ['date','scheduled_date','scheduled_source','updated_at']}=={k:v for k,v in changed.items() if k not in ['date','scheduled_date','scheduled_source','updated_at']}
   if r['queue_pinned'] or r['queue_preserved']:assert changed==r
  assert new['goal']==old['goal'];return new
 with ThreadPoolExecutor(max_workers=2) as pool:independent=list(pool.map(timed,[request(g,before[g]) for g in goals]))
 assert all(code==200 and r['status']=='applied' for code,r,ms in independent),independent
 timings['independent_ms']=[ms for code,r,ms in independent];mark('two independent 500-row courses respread concurrently with both applied')
 for g in goals:preserved(g,before[g])
 mark('all 1000 rows retain content and goal fields; pinned/preserved rows exact')
 # Restore only this synthetic course to intentionally stale tail dates, then
 # reactivate with an exact preimage for two competing operations.
 g=goals[0];sql('DELETE FROM rooted_private.scheduler_modes WHERE goal_id='+lit(g)+'; UPDATE lessons SET date='+lit(day)+'::date+600+lesson_number,scheduled_date='+lit(day)+'::date+600+lesson_number WHERE curriculum_goal_id='+lit(g)+' AND NOT queue_pinned AND NOT queue_preserved;')
 racebefore=state(g);sql('SELECT rooted_private.set_scheduler_mode('+lit(g)+','+lit(json.dumps(racebefore))+"::jsonb,'atomic_v2');")
 barrier=threading.Barrier(2)
 def race(p):barrier.wait();return timed(p)
 with ThreadPoolExecutor(max_workers=2) as pool:raceout=list(pool.map(race,[request(g,racebefore),request(g,racebefore)]))
 statuses=sorted(r['status'] for code,r,ms in raceout);assert statuses in [['applied','busy'],['applied','stale']],raceout
 timings['same_goal_ms']=[ms for code,r,ms in raceout];timings['same_goal_statuses']=statuses;preserved(g,racebefore);mark('same-course race has one applied and one busy/stale with no partial duplicate')
 lock=Conn();caller=Conn();probe=Conn()
 try:
  lock.run('BEGIN; LOCK TABLE public.lessons IN SHARE ROW EXCLUSIVE MODE;')
  snap=state(g);code,r,ms=timed(request(g,snap));assert code==200 and r['status']=='busy';assert state(g)==snap;timings['calendar_table_refusal_ms']=ms;mark('calendar-style table contention refuses with exact zero effects')
 finally:lock.run('ROLLBACK;');lock.close();caller.close();probe.close()
 # Hold the last lesson row so function first acquires goal/table/earlier rows.
 # Call within a still-open transaction, then independently prove its partial
 # goal/row locks were released by the nested busy handler.
 snap=state(g);last=sorted(snap['rows'],key=lambda r:r['id'])[-1]['id'];lock=Conn();caller=Conn();probe=Conn()
 try:
  lock.run('BEGIN; SELECT id FROM lessons WHERE id='+lit(last)+' FOR UPDATE;')
  p=request(g,snap)
  caller.run("BEGIN; SET LOCAL statement_timeout='2s'; SELECT set_config('request.jwt.claim.sub',"+lit(uid)+",true);")
  t=time.perf_counter();response=caller.run('SELECT public.commit_scheduler_respread('+lit(p['p_operation_id'])+','+lit(g)+','+lit(json.dumps(snap))+"::jsonb,'catchup_spread',"+lit(day)+');');timings['partial_lock_refusal_ms']=round((time.perf_counter()-t)*1000,2)
  assert json.loads(response)['status']=='busy',response
  first=sorted(snap['rows'],key=lambda r:r['id'])[0]['id']
  probe.run("BEGIN; SET LOCAL statement_timeout='1s'; SELECT id FROM curriculum_goals WHERE id="+lit(g)+' FOR UPDATE NOWAIT; SELECT id FROM lessons WHERE id='+lit(first)+' FOR UPDATE NOWAIT;')
  assert state(g)==snap;mark('busy releases acquired goal/earlier-row locks while refusing transaction remains open')
 finally:
  for c in [probe,caller,lock]:
   try:c.run('ROLLBACK;')
   finally:c.close()
 print(json.dumps({'passed':results,'latencies_ms':timings,'scope':'isolated Colima local measurements, no SLA claim'},indent=2))
finally:
 for g in goals:sql('DELETE FROM rooted_private.scheduler_modes WHERE goal_id='+lit(g)+'; UPDATE lessons SET queue_preserved=false WHERE curriculum_goal_id='+lit(g)+'; DELETE FROM lessons WHERE curriculum_goal_id='+lit(g)+'; DELETE FROM curriculum_goals WHERE id='+lit(g)+'; DELETE FROM rooted_private.scheduler_action_receipts WHERE goal_id='+lit(g)+';')
 assert sql('SELECT count(*) FROM lessons WHERE curriculum_goal_id IN ('+','.join(map(lit,goals))+');')=='0'
 print('PASS own two 500-row cohorts and receipts cleaned')
