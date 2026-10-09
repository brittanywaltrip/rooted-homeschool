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
fixture=json.loads((B/'fixture-shape.json').read_text());uid=fixture['user']; goals=[];checks=[]
def rpc(n,p): return http('/rest/v1/rpc/'+n,p)
def state(g):
 c,r=rpc('read_scheduler_state',{'p_goal_id':g});assert c==200 and r['status']=='ready',r;return r['snapshot']
def apply(g,a,e=None,op=None):return rpc('commit_scheduler_history_heal',{'p_operation_id':op or str(uuid.uuid4()),'p_goal_id':g,'p_expected':e or state(g),'p_action':dict(a,localDay=day)})
def mark(s):checks.append(s);print('PASS',s,flush=True)
def make(slots):
 g=str(uuid.uuid4());goals.append(g)
 q="INSERT INTO curriculum_goals(id,user_id,child_id,school_year_id,curriculum_name,total_lessons,current_lesson,start_date,start_at_lesson,school_days,lessons_per_day,created_at) VALUES("+','.join(map(lit,[g,uid,fixture['child'],fixture['year'],'Synthetic recovery '+g]))+",4,0,"+lit(day)+",1,ARRAY['Mon','Tue','Wed','Thu','Fri','Sat','Sun'],1,now()-interval '1 day');"
 for i in slots:
  dt=str(d+datetime.timedelta(days=i-1));q+="INSERT INTO lessons(user_id,child_id,curriculum_goal_id,title,date,scheduled_date,lesson_number,queue_position,scheduled_source) VALUES("+','.join(map(lit,[uid,fixture['child'],g,'Synthetic recovery '+str(i),dt,dt]))+','+str(i)+','+str(i)+",'wizard_create');"
 sql(q);s=state(g);sql('SELECT rooted_private.set_scheduler_mode('+lit(g)+','+lit(json.dumps(s))+"::jsonb,'atomic_v2');");return g
try:
 day=sql("SELECT (now() AT TIME ZONE (SELECT timezone FROM profiles WHERE id="+lit(uid)+"))::date;");d=datetime.date.fromisoformat(day)
 for choice in ['planned','picked','today']:
  g=make([2,3,4]);date=day if choice=='today' else str(d-datetime.timedelta(days=2));a={'kind':'history_insert','slot':1,'date':date,'choice':choice}
  c,r=apply(g,a);assert c==200 and r['status']=='applied',(c,r)
  row=next(x for x in state(g)['rows'] if x['queue_position']==1)
  assert row['date']==date and row['scheduled_source']=='completion_'+choice
  assert row['queue_pinned']==(choice!='today') and row['is_backfill']==(choice!='today')
  if choice!='today':assert '12:00:00' in row['completed_at']
  mark('offered '+choice+' completion source/date/pin/backfill preserved')
 g=make([2,3,4]);c,r=apply(g,{'kind':'history_insert','slot':1,'date':day,'choice':'today','origin':'prior_card'});assert c==200 and r['status']=='applied',r
 row=next(x for x in state(g)['rows'] if x['queue_position']==1);assert row['hours']==0 and row['minutes_spent'] is None and row['subject_id'] is None and ' — Lesson 1' in row['title'];mark('prior card retains zero-time original insert semantics')
 g=make([2,3,4]);before=state(g)
 for bad in [{'choice':'forged'},{'choice':'today','date':str(d-datetime.timedelta(days=1))},{'choice':'planned','origin':'arbitrary'}]:
  c,r=apply(g,dict({'kind':'history_insert','slot':1,'date':day},**bad));assert c==200 and r['status']=='invalid',(c,r);assert state(g)==before
 mark('invalid source/origin and mismatched today intent refuse without writes')
 bg=make([2,3,4]);bridge={'url':private['url'],'anon':private['anon_key'],'token':private['access_token'],'goal':bg,'user':uid,'child':fixture['child'],'day':day,'date':str(d-datetime.timedelta(days=2))}
 out=subprocess.run(['node',str(B.parent/'rooted-release-package/investigation/containment/recovery-client-bridge.mjs')],input=json.dumps(bridge),text=True,capture_output=True);assert out.returncode==0,out.stderr;assert json.loads(out.stdout)['tail_respready'];mark('actual Yes helper: committed insert lost twice, same receipt, one event and protected tail re-spread')
finally:
 for g in goals:
  sql('DELETE FROM rooted_private.scheduler_modes WHERE goal_id='+lit(g)+'; DELETE FROM lessons WHERE curriculum_goal_id='+lit(g)+'; DELETE FROM curriculum_goals WHERE id='+lit(g)+'; DELETE FROM rooted_private.scheduler_action_receipts WHERE goal_id='+lit(g)+';')
(B/'recovery-followup-results.json').write_text(json.dumps({'passed':checks,'count':len(checks)},indent=2))
