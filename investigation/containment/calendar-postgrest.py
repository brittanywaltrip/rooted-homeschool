from pathlib import Path
B=Path(__file__).resolve().parent
exec((B/'containment-postgrest.py').read_text().split('fixture=json.loads')[0])
fixture=json.loads((B/'fixture-shape.json').read_text());checks=[];uid=None;existing_token=private['access_token']
baseline=json.loads(sql("SELECT jsonb_build_object('rows',(SELECT jsonb_agg(to_jsonb(l) ORDER BY id) FROM lessons l),'goals',(SELECT jsonb_agg(to_jsonb(g) ORDER BY id) FROM curriculum_goals g),'vacations',(SELECT jsonb_agg(to_jsonb(v) ORDER BY id) FROM vacation_blocks v),'profiles',(SELECT jsonb_agg(to_jsonb(p) ORDER BY id) FROM profiles p));"))
def mark(s):checks.append(s);print('PASS',s,flush=True)
def rpc(n,p={}):return http('/rest/v1/rpc/'+n,p)
def state():
 c,r=rpc('read_scheduler_calendar');assert c==200 and r['status']=='ready',(c,r);return r
def apply(a,writes=[],expected=None,op=None):
 s=state();p={'p_operation_id':op or str(uuid.uuid4()),'p_expected':expected or s['snapshot'],'p_action':dict(a,localDay=s['localDay']),'p_writes':writes};c,r=rpc('commit_scheduler_calendar',p);return c,r,p
def undo(op):return rpc('undo_scheduler_calendar',{'p_operation_id':op})
def assert_business(a,b):
 a=json.loads(json.dumps(a));b=json.loads(json.dumps(b))
 for s in [a,b]:
  for r in s['rows']:r.pop('updated_at',None)
 assert a==b,'Business fields differ'
