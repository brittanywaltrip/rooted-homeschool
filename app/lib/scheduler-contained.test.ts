import {test} from 'node:test';
import assert from 'node:assert/strict';
import {commitContainedAction, commitContainedGroups, commitCalendarAction, planCalendarWrites, undoCalendarAction, assertLegacySchedulingEdit, assertLegacyCalendarEdit, planContainedSkip, retrySchedulerAction, undoContainedAction, schedulerRefusalMessage} from './scheduler-contained.ts';
import {completeLessonOnDate} from './completeLessonOnDate.ts';

const row = {id:'l',curriculum_goal_id:'g',queue_position:2,scheduled_date:'2026-10-09',queue_pinned:false,skipped:false,completed:false};
const snapshot = {goal:{id:'g'},rows:[row],vacations:[]};
function fake(mode='atomic_v2', outcomes: unknown[] = [{data:{status:'applied'},error:null}]) {
  const calls: {name:string;args:Record<string,unknown>}[]=[];
  const client = {async rpc(name:string,args:Record<string,unknown>) {
    calls.push({name,args});
    if(name==='read_scheduler_state') return {data:{status:'ready',mode,snapshot},error:null};
    const next=outcomes.shift(); if(next instanceof Error) throw next; return next;
  },from() { const query={select(){return query},eq(){return query},async maybeSingle(){ const placement={...row};delete (placement as Partial<typeof row>).id;return {data:placement,error:null};}};return query; }};
  return {client:client as never,calls};
}
const action = {kind:'single_move',lessonId:'l',targetDate:'2026-10-12',localDay:'2026-10-09'} as const;
test('oneoffs and legacy goals never invoke a protected writer',async()=>{
  const f=fake('legacy'); assert.equal((await commitContainedAction(f.client,null,action)).status,'legacy');assert.equal(f.calls.length,0);
  assert.equal((await commitContainedAction(f.client,'g',action)).status,'legacy');assert.equal(f.calls.length,1);
});
test('atomic goals submit the entire freshly read preimage',async()=>{
  const f=fake();const r=await commitContainedAction(f.client,'g',action);assert.equal(r.status,'applied');
  assert.deepEqual(f.calls[1].args.p_expected,snapshot);assert.deepEqual(f.calls[1].args.p_action,action);assert.match(r.operationId!,/^[0-9a-f-]{36}$/);
});
test('ambiguous failure retains the exact operation and preimage for explicit retry',async()=>{
  const f=fake('atomic_v2',[new Error('connection lost'),new Error('connection lost again'),{data:{status:'already_applied'},error:null}]);
  const r=await commitContainedAction(f.client,'g',action);assert.equal(r.status,'unknown');assert.ok(r.retry);
  const retried=await retrySchedulerAction(f.client,r.retry);assert.equal(retried.status,'already_applied');assert.deepEqual(f.calls[1],f.calls[2]);assert.deepEqual(f.calls[1],f.calls[3]);
});
test('stale/busy/paused/invalid never falls back or automatically retries',async()=>{
  for(const status of ['stale','busy','invalid']){const f=fake('atomic_v2',[{data:{status},error:null}]);assert.equal((await commitContainedAction(f.client,'g',action)).status,status);assert.equal(f.calls.length,2);}
  const f=fake('paused');assert.equal((await commitContainedAction(f.client,'g',action)).status,'paused');assert.equal(f.calls.length,1);
});
test('only missing read endpoint permits legacy fallback; permission/network failures refuse',async()=>{
  for(const code of ['PGRST202','42501']){const c={rpc:async()=>({data:null,error:{code,message:code}})} as never;assert.equal((await commitContainedAction(c,'g',action)).status,code==='PGRST202'?'legacy':'invalid');}
});
test('completion refuses changed placement before committing and emits no event',async()=>{
  const f=fake();const old={...row,scheduled_date:'2026-10-08'};
  const result=await commitContainedAction(f.client,'g',{kind:'complete',lessonId:'l',payload:{completed:true},placement:old});
  assert.equal(result.status,'stale');assert.equal(f.calls.length,1);
});
test('completion uses protected payload/guards, never direct update, and emits only after success',async()=>{
  const f=fake();const events:unknown[]=[];
  const result=await completeLessonOnDate(f.client,{lessonId:'l',dateStr:'2026-10-09',todayStr:'2026-10-09',choice:'today',surface:'plan',onlyIfIncomplete:true,track:e=>events.push(e),extra:{minutes_spent:17}});
  assert.equal(result.error,null);assert.equal(result.contained,true);assert.equal(events.length,1);
  const sent=f.calls[1].args.p_action as {onlyIfIncomplete:boolean;payload:Record<string,unknown>};assert.equal(sent.onlyIfIncomplete,true);assert.equal(sent.payload.minutes_spent,17);assert.equal(sent.payload.completed,true);
});
test('completion ambiguous failure is not presented as success',async()=>{
  const f=fake('atomic_v2',[new Error('lost'),new Error('lost again')]);const events:unknown[]=[];
  const result=await completeLessonOnDate(f.client,{lessonId:'l',dateStr:'2026-10-09',todayStr:'2026-10-09',choice:'today',surface:'plan',track:e=>events.push(e)});
  assert.equal(result.error?.code,'unknown');assert.ok(result.retry);assert.equal(events.length,0);
});
test('receipt Undo retains refusal status and tells parent to reload',async()=>{
  const f=fake('atomic_v2',[{data:{status:'stale'},error:null}]);const r=await undoContainedAction(f.client,'op');assert.equal(r.status,'stale');assert.match(schedulerRefusalMessage(r),/Reload/);assert.deepEqual(f.calls[0].args,{p_operation_id:'op'});
});

