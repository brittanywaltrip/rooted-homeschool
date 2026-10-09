"""Synthetic loopback only. Pass path to local-private.json's directory."""
from pathlib import Path
import sys
R=Path(__file__).resolve().parent
runtime=Path(sys.argv[1]).resolve()
source=(R/'containment-postgrest.py').read_text().split('fixture=json.loads')[0]
source=source.replace('B=Path(__file__).resolve().parent;', 'B=runtime;')
exec(source)
fixture=json.loads((B/'fixture-shape.json').read_text());uid=None;checks=[]
def mark(s):checks.append(s);print('PASS',s,flush=True)
def rpc(n,p):return http('/rest/v1/rpc/'+n,p)
def state():
 c,r=rpc('read_scheduler_state',{'p_goal_id':goal});assert c==200 and r['status']=='ready',r;return r

def apply(selected=None,expected=None,day=None):
 s=state();selected=selected or ids[:2];items=[]
 for id in selected:
  row=next(x for x in s['snapshot']['rows'] if x['id']==id)
  items.append({'lessonId':id,'placement':{k:row[k] for k in ['curriculum_goal_id','queue_position','scheduled_date','queue_pinned','skipped','completed']},'payload':{'completed':True,'completed_at':s['localDay']+'T12:00:00Z','date':s['localDay'],'scheduled_date':s['localDay'],'scheduled_source':'completion_today','queue_pinned':False,'is_backfill':False}})
 p={'p_operation_id':str(uuid.uuid4()),'p_goal_id':goal,'p_expected':expected or s['snapshot'],'p_items':items,'p_local_day':day or s['localDay']}
 c,r=rpc('commit_scheduler_bulk_completion',p);return c,r,p

def undo(op):return rpc('undo_scheduler_action',{'p_operation_id':op})
def business(s):
 s=json.loads(json.dumps(s))
 for r in s['rows']:r.pop('updated_at',None)
 s['goal'].pop('updated_at',None)
 return s
