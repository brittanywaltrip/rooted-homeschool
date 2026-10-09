import test from "node:test";
import assert from "node:assert/strict";
import { answerMissedYes, MissedCompletionError, type MissedAnswerDeps } from "./missed-work-answers.ts";
import { makeMemorySupabase } from "./test-helpers/memory-supabase.ts";
import type { RecoveryRow } from "./recoverySelection.ts";

const rows: RecoveryRow[] = [1,2].map(n => ({goal_id:"g", lesson_number:n, date:"2026-10-05", choice:"planned"}));
function setup(fail = false) {
  const db = makeMemorySupabase({
    curriculum_goals: [{id:"g", user_id:"u", child_id:"c", curriculum_name:"Math", subject_label:"Math", current_lesson:0, start_at_lesson:1, total_lessons:2, lessons_per_day:1, school_days:["Mon","Tue","Wed","Thu","Fri"], start_date:"2026-10-01", default_minutes:25}],
    lessons: [1,2].map(n => ({id:`l${n}`, user_id:"u", child_id:"c", curriculum_goal_id:"g", lesson_number:n, queue_position:n, completed:false, queue_pinned:false, skipped:false, scheduled_date:"2026-10-05", date:"2026-10-05", minutes_spent:17, hours:17/60})),
    vacation_blocks: [],
  }, {refuseUpdate: (table, row, payload) => fail && table === "lessons" && row.id === "l2" && payload.completed === true});
  const events: string[] = [];
  const deps: MissedAnswerDeps = {supabase:db.client as never, userId:"u", todayStr:"2026-10-08", entriesByGoal:new Map([["g", rows.map(r => ({goal_id:r.goal_id, lesson_number:r.lesson_number, date:r.date}))]]), goals:[{id:"g", child_id:"c", curriculum_name:"Math", subject_label:"Math"}], subjects:[], track: e => {events.push(e);}};
  return {...db, deps, events, allow: () => {fail=false;}};
}

test("zero-row completion stops recovery, reports partial count, and retains real work and time", async () => {
  const f = setup(true);
  // The unchecked sibling would previously mark this goal answered BEFORE
  // the failed completion, hiding unfinished work from the next review.
  f.deps.entriesByGoal.get("g")!.push({goal_id:"g",lesson_number:3,date:"2026-10-06"});
  await assert.rejects(answerMissedYes(f.deps, rows), (err: unknown) => {
    assert.ok(err instanceof MissedCompletionError);
    assert.equal(err.completedCount, 1); assert.equal(err.requestedCount, 2);
    assert.match(err.message, /1 of 2.*Close and reopen/);
    assert.equal((err.cause as {code:string}).code, "placement_changed");
    return true;
  });
  assert.deepEqual(f.tables.lessons.map(r => r.completed), [true,false]);
  assert.deepEqual(f.tables.lessons.map(r => r.minutes_spent), [17,17]);
  assert.deepEqual(f.tables.lessons.map(r => r.hours), [17/60,17/60]);
  assert.equal(f.events.filter(e => e === "lesson_completed").length, 1);
  assert.equal(f.tables.curriculum_goals[0].catchup_answered_on, undefined);
});

test("retry preserves the first completion date/time and confirms only remaining writes", async () => {
  const f = setup(true);
  await assert.rejects(answerMissedYes(f.deps, rows));
  const first = {...f.tables.lessons[0]}; f.allow();
  const result = await answerMissedYes(f.deps, rows.map(r => ({...r,date:"2026-10-06"})));
  assert.deepEqual(result, {completedCount:2});
  assert.deepEqual(f.tables.lessons[0], first);
  assert.equal(f.tables.lessons[1].scheduled_date, "2026-10-06");
  assert.equal(f.events.filter(e => e === "lesson_completed").length, 2);
});

test("successful batch returns the confirmed count", async () => {
  const f = setup();
  assert.deepEqual(await answerMissedYes(f.deps, rows), {completedCount:2});
  assert.deepEqual(f.tables.lessons.map(r => r.completed), [true,true]);
});

