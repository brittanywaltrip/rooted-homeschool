// Disposable local PostgreSQL only. No .env, remote credentials or network DB.
import { execFileSync, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import {computeNextLessonsForGoal,queueHoldsFromRows} from '../app/lib/scheduler.ts';
import {countDoneToday} from '../app/lib/phase2-commit.ts';
import { planAnchoredCascade } from '../app/lib/cascade-shift-plan.ts';
const runAsync=promisify(execFile);
const root=mkdtempSync('/tmp/rooted-cascade-atomic-');
const bin='/opt/homebrew/opt/postgresql@17/bin/';
const port='56939';
const env={...process.env,PGHOST:root,PGPORT:port,PGUSER:'postgres',PGDATABASE:'postgres'};
const U='bbbbbbbb-0000-4000-8000-000000000001', OTHER='bbbbbbbb-0000-4000-8000-000000000002', G='aaaaaaaa-0000-4000-8000-000000000001';
const L=n=>`cccccccc-0000-4000-8000-${String(n).padStart(12,'0')}`;
const quote=s=>`'${String(s).replaceAll("'","''")}'`;
const q=(sql)=>execFileSync(bin+'psql',['-X','-q','-A','-t','-v','ON_ERROR_STOP=1','-c',sql],{env,encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
const as=(sql,user=U)=>`set role authenticated; set request.jwt.claims=${quote(JSON.stringify({sub:user,role:'authenticated'}))}; ${sql}`;
const json=(sql,user=U)=>JSON.parse(q(as(sql,user)).split('\n').at(-1));
const rpcSQL=(name,args)=>`select public.${name}(${args.map(x=>quote(typeof x==='object'?JSON.stringify(x):x)).join(',')})::text`;
const results=[];
let started=false;
try {
 execFileSync(bin+'initdb',['-D',root+'/data','-U','postgres','-A','trust'],{encoding:'utf8',stdio:'pipe'});
 execFileSync(bin+'pg_ctl',['-D',root+'/data','-o',`-c listen_addresses='' -c unix_socket_directories='${root}' -p ${port}`,'-l',root+'/postgres.log','start','-w'],{encoding:'utf8',stdio:'pipe'});started=true;
 q(readFileSync('supabase/tests/builder-rebuild/stub.sql','utf8'));
 q(`create table auth.users(id uuid primary key); insert into auth.users values('${U}'),('${OTHER}');
 alter table public.lessons add column continues_lesson_id uuid references public.lessons(id);
 alter table public.lessons add constraint rehearsal_goal_fk foreign key(curriculum_goal_id) references public.curriculum_goals(id);
 create table public.vacation_blocks(id uuid primary key default gen_random_uuid(),user_id uuid,start_date date,end_date date);
 create function public.rehearsal_updated() returns trigger language plpgsql as $$ begin
 if new.id::text=current_setting('rehearsal.fail_id',true) then raise exception 'synthetic write failure'; end if;
 new.updated_at=clock_timestamp(); return new; end $$;
 create trigger rehearsal_update before update on public.lessons for each row execute function public.rehearsal_updated();`);
 q(readFileSync('supabase/proposals/cascade_shift_atomic.sql','utf8'));
 q(readFileSync('supabase/migrations/20260921230610_daily_reconcile.sql','utf8'));
 q(readFileSync('supabase/proposals/preserved_daily_reconcile.sql','utf8'));
 q(readFileSync('supabase/proposals/preserved_cleanup_guard.sql','utf8'));
 q('create trigger preserved_cleanup_rehearsal after update of current_lesson on public.curriculum_goals for each row execute function public.curriculum_goals_cleanup_orphans_trg()');
 q("update rooted_private.app_switches set enabled=true where name='daily_reconcile'");
 const today=q("select (now() at time zone 'UTC')::date");
 const add=n=>q(`select (date '${today}'+${n})::text`);
 const label=q(`select to_char(date '${today}','Dy')`);
 function reset(gap=true){q(`truncate rooted_private.cascade_shift_receipts;truncate rooted_private.daily_reconcile_log; update public.lessons set queue_preserved=false;delete from public.lessons;delete from public.vacation_blocks;delete from public.curriculum_goals;
 insert into public.curriculum_goals(id,user_id,total_lessons,current_lesson,school_days,start_date) values('${G}','${U}',3,0,array['${label}'],'${today}');
 insert into public.lessons(id,user_id,curriculum_goal_id,lesson_number,queue_position,scheduled_date,date,queue_pinned,scheduled_source,notes,minutes_spent)
 values('${L(1)}','${U}','${G}',1,1,'${today}','${today}',false,'wizard_create',null,null),
 ('${L(2)}','${U}','${G}',2,2,'${add(gap?21:7)}','${add(gap?21:7)}',${gap},'${gap?'plan_move':'wizard_create'}','synthetic note',25),
 ('${L(3)}','${U}','${G}',3,3,'${add(gap?28:14)}','${add(gap?28:14)}',false,'wizard_create',null,null);`);}
 const snapshot=()=>json(rpcSQL('read_cascade_snapshot',[G,today,today+'T00:00:00Z',add(1)+'T00:00:00Z'])).snapshot;
 function prepare(target=add(7)){const s=snapshot();const c={lessonId:L(1),from:s.rows[0].scheduled_date,to:target};const p=planAnchoredCascade(s,c);assert.ok(p.ok,JSON.stringify(p));return {s,c,p:p.plan,op:randomUUID()};}
 const commit=(v)=>json(rpcSQL('commit_cascade_shift',[v.op,G,v.s,v.c,v.p.writes,v.p.preserved]));
 const undo=(v)=>json(rpcSQL('undo_cascade_shift',[v.op]));
 const restored=(s)=>s.rows.map(r=>{const copy={...r};delete copy.updated_at;return copy;});
 function pass(name){results.push({name,status:'PASS'});console.log('PASS '+name);}
 if(process.env.CASCADE_REVIEW_CASE){
  reset();const check=prepare();
  if(process.env.CASCADE_REVIEW_CASE==='gap'){
   q(`update public.lessons set queue_pinned=false where id='${L(2)}'`);
   check.s=snapshot();check.p.writes[1].before.queue_pinned=false;check.p.writes[1].after.queue_pinned=false;
   assert.equal(planAnchoredCascade(check.s,check.c).ok,false);
   assert.notEqual(commit(check).status,'applied');assert.deepEqual(snapshot(),check.s);
  }else{
   if(process.env.CASCADE_REVIEW_CASE==='undo')assert.equal(commit(check).status,'applied');
   const before=snapshot();
   const body=process.env.CASCADE_REVIEW_CASE==='protected'?"new.notes:='unexpected trigger edit';":"new.date:=old.date;new.scheduled_date:=old.scheduled_date;";
   if(process.env.CASCADE_REVIEW_CASE==='deferred'){
    q(`create function public.rehearsal_silent() returns trigger language plpgsql as $$ begin if new.id='${L(2)}' and current_setting('rehearsal.deferred_fired',true) is distinct from 'yes' then perform set_config('rehearsal.deferred_fired','yes',true);update public.lessons set date=old.date,scheduled_date=old.scheduled_date where id=new.id;end if;return null;end $$;create constraint trigger z_rehearsal_silent after update on public.lessons deferrable initially deferred for each row execute function public.rehearsal_silent();`);
   }else{
   q(`create function public.rehearsal_silent() returns trigger language plpgsql as $$ begin if new.id='${L(2)}' then ${body} end if;return new;end $$;create trigger z_rehearsal_silent before update on public.lessons for each row execute function public.rehearsal_silent();`);
   }
   assert.equal((process.env.CASCADE_REVIEW_CASE==='undo'?undo(check):commit(check)).status,'failed');assert.deepEqual(snapshot(),before);
  }
  pass('review regression '+process.env.CASCADE_REVIEW_CASE);process.exitCode=0;
 }else{
 reset();let v=prepare();let out=commit(v);assert.equal(out.status,'applied');let after=snapshot();
 assert.deepEqual(after.rows.map(r=>r.scheduled_date),[add(7),add(28),add(35)]);assert.deepEqual(after.rows.map(r=>r.queue_pinned),[true,true,false]);
 assert.equal(after.rows[1].notes,'synthetic note');assert.equal(after.rows[1].minutes_spent,25);pass('pinned gap shifts successfully in one real SQL transaction');
 assert.equal(commit(v).status,'already_applied');assert.deepEqual(snapshot(),after);pass('same operation retry writes nothing twice');
 assert.equal(undo(v).status,'undone');assert.deepEqual(restored(snapshot()),restored(v.s));assert.equal(undo(v).status,'already_undone');pass('protected SQL Undo restores exact scheduling fields once');
 reset();v=prepare();q(`update public.lessons set notes='later work' where id='${L(2)}'`);after=snapshot();assert.equal(commit(v).status,'stale');assert.deepEqual(snapshot(),after);pass('stale preflight cannot overwrite later work');
 reset();v=prepare();const fail=json(`set rehearsal.fail_id=${quote(L(2))}; ${rpcSQL('commit_cascade_shift',[v.op,G,v.s,v.c,v.p.writes,v.p.preserved])}`);assert.equal(fail.status,'failed');assert.deepEqual(snapshot(),v.s);assert.equal(q('select count(*) from rooted_private.cascade_shift_receipts'),'0');pass('second-row error rolls back trigger, tail and receipt');
 reset();v=prepare();assert.equal(commit(v).status,'applied');q(`update public.lessons set notes='later note' where id='${L(2)}'`);after=snapshot();assert.equal(undo(v).status,'stale');assert.deepEqual(snapshot(),after);pass('Undo refuses a later note');
 reset();v=prepare();assert.equal(commit(v).status,'applied');q(`update public.lessons set completed=true,completed_at=now() where id='${L(2)}'`);after=snapshot();assert.equal(undo(v).status,'stale');assert.deepEqual(snapshot(),after);pass('Undo refuses a later completion and pointer change');
 reset();v=prepare();assert.equal(commit(v).status,'applied');q(`insert into public.vacation_blocks(user_id,start_date,end_date) values('${U}','${add(35)}','${add(35)}')`);after=snapshot();assert.equal(undo(v).status,'stale');assert.deepEqual(snapshot(),after);pass('Undo refuses changed breaks');
 reset();v=prepare();assert.equal(commit(v).status,'applied');after=snapshot();const undoFail=json(`set rehearsal.fail_id=${quote(L(2))}; ${rpcSQL('undo_cascade_shift',[v.op])}`);assert.equal(undoFail.status,'failed');assert.deepEqual(snapshot(),after);pass('second-row Undo error rolls back every restore');
 reset();v=prepare();let wrong=json(rpcSQL('commit_cascade_shift',[v.op,G,v.s,v.c,v.p.writes,v.p.preserved]),OTHER);assert.equal(wrong.status,'invalid');assert.deepEqual(snapshot(),v.s);pass('another owner cannot commit');
 assert.throws(()=>q(`set role anon; ${rpcSQL('read_cascade_snapshot',[G,today,today+'T00:00:00Z',add(1)+'T00:00:00Z'])}`),/permission denied/);pass('anonymous RPC access denied');
 reset();v=prepare();let bad=structuredClone(v);bad.p.writes.pop();assert.equal(commit(bad).status,'invalid');assert.deepEqual(snapshot(),v.s);pass('partial tail payload refused before writes');
 reset();v=prepare();bad=structuredClone(v);bad.p.writes[2].after.queue_pinned=true;assert.equal(commit(bad).status,'invalid');assert.deepEqual(snapshot(),v.s);pass('cannot silently pin the whole tail');
 reset(false);v=prepare();const v2={...v,op:randomUUID()};const statements=[v,v2].map(x=>as(rpcSQL('commit_cascade_shift',[x.op,G,x.s,x.c,x.p.writes,x.p.preserved])));
 const concurrent=await Promise.all(statements.map(sql=>runAsync(bin+'psql',['-X','-q','-A','-t','-v','ON_ERROR_STOP=1','-c',sql],{env,encoding:'utf8'})));
 assert.deepEqual(concurrent.map(r=>JSON.parse(r.stdout.trim()).status).sort(),['applied','stale']);pass('concurrent same-snapshot commits serialize: only one applies');
 reset();v=prepare();assert.equal(commit(v).status,'applied');let vnext=prepare(add(14));let nextPlan=planAnchoredCascade(vnext.s,vnext.c);assert.ok(nextPlan.ok);vnext.p=nextPlan.plan;assert.equal(commit(vnext).status,'applied');assert.deepEqual(snapshot().rows.map(r=>r.scheduled_date),[add(14),add(35),add(42)]);assert.equal(undo(vnext).status,'undone');assert.equal(undo(v).status,'stale');pass('repeated shift succeeds; old Undo token cannot overwrite newer revisions');
 reset(false);
 q(`update public.lessons set date=date-7,scheduled_date=scheduled_date-7`);
 let prefixSnapshot=snapshot();const prefixChoice={lessonId:L(2),from:today,to:add(7)};
 const prefixPlan=planAnchoredCascade(prefixSnapshot,prefixChoice);assert.ok(prefixPlan.ok,JSON.stringify(prefixPlan));
 const prefixOp={s:prefixSnapshot,c:prefixChoice,p:prefixPlan.plan,op:randomUUID()};
 assert.equal(prefixOp.p.writes.length,2);assert.equal(prefixOp.p.preserved.length,1);
 assert.equal(commit(prefixOp).status,'applied');const prefixAfter=snapshot();
 assert.deepEqual(restored(prefixAfter)[0],{...restored(prefixSnapshot)[0],queue_preserved:true});
 assert.deepEqual(prefixAfter.rows.map(r=>r.scheduled_date),[add(-7),add(7),add(14)]);
 assert.equal(q(`select rooted_private.cascade_projection_matches(${quote(JSON.stringify(prefixAfter))}::jsonb)`),'t');
 assert.equal(undo(prefixOp).status,'undone');assert.deepEqual(restored(snapshot()),restored(prefixSnapshot));
 pass('SQL preserves earlier dates/content separately and Undo restores the scope marker');
 prefixSnapshot=snapshot();prefixOp.s=prefixSnapshot;prefixOp.op=randomUUID();prefixOp.p=planAnchoredCascade(prefixSnapshot,prefixChoice).plan;
 assert.equal(commit(prefixOp).status,'applied');
 q(`update public.lessons set completed=true,completed_at='${today}T01:00:00Z' where id='${L(2)}'`);
 const advanced=snapshot();assert.equal(advanced.goal.current_lesson,2);assert.equal(advanced.rows[0].completed,false);assert.equal(advanced.rows[0].queue_preserved,true);
 const expected={goal:{total_lessons:advanced.goal.total_lessons,current_lesson:advanced.goal.current_lesson,lessons_per_day:advanced.goal.lessons_per_day,lessons_per_day_overrides:advanced.goal.lessons_per_day_overrides,school_days:advanced.goal.school_days,start_date:advanced.goal.start_date},vacations:[],pins:[],skipped:[],preserved:[[1,add(-7)]],done_today:1,day_start:today+'T00:00:00Z',day_end:add(1)+'T00:00:00Z'};
 const staleExpected={...expected};delete staleExpected.preserved;
 const cacheWrites=[{id:L(3),from:add(14),to:add(7)}];
 assert.equal(json(rpcSQL('apply_daily_reconcile',[G,today,staleExpected,cacheWrites])).status,'stale');
 assert.deepEqual(snapshot(),advanced);
 assert.equal(json(rpcSQL('apply_daily_reconcile',[G,today,expected,cacheWrites])).status,'applied');
 const rolled=snapshot();assert.deepEqual(rolled.rows[0],advanced.rows[0]);assert.equal(rolled.rows[2].scheduled_date,add(7));assert.equal(q(`select rooted_private.cascade_projection_matches(${quote(JSON.stringify(rolled))}::jsonb)`),'t');
 pass('completion pointer and daily reconciliation retain earlier work; old daily payload refuses');
 assert.throws(()=>q(as(`update public.lessons set scheduled_date=scheduled_date+7 where id='${L(1)}'`)),/cannot be rescheduled implicitly/);assert.deepEqual(snapshot(),rolled);
 assert.throws(()=>q(as(`delete from public.lessons where id='${L(1)}'`)),/must be explicitly resolved/);assert.deepEqual(snapshot(),rolled);
 pass('unaware direct writer and rebuild deletion cannot erase preserved work');
 // Differential characterization of the independent SQL validator, including
 // first-day rewind, skips, make-ups, variable capacity, breaks and gap pins.
 let parityCases=0;
 for(let variant=0;variant<32;variant++){
  reset(false);
  const pointer=variant%4===0?1:variant%4===1?2:0;
  const weekdaySet=variant%2?[label]:['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];
  const overrides=variant%3===0?{[label]:2}:null;
  q(`update public.curriculum_goals set total_lessons=5,current_lesson=${pointer},school_days=${quote('{'+weekdaySet.join(',')+'}')},lessons_per_day=${variant%3===1?2:1},lessons_per_day_overrides=${overrides?quote(JSON.stringify(overrides))+'::jsonb':'null'};delete from public.lessons;`);
  for(let n=1;n<=5;n++){
   const completed=n<=pointer && !(variant%4===1 && n===1);
   const makeup=variant%4===1 && n===1;
   const pin=makeup || (variant%5===0 && n===4);
   const skipped=variant%7===0 && n===3;
   const date=add(makeup?0:pin?21:n-1);
   q(`insert into public.lessons(id,user_id,curriculum_goal_id,lesson_number,queue_position,scheduled_date,date,queue_pinned,scheduled_source,completed,completed_at,skipped) values('${L(n)}','${U}','${G}',${n},${n},'${date}','${date}',${pin},'wizard_create',${completed},${completed?quote(today+'T01:00:00Z'):'null'},${skipped});`);
  }
  if(variant%6===0)q(`insert into public.vacation_blocks(user_id,start_date,end_date)values('${U}','${add(7)}','${add(9)}')`);
  let current=snapshot();const projected=computeNextLessonsForGoal(current.goal,new Date(today+'T00:00:00'),3650,current.vacations,countDoneToday(current.rows,current.dayStartIso,current.dayEndIso),queueHoldsFromRows(current.rows,G));
  const projectedBySlot=new Map(projected.map(p=>[p.lesson_number,p.date]));
  for(const row of current.rows){if(!row.completed&&!row.skipped&&row.queue_position>pointer){const date=projectedBySlot.get(row.queue_position);assert.ok(date);q(`update public.lessons set date='${date}',scheduled_date='${date}' where id='${row.id}'`);}}
  current=snapshot();assert.equal(q(`select rooted_private.cascade_projection_matches(${quote(JSON.stringify(current))}::jsonb)`),'t',`parity variant ${variant}`);parityCases++;
  const unpinned=current.rows.find(r=>!r.completed&&!r.skipped&&!r.queue_pinned&&r.queue_position>pointer);
  if(unpinned){q(`update public.lessons set date=date+7,scheduled_date=scheduled_date+7 where id='${unpinned.id}'`);current=snapshot();assert.equal(q(`select rooted_private.cascade_projection_matches(${quote(JSON.stringify(current))}::jsonb)`),'f',`mutated parity ${variant}`);parityCases++;}
 }
 pass(`${parityCases} SQL/TypeScript projection parity and mutation checks`);
 reset();
 const {browserRehearsal}=await import('./atomic-browser-rehearsal.mjs');
 const client={rpc:async(name,args)=>{const names={read_cascade_snapshot:['p_goal_id','p_local_day','p_day_start','p_day_end'],commit_cascade_shift:['p_operation_id','p_goal_id','p_expected','p_choice','p_moves','p_preserved'],undo_cascade_shift:['p_operation_id']};return {data:json(rpcSQL(name,names[name].map(key=>args[key]))),error:null};}};
 await browserRehearsal({client,snapshot,goalId:G,lessonId:L(1),today,target:add(7),finish:add(35)});
 pass('browser real callback/coordinator commits a pinned gap and performs SQL receipt Undo');
 writeFileSync('../investigation-evidence/preserved-db-results.json',JSON.stringify({scratch:root,results},null,2));
 console.log(`${results.length} SQL cases passed`);
}
}finally{if(started)execFileSync(bin+'pg_ctl',['-D',root+'/data','stop','-m','fast'],{encoding:'utf8',stdio:'pipe'});}