test('lost commit response resolves automatically using one identical replay',async()=>{
  const f=fake('atomic_v2',[new Error('response lost'),{data:{status:'already_applied',held:3},error:null}]);
  const result=await commitContainedAction(f.client,'g',action);
  assert.equal(result.status,'already_applied');assert.equal(result.held,3);assert.deepEqual(f.calls[1],f.calls[2]);
});
test('repeated UI tap after two unknown responses reuses token before reading state',async()=>{
  const f=fake('atomic_v2',[new Error('lost'),new Error('lost'),{data:{status:'already_applied'},error:null}]);
  const first=await commitContainedAction(f.client,'g',action);assert.equal(first.status,'unknown');
  const second=await commitContainedAction(f.client,'g',action);assert.equal(second.status,'already_applied');
  assert.equal(first.operationId,second.operationId);assert.deepEqual(f.calls.map(c=>c.name),['read_scheduler_state','commit_scheduler_action','commit_scheduler_action','commit_scheduler_action']);
  assert.deepEqual(f.calls[1],f.calls[3]);
});
test('a different action cannot replace an unresolved operation',async()=>{
  const f=fake('atomic_v2',[new Error('lost'),new Error('lost')]);await commitContainedAction(f.client,'g',action);
  const result=await commitContainedAction(f.client,'g',{...action,targetDate:'2026-10-13'});
  assert.equal(result.status,'unknown');assert.equal(result.reason,'pending_previous_action');assert.equal(f.calls.length,3);
});
test('completion repeated after lost response replays original timestamp and guards',async()=>{
  const f=fake('atomic_v2',[new Error('lost'),new Error('lost'),{data:{status:'already_applied'},error:null}]);
  const args={lessonId:'l',dateStr:'2026-10-09',todayStr:'2026-10-09',choice:'today' as const,surface:'plan' as const,onlyIfIncomplete:true};
  const first=await completeLessonOnDate(f.client,{...args,now:new Date('2026-10-09T10:00:00Z')});assert.equal(first.error?.code,'unknown');
  (f.client as {from:()=>never}).from=()=>{throw new Error('must resolve receipt before fresh read')};
  const second=await completeLessonOnDate(f.client,{...args,now:new Date('2026-10-09T11:00:00Z')});assert.equal(second.error,null);
  assert.equal(second.payload?.completed_at,'2026-10-09T10:00:00.000Z');assert.deepEqual(f.calls[1],f.calls[3]);
});

test('definite database refusals are not retained or replayed as ambiguous',async()=>{
  for(const code of ['P0001','22023','23505','42501','55P03','57014','40001','PGRST202']) {
    const f=fake('atomic_v2',[{data:null,error:{code,message:'refused'}},{data:{status:'applied'},error:null}]);
    const first=await commitContainedAction(f.client,'g',action);
    assert.ok(first.status==='invalid'||first.status==='busy');assert.equal(f.calls.length,2);
    const second=await commitContainedAction(f.client,'g',action);assert.equal(second.status,'applied');
    assert.equal(f.calls[2].name,'read_scheduler_state');assert.notEqual(first.operationId,second.operationId);
  }
});
test('a new completion selection after ambiguity is refused, never treated as the prior success',async()=>{
  const f=fake('atomic_v2',[new Error('lost'),new Error('lost')]);
  const args={lessonId:'l',dateStr:'2026-10-09',todayStr:'2026-10-09',choice:'today' as const,surface:'plan' as const};
  await completeLessonOnDate(f.client,args);
  const result=await completeLessonOnDate(f.client,{...args,dateStr:'2026-10-08',choice:'picked'});
  assert.equal(result.error?.code,'unknown');assert.equal(f.calls.length,3);
});

