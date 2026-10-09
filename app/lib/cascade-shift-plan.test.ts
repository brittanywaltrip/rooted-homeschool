import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planAnchoredCascade, sameCascadeSnapshot, type CascadePlan, type CascadeSnapshot } from './cascade-shift-plan.ts';

function fixture(dates = ['2026-09-22','2026-09-29','2026-10-06'], pins: number[] = []): CascadeSnapshot {
  return { userId: 'synthetic-user', goal: { id: 'g', user_id: 'synthetic-user', total_lessons: dates.length, current_lesson: 0, lessons_per_day: 1, school_days: ['Tue'], start_date: '2026-09-22' },
    rows: dates.map((date,i) => ({ id: `L${i+1}`, user_id: 'synthetic-user', curriculum_goal_id: 'g', lesson_number: i+1, queue_position: i+1, scheduled_date: date, date, queue_preserved:false,queue_pinned: pins.includes(i+1), scheduled_source: pins.includes(i+1) ? 'plan_move' : 'wizard_create', completed: false, completed_at: null, skipped: false, is_backfill: false, continues_lesson_id: null, notes: null, minutes_spent: null, hours: null, updated_at: `version-${i}` })), rowCount: dates.length, vacations: [], localDay: '2026-09-22', dayStartIso: '2026-09-22T00:00:00Z', dayEndIso: '2026-09-23T00:00:00Z' };
}
const choose = { lessonId: 'L1', from: '2026-09-22', to: '2026-09-29' };
function mustPlan(s: CascadeSnapshot, c = choose) { const r = planAnchoredCascade(s,c); if (!r.ok) throw Error(r.reason); return r.plan; }

// Transaction contract MODEL ONLY. No application imports this adapter. A
// real implementation must lock, re-read, validate and commit in the database.
function commitModel(current: CascadeSnapshot, plan: CascadePlan, failAt = -1) {
  if (!sameCascadeSnapshot(current, plan.expected)) return { ok: false as const, snapshot: current };
  const next = structuredClone(current);
  for (const [i,w] of [...plan.writes,...(plan.preserved??[])].entries()) {
    if (i === failAt) return { ok: false as const, snapshot: current };
    Object.assign(next.rows.find(r => r.id === w.id)!, w.after, { updated_at: `committed-${i}-${current.rows.find(r => r.id === w.id)!.updated_at}` });
  }
  return { ok: true as const, snapshot: next, undo: { expected: structuredClone(next), days: -plan.days, preserved: [], writes: [...plan.writes,...(plan.preserved??[])].map(w => ({ id: w.id, before: w.after, after: w.before })) } };
}
const dates = (s: CascadeSnapshot) => s.rows.map(r => r.scheduled_date);

