import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import type {SupabaseClient} from '@supabase/supabase-js';
import {loadPreservedWork} from './preserved-work.ts';
import {computeNextLessonsForGoal,computeTodayLessons,queueHoldsFromRows,planProjectedDateWrites,planQueueMove} from './scheduler.ts';
import {planAnchoredCascade,type CascadeSnapshot} from './cascade-shift-plan.ts';
import {nthSchoolDay} from '../../lib/school-days.ts';
function fixture():CascadeSnapshot{
 return {userId:'u',goal:{id:'g',user_id:'u',total_lessons:4,current_lesson:0,lessons_per_day:1,school_days:['Sun'],start_date:'2026-09-06'},localDay:'2026-09-21',dayStartIso:'2026-09-21T00:00:00Z',dayEndIso:'2026-09-22T00:00:00Z',vacations:[],rowCount:4,
 rows:['2026-09-13','2026-09-20','2026-09-27','2026-10-04'].map((date,i)=>({id:`L${i+1}`,user_id:'u',curriculum_goal_id:'g',lesson_number:i+1,queue_position:i+1,date,scheduled_date:date,queue_pinned:false,queue_preserved:false,scheduled_source:'wizard_create',completed:false,completed_at:null,skipped:false,is_backfill:false,continues_lesson_id:null,notes:i===0?'earlier note':null,minutes_spent:i===0?25:null,hours:null,updated_at:'v1'}))};
}
function shift(s:CascadeSnapshot,id='L2',from='2026-09-20',to='2026-09-27'){
 const p=planAnchoredCascade(s,{lessonId:id,from,to});assert.ok(p.ok,JSON.stringify(p));
 const after=structuredClone(s);for(const w of [...p.plan.writes,...p.plan.preserved])Object.assign(after.rows.find(r=>r.id===w.id)!,w.after);
 return {after,plan:p.plan};
}
test('confirmed suffix moves; earlier row keeps date, content and pin without completion',()=>{
 const s=fixture(),{after,plan}=shift(s);assert.deepEqual(plan.writes.map(r=>r.id),['L2','L3','L4']);assert.deepEqual(plan.preserved.map(r=>r.id),['L1']);
 assert.deepEqual(after.rows[0],{...s.rows[0],queue_preserved:true});
 const p=computeNextLessonsForGoal(after.goal,new Date('2026-09-21T00:00:00'),3650,[],0,queueHoldsFromRows(after.rows));
 const dates=new Map(p.map(r=>[r.lesson_number,r.date]));for(const r of after.rows)assert.equal(dates.get(r.queue_position!),r.scheduled_date);
});
test('repeated later shift retains prefix and changes only its new confirmed suffix',()=>{
 const a=shift(fixture()).after,b=shift(a,'L3','2026-10-04','2026-10-11');
 assert.deepEqual(b.plan.writes.map(r=>r.id),['L3','L4']);assert.deepEqual(b.after.rows[0],a.rows[0]);
 assert.deepEqual(b.after.rows[1],{...a.rows[1],queue_preserved:true});
});
test('pointer advancement and day rollover retain unresolved earlier work while ordinary tail rolls',()=>{
 const {after}=shift(fixture());after.rows[1].completed=true;after.rows[1].completed_at='2026-09-27T12:00:00Z';after.goal.current_lesson=2;
 const holds=queueHoldsFromRows(after.rows),day=new Date('2026-10-11T00:00:00');
 const p=computeNextLessonsForGoal(after.goal,day,3650,[],0,holds);
 assert.equal(p.find(r=>r.lesson_number===1)?.date,'2026-09-13');
 assert.equal(computeTodayLessons([after.goal],day,[],new Map(),new Map([['g',holds]]))[0].lesson_number,3);
 const map=new Map(p.map(r=>[`g|${r.lesson_number}`,r.date]));const writes=planProjectedDateWrites(after.rows,map,r=>`g|${r.queue_position}`);
 assert.equal([...writes.values()].flat().includes('L1'),false);assert.equal(after.rows[0].completed,false);
});
test('five-day course shifts lesson 12 onward without touching eleven completed lessons',()=>{
 const s=fixture();s.goal.school_days=['Mon','Tue','Wed','Thu','Fri'];s.goal.total_lessons=20;s.goal.current_lesson=11;s.goal.start_date='2026-09-01';s.localDay='2026-09-18';s.dayStartIso=s.localDay+'T00:00:00Z';s.dayEndIso='2026-09-19T00:00:00Z';
 s.rows=Array.from({length:20},(_,i)=>({...structuredClone(s.rows[0]),id:`L${i+1}`,lesson_number:i+1,queue_position:i+1,completed:i<11,completed_at:i<11?'2026-09-17T12:00:00Z':null,date:i<11?'2026-09-17':nthSchoolDay('2026-09-18',s.goal.school_days!,i-11,[]),scheduled_date:i<11?'2026-09-17':nthSchoolDay('2026-09-18',s.goal.school_days!,i-11,[])}));s.rowCount=20;
 const legacy=structuredClone(s.rows);const reorder=planQueueMove({movingLessonId:'L12',targetDate:'2026-09-21',goalLessons:legacy});assert.ok(reorder&&!reorder.noop);
 for(const change of reorder.shifts)legacy.find(r=>r.id===change.id)!.queue_position=change.queue_position;
 Object.assign(legacy[11],{queue_position:reorder.movedNewQp,date:'2026-09-21',scheduled_date:'2026-09-21',queue_pinned:true,scheduled_source:'plan_move'});
 assert.equal(legacy[11].queue_position,13);assert.equal(legacy[12].queue_position,12);assert.equal(legacy[11].scheduled_date,legacy[12].scheduled_date);assert.deepEqual(legacy.slice(0,11),s.rows.slice(0,11));
 const {after,plan}=shift(s,'L12','2026-09-18','2026-09-21');assert.equal(plan.writes.length,9);assert.equal(plan.preserved.length,0);assert.deepEqual(after.rows.slice(0,11),s.rows.slice(0,11));assert.equal(after.rows[12].scheduled_date,'2026-09-22');
 const drift=structuredClone(s);drift.rows[11].queue_position=13;drift.rows[12].queue_position=12;assert.equal(planAnchoredCascade(drift,{lessonId:'L12',from:'2026-09-18',to:'2026-09-21'}).ok,false);
});
test('shared unresolved query has no pointer, date-window or any-completion gate and paginates',async()=>{
 const calls:unknown[][]=[];let page=0;const old={id:'old',title:'Earlier lesson',lesson_number:1,scheduled_date:'2020-01-01',curriculum_goal_id:'g',curriculum_goals:{curriculum_name:'Course'}};
 const q={select:(...a:unknown[])=>{calls.push(['select',...a]);return q;},eq:(...a:unknown[])=>{calls.push(['eq',...a]);return q;},order:()=>q,range:async()=>({data:page++===0?Array.from({length:500},(_,i)=>({...old,id:String(i)})):[old],error:null})};
 const client={from:()=>q} as unknown as SupabaseClient;const rows=await loadPreservedWork(client,'u');assert.equal(rows?.length,501);assert.equal(rows?.at(-1)?.scheduled_date,'2020-01-01');
 assert.ok(calls.some(c=>c[1]==='completed'&&c[2]===false));assert.ok(calls.some(c=>c[1]==='user_id'&&c[2]==='u'));
 for(const path of ['../components/PlanV2/index.tsx','../dashboard/page.tsx'])assert.match(readFileSync(new URL(path,import.meta.url),'utf8'),/<PreservedWorkPanel userId=\{effectiveUserId\} revision=\{lessons\}/);
});
