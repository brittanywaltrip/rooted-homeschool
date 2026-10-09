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

fixture=json.loads((B/'fixture-shape.json').read_text());uid=fixture['user'];goal=str(uuid.uuid4());ids=[str(uuid.uuid4()) for _ in range(4)]
sql((B.parent/'rooted-release-package/investigation/containment/recalibration.sql').read_text().replace('CREATE FUNCTION public.commit_scheduler_recalibration','CREATE OR REPLACE FUNCTION public.commit_scheduler_recalibration')+" NOTIFY pgrst,'reload schema';")
def rpc(name,p):return http('/rest/v1/rpc/'+name,p)
def state():
 code,r=rpc('read_scheduler_state',{'p_goal_id':goal});assert code==200 and r['status']=='ready',r;return r
base=json.loads(sql("SELECT jsonb_build_object('rows',(SELECT jsonb_agg(to_jsonb(l) ORDER BY id) FROM lessons l),'goals',(SELECT jsonb_agg(to_jsonb(g) ORDER BY id) FROM curriculum_goals g));"));results=[]
def mark(s):results.append(s);print('PASS',s,flush=True)
try:
 day=sql("SELECT (now() AT TIME ZONE (SELECT timezone FROM profiles WHERE id="+lit(uid)+"))::date;");d=datetime.date.fromisoformat(day)
 q="INSERT INTO curriculum_goals(id,user_id,child_id,school_year_id,curriculum_name,total_lessons,current_lesson,start_date,start_at_lesson,school_days,lessons_per_day) VALUES("+','.join(map(lit,[goal,uid,fixture['child'],fixture['year'],'Synthetic recalibration']))+",4,0,"+lit(str(d-datetime.timedelta(days=10)))+",1,ARRAY['Mon','Tue','Wed','Thu','Fri','Sat','Sun'],1);"
 for i,rid in enumerate(ids):
  date=str(d+datetime.timedelta(days=i));q+="INSERT INTO lessons(id,user_id,child_id,school_year_id,curriculum_goal_id,title,date,scheduled_date,lesson_number,queue_position,scheduled_source) VALUES("+','.join(map(lit,[rid,uid,fixture['child'],fixture['year'],goal,'Synthetic recalibration '+str(i),date,date]))+','+str(i+1)+','+str(i+1)+",'wizard_create');"
 sql(q);before=state()['snapshot'];sql('SELECT rooted_private.set_scheduler_mode('+lit(goal)+','+lit(json.dumps(before))+"::jsonb,'atomic_v2');")
 def params(current=3,history=False):return {'p_operation_id':str(uuid.uuid4()),'p_goal_id':goal,'p_expected':state()['snapshot'],'p_current':current,'p_day':day,'p_history':history,'p_confirmed':ids[:2] if history else [],'p_dates':[{'id':ids[i],'date':str(d+datetime.timedelta(days=i-current+1))} for i in range(current-1,4)]}
 # Partial-lock refusal must release the acquired goal lock before caller transaction ends.
 holder=Conn();caller=Conn()
 try:
  holder.run('BEGIN; SELECT id FROM lessons WHERE id='+lit(ids[2])+' FOR UPDATE;')
  p=params();code,r=rpc('commit_scheduler_recalibration',p);assert r['status']=='busy';assert state()['snapshot']==before;mark('locked tail refuses promptly with no prefix effects')
 finally:
  holder.run('ROLLBACK;');holder.close();caller.close()
 # Preserved/pinned target is refused without releasing its placement.
 sql('DELETE FROM rooted_private.scheduler_modes WHERE goal_id='+lit(goal)+'; UPDATE lessons SET queue_pinned=true WHERE id='+lit(ids[2])+';')
 pinned=state()['snapshot'];sql('SELECT rooted_private.set_scheduler_mode('+lit(goal)+','+lit(json.dumps(pinned))+"::jsonb,'atomic_v2');")
 p=params();code,r=rpc('commit_scheduler_recalibration',p);assert r['status']=='invalid';assert state()['snapshot']==pinned;mark('pinned current lesson is preserved by whole-command refusal')
 sql('DELETE FROM rooted_private.scheduler_modes WHERE goal_id='+lit(goal)+'; UPDATE lessons SET queue_pinned=false WHERE id='+lit(ids[2])+';')
 before=state()['snapshot'];sql('SELECT rooted_private.set_scheduler_mode('+lit(goal)+','+lit(json.dumps(before))+"::jsonb,'atomic_v2');")
 for field,value in [('notes','Synthetic gap work'),('minutes_spent',17),('hours',0.5),('started_at','10:00:00')]:
  sql('UPDATE lessons SET '+field+'='+lit(value)+' WHERE id='+lit(ids[0])+';')
  work=state()['snapshot']
  for history in [False,True]:
   p=params(history=history);code,r=rpc('commit_scheduler_recalibration',p);assert r['status']=='invalid',(field,history,r);assert state()['snapshot']==work
  sql('UPDATE lessons SET '+field+('=0' if field=='hours' else '=NULL')+' WHERE id='+lit(ids[0])+';')
 mark('notes, minutes, hours and started time in gap each refuse with zero effects for both history choices')
 before=state()['snapshot']
 p=params(history=True);p['p_confirmed']=[ids[0]];code,r=rpc('commit_scheduler_recalibration',p);assert code==200 and r['status']=='stale',r;assert state()['snapshot']==before;mark('confirmed history set mismatch refuses before writes')
 p=params();p['p_dates'][0]['date']=str(d+datetime.timedelta(days=50));code,r=rpc('commit_scheduler_recalibration',p);assert code>=400,(code,r);assert state()['snapshot']==before;assert sql('SELECT count(*) FROM rooted_private.scheduler_capabilities;')=='0';mark('bad projection rolls back pointer, prefix and tail; capability cleared')
 p=params();p['p_expected']['goal']['current_lesson']=1;code,r=rpc('commit_scheduler_recalibration',p);assert r['status']=='stale';assert state()['snapshot']==before;mark('full preimage mismatch refuses atomically')
 p=params(history=True);code,r=rpc('commit_scheduler_recalibration',p);assert code==200 and r['status']=='applied',(code,r);after=state()['snapshot'];assert after['goal']['current_lesson']==2;assert all(x['completed'] for x in after['rows'] if x['id'] in ids[:2]);assert all(x['completed_at'][11:19]=='12:00:00' for x in after['rows'] if x['id'] in ids[:2]);assert sql('SELECT timezone FROM profiles WHERE id='+lit(uid))!='UTC';mark('confirmed estimates and tail commit together; UTC-noon history preserved in non-UTC account')
 code,r=rpc('commit_scheduler_recalibration',p);assert r['status']=='already_applied';assert state()['snapshot']==after;mark('durable same-operation replay is write-free')
 p['p_current']=4;code,r=rpc('commit_scheduler_recalibration',p);assert r['status']=='invalid';assert state()['snapshot']==after;mark('operation reuse with changed intent refuses')
 p=params(current=2);code,r=rpc('commit_scheduler_recalibration',p);assert r['status']=='invalid';assert state()['snapshot']==after;mark('cannot move pointer behind completed work')
 # Reset only this disposable cohort for drifted book order + work-preserving No.
 sql('DELETE FROM rooted_private.scheduler_modes WHERE goal_id='+lit(goal)+'; DELETE FROM lessons WHERE curriculum_goal_id='+lit(goal)+'; DELETE FROM curriculum_goals WHERE id='+lit(goal)+'; DELETE FROM rooted_private.scheduler_action_receipts WHERE goal_id='+lit(goal)+';'+q)
 sql('UPDATE lessons SET queue_position=NULL WHERE id IN ('+lit(ids[0])+','+lit(ids[1])+'); UPDATE lessons SET queue_position=CASE WHEN id='+lit(ids[0])+' THEN 2 ELSE 1 END WHERE id IN ('+lit(ids[0])+','+lit(ids[1])+'); UPDATE lessons SET notes='+lit('Synthetic retained note')+',minutes_spent=17 WHERE id='+lit(ids[3])+';')
 before=state()['snapshot'];sql('SELECT rooted_private.set_scheduler_mode('+lit(goal)+','+lit(json.dumps(before))+"::jsonb,'atomic_v2');")
 bridge={'url':private['url'],'anon':private['anon_key'],'token':private['access_token'],'goal':goal}
 out=subprocess.run(['node',str(B.parent/'rooted-release-package/investigation/containment/recalibration-client-bridge.mjs')],input=json.dumps(bridge),text=True,capture_output=True);assert out.returncode==0,out.stderr;assert json.loads(out.stdout)['retained_requests']==3
 after=state()['snapshot'];assert after['goal']['current_lesson']==2
 note=next(x for x in after['rows'] if x['id']==ids[3]);assert note['notes']=='Synthetic retained note' and note['minutes_spent']==17 and not note['completed'];assert all(x['scheduled_date'] is None for x in after['rows'] if x['id'] in ids[:2])
 assert all(x['queue_position']==x['lesson_number'] for x in after['rows']);mark('real TS current writer restores book order, preserves notes/minutes on No, and recovers two lost responses')
 print(json.dumps({'passed':results}))
finally:
 sql('DELETE FROM rooted_private.scheduler_modes WHERE goal_id='+lit(goal)+'; DELETE FROM lessons WHERE curriculum_goal_id='+lit(goal)+'; DELETE FROM curriculum_goals WHERE id='+lit(goal)+'; DELETE FROM rooted_private.scheduler_action_receipts WHERE goal_id='+lit(goal)+';')
 final=json.loads(sql("SELECT jsonb_build_object('rows',(SELECT jsonb_agg(to_jsonb(l) ORDER BY id) FROM lessons l),'goals',(SELECT jsonb_agg(to_jsonb(g) ORDER BY id) FROM curriculum_goals g));"));assert final==base,'Existing fixture changed'
 print('PASS existing fixture exact preservation')
