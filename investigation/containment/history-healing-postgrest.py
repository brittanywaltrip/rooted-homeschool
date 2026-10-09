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
 g=make([2,3,4]);before=state(g)
 c,r=apply(g,{'kind':'heal_next','slot':1,'date':str(d+datetime.timedelta(days=1))});assert c>=400,(c,r);assert state(g)==before;mark('wrong projected next date rolls back insert and capability')
 c,r=apply(g,{'kind':'heal_next','slot':1,'date':day});assert c==200 and r['status']=='applied',r;assert len(state(g)['rows'])==4;mark('next missing row heals without touching held rows')
 g=make([]);before=state(g);slots=[{'slot':i,'date':str(d+datetime.timedelta(days=i-1))} for i in range(1,5)]
 c,r=apply(g,{'kind':'heal_empty','slots':slots[:-1]});assert r['status']=='invalid';assert state(g)==before
 op=str(uuid.uuid4());a={'kind':'heal_empty','slots':slots};c,r=apply(g,a,before,op);assert c==200 and r['status']=='applied' and r['written']==4,r
 c,r=apply(g,a,before,op);assert r['status']=='already_applied';assert len(state(g)['rows'])==4;mark('empty queue all slots atomic and identical replay does not duplicate')
 g=make([2,3,4]);before=state(g);a={'kind':'history_insert','slot':1,'date':str(d-datetime.timedelta(days=2))};op=str(uuid.uuid4())
 c,r=apply(g,a,before,op);assert c==200 and r['status']=='applied',r
 rows=state(g)['rows'];row=next(x for x in rows if x['queue_position']==1);assert row['completed'] and row['queue_pinned'] and row['is_backfill'] and '12:00:00' in row['completed_at'];assert row['date']==a['date'];mark('history insert preserves requested past noon completion and pin')
 c,r=apply(g,a,before,op);assert r['status']=='already_applied';assert len(state(g)['rows'])==4
 c,r=apply(g,{'kind':'history_insert','slot':1,'date':day},before);assert r['status']=='stale';mark('history replay/stale page cannot overwrite recorded work')
 g=make([1,2,3,4]);before=state(g);root=next(x for x in before['rows'] if x['queue_position']==1);a={'kind':'continue','parentLessonId':root['id'],'targetDate':day};op=str(uuid.uuid4())
 c,r=apply(g,a,before,op);assert c==200 and r['status']=='applied',r
 new=r['row'];assert new['continues_lesson_id']==root['id'] and new['queue_position'] is None and new['lesson_number'] is None and new['notes'] is None
 for old in before['rows']:assert next(x for x in state(g)['rows'] if x['id']==old['id'])==old
 c,r=apply(g,a,before,op);assert r['status']=='already_applied';mark('continuation derives exact root metadata, preserves schedule and receipt replay')
 sql('SELECT rooted_private.set_scheduler_mode('+lit(g)+','+lit(json.dumps(state(g)))+"::jsonb,'paused');")
 c,r=rpc('undo_scheduler_continuation',{'p_operation_id':op});assert c==200 and r['status']=='undone',r;assert state(g)==before
 sql('SELECT rooted_private.set_scheduler_mode('+lit(g)+','+lit(json.dumps(state(g)))+"::jsonb,'atomic_v2');")
 mark('paused continuation Undo preserves original schedule without disabling guard')
 c,r=rpc('undo_scheduler_continuation',{'p_operation_id':op});assert r['status']=='already_undone';mark('exact continuation Undo removes only created row and repeats safely')
 op=str(uuid.uuid4());c,r=apply(g,a,op=op);assert r['status']=='applied';rid=r['row']['id']
 c,r=http('/rest/v1/lessons?id=eq.'+rid,{'notes':'Synthetic parent work'},'PATCH');assert c==200
 after=state(g);c,r=rpc('undo_scheduler_continuation',{'p_operation_id':op});assert r['status']=='stale';assert state(g)==after;mark('continuation Undo refuses after parent note without touching it')
 # Scrub expired full row; replay must resolve original ID, never create a replacement.
 rg=make([1,2,3,4]);rs=state(rg);rr=rs['rows'][0];ra={'kind':'continue','parentLessonId':rr['id'],'targetDate':day};rop=str(uuid.uuid4())
 c,r=apply(rg,ra,rs,rop);assert r['status']=='applied';rid2=r['row']['id'];current=state(rg)
 sql("UPDATE rooted_private.scheduler_action_receipts SET created_at=now()-interval '11 minutes' WHERE id="+lit(rop)+"; SELECT rooted_private.expire_scheduler_receipts(500);")
 assert sql('SELECT result ? '+lit('row')+' FROM rooted_private.scheduler_action_receipts WHERE id='+lit(rop))=='f'
 c,r=apply(rg,ra,rs,rop);assert r['status']=='already_applied' and r['row']['id']==rid2;assert state(rg)==current
 c,r=rpc('undo_scheduler_continuation',{'p_operation_id':rop});assert r['status']=='invalid' and r['reason']=='expired';assert state(rg)==current
 sql('DELETE FROM rooted_private.scheduler_modes WHERE goal_id='+lit(rg)+'; DELETE FROM lessons WHERE id='+lit(rid2)+';')
 deleted=state(rg);c,r=apply(rg,ra,rs,rop);assert r['status']=='already_applied' and r.get('row') is None;assert state(rg)==deleted
 mark('expired continuation payload scrub preserves replay and missing row never reinserts')
 # A new later history record must not discard any earlier logged work.
 for patch in [{'hours':0.5},{'minutes_spent':17},{'started_at':'09:15:00'},{'notes':'Earlier synthetic parent work'}]:
  wg=make([1,2,4]);ws=state(wg);wr=next(x for x in ws['rows'] if x['queue_position']==1)
  c,r=http('/rest/v1/lessons?id=eq.'+wr['id'],patch,'PATCH');assert c==200,r
  ws=state(wg);c,r=apply(wg,{'kind':'history_insert','slot':3,'date':str(d-datetime.timedelta(days=2))});assert c==200 and r['status']=='applied',(patch,c,r)
  after_work=next(x for x in state(wg)['rows'] if x['id']==wr['id']);assert after_work==next(x for x in ws['rows'] if x['id']==wr['id'])
 mark('history insertion above earlier hours/minutes/start-time/notes preserves each full work row')
 # Actual TypeScript helper plus real PostgREST lost-response replay.
 bg=make([1,2,3,4]);bst=state(bg);br=next(x for x in bst['rows'] if x['queue_position']==1)
 bridge={'url':private['url'],'anon':private['anon_key'],'token':private['access_token'],'goal':bg,'action':{'kind':'continue','parentLessonId':br['id'],'targetDate':day}}
 out=subprocess.run(['node',str(B.parent/'rooted-release-package/investigation/containment/history-healing-client-bridge.mjs')],input=json.dumps(bridge),text=True,capture_output=True);assert out.returncode==0,out.stderr;assert json.loads(out.stdout)['identical_requests']==3
 assert state(bg)==bst;mark('actual TS helper lost responses replay exact operation and Undo through real API')
 hg=make([2,3,4]);bridge={'url':private['url'],'anon':private['anon_key'],'token':private['access_token'],'goal':hg,'user':uid,'day':day}
 out=subprocess.run(['node',str(B.parent/'rooted-release-package/investigation/containment/history-log-client-bridge.mjs')],input=json.dumps(bridge),text=True,capture_output=True);assert out.returncode==0,out.stderr;assert json.loads(out.stdout)['events']==1
 mark('public history wrapper resumes original insert receipt before existing-row lookup; one event and unchanged timestamp')
 # Authenticated other-owner state and forged op scope cannot be borrowed.
 c,r=apply(g,{'kind':'continue','parentLessonId':str(uuid.uuid4()),'targetDate':day});assert r['status']=='invalid';assert state(g)==after
 assert sql('SELECT count(*) FROM rooted_private.scheduler_capabilities;')=='0';mark('invalid root and all outcomes leave no capability')
 # NOWAIT partial-lock release: lock one existing row, then attempt recovery.
 lock=Conn();lock.run('BEGIN; SELECT 1 FROM lessons WHERE id='+lit(root['id'])+' FOR UPDATE;')
 try:
  c,r=apply(g,{'kind':'continue','parentLessonId':root['id'],'targetDate':day});assert r['status']=='busy',r
 finally:lock.run('ROLLBACK;');lock.close()
 assert state(g)==after;mark('row contention returns busy without partial insertion')
finally:
 for g in goals:
  sql('DELETE FROM rooted_private.scheduler_modes WHERE goal_id='+lit(g)+'; DELETE FROM lessons WHERE curriculum_goal_id='+lit(g)+'; DELETE FROM curriculum_goals WHERE id='+lit(g)+'; DELETE FROM rooted_private.scheduler_action_receipts WHERE goal_id='+lit(g)+';')
(B/'history-healing-results.json').write_text(json.dumps({'passed':checks,'count':len(checks)},indent=2))