test('an ambiguous first commit remains pending after a busy replay',async()=>{
  const f=fake('atomic_v2',[new Error('response lost'),{data:{status:'busy'},error:null},{data:{status:'already_applied'},error:null}]);
  const first=await commitContainedAction(f.client,'g',action);assert.equal(first.status,'unknown');
  const second=await commitContainedAction(f.client,'g',action);assert.equal(second.status,'already_applied');
  assert.deepEqual(f.calls[1],f.calls[3]);assert.equal(f.calls.filter(c=>c.name==='read_scheduler_state').length,1);
});
const skipState = () => ({localDay:'2026-10-09',dayStartIso:'2026-10-09T00:00:00Z',dayEndIso:'2026-10-10T00:00:00Z',snapshot:{
  goal:{id:'g',user_id:'u',total_lessons:3,current_lesson:0,lessons_per_day:1,school_days:['Mon','Tue','Wed','Thu','Fri','Sat','Sun'],start_date:'2026-10-09'},
  rows:[0,1,2].map(i=>({...row,id:`l${i+1}`,user_id:'u',lesson_number:i+1,queue_position:i+1,scheduled_date:`2026-10-${9+i}`.replace('-9','-09'),date:`2026-10-${9+i}`.replace('-9','-09'),scheduled_source:'wizard_create',is_backfill:false,continues_lesson_id:null,notes:null,minutes_spent:null,hours:null,updated_at:'v1',completed_at:null})),vacations:[]}});
test('skip projection shifts only eligible tail, keeps snapshot untouched, and refuses absent calendar',()=>{
  const state=skipState();const before=structuredClone(state);
  const plan=planContainedSkip(state,{kind:'set_skipped',lessonIds:['l1'],skipped:true,localDay:'2026-10-09'});
  assert.ok(plan);assert.deepEqual(plan.writes,[{id:'l2',date:'2026-10-09'},{id:'l3',date:'2026-10-10'}]);assert.deepEqual(state,before);
  assert.equal(planContainedSkip({...state,dayStartIso:undefined},{kind:'set_skipped',lessonIds:['l1'],skipped:true,localDay:'2026-10-09'}),null);
});
test('unskip behind pointer explicitly pins today, preserving ordinary tail',()=>{
  const state=skipState();state.snapshot.goal.current_lesson=1;state.snapshot.rows[0].skipped=true;
  const plan=planContainedSkip(state,{kind:'set_skipped',lessonIds:['l1'],skipped:false,localDay:'2026-10-09',restoreDates:{l1:'2026-10-09'}});
  assert.ok(plan);assert.ok(plan.writes?.some(write=>write.id==='l1'&&write.date==='2026-10-09'&&write.queue_pinned));
});
test('bulk preflight reads every goal before first write and reports independent outcomes',async()=>{
  const calls:string[]=[];const c={async rpc(name:string,args:Record<string,unknown>){calls.push(`${name}:${args.p_goal_id}`);
    if(name==='read_scheduler_state')return {data:{status:'ready',mode:'atomic_v2',...skipState()},error:null};
    return {data:{status:args.p_goal_id==='g1'?'applied':'stale'},error:null};}} as never;
  const result=await commitContainedGroups(c,['g1','g2'].map(goalId=>({goalId,action:{kind:'set_skipped',lessonIds:[goalId==='g1'?'l1':'l2'],skipped:true,localDay:'2026-10-09'}})));
  assert.deepEqual(calls.slice(0,2),['read_scheduler_state:g1','read_scheduler_state:g2']);assert.deepEqual(result.map(item=>item.result.status),['applied','stale']);
});

