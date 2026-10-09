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

fixture=json.loads((B/'fixture-shape.json').read_text());uid=fixture['user'];goal=str(uuid.uuid4());ids=[str(uuid.uuid4()) for _ in range(6)];results=[]
def rpc(name,p):return http('/rest/v1/rpc/'+name,p)
def state():
 code,r=rpc('read_scheduler_state',{'p_goal_id':goal});assert code==200 and r['status']=='ready',r;return r
# Baseline only known original fixture IDs; disjoint parallel cohorts excluded.
base=json.loads(sql("SELECT jsonb_build_object('rows',(SELECT jsonb_agg(to_jsonb(l) ORDER BY id) FROM lessons l WHERE user_id="+lit(uid)+"),'goals',(SELECT jsonb_agg(to_jsonb(g) ORDER BY id) FROM curriculum_goals g WHERE user_id="+lit(uid)+"));"));oldrows=[x['id'] for x in base['rows']];oldgoals=[x['id'] for x in base['goals']]
def mark(x):results.append(x);print('PASS '+x,flush=True)
try:
 day=sql("SELECT (now() AT TIME ZONE (SELECT timezone FROM profiles WHERE id="+lit(uid)+"))::date;");d=datetime.date.fromisoformat(day)
 q="INSERT INTO curriculum_goals(id,user_id,child_id,school_year_id,curriculum_name,total_lessons,current_lesson,start_date,start_at_lesson,school_days,lessons_per_day) VALUES("+','.join(map(lit,[goal,uid,fixture['child'],fixture['year'],'Synthetic respread']))+",6,0,"+lit(day)+",1,ARRAY['Mon','Tue','Wed','Thu','Fri','Sat','Sun'],1);"
 for i,rid in enumerate(ids):
  date=day if i==1 else str(d+datetime.timedelta(days=30+i));slot='NULL' if i==1 else str(i+1)
  q+="INSERT INTO lessons(id,user_id,child_id,school_year_id,curriculum_goal_id,title,date,scheduled_date,lesson_number,queue_position,scheduled_source,queue_pinned,queue_preserved) VALUES("+','.join(map(lit,[rid,uid,fixture['child'],fixture['year'],goal,'Synthetic respread '+str(i),date,date]))+','+str(i+1)+','+slot+",'wizard_create',"+('true' if i==4 else 'false')+','+('true' if i==5 else 'false')+');'
 sql(q);before=state()['snapshot'];sql('SELECT rooted_private.set_scheduler_mode('+lit(goal)+','+lit(json.dumps(before))+"::jsonb,'atomic_v2');")
 p={'p_operation_id':str(uuid.uuid4()),'p_goal_id':goal,'p_expected':before,'p_source':'queue_resync','p_day':day};code,r=rpc('commit_scheduler_respread',p);assert r['status']=='invalid';assert state()['snapshot']==before;mark('unapproved source refuses unchanged')
 p['p_source']='completion_respread';p['p_expected']={};code,r=rpc('commit_scheduler_respread',p);assert r['status']=='stale';assert state()['snapshot']==before;mark('full expected snapshot required')
 lock=Conn()
 try:
  lock.run('BEGIN; SELECT id FROM lessons WHERE id='+lit(ids[2])+' FOR UPDATE;');p['p_expected']=before;code,r=rpc('commit_scheduler_respread',p);assert r['status']=='busy';assert state()['snapshot']==before;mark('locked tail refuses atomically')
 finally:lock.run('ROLLBACK;');lock.close()
 table_lock=Conn()
 try:
  table_lock.run('BEGIN; LOCK TABLE public.lessons IN SHARE ROW EXCLUSIVE MODE;');code,r=rpc('commit_scheduler_respread',p);assert r['status']=='busy';assert state()['snapshot']==before;mark('calendar-style lessons table lock refuses promptly with zero effects')
 finally:table_lock.run('ROLLBACK;');table_lock.close()
 inp={'url':private['url'],'anon':private['anon_key'],'token':private['access_token'],'goal':goal,'first':ids[0]}
 out=subprocess.run(['node',str(B.parent/'rooted-release-package/investigation/containment/respread-client-bridge.mjs')],input=json.dumps(inp),text=True,capture_output=True);assert out.returncode==0,out.stderr
 info=json.loads(out.stdout);assert info['replayRequests']==3
 after=state()['snapshot'];byid={x['id']:x for x in after['rows']}
 for x in before['rows']:
  if x['id'] in [ids[1],ids[4],ids[5]]:assert byid[x['id']]==x
 assert byid[ids[0]]['completed'];assert byid[ids[2]]['scheduled_date']==str(d+datetime.timedelta(days=1));assert byid[ids[3]]['scheduled_date']==str(d+datetime.timedelta(days=2))
 mark('real completion then respread respects unslotted capacity/reservation and preserves pins/preserved placements; lost-response replay identical')
 print(json.dumps({'passed':results}))
finally:
 sql('DELETE FROM rooted_private.scheduler_modes WHERE goal_id='+lit(goal)+'; UPDATE lessons SET queue_preserved=false WHERE curriculum_goal_id='+lit(goal)+'; DELETE FROM lessons WHERE curriculum_goal_id='+lit(goal)+'; DELETE FROM curriculum_goals WHERE id='+lit(goal)+'; DELETE FROM rooted_private.scheduler_action_receipts WHERE goal_id='+lit(goal)+';')
 final=json.loads(sql("SELECT jsonb_build_object('rows',(SELECT jsonb_agg(to_jsonb(l) ORDER BY id) FROM lessons l WHERE id IN ("+','.join(map(lit,oldrows))+")),'goals',(SELECT jsonb_agg(to_jsonb(g) ORDER BY id) FROM curriculum_goals g WHERE id IN ("+','.join(map(lit,oldgoals))+")));"));assert final==base;print('PASS original captured fixture exact preservation; own cohort cleaned')
