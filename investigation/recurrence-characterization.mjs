import fs from 'node:fs';
import assert from 'node:assert/strict';
import {computeNextLessonsForGoal,queueHoldsFromRows} from '../app/lib/scheduler.ts';
import {planAnchoredCascade} from '../app/lib/cascade-shift-plan.ts';
process.env.TZ='UTC';
const saved=JSON.parse(fs.readFileSync('../synthetic-runtime/committed-repaired-snapshot.json'));
for(const goal of saved.goals.filter(g=>g.total_lessons>1)){
 const source=saved.lessons.filter(r=>r.curriculum_goal_id===goal.id);
 for(const mode of ['narrow','prefix-only','prefix-and-selected-anchor']){
  const rows=source.map(r=>({...r,queue_preserved:mode!=='narrow'&&r.queue_position<3,queue_pinned:r.queue_pinned||(mode==='prefix-and-selected-anchor'&&r.queue_position===3)}));
  for(const day of ['2026-09-20','2026-10-09','2026-10-16']){
   const map=new Map(computeNextLessonsForGoal(goal,new Date(day+'T00:00:00'),3650,[],0,queueHoldsFromRows(rows)).map(r=>[r.lesson_number,r.date]));
   const mismatches=rows.filter(r=>map.get(r.queue_position)!==r.scheduled_date).length;
   if(mode==='prefix-and-selected-anchor')assert.equal(mismatches,0);
   console.log(JSON.stringify({course:goal.curriculum_name,mode,day,mismatches}));
  }
 }
 const rows=source.map(r=>({...r,queue_preserved:false}));const localDay='2026-10-09';
 const state={userId:goal.user_id,goal,rows,rowCount:rows.length,vacations:[],localDay,dayStartIso:localDay+'T00:00:00Z',dayEndIso:'2026-10-10T00:00:00Z'};
 const selected=rows.find(r=>r.queue_position===3);const to=new Date(selected.date+'T00:00:00Z');to.setUTCDate(to.getUTCDate()+7);
 const result=planAnchoredCascade(state,{lessonId:selected.id,from:selected.date,to:to.toISOString().slice(0,10)});
 console.log(JSON.stringify({course:goal.curriculum_name,actualPlanner:result.ok?{moved:result.plan.writes.length,preserved:result.plan.preserved.length}:result}));
}