test('calendar preflight includes later pages and refuses protected offscreen goals',async()=>{
  const seen:number[]=[];const modes:string[]=[];
  const c={from(){const q={select(){return q},eq(){return q},order(){return q},async range(offset:number){seen.push(offset);return {error:null,data:offset===0?Array.from({length:100},(_,i)=>({id:`g${i}`})):[{id:'archived-protected'}]};}};return q;},
    async rpc(_name:string,args:Record<string,string>){modes.push(args.p_goal_id);return {error:null,data:{status:'ready',mode:args.p_goal_id==='archived-protected'?'atomic_v2':'legacy'}};}} as never;
  await assert.rejects(assertLegacyCalendarEdit(c,'u'),/Nothing changed/);assert.deepEqual(seen,[0,100]);assert.equal(modes.at(-1),'archived-protected');
});
test('recalibration preflight allows legacy only and refuses unreadable state',async()=>{
  await assertLegacySchedulingEdit(fake('legacy').client,['g'],'blocked');
  await assert.rejects(assertLegacySchedulingEdit(fake('atomic_v2').client,['g'],'blocked'),/blocked/);
  const c={rpc:async()=>({error:{code:'42501'},data:null})} as never;
  await assert.rejects(assertLegacySchedulingEdit(c,['g'],'blocked'),/Nothing changed/);
});
test('skip projection preserves a prefix marker and existing later pin',()=>{
  const state=skipState();const rows=state.snapshot.rows as Array<typeof state.snapshot.rows[number]&{queue_preserved?:boolean}>;
  rows[0].queue_preserved=true;rows[2].queue_pinned=true;
  const plan=planContainedSkip(state,{kind:'set_skipped',lessonIds:['l2'],skipped:true,localDay:'2026-10-09'});
  assert.ok(plan);assert.deepEqual(plan.writes,[]);
  rows[2].queue_position=null as unknown as number;
  assert.equal(planContainedSkip(state,{kind:'set_skipped',lessonIds:['l2'],skipped:true,localDay:'2026-10-09'}),null);
});
test('skip projection respects a vacation instead of moving the next lesson into it',()=>{
  const state=skipState();state.snapshot.vacations=[{start_date:'2026-10-09',end_date:'2026-10-09'}] as never[];
  const plan=planContainedSkip(state,{kind:'set_skipped',lessonIds:['l1'],skipped:true,localDay:'2026-10-09'});
  assert.ok(plan);assert.ok(plan.writes?.every(write=>write.date!=='2026-10-09'));
});

const calendarSnapshot = () => ({profile:{id:'u',school_days:['monday','tuesday','wednesday','thursday','friday'],timezone:'UTC'},goals:[{id:'g'}],
  rows:[12,13,14].map((day,i)=>({id:`c${i}`,completed:false,date:`2026-10-${day}`,scheduled_date:`2026-10-${day}`,queue_preserved:false})),vacations:[] as Array<{id:string;name:string;start_date:string;end_date:string;shift_applied?:boolean}>});
const breakAction={kind:'add',name:'Break',startDate:'2026-10-12',endDate:'2026-10-13',shift:true} as const;
test('calendar shift retains existing ordinal mapping and lowercase profile days',()=>{
  const snapshot=calendarSnapshot();const before=structuredClone(snapshot);
  assert.deepEqual(planCalendarWrites(snapshot,breakAction),[{id:'c0',date:'2026-10-14'},{id:'c1',date:'2026-10-15'},{id:'c2',date:'2026-10-16'}]);assert.deepEqual(snapshot,before);
});
test('calendar metadata-only preserves rows; shift refuses preserved unfinished work',()=>{
  const snapshot=calendarSnapshot();snapshot.rows[0].queue_preserved=true;
  assert.equal(planCalendarWrites(snapshot,breakAction),null);
  assert.deepEqual(planCalendarWrites(snapshot,{...breakAction,shift:false}),[]);
});
test('explicit remove inversion uses current rows; it is distinct from receipt Undo',()=>{
  const snapshot=calendarSnapshot();snapshot.vacations=[{id:'v',name:'Break',start_date:'2026-10-12',end_date:'2026-10-13',shift_applied:true}];
  snapshot.rows.forEach((row,i)=>{row.date=row.scheduled_date=`2026-10-${14+i}`;});
  assert.deepEqual(planCalendarWrites(snapshot,{kind:'remove',id:'v',shift:true}),[{id:'c0',date:'2026-10-12'},{id:'c1',date:'2026-10-13'},{id:'c2',date:'2026-10-14'}]);
});
test('calendar unknown then busy keeps exact operation for repeated action',async()=>{
  const calls:Array<{name:string;args:unknown}>=[];const outcomes=[new Error('lost'),{status:'busy'},{status:'already_applied',blockId:'v',written:3}];
  const c={async rpc(name:string,args:unknown){calls.push({name,args});if(name==='read_scheduler_calendar')return {data:{status:'ready',mode:'atomic_v2',localDay:'2026-10-09',snapshot:calendarSnapshot()},error:null};
    const value=outcomes.shift();if(value instanceof Error)throw value;return {data:value,error:null};}} as never;
  const first=await commitCalendarAction(c,breakAction);assert.equal(first.status,'unknown');
  const second=await commitCalendarAction(c,breakAction);assert.equal(second.status,'already_applied');assert.equal(second.blockId,'v');assert.deepEqual(calls[1],calls[3]);assert.equal(calls.filter(call=>call.name==='read_scheduler_calendar').length,1);
});
test('calendar Undo sends only receipt identity and preserves stale refusal',async()=>{
  const calls:unknown[]=[];const c={async rpc(name:string,args:unknown){calls.push({name,args});return {data:{status:'stale'},error:null};}} as never;
  assert.equal((await undoCalendarAction(c,'receipt')).status,'stale');assert.deepEqual(calls,[{name:'undo_scheduler_calendar',args:{p_operation_id:'receipt'}}]);
});