try:
 source=(B.parent/'rooted-release-package/investigation/containment/calendar.sql').read_text()
 sql('BEGIN;'+source.replace('CREATE TABLE rooted_private.scheduler_calendar_receipts','CREATE TABLE IF NOT EXISTS rooted_private.scheduler_calendar_receipts').replace('CREATE FUNCTION','CREATE OR REPLACE FUNCTION')+"COMMIT; NOTIFY pgrst,'reload schema';")
 mark('calendar SQL compiles transactionally on isolated PostgreSQL')
 email='calendar-'+str(uuid.uuid4())+'@rooted.invalid';password='Synthetic-'+str(uuid.uuid4())
 c,r=http('/auth/v1/admin/users',{'email':email,'password':password,'email_confirm':True},token=private['service_role_key']);assert c==200,(c,str(r)[:100]);uid=r['id']
 c,r=http('/auth/v1/token?grant_type=password',{'email':email,'password':password});assert c==200;private['access_token']=r['access_token']
 child=str(uuid.uuid4());year=str(uuid.uuid4());goal=str(uuid.uuid4());ids=[str(uuid.uuid4()) for _ in range(3)]
 sql("INSERT INTO profiles(id,timezone,school_days) VALUES("+lit(uid)+",'UTC',ARRAY['monday','tuesday','wednesday','thursday','friday']) ON CONFLICT(id) DO UPDATE SET timezone='UTC';INSERT INTO children SELECT (jsonb_populate_record(NULL::children,to_jsonb(c)||jsonb_build_object('id',"+lit(child)+",'user_id',"+lit(uid)+"))).* FROM children c WHERE id="+lit(fixture['child'])+";INSERT INTO school_years SELECT (jsonb_populate_record(NULL::school_years,to_jsonb(y)||jsonb_build_object('id',"+lit(year)+",'user_id',"+lit(uid)+"))).* FROM school_years y WHERE id="+lit(fixture['year'])+';')
 d=datetime.date.fromisoformat(sql("SELECT (now() AT TIME ZONE 'UTC')::date;"));start=d+datetime.timedelta(days=7-d.weekday());dates=[str(start+datetime.timedelta(days=i)) for i in range(3)]
 q="INSERT INTO curriculum_goals(id,user_id,child_id,school_year_id,curriculum_name,total_lessons,current_lesson,start_date,start_at_lesson,school_days,lessons_per_day) VALUES("+','.join(map(lit,[goal,uid,child,year,'Synthetic calendar']))+",3,0,"+lit(dates[0])+",1,ARRAY['Mon','Tue','Wed','Thu','Fri'],1);"
 for i,rid in enumerate(ids):q+="INSERT INTO lessons(id,user_id,child_id,school_year_id,curriculum_goal_id,title,date,scheduled_date,lesson_number,queue_position,scheduled_source,notes,minutes_spent) VALUES("+','.join(map(lit,[rid,uid,child,year,goal,'Synthetic calendar '+str(i),dates[i],dates[i]]))+','+str(i+1)+','+str(i+1)+",'wizard_create','Keep this work',17);"
 sql(q)
 c,r=rpc('read_scheduler_state',{'p_goal_id':goal});assert c==200
 sql('SELECT rooted_private.set_scheduler_mode('+lit(goal)+','+lit(json.dumps(r['snapshot']))+"::jsonb,'atomic_v2');")
 base=state()['snapshot'];assert state()['mode']=='atomic_v2';mark('fresh separate synthetic owner activated; original fixture untouched')
 a={'kind':'add','name':'Synthetic break','startDate':dates[0],'endDate':dates[1],'shift':False}
 c,r,p=apply(a);assert c==200 and r['status']=='applied',(c,r);op=p['p_operation_id'];vid=r['blockId'];after=state()['snapshot'];assert after['rows']==base['rows'];assert len(after['vacations'])==1;mark('metadata-only add changes no lesson fields')
 c,r=rpc('commit_scheduler_calendar',p);assert r['status']=='already_applied';assert state()['snapshot']==after
 c,r=undo(op);assert r['status']=='undone',r;assert state()['snapshot']==base
 c,r=rpc('commit_scheduler_calendar',p);assert r['status']=='already_undone';assert sql('SELECT before_state IS NULL AND after_state IS NULL AND length(after_hash)=64 AND length(request_hash)=64 FROM rooted_private.scheduler_calendar_receipts WHERE id='+lit(op))=='t';mark('add exact Undo scrubs snapshots; replay cannot claim reapplied')
 # Real TypeScript mapper + two responses lost after actual commit + receipt Undo.
 bridge={'url':private['url'],'anon':private['anon_key'],'token':private['access_token'],'action':dict(a,shift=True)}
 out=subprocess.run(['node',str(B.parent/'rooted-release-package/investigation/containment/calendar-client-bridge.mjs')],input=json.dumps(bridge),text=True,capture_output=True);assert out.returncode==0,out.stderr;assert json.loads(out.stdout)['identical_requests']==3
 assert_business(state()['snapshot'],base);mark('actual TS shift mapper/lowercase days, two lost responses, exact replay and Undo preserve work')
 # Explicit inverse uses current scope and its own authoritative Undo.
 shifted=[{'id':ids[i],'date':str(start+datetime.timedelta(days=i+2))} for i in range(3)]
 c,r,forward=apply(dict(a,shift=True),shifted);assert r['status']=='applied',r;shifted_state=state()['snapshot'];shift_id=r['blockId']
 c,r,reverse=apply({'kind':'remove','id':shift_id,'shift':True},[{'id':ids[i],'date':dates[i]} for i in range(3)]);assert r['status']=='applied',r
 assert [x['scheduled_date'] for x in sorted(state()['snapshot']['rows'],key=lambda x:x['queue_position'])]==dates
 assert undo(reverse['p_operation_id'])[1]['status']=='undone';assert_business(state()['snapshot'],shifted_state)
 # Forward Undo is now intentionally stale because the inverse/Undo touched timestamps.
 assert undo(forward['p_operation_id'])[1]['status']=='stale'
 c,r,_=apply({'kind':'remove','id':shift_id,'shift':True},[{'id':ids[i],'date':dates[i]} for i in range(3)]);assert r['status']=='applied'
 mark('explicit fresh inverse and its receipt Undo work; earlier operation remains stale')
 # Reject scope injection and ownership before mutations.
 before=state()['snapshot'];c,r,_=apply(dict(a,shift=True),[dict(w,notes='forged') for w in shifted]);assert r['status']=='invalid';assert state()['snapshot']==before
 c,r=http('/rest/v1/rpc/commit_scheduler_calendar',forward,token=existing_token);assert c==200 and r['status']=='invalid';assert state()['snapshot']==before
 mark('extra write fields and another owner replay refuse with no effects')
 # Force an exception after calendar insert, during a later lesson update.
 sql("CREATE FUNCTION rooted_private.calendar_test_abort() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.id="+lit(ids[-1])+"::uuid THEN RAISE EXCEPTION 'synthetic forced calendar failure';END IF;RETURN NEW;END $$; CREATE TRIGGER zzz_calendar_test_abort AFTER UPDATE ON lessons FOR EACH ROW EXECUTE FUNCTION rooted_private.calendar_test_abort();")
 try:
  before=state()['snapshot'];c,r,_=apply(dict(a,shift=True),shifted);assert r['status']=='invalid';assert state()['snapshot']==before;assert sql('SELECT count(*) FROM rooted_private.scheduler_capabilities;')=='0'
 finally:sql('DROP TRIGGER zzz_calendar_test_abort ON lessons; DROP FUNCTION rooted_private.calendar_test_abort();')
 mark('forced mid-transaction failure rolls back calendar, every lesson, receipt and capabilities')
 # Keep one block through metadata edit/end-now/remove and undo each.
 c,r,p=apply(a);assert r['status']=='applied',r;vid=r['blockId'];base_with=state()['snapshot']
 c,r,edit=apply({'kind':'edit','id':vid,'name':'Edited synthetic','startDate':dates[1],'endDate':dates[2]});assert r['status']=='applied',r;assert state()['snapshot']['rows']==base_with['rows'];assert undo(edit['p_operation_id'])[1]['status']=='undone';assert state()['snapshot']==base_with;mark('edit metadata and exact Undo preserve full lessons')
 c,r,end=apply({'kind':'endnow','id':vid});assert r['status']=='applied',r;assert next(v for v in state()['snapshot']['vacations'] if v['id']==vid)['end_date']==dates[0];assert undo(end['p_operation_id'])[1]['status']=='undone';assert state()['snapshot']==base_with;mark('end-now clamps to future start; Undo restores period')
 c,r,remove=apply({'kind':'remove','id':vid,'shift':False});assert r['status']=='applied';assert not state()['snapshot']['vacations'];assert undo(remove['p_operation_id'])[1]['status']=='undone';assert state()['snapshot']==base_with;mark('remove/Undo retains original block identity and metadata')
 # Exact preimage and post-image guard.
 stale=state()['snapshot'];c,r=http('/rest/v1/lessons?id=eq.'+ids[0],{'notes':'Later parent note'},'PATCH');assert c==200
 c,r,_=apply({'kind':'edit','id':vid,'name':'Must refuse','startDate':dates[0],'endDate':dates[1]},expected=stale);assert r['status']=='stale';current=state()['snapshot'];assert undo(p['p_operation_id'])[1]['status']=='stale';assert state()['snapshot']==current;mark('stale commit and Undo after later notes refuse without effects')
 # Preserved work refuses shift before metadata insertion.
 sql('DELETE FROM rooted_private.scheduler_modes WHERE goal_id='+lit(goal)+'; UPDATE lessons SET queue_preserved=true WHERE id='+lit(ids[0])+';')
 c,s=rpc('read_scheduler_state',{'p_goal_id':goal});sql('SELECT rooted_private.set_scheduler_mode('+lit(goal)+','+lit(json.dumps(s['snapshot']))+"::jsonb,'atomic_v2');")
 before=state()['snapshot'];c,r,_=apply(dict(a,shift=True),[{'id':ids[i],'date':str(start+datetime.timedelta(days=i+2))} for i in range(3)]);assert r['status']=='invalid',r;assert state()['snapshot']==before;mark('preserved unfinished redate refuses whole calendar operation')
 # Lock failure must leave no mutation/capability; independent owner goal lock available.
 holder=Conn();caller=Conn()
 try:
  holder.run('BEGIN; SELECT 1 FROM lessons WHERE id='+lit(ids[-1])+' FOR UPDATE;')
  c,r,_=apply({'kind':'edit','id':vid,'name':'Busy','startDate':dates[0],'endDate':dates[1]});assert r['status']=='busy',r;assert state()['snapshot']==before
  caller.run('BEGIN; SELECT 1 FROM curriculum_goals WHERE id='+lit(goal)+' FOR UPDATE NOWAIT; ROLLBACK;')
 finally:holder.run('ROLLBACK;');holder.close();caller.close()
 assert sql('SELECT count(*) FROM rooted_private.scheduler_capabilities;')=='0';mark('contention refuses promptly; acquired goal locks and capabilities released')
 # Expiry keeps compact idempotency proof and rejects Undo.
 c,r,exp=apply({'kind':'edit','id':vid,'name':'Expire','startDate':dates[0],'endDate':dates[1]});assert r['status']=='applied'
 sql('UPDATE rooted_private.scheduler_calendar_receipts SET created_at=now()-interval \'11 minutes\' WHERE id='+lit(exp['p_operation_id'])+';')
 before=state()['snapshot'];c,r=undo(exp['p_operation_id']);assert r['reason']=='undo_expired';assert state()['snapshot']==before
 assert sql('SELECT before_state IS NULL AND after_state IS NULL FROM rooted_private.scheduler_calendar_receipts WHERE id='+lit(exp['p_operation_id']))=='t';assert rpc('commit_scheduler_calendar',exp)[1]['status']=='already_applied';mark('Undo expiry scrubs snapshots without losing replay identity')
