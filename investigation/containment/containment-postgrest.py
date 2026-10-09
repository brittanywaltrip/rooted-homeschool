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
fixture=json.loads((B/'fixture-shape.json').read_text());uid=fixture['user'];goal=str(uuid.uuid4());ids=[str(uuid.uuid4()) for _ in range(4)];base=json.loads(sql("SELECT jsonb_build_object('rows',(SELECT jsonb_agg(to_jsonb(l) ORDER BY id) FROM lessons l),'goals',(SELECT jsonb_agg(to_jsonb(g) ORDER BY id) FROM curriculum_goals g));"));results=[]
def rpc(name,p):
 status,data=http('/rest/v1/rpc/'+name,p);return status,data
def state():
 code,r=rpc('read_scheduler_state',{'p_goal_id':goal});assert code==200 and r['status']=='ready',r;return r['snapshot']
def mark(name):results.append(name);print('PASS',name,flush=True)
def action(a,expected=None,op=None):
 return rpc('commit_scheduler_action',{'p_operation_id':op or str(uuid.uuid4()),'p_goal_id':goal,'p_expected':expected or state(),'p_action':a})
def unchanged(before):assert state()==before
try:
 day=sql("SELECT (now() AT TIME ZONE (SELECT timezone FROM profiles WHERE id="+lit(uid)+"))::date;");d=datetime.date.fromisoformat(day)
 q="INSERT INTO curriculum_goals(id,user_id,child_id,school_year_id,curriculum_name,total_lessons,current_lesson,start_date,start_at_lesson,school_days,lessons_per_day) VALUES("+','.join(map(lit,[goal,uid,fixture['child'],fixture['year'],'Synthetic containment']))+",4,0,"+lit(day)+",1,ARRAY['Mon','Tue','Wed','Thu','Fri','Sat','Sun'],1);"
 for i,rid in enumerate(ids):
  date=str(d+datetime.timedelta(days=i));q+="INSERT INTO lessons(id,user_id,child_id,school_year_id,curriculum_goal_id,title,date,scheduled_date,lesson_number,queue_position,scheduled_source) VALUES("+','.join(map(lit,[rid,uid,fixture['child'],fixture['year'],goal,'Synthetic containment '+str(i),date,date]))+','+str(i+1)+','+str(i+1)+",'wizard_create');"
 sql(q+"NOTIFY pgrst,'reload schema';")
 bulkgoal=str(uuid.uuid4());bulkids=[str(uuid.uuid4()) for _ in ids];bulkq=q.replace(goal,bulkgoal).replace("Synthetic containment","Synthetic bulk containment")
 for old,new in zip(ids,bulkids):bulkq=bulkq.replace(old,new)
 sql(bulkq)
 try:
  code,bstate=rpc('read_scheduler_state',{'p_goal_id':bulkgoal});assert code==200
  sql("SELECT rooted_private.set_scheduler_mode("+lit(bulkgoal)+","+lit(json.dumps(bstate["snapshot"]))+"::jsonb,'atomic_v2');")
  bridge={'url':private['url'],'anon':private['anon_key'],'token':private['access_token'],'goal':bulkgoal,'action':{'kind':'set_skipped','lessonIds':bulkids[:2],'skipped':True,'localDay':day}}
  out=subprocess.run(['node',str(B.parent/'rooted-release-package/investigation/containment/client-bridge.mjs')],input=json.dumps(bridge),text=True,capture_output=True);assert out.returncode==0,out.stderr;assert json.loads(out.stdout)['identical_requests']==3
  code,bafter=rpc('read_scheduler_state',{'p_goal_id':bulkgoal})
  for before_row in bstate['snapshot']['rows']:
   after_row=next(x for x in bafter['snapshot']['rows'] if x['id']==before_row['id']);assert {k:v for k,v in before_row.items() if k!='updated_at'}=={k:v for k,v in after_row.items() if k!='updated_at'}
  mark('actual protected bulk skip projects tail atomically, survives two lost responses and Undo restores all rows')
  code,skipresult=rpc('commit_scheduler_action',{'p_operation_id':str(uuid.uuid4()),'p_goal_id':bulkgoal,'p_expected':bafter['snapshot'],'p_action':{'kind':'skip','lessonId':bulkids[0]}});assert code==200 and skipresult['status']=='applied',skipresult
  code,unskipbefore=rpc('read_scheduler_state',{'p_goal_id':bulkgoal});assert code==200
  bridge['action']={'kind':'set_skipped','lessonIds':[bulkids[0]],'skipped':False,'localDay':day}
  out=subprocess.run(['node',str(B.parent/'rooted-release-package/investigation/containment/client-bridge.mjs')],input=json.dumps(bridge),text=True,capture_output=True);assert out.returncode==0,out.stderr
  code,unskipafter=rpc('read_scheduler_state',{'p_goal_id':bulkgoal});assert code==200
  for before_row in unskipbefore['snapshot']['rows']:
   after_row=next(x for x in unskipafter['snapshot']['rows'] if x['id']==before_row['id']);assert {k:v for k,v in before_row.items() if k!='updated_at'}=={k:v for k,v in after_row.items() if k!='updated_at'}
  mark('actual protected unskip projects atomically, lost-response replay and Undo restore skipped state')
 finally:
  sql('DELETE FROM rooted_private.scheduler_modes WHERE goal_id='+lit(bulkgoal)+'; DELETE FROM lessons WHERE curriculum_goal_id='+lit(bulkgoal)+'; DELETE FROM curriculum_goals WHERE id='+lit(bulkgoal)+'; DELETE FROM rooted_private.scheduler_action_receipts WHERE goal_id='+lit(bulkgoal)+';')
 # Activation cannot race past an old transaction holding the goal lock.
 legacybefore=state();locker=Conn()
 try:
  locker.run('BEGIN; SELECT id FROM curriculum_goals WHERE id='+lit(goal)+' FOR UPDATE;')
  probe=subprocess.run(D+['exec','-i','supabase_db_rooted-isolated-local','psql','-X','-qAt','-U','postgres','-d','postgres','-v','ON_ERROR_STOP=1'],input='SELECT rooted_private.set_scheduler_mode('+lit(goal)+','+lit(json.dumps(legacybefore))+"::jsonb,'atomic_v2');",text=True,capture_output=True)
  assert probe.returncode!=0 and 'could not obtain lock' in probe.stderr,probe.stderr
  locker.run('ROLLBACK;')
 finally:locker.close()
 unchanged(legacybefore);assert sql('SELECT count(*) FROM rooted_private.scheduler_modes WHERE goal_id='+lit(goal))=='0';mark('activation refuses locked legacy transaction without installing protection or changing state')
 # Emulate old first-stage success while legacy, then activate before queued tail.
 code,result=rpc('move_lesson_keep_slot',{'p_lesson_id':ids[1],'p_target_date':str(d+datetime.timedelta(days=3)),'p_local_day':day,'p_hold_between':False});assert code==200 and result['status']=='moved',result
 before=state();sql('SELECT rooted_private.set_scheduler_mode('+lit(goal)+','+lit(json.dumps(before))+'::jsonb,\'atomic_v2\');')
 before=state()
 for patch in [{'date':str(d-datetime.timedelta(days=1)),'scheduled_date':str(d-datetime.timedelta(days=1))},{'queue_pinned':False,'scheduled_source':'plan_cascade_shift'},{'queue_position':99},{'curriculum_goal_id':None},{'user_id':str(uuid.uuid4())}]:
  code,result=http('/rest/v1/lessons?id=eq.'+ids[1],patch,'PATCH');assert code>=400,(code,result);unchanged(before)
 mark('delayed legacy tail/unpin/Undo/slot/detachment/source writes refuse without effects')
 for name,p in [('move_lesson_keep_slot',{'p_lesson_id':ids[2],'p_target_date':str(d+datetime.timedelta(days=7)),'p_local_day':day,'p_hold_between':False}),('move_lesson_to_date',{'p_lesson_id':ids[2],'p_target_date':str(d+datetime.timedelta(days=7))})]:
  code,result=rpc(name,p);assert code>=400 or result.get('status')=='invalid',(code,result);unchanged(before)
 mark('old RPC entry refuses before first write; no missing-function fallback')
 code,result=http('/rest/v1/lessons?curriculum_goal_id=eq.'+goal,{'queue_pinned':True},'PATCH');assert code>=400;unchanged(before)
 mark('multi-row direct statement refuses atomically')
 code,result=http('/rest/v1/lessons?id=eq.'+ids[0],{'notes':'Synthetic parent note','minutes_spent':12,'title':'Synthetic parent title'},'PATCH');assert code==200,result
 after=state();assert after!=before;assert next(x for x in after['rows'] if x['id']==ids[0])['notes']=='Synthetic parent note';mark('ordinary notes/minutes/title remain available')
 code,result=http('/rest/v1/profiles?id=eq.'+uid,{'school_days':['Mon']},'PATCH');assert code>=400,(code,result);unchanged(after);mark('profile school-day schedule dependency refuses without effects')
 for a in [{'lessonId':ids[3]},{'kind':None,'lessonId':ids[3]},{'kind':'bogus','lessonId':ids[3]}]:
  before=state();code,result=action(a,expected=before);assert code==200 and result['status']=='invalid',(code,result);unchanged(before)
 mark('missing/null/unknown operation kind cannot delete')
 code,result=http('/rest/v1/lessons?id=eq.'+ids[3],{'hours':0.5},'PATCH');assert code==200
 before=state();code,result=action({'kind':'delete','lessonId':ids[3]},expected=before);assert result['status']=='invalid';unchanged(before);mark('recorded hours prevent deletion')
 before=state()
 bridge={'url':private['url'],'anon':private['anon_key'],'token':private['access_token'],'goal':goal,'action':{'kind':'single_move','lessonId':ids[2],'targetDate':str(d+datetime.timedelta(days=6)),'localDay':day}}
 out=subprocess.run(['node',str(B.parent/'rooted-release-package/investigation/containment/client-bridge.mjs')],input=json.dumps(bridge),text=True,capture_output=True);assert out.returncode==0,out.stderr;assert json.loads(out.stdout)['identical_requests']==3;mark('actual TypeScript client recovers two lost server responses using one operation and authoritative Undo')
 before=state();op=str(uuid.uuid4());a={'kind':'single_move','lessonId':ids[2],'targetDate':str(d+datetime.timedelta(days=6)),'localDay':day};code,result=action(a,before,op);assert code==200 and result['status']=='applied',(code,result);moved=state()
 code,result=action(a,before,op);assert result['status']=='already_applied';unchanged(moved);mark('current single move applies and exact lost-response retry is idempotent')
 code,result=rpc('undo_scheduler_action',{'p_operation_id':op});assert code==200 and result['status']=='undone',(code,result)
 restored=state()
 for row in before['rows']:
  got=next(x for x in restored['rows'] if x['id']==row['id']);assert {k:v for k,v in row.items() if k!='updated_at'}=={k:v for k,v in got.items() if k!='updated_at'}
 code,result=rpc('undo_scheduler_action',{'p_operation_id':op});assert result['status']=='already_undone';unchanged(restored);mark('authoritative Undo restores scheduling and repeats without writes')
 before=state();op=str(uuid.uuid4());code,result=action({'kind':'skip','lessonId':ids[2]},before,op);assert code==200 and result['status']=='applied',(code,result)
 code,result=http('/rest/v1/lessons?id=eq.'+ids[2],{'notes':'Synthetic newer note'},'PATCH');assert code==200
 after=state();code,result=rpc('undo_scheduler_action',{'p_operation_id':op});assert result['status']=='stale';unchanged(after);mark('Undo cannot overwrite later parent note')
 code,result=action({'kind':'complete','lessonId':ids[0],'onlyIfIncomplete':True,'payload':{'completed':True,'completed_at':datetime.datetime.now(datetime.timezone.utc).isoformat()} });assert code==200 and result['status']=='applied',(code,result);mark('protected completion with pointer trigger succeeds')
 before=state();code,result=action({'kind':'complete','lessonId':ids[0],'onlyIfIncomplete':True,'payload':{'completed':True,'completed_at':datetime.datetime.now(datetime.timezone.utc).isoformat()}},before);assert result['status']=='stale';unchanged(before);mark('onlyIfIncomplete refuses duplicate completion')

 before=state()
 for table,path,payload,method in [('goal','/rest/v1/curriculum_goals?id=eq.'+goal,{'start_date':str(d+datetime.timedelta(days=5))},'PATCH'),('delete','/rest/v1/lessons?id=eq.'+ids[3],None,'DELETE'),('insert','/rest/v1/lessons',{'id':str(uuid.uuid4()),'user_id':uid,'child_id':fixture['child'],'curriculum_goal_id':goal,'title':'Forbidden synthetic insert','date':day},'POST'),('calendar','/rest/v1/vacation_blocks',{'user_id':uid,'start_date':day,'end_date':day},'POST'),('timezone','/rest/v1/profiles?id=eq.'+uid,{'timezone':'UTC'},'PATCH')]:
  code,result=http(path,payload,method);assert code>=400,(table,code,result);unchanged(before)
 mark('goal settings, insert/delete, calendar and timezone bypasses refuse before mutation')
 other_id=str(uuid.uuid4());other_email='containment-'+other_id+'@isolated.invalid';other_password=str(uuid.uuid4())
 code,user=http('/auth/v1/admin/users',{'id':other_id,'email':other_email,'password':other_password,'email_confirm':True},token=private['service_role_key']);assert code in (200,201)
 try:
  code,other=http('/auth/v1/token?grant_type=password',{'email':other_email,'password':other_password});assert code==200
  code,result=http('/rest/v1/rpc/read_scheduler_state',{'p_goal_id':goal},token=other['access_token']);assert code==200 and result['status']=='invalid'
  code,result=http('/rest/v1/rpc/undo_scheduler_action',{'p_operation_id':op},token=other['access_token']);assert code==200 and result['status']=='invalid';unchanged(before)
 finally:sql('DELETE FROM auth.users WHERE id='+lit(other_id)+';')
 mark('actual second authenticated owner cannot read goal or use owned Undo receipt')
 code,result=rpc('read_scheduler_state',{'p_goal_id':str(uuid.uuid4())});assert result['status']=='invalid'
 code,result=http('/rest/v1/rpc/commit_scheduler_action',{'p_operation_id':str(uuid.uuid4()),'p_goal_id':goal,'p_expected':before,'p_action':{'kind':'skip','lessonId':ids[1]}},token=private['anon_key']);assert code>=400;unchanged(before)
 assert sql("SELECT has_table_privilege('authenticated','rooted_private.scheduler_capabilities','INSERT') OR has_function_privilege('authenticated','rooted_private.scheduler_allow(uuid,text,uuid[],text[],text[],uuid[],jsonb)','EXECUTE');")=='f';mark('anonymous/wrong goal/private capability access refused')
 # Force failure after another row has been held by the single-move function.
 sql("CREATE FUNCTION rooted_private.synthetic_containment_fault() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.id="+lit(ids[1])+"::uuid AND NEW.scheduled_date IS DISTINCT FROM OLD.scheduled_date THEN RAISE EXCEPTION 'synthetic injected second-row failure';END IF;RETURN NEW;END $$; CREATE TRIGGER zzz_synthetic_containment_fault BEFORE UPDATE ON lessons FOR EACH ROW EXECUTE FUNCTION rooted_private.synthetic_containment_fault();")
 try:
  code,result=action({'kind':'single_move','lessonId':ids[1],'targetDate':str(d+datetime.timedelta(days=10)),'localDay':day},before);assert code>=400 or result['status']!='applied',(code,result);unchanged(before)
 finally:sql('DROP TRIGGER zzz_synthetic_containment_fault ON lessons; DROP FUNCTION rooted_private.synthetic_containment_fault();')
 mark('injected later-row failure rolls back prior holds and primary move')
 locker=Conn()
 try:
  for lock in ["SELECT id FROM lessons WHERE id="+lit(ids[3])+" FOR UPDATE;", "SELECT id FROM profiles WHERE id="+lit(uid)+" FOR UPDATE;", 'LOCK TABLE vacation_blocks IN ROW EXCLUSIVE MODE;']:
   locker.run('BEGIN; '+lock)
   started=time.monotonic();code,result=action({'kind':'skip','lessonId':ids[1]},before);elapsed=time.monotonic()-started
   assert code==200 and result['status']=='busy' and elapsed<3,(code,result,elapsed);unchanged(before)
   # A busy refusal must release every partial goal/row lock immediately.
   sql("BEGIN; SET LOCAL lock_timeout='100ms'; SELECT id FROM curriculum_goals WHERE id="+lit(goal)+" FOR UPDATE NOWAIT; ROLLBACK;")
   locker.run('ROLLBACK;')
  op=str(uuid.uuid4());locker.run('BEGIN; SELECT pg_advisory_xact_lock(hashtextextended('+lit(op)+'::text,0));')
  started=time.monotonic();code,result=action({'kind':'skip','lessonId':ids[1]},before,op);assert code==200 and result['status']=='busy' and time.monotonic()-started<3;unchanged(before);locker.run('ROLLBACK;')
 finally:locker.close()
 mark('lesson/profile/vacation/advisory contention is bounded and releases partial locks')

 assert sql('SELECT count(*) FROM rooted_private.scheduler_capabilities;')=='0';mark('success/refusal leave no reusable capabilities')
 window=json.loads(sql('SELECT rooted_private.cascade_local_window('+lit(uid)+','+lit(day)+');'))
 code,read=rpc('read_cascade_snapshot',{'p_goal_id':goal,'p_local_day':day,'p_day_start':window['dayStartIso'],'p_day_end':window['dayEndIso']});assert code==200 and read['status']=='ready',read
 snapshot=read['snapshot'];source=B.parent/'rooted-release-package';bridge=(B/'remaining-builder-bridge.mjs').read_text().replace('../rooted-recurrence-local/','../rooted-release-package/');(B/'containment-builder-bridge.mjs').write_text(bridge)
 built=subprocess.run(['node',str(B/'containment-builder-bridge.mjs')],input=json.dumps({'goal':snapshot['goal'],'rows':snapshot['rows'],'snapshot':snapshot,'requestId':str(uuid.uuid4())}),text=True,capture_output=True);assert built.returncode==0,built.stderr;plan=json.loads(built.stdout)
 builder={'p_goal_id':goal,'p_local_day':day,'p_expected':plan['expected'],'p_plan':plan['plan'],'p_settings':None}
 code,result=rpc('apply_builder_rebuild',builder);assert code==200 and result['status']=='applied',(code,result);before=state();mark('current guarded Builder no-change transaction succeeds in protected mode')
 sql('SELECT rooted_private.set_scheduler_mode('+lit(goal)+','+lit(json.dumps(before))+'::jsonb,\'paused\');')
 code,result=action({'kind':'skip','lessonId':ids[1]},before);assert result['status']=='paused';unchanged(before);mark('pause blocks fresh action without enabling legacy writers')
 code,result=rpc('apply_builder_rebuild',builder);assert code==200 and result['status']=='applied' and result.get('replayed') is True,(code,result);unchanged(before);mark('paused Builder retains owned exact-request replay')
finally:
 # Explicit teardown of only this disposable test cohort; all existing rows preserved.
 sql('DELETE FROM rooted_private.scheduler_modes WHERE goal_id='+lit(goal)+'; UPDATE lessons SET queue_preserved=false WHERE curriculum_goal_id='+lit(goal)+'; DELETE FROM lessons WHERE curriculum_goal_id='+lit(goal)+'; DELETE FROM curriculum_goals WHERE id='+lit(goal)+'; DELETE FROM rooted_private.scheduler_action_receipts WHERE goal_id='+lit(goal)+';')
 final=json.loads(sql("SELECT jsonb_build_object('rows',(SELECT jsonb_agg(to_jsonb(l) ORDER BY id) FROM lessons l),'goals',(SELECT jsonb_agg(to_jsonb(g) ORDER BY id) FROM curriculum_goals g));"));assert final==base,'Existing fixture changed'
 (B/'containment-postgrest-results.json').write_text(json.dumps({'passed':results,'existing_fixture_exact':True},indent=2))