test("not_found between lookup and completion is not silently inserted or reported done", async () => {
  const f = setup();
  const from = f.client.from.bind(f.client);
  const proxy = { ...f.client, from(table: string) {
    const base = from(table);
    return {...base, select(cols: string) {
      if (table === "lessons" && cols.startsWith("curriculum_goal_id, queue_position, scheduled_date")) {
        f.tables.lessons = f.tables.lessons.filter(r => r.id !== "l1");
      }
      return base.select(cols);
    }};
  }};
  await assert.rejects(answerMissedYes({...f.deps,supabase:proxy as never}, rows), (err: unknown) => {
    assert.ok(err instanceof MissedCompletionError); assert.equal(err.completedCount, 0);
    assert.equal((err.cause as {code:string}).code, "not_found"); return true;
  });
  assert.equal(f.tables.lessons.length,1);
  assert.equal(f.tables.lessons[0].completed,false);
});

test("failed lookup cannot fall through to a duplicate completion insert", async () => {
  const f = setup();
  const bad = {from: () => {const q = {select:()=>q, eq:()=>q, maybeSingle: async()=>({data:null,error:{message:"read failed"}})};return q;}};
  await assert.rejects(answerMissedYes({...f.deps,supabase:bad as never}, rows), MissedCompletionError);
  assert.deepEqual(f.tables.lessons.map(r => r.completed),[false,false]);
});

test("missing child and unconfirmed insert both fail without a full-success count", async () => {
  for (const missingChild of [true,false]) {
    const f = setup(); f.tables.lessons=[];
    if (missingChild) { f.tables.curriculum_goals[0].child_id=null; f.deps.goals[0].child_id=null; }
    else {
      const from=f.client.from.bind(f.client);
      f.deps.supabase={...f.client,from(table:string) {const base=from(table);return {...base,insert:()=>({select:async()=>({data:[],error:null})})};}} as never;
    }
    await assert.rejects(answerMissedYes(f.deps,rows), MissedCompletionError);
    assert.equal(f.events.filter(e => e === "lesson_completed").length,0);
  }
});

for (const boundary of ["before helper read", "after helper read"] as const) {
  test(`competing completion ${boundary} keeps its date, timestamp, hours and truthful count`, async () => {
    const f = setup();
    const from = f.client.from.bind(f.client);
    let winner: Record<string, unknown> | undefined;
    const completeElsewhere = () => {
      Object.assign(f.tables.lessons[0], {completed:true, completed_at:"2026-10-07T12:00:00Z",
        date:"2026-10-07", scheduled_date:"2026-10-07", queue_pinned:true});
      winner = {...f.tables.lessons[0]};
    };
    f.deps.supabase = {...f.client, from(table: string) {
      const base = from(table);
      return {...base,
        select(cols: string) {
          if (!winner && boundary === "before helper read" && table === "lessons" && cols.startsWith("curriculum_goal_id, queue_position")) completeElsewhere();
          return base.select(cols);
        },
        update(payload: Record<string, unknown>) {
          if (!winner && boundary === "after helper read" && table === "lessons" && payload.completed === true) completeElsewhere();
          return base.update(payload);
        },
      };
    }} as never;
    assert.deepEqual(await answerMissedYes(f.deps, rows), {completedCount:2});
    assert.ok(winner); assert.deepEqual(f.tables.lessons[0], winner);
    assert.equal(f.events.filter(e => e === "lesson_completed").length, 1);
  });
}

test("competing completion with unchanged placement still preserves timestamp and time", async () => {
  const f = setup(); const from = f.client.from.bind(f.client);
  let winner: Record<string, unknown> | undefined;
  f.deps.supabase = {...f.client, from(table: string) {
    const base = from(table);
    return {...base, update(payload: Record<string, unknown>) {
      if (!winner && table === "lessons" && payload.completed === true) {
        Object.assign(f.tables.lessons[0], {completed:true,completed_at:"2026-10-05T19:22:00Z",minutes_spent:43,hours:43/60});
        winner={...f.tables.lessons[0]};
      }
      return base.update(payload);
    }};
  }} as never;
  assert.deepEqual(await answerMissedYes(f.deps, rows), {completedCount:2});
  assert.deepEqual(f.tables.lessons[0],winner);
  assert.equal(f.events.filter(e => e === "lesson_completed").length,1);
});

