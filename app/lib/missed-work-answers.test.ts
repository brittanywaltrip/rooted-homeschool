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
