// Current-state geometry supplied by parent; synthetic IDs/content only.
// Not historical preimages, not a customer update script. Slots outside the
// two confirmed swapped pairs are assumed sequential pending JSON inventory.
import assert from 'node:assert/strict';
import {writeFileSync} from 'node:fs';
import {computeNextLessonsForGoal,queueHoldsFromRows} from '../app/lib/scheduler.ts';
const add=(d,n)=>{const x=new Date(d+'T12:00:00Z');x.setUTCDate(x.getUTCDate()+n);return x.toISOString().slice(0,10);};
const results=[];
for(const [day,first,selected,start,pointer,firstDate,expectedEnd] of [
 ['Sun',1,2,'2026-09-06',0,'2026-09-13','2027-09-12'],
 ['Tue',2,3,'2026-09-08',1,'2026-09-15','2027-09-07'],
]){
 const goal={id:day,total_lessons:52,start_at_lesson:first,current_lesson:pointer,school_days:[day],start_date:start,lessons_per_day:1};
 const rows=Array.from({length:53-first},(_,i)=>{const n=first+i;const date=add(firstDate,(i+(n===selected?1:0))*7);return{id:`synthetic-${day}-${n}`,curriculum_goal_id:day,lesson_number:n,queue_position:n===selected?n+1:n===selected+1?n-1:n,date,scheduled_date:date,queue_pinned:n===selected,scheduled_source:n<=selected?'plan_move':'wizard_create',completed:false,skipped:false,is_backfill:false,continues_lesson_id:null,notes:null,minutes_spent:null,hours:null};});
 const proposed=structuredClone(rows);for(const r of proposed){if(r.lesson_number>selected)r.date=r.scheduled_date=add(r.scheduled_date,7);if(r.lesson_number===selected||r.lesson_number===selected+1)r.queue_position=r.lesson_number;}
 assert.deepEqual(proposed[0],rows[0]);assert.equal(proposed[1].scheduled_date,rows[1].scheduled_date);assert.equal(proposed.at(-1).scheduled_date,expectedEnd);assert.equal(new Set(proposed.map(r=>r.scheduled_date)).size,rows.length);
 for(let i=0;i<rows.length;i++){const exclude=({date,scheduled_date,queue_position,...rest})=>rest;assert.deepEqual(exclude(proposed[i]),exclude(rows[i]));}
 const projections=['2026-09-21','2026-10-09'].map(localDay=>{const p=computeNextLessonsForGoal(goal,new Date(localDay+'T00:00:00'),3650,[],0,queueHoldsFromRows(proposed,day));const bySlot=new Map(p.map(x=>[x.lesson_number,x.date]));const differences=proposed.filter(r=>bySlot.get(r.queue_position)!==r.scheduled_date).map(r=>({lesson:r.lesson_number,stored:r.scheduled_date,projected:bySlot.get(r.queue_position)}));return{localDay,differenceCount:differences.length,firstDifferences:differences.slice(0,4)};});
 results.push({day,synthetic:true,slotAssumption:'identity except confirmed adjacent swap; verify against pending current inventory',rows:rows.length,dateChangeCount:proposed.filter((r,i)=>r.scheduled_date!==rows[i].scheduled_date).length,queueChangeCount:2,pinChangeCount:0,earlierRowUnchanged:true,selectedDate:proposed[1].scheduled_date,finish:proposed.at(-1).scheduled_date,projections,diff:proposed.map((r,i)=>({lesson:r.lesson_number,before:{date:rows[i].scheduled_date,slot:rows[i].queue_position,pin:rows[i].queue_pinned},after:{date:r.scheduled_date,slot:r.queue_position,pin:r.queue_pinned}})).filter(r=>JSON.stringify(r.before)!==JSON.stringify(r.after))});
}
writeFileSync('../investigation-evidence/recorded-shifts-fixture.json',JSON.stringify(results,null,2));console.log(JSON.stringify(results.map(({diff,...rest})=>rest),null,2));
