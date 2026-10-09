import fs from 'node:fs';
import {computeNextLessonsForGoal,queueHoldsFromRows,reservedSlotsFromRows,doneTodayHolds} from '../../app/lib/scheduler.ts';
const cases=[];
for(let n=0;n<256;n++){
 const day='2026-10-09';const pointer=n%4;
 const goal={id:'00000000-0000-4000-8000-000000000001',current_lesson:pointer,total_lessons:8,lessons_per_day:1+(n%3),school_days:n&1?['Mon','Wed','Fri']:[],start_date:n&2?'2026-10-12':'2026-10-01',lessons_per_day_overrides:n&4?{Mon:2,Wed:0,Fri:3}:null};
 const rows=Array.from({length:8},(_,i)=>({id:String(i+1),curriculum_goal_id:goal.id,lesson_number:i+1,queue_position:i+1,completed:i<pointer,completed_at:i<pointer?'2026-10-09T03:00:00Z':null,skipped:false,queue_pinned:false,queue_preserved:false,date:'2026-10-13',scheduled_date:'2026-10-13'}));
 if(n&8){rows[4].queue_position=null;rows[4].scheduled_date='2026-10-09';}
 if(n&16){rows[1].queue_position=null;rows[1].completed=true;rows[1].completed_at='2026-10-09T03:00:00Z';}
 if(n&32){rows[5].queue_pinned=true;rows[5].scheduled_date='2026-10-19';}
 if(n&64){rows[3].skipped=true;rows[6].queue_preserved=true;rows[6].scheduled_date='2026-10-12';}
 if(n&128){rows[0].completed=false;rows[0].queue_pinned=true;rows[0].scheduled_date='2026-10-09';}
 const vacations=n%5===0?[{start_date:'2026-10-12',end_date:'2026-10-14'}]:[];
 const start=n%2?'2026-10-08T17:30:00Z':'2026-10-09T00:00:00Z';const end=n%2?'2026-10-09T17:30:00Z':'2026-10-10T00:00:00Z';
 const done=rows.filter(r=>r.completed&&r.completed_at>=start&&r.completed_at<end);const slotted=done.filter(r=>r.queue_position!==null).length;const unslotted=done.length-slotted;
 const projected=computeNextLessonsForGoal(goal,new Date(day+'T00:00:00'),3650,vacations,slotted,[...queueHoldsFromRows(rows,goal.id),...reservedSlotsFromRows(rows,pointer,goal.id),...doneTodayHolds(unslotted,day)]);
 cases.push({state:{goal,rows,vacations,localDay:day,dayStartIso:start,dayEndIso:end},expected:Object.fromEntries(projected.map(p=>[p.lesson_number,p.date]))});
}
for(const variant of ['occupied-reservation','past-first-pin','early-preserved','missing-slot','lowercase','full-day-name']) {
 const state=structuredClone(cases[19].state);state.goal.start_date='2026-10-01';state.goal.school_days=[];
 if(variant==='occupied-reservation'){state.rows[4].queue_position=null;state.rows[5].queue_position=5;}
 if(variant==='past-first-pin'){state.rows[3].queue_pinned=true;state.rows[3].scheduled_date='2026-10-08';}
 if(variant==='early-preserved'){state.rows[0].completed=false;state.rows[0].queue_preserved=true;state.rows[0].scheduled_date='2026-10-08';}
 if(variant==='missing-slot')state.rows=state.rows.filter(r=>r.lesson_number!==5);
 if(variant==='lowercase')state.goal.school_days=['mon','tue'];
 if(variant==='full-day-name')state.goal.school_days=['Monday','Tuesday'];
 const done=state.rows.filter(r=>r.completed&&r.completed_at>=state.dayStartIso&&r.completed_at<state.dayEndIso);
 const slotted=done.filter(r=>r.queue_position!==null).length;
 const projection=computeNextLessonsForGoal(state.goal,new Date(state.localDay+'T00:00:00'),3650,state.vacations,slotted,[...queueHoldsFromRows(state.rows,state.goal.id),...reservedSlotsFromRows(state.rows,state.goal.current_lesson,state.goal.id),...doneTodayHolds(done.length-slotted,state.localDay)]);
 cases.push({variant,state,expected:Object.fromEntries(projection.map(p=>[p.lesson_number,p.date]))});
}
fs.writeFileSync(new URL('../../../synthetic-runtime/respread-parity-cases.json',import.meta.url),JSON.stringify(cases));