test('regular weekly succeeds with one new pin, no reordering', () => {
  const s=fixture(); const p=mustPlan(s); const result=commitModel(s,p); assert.equal(result.ok,true);
  assert.deepEqual(dates(result.snapshot),['2026-09-29','2026-10-06','2026-10-13']);
  assert.deepEqual(result.snapshot.rows.map(r=>r.queue_pinned),[true,false,false]);
  assert.deepEqual(result.snapshot.rows.map(r=>r.queue_position),[1,2,3]);
});
test('a pinned intentional gap shifts successfully and the ordinary tail stays unpinned', () => {
  const s=fixture(['2026-09-22','2026-10-13','2026-10-20'],[2]); const result=commitModel(s,mustPlan(s));
  assert.deepEqual(dates(result.snapshot),['2026-09-29','2026-10-20','2026-10-27']);
  assert.deepEqual(result.snapshot.rows.map(r=>r.queue_pinned),[true,true,false]);
});
test('several existing gap anchors keep their spacing', () => {
  const s=fixture(['2026-09-22','2026-10-13','2026-11-03','2026-11-10'],[2,3]);
  assert.deepEqual(dates(commitModel(s,mustPlan(s)).snapshot),['2026-09-29','2026-10-20','2026-11-10','2026-11-17']);
});
test('an unpinned gap refuses rather than inventing more fixed pins', () => {
  const s=fixture(['2026-09-22','2026-10-13','2026-10-20']);
  assert.deepEqual(planAnchoredCascade(s,choose),{ok:false,reason:'unrepresented_gap'});
});
test('Sunday pinned gap shifts correctly', () => {
  const s=fixture(['2026-09-20','2026-10-11','2026-10-18'],[2]); s.goal.school_days=['Sun']; s.goal.start_date=s.localDay='2026-09-20'; s.dayStartIso='2026-09-20T00:00:00Z';s.dayEndIso='2026-09-21T00:00:00Z';
  const p=mustPlan(s,{lessonId:'L1',from:'2026-09-20',to:'2026-09-27'});
  assert.deepEqual(dates(commitModel(s,p).snapshot),['2026-09-27','2026-10-18','2026-10-25']);
});
test('holidays are respected while shifting an anchor and its tail', () => {
  const s=fixture(['2026-09-22','2026-10-13','2026-10-20'],[2]); s.vacations=[{start_date:'2026-10-20',end_date:'2026-10-20'}];
  // The original last date is inside the newly declared break; that malformed
  // plan must not be silently compressed or piled up during shifting.
  assert.equal(planAnchoredCascade(s,choose).ok,false);
  s.rows[2].scheduled_date=s.rows[2].date='2026-10-27';
  assert.deepEqual(dates(commitModel(s,mustPlan(s)).snapshot),['2026-09-29','2026-10-27','2026-11-03']);
});
test('repeated anchored shifts and both Undo operations round-trip', () => {
  const s=fixture(['2026-09-22','2026-10-13','2026-10-20'],[2]); const a=commitModel(s,mustPlan(s)); assert.ok(a.ok);
  const b=commitModel(a.snapshot,mustPlan(a.snapshot,{...choose,from:'2026-09-29',to:'2026-10-06'})); assert.ok(b.ok);
  assert.deepEqual(dates(b.snapshot),['2026-10-06','2026-10-27','2026-11-03']);
  const undone=commitModel(b.snapshot,b.undo);assert.ok(undone.ok); assert.deepEqual(dates(undone.snapshot),dates(a.snapshot));
  // The first Undo token is deliberately stale after another transaction,
  // even if a second Undo restored the same dates: revisions advanced.
  assert.equal(commitModel(undone.snapshot,a.undo).ok,false);
});
test('Undo restores exact date/pin/source values and preserves work fields', () => {
  const s=fixture(['2026-09-22','2026-10-13','2026-10-20'],[2]);s.rows[1].notes='synthetic note';s.rows[1].minutes_spent=25;s.rows[1].hours=0.5;
  const applied=commitModel(s,mustPlan(s));assert.ok(applied.ok);const undone=commitModel(applied.snapshot,applied.undo);assert.ok(undone.ok);
  for (const [i,r] of undone.snapshot.rows.entries()) assert.deepEqual({...r,updated_at:s.rows[i].updated_at},s.rows[i]);
});
for (const changed of ['completed','notes','date','pin','skip','continuation','pace','break','membership','version'] as const) {
  test(`expected-state commit and Undo refuse concurrent ${changed}`, () => {
    const s=fixture();const p=mustPlan(s);const applied=commitModel(s,p);assert.ok(applied.ok);
    const mutate=(v:CascadeSnapshot)=>{ const r=v.rows[1];
      if(changed==='completed'){r.completed=true;r.completed_at='2026-09-22T12:00:00Z';}
      if(changed==='notes')r.notes='later work';if(changed==='date')r.date='2026-10-20';if(changed==='pin')r.queue_pinned=!r.queue_pinned;
      if(changed==='skip')r.skipped=true;if(changed==='continuation')r.continues_lesson_id='L1';if(changed==='pace')v.goal.lessons_per_day=2;
      if(changed==='break')v.vacations.push({start_date:'2026-10-01',end_date:'2026-10-02'});
      if(changed==='membership'){v.rows.pop();v.rowCount--; }if(changed==='version')r.updated_at='later-version';
    };
    const stale=structuredClone(s);mutate(stale); const before=structuredClone(stale);assert.equal(commitModel(stale,p).ok,false);assert.deepEqual(stale,before);
    const undoStale=structuredClone(applied.snapshot);mutate(undoStale);const later=structuredClone(undoStale);assert.equal(commitModel(undoStale,applied.undo).ok,false);assert.deepEqual(undoStale,later);
  });
}
test('failure at each write leaves all rows intact in the transaction model', () => {
  const s=fixture();const p=mustPlan(s);for(let i=0;i<p.writes.length;i++){const result=commitModel(s,p,i);assert.equal(result.ok,false);assert.deepEqual(result.snapshot,s);}
});
test('completed, skipped and continuation rows are not moved or edited', () => {
  const s=fixture(['2026-09-15','2026-09-22','2026-09-29','2026-10-06']);s.goal.current_lesson=1;s.goal.start_date='2026-09-15';
  s.rows[0].completed=true;s.rows[0].completed_at='2026-09-15T12:00:00Z';
  s.rows[2].skipped=true;s.rows[2].scheduled_date=null;
  s.rows[3].scheduled_date=s.rows[3].date='2026-09-29';
  s.rows.push({...s.rows[0],id:'continuation',lesson_number:null,queue_position:null,completed:false,completed_at:null,continues_lesson_id:'L1',scheduled_source:'continuation',scheduled_date:'2026-11-03',date:'2026-11-03'});s.rowCount++;
  const p=mustPlan(s,{lessonId:'L2',from:'2026-09-22',to:'2026-09-29'});const next=commitModel(s,p).snapshot;
  for(const id of ['L1','L3','continuation'])assert.deepEqual(next.rows.find(r=>r.id===id),s.rows.find(r=>r.id===id));
});
test('continuation collision and variable-capacity pileups refuse', () => {
  const s=fixture();s.rows.push({...s.rows[0],id:'c',lesson_number:null,queue_position:null,continues_lesson_id:'L1',scheduled_source:'continuation',scheduled_date:'2026-09-29',date:'2026-09-29'});s.rowCount++;
  assert.deepEqual(planAnchoredCascade(s,choose),{ok:false,reason:'capacity'});
  const varied=fixture(['2026-09-21','2026-09-21','2026-09-24']);varied.goal.school_days=['Mon','Thu'];varied.goal.lessons_per_day_overrides={Mon:2,Thu:1};varied.goal.start_date=varied.localDay='2026-09-21';
  assert.deepEqual(planAnchoredCascade(varied,{lessonId:'L1',from:'2026-09-21',to:'2026-09-24'}),{ok:false,reason:'capacity'});
});
test('historical swapped queue refuses rather than silently repairing book order', () => {
  const s=fixture();s.rows[0].queue_position=2;s.rows[1].queue_position=1;
  assert.deepEqual(planAnchoredCascade(s,choose),{ok:false,reason:'queue_order'});
});
test('partial snapshots and wrong ownership refuse before a plan exists', () => {
  const s=fixture();s.rowCount++;assert.deepEqual(planAnchoredCascade(s,choose),{ok:false,reason:'snapshot'});
  s.rowCount--;s.rows[1].user_id='other';assert.deepEqual(planAnchoredCascade(s,choose),{ok:false,reason:'snapshot'});
});

test('shifting a later queue suffix preserves earlier unfinished work exactly', () => {
  const s=fixture(); const earlier={...structuredClone(s.rows[0]),queue_preserved:true};
  const p=mustPlan(s,{lessonId:'L2',from:'2026-09-29',to:'2026-10-06'});
  assert.deepEqual(p.writes.map(w=>w.id),['L2','L3']);
  const shifted=commitModel(s,p);assert.deepEqual({...shifted.snapshot.rows[0],updated_at:earlier.updated_at},earlier);
  assert.deepEqual(dates(shifted.snapshot),['2026-09-22','2026-10-06','2026-10-13']);
});

test('unslotted courses refuse until the server supports PR146 reservations',()=>{
 for(const completed of [false,true]){
  const s=fixture();s.rows.push({...s.rows[0],id:'outside',lesson_number:4,queue_position:null,completed});s.rowCount++;s.goal.total_lessons++;
  assert.deepEqual(planAnchoredCascade(s,choose),{ok:false,reason:'queue_order'});
 }
});