finally:
 if uid:
  sql('DELETE FROM rooted_private.scheduler_modes WHERE goal_id IN (SELECT id FROM curriculum_goals WHERE user_id='+lit(uid)+'); UPDATE lessons SET queue_preserved=false WHERE user_id='+lit(uid)+'; DELETE FROM lessons WHERE user_id='+lit(uid)+'; DELETE FROM curriculum_goals WHERE user_id='+lit(uid)+'; DELETE FROM vacation_blocks WHERE user_id='+lit(uid)+'; DELETE FROM school_years WHERE user_id='+lit(uid)+'; DELETE FROM children WHERE user_id='+lit(uid)+'; DELETE FROM rooted_private.scheduler_calendar_receipts WHERE user_id='+lit(uid)+';')
  c,r=http('/auth/v1/admin/users/'+uid,method='DELETE',token=private['service_role_key']);assert c in [200,204],c
 final=json.loads(sql("SELECT jsonb_build_object('rows',(SELECT jsonb_agg(to_jsonb(l) ORDER BY id) FROM lessons l),'goals',(SELECT jsonb_agg(to_jsonb(g) ORDER BY id) FROM curriculum_goals g),'vacations',(SELECT jsonb_agg(to_jsonb(v) ORDER BY id) FROM vacation_blocks v),'profiles',(SELECT jsonb_agg(to_jsonb(p) ORDER BY id) FROM profiles p));"))
 assert final==baseline,'Existing fixture changed';mark('all disposable owner rows removed; existing fixture exact preservation')
 (B/'calendar-postgrest-results.json').write_text(json.dumps({'count':len(checks),'passed':checks},indent=2))