try:
 sql((R/'bulk-completion.sql').read_text().replace('CREATE FUNCTION','CREATE OR REPLACE FUNCTION')+"NOTIFY pgrst,'reload schema';")
 # Install only the explicitly owned Undo function update.
 actions=(R/'actions.sql').read_text();definition=actions.split('CREATE FUNCTION public.undo_scheduler_action')[1].split('-- Private maintenance')[0]
 sql('CREATE OR REPLACE FUNCTION public.undo_scheduler_action'+definition)
 mark('bulk RPC and descending Undo compile')
 email='bulk-'+str(uuid.uuid4())+'@rooted.invalid';password='Synthetic-'+str(uuid.uuid4())
 c,r=http('/auth/v1/admin/users',{'email':email,'password':password,'email_confirm':True},token=private['service_role_key']);assert c==200;uid=r['id']
 c,r=http('/auth/v1/token?grant_type=password',{'email':email,'password':password});assert c==200;private['access_token']=r['access_token']
 child=str(uuid.uuid4());year=str(uuid.uuid4());goal=str(uuid.uuid4());ids=[str(uuid.uuid4()) for _ in range(6)]
 sql("INSERT INTO profiles(id,timezone) VALUES("+lit(uid)+",'UTC');INSERT INTO children SELECT (jsonb_populate_record(NULL::children,to_jsonb(c)||jsonb_build_object('id',"+lit(child)+",'user_id',"+lit(uid)+"))).* FROM children c WHERE id="+lit(fixture['child'])+";INSERT INTO school_years SELECT (jsonb_populate_record(NULL::school_years,to_jsonb(y)||jsonb_build_object('id',"+lit(year)+",'user_id',"+lit(uid)+"))).* FROM school_years y WHERE id="+lit(fixture['year'])+';')
 day=sql("SELECT (now() AT TIME ZONE 'UTC')::date;");d=datetime.date.fromisoformat(day)
 q="INSERT INTO curriculum_goals(id,user_id,child_id,school_year_id,curriculum_name,total_lessons,current_lesson,start_date,start_at_lesson,school_days,lessons_per_day) VALUES("+','.join(map(lit,[goal,uid,child,year,'Synthetic atomic bulk']))+",6,0,"+lit(day)+",1,ARRAY['Mon','Tue','Wed','Thu','Fri','Sat','Sun'],1);"
 for i,id in enumerate(ids):
  date=str(d+datetime.timedelta(days=i));q+="INSERT INTO lessons(id,user_id,child_id,school_year_id,curriculum_goal_id,title,date,scheduled_date,lesson_number,queue_position,scheduled_source,notes,minutes_spent) VALUES("+','.join(map(lit,[id,uid,child,year,goal,'Synthetic bulk '+str(i),date,date]))+','+str(i+1)+','+str(i+1)+",'wizard_create','Keep exact notes',17);"
 sql(q)
 # A preserved gap plus previously completed higher slot: Undo must restore the
 # lower selected historical dates without reopening the previously done row.
 sql('UPDATE lessons SET queue_preserved=true WHERE id='+lit(ids[2])+';')
 c,r=http('/rest/v1/lessons?id=eq.'+ids[3],{'completed':True,'completed_at':day+'T12:00:00Z'},'PATCH');assert c==200,(c,r)
 sql('SELECT rooted_private.set_scheduler_mode('+lit(goal)+','+lit(json.dumps(state()['snapshot']))+"::jsonb,'atomic_v2');")
 before=state()['snapshot']
 bridge={'url':private['url'],'anon':private['anon_key'],'token':private['access_token'],'goal':goal,'ids':ids[:2],'day':day}
 out=subprocess.run(['node',str(R/'bulk-completion-client-bridge.mjs')],input=json.dumps(bridge),text=True,capture_output=True);assert out.returncode==0,out.stderr;assert json.loads(out.stdout)['identical_requests']==3
 assert business(state()['snapshot'])==business(before);mark('actual TS helper survives two lost responses and exact receipt Undo')
 before=state()['snapshot']
 c,r,p=apply();assert c==200 and r['status']=='applied',(c,r)
 after=state()['snapshot'];assert all(next(x for x in after['rows'] if x['id']==id)['completed'] for id in ids[:2]);assert all(x['notes']=='Keep exact notes' and x['minutes_spent']==17 for x in after['rows'])
 assert rpc('commit_scheduler_bulk_completion',p)[1]['status']=='already_applied'
 c,r=undo(p['p_operation_id']);assert r['status']=='undone',r;assert business(state()['snapshot'])==business(before)
 assert rpc('commit_scheduler_bulk_completion',p)[1]['status']=='already_undone';mark('higher completed slot, preserved gap, work and exact scheduling Undo; replay safe')
 holder=Conn()
 try:
  holder.run('BEGIN; LOCK TABLE public.lessons IN SHARE ROW EXCLUSIVE MODE;')
  held=state()['snapshot'];c,r,p=apply();assert r['status']=='busy',r;assert state()['snapshot']==held
 finally:holder.run('ROLLBACK;');holder.close()
 mark('calendar-like table contention returns busy without effects')
 before=state()['snapshot'];c,r,p=apply(day=str(d-datetime.timedelta(days=1)));assert r['status']=='stale',r;assert state()['snapshot']==before;mark('midnight caller-day mismatch has zero effects')
 # A silent BEFORE trigger must not create a receipt or partially commit others.
 sql("CREATE FUNCTION rooted_private.bulk_test_suppress() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.id="+lit(ids[1])+"::uuid AND NEW.completed THEN RETURN NULL;END IF;RETURN NEW;END $$;CREATE TRIGGER zzz_bulk_test_suppress BEFORE UPDATE ON lessons FOR EACH ROW EXECUTE FUNCTION rooted_private.bulk_test_suppress();")
 try:
  c,r,p=apply();assert c>=400,(c,r);assert state()['snapshot']==before;assert sql('SELECT count(*) FROM rooted_private.scheduler_action_receipts WHERE id='+lit(p['p_operation_id']))=='0'
 finally:sql('DROP TRIGGER zzz_bulk_test_suppress ON lessons;DROP FUNCTION rooted_private.bulk_test_suppress();')
 mark('silent suppression rolls back earlier completion and leaves no receipt')
 c,r,p=apply();assert r['status']=='applied',r
 c,r=http('/rest/v1/lessons?id=eq.'+ids[0],{'notes':'Later note'},'PATCH');assert c==200
 before=state()['snapshot'];assert undo(p['p_operation_id'])[1]['status']=='stale';assert state()['snapshot']==before;mark('later work makes Undo stale without overwriting notes')
 assert sql('SELECT count(*) FROM rooted_private.scheduler_capabilities WHERE owner_id='+lit(uid))=='0'
finally:
 if uid:
  sql('DELETE FROM rooted_private.scheduler_modes WHERE goal_id IN (SELECT id FROM curriculum_goals WHERE user_id='+lit(uid)+'); UPDATE lessons SET queue_preserved=false WHERE user_id='+lit(uid)+';DELETE FROM lessons WHERE user_id='+lit(uid)+';DELETE FROM curriculum_goals WHERE user_id='+lit(uid)+';DELETE FROM school_years WHERE user_id='+lit(uid)+';DELETE FROM children WHERE user_id='+lit(uid)+';DELETE FROM rooted_private.scheduler_action_receipts WHERE user_id='+lit(uid)+';')
  c,r=http('/auth/v1/admin/users/'+uid,method='DELETE',token=private['service_role_key']);assert c in [200,204]
  assert sql('SELECT count(*) FROM lessons WHERE user_id='+lit(uid))=='0';mark('disposable owner and every owned row/receipt removed')
 (R/'bulk-completion-results.json').write_text(json.dumps({'passed':checks},indent=2))