test("failed winner re-read remains partial failure, never a confirmed completion", async () => {
  const f=setup(); const from=f.client.from.bind(f.client); let confirming=false;
  f.deps.supabase={...f.client,from(table:string){
    const base=from(table);
    return {...base,update(payload:Record<string,unknown>){
      if(table === "lessons" && payload.completed === true){
        confirming=true;
        const q={eq:()=>q,is:()=>q,select:async()=>({data:[],error:null})};return q;
      }
      return base.update(payload);
    },select(cols:string){
      if(confirming && table === "lessons" && cols === "id, completed"){
        const q={eq:()=>q,maybeSingle:async()=>({data:null,error:{message:"winner read failed"}})};return q;
      }
      return base.select(cols);
    }};
  }} as never;
  await assert.rejects(answerMissedYes(f.deps,rows),(error:unknown)=>{
    assert.ok(error instanceof MissedCompletionError); assert.equal(error.completedCount,0);
    assert.equal((error.cause as {message:string}).message,"winner read failed");return true;
  });
  assert.deepEqual(f.tables.lessons.map(r=>r.completed),[false,false]);
  assert.equal(f.events.filter(e=>e === "lesson_completed").length,0);
});

test('protected missing catch-up preserves offered choice and resolves lost insert before lookup on retry', async () => {
  const f=setup(); f.tables.lessons.length=0;
  const baseRpc=f.client.rpc.bind(f.client); const calls: string[]=[]; let insertCalls=0; let respreads=0; let directTailWrites=0;
  const baseFrom=f.client.from.bind(f.client);
  f.client.from=(table:string)=>{const query=baseFrom(table);return {...query,update(payload:Record<string,unknown>){if(table==='lessons' && ('scheduled_date' in payload || 'date' in payload)){directTailWrites++;throw new Error('Forbidden direct tail write');}return query.update(payload);}};};
  f.client.rpc=async (name,args) => {
    if(name==='read_scheduler_state') return {data:{status:'ready',mode:'atomic_v2',localDay:f.deps.todayStr,snapshot:{goal:f.tables.curriculum_goals[0],rows:[...f.tables.lessons],vacations:[]}},error:null} as never;
    if(name==='commit_scheduler_history_heal') {
      calls.push(JSON.stringify(args));insertCalls++;
      const action=args.p_action as {choice:string;date:string;slot:number};
      assert.equal(action.choice,'planned');
      if(insertCalls===1) f.tables.lessons.push({id:'new-history',user_id:'u',child_id:'c',curriculum_goal_id:'g',lesson_number:action.slot,queue_position:action.slot,
        completed:true,completed_at:`${action.date}T12:00:00Z`,date:action.date,scheduled_date:action.date,scheduled_source:'completion_planned',queue_pinned:true,is_backfill:true,minutes_spent:25,hours:25/60});
      if(insertCalls<3) throw new Error('Response lost after commit');
      return {data:{status:'already_applied',written:1},error:null} as never;
    }
    if(name==='commit_scheduler_respread'){respreads++;assert.equal(args.p_source,'catchup_spread');return {data:{status:'applied',written:0,writtenIds:[]},error:null} as never;}
    return baseRpc(name,args);
  };
  await assert.rejects(answerMissedYes(f.deps,[rows[0]]),MissedCompletionError);
  const saved={...f.tables.lessons[0]};
  assert.deepEqual(await answerMissedYes(f.deps,[rows[0]]),{completedCount:1});
  assert.deepEqual(f.tables.lessons[0],saved);
  assert.equal(respreads,1);assert.equal(directTailWrites,0);
  assert.equal(calls.length,3);assert.equal(new Set(calls).size,1);
  assert.equal(f.events.filter(e=>e==='lesson_completed').length,1);
});

test('protected missing-row refusal preserves prior work and never falls back to direct insertion', async () => {
  const f=setup();f.tables.lessons.splice(0,1);const before=f.tables.lessons.map(r=>({...r}));
  f.client.rpc=async(name)=> name==='read_scheduler_state'
    ? {data:{status:'ready',mode:'paused',snapshot:{}},error:null} as never
    : {data:null,error:{code:'PGRST202',message:'missing'}};
  await assert.rejects(answerMissedYes(f.deps,[rows[0]]),MissedCompletionError);
  assert.deepEqual(f.tables.lessons,before);assert.equal(f.events.filter(e=>e==='lesson_completed').length,0);
});
