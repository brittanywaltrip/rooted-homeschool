import {durableSchedulerRpc} from './scheduler-recovery-journal.ts';
import {bookOrderView} from './move-keep-slot.ts';
import {isDefinitiveSchedulerRejection} from './scheduler-terminal-result.ts';
import type { SupabaseClient } from '@supabase/supabase-js';
import { computeNextLessonsForGoal, queueHoldsFromRows, reservedSlotsFromRows, doneTodayHolds, NO_WRITES, type CurriculumGoalConfig, type VacationBlock } from './scheduler.ts';
import { countDoneToday } from './phase2-commit.ts';
import type { CascadeRow } from './cascade-shift-plan.ts';
import {planRecalibrateGap, type RecalibrateResult } from './recalibrate.ts';

type State = { localDay: string; dayStartIso: string; dayEndIso: string; snapshot: { goal: CurriculumGoalConfig & {start_at_lesson?:number|null}; rows: CascadeRow[]; vacations: VacationBlock[] } };
type Intent = { goalId: string; newCurrentLesson: number; recordHistory?: boolean; confirmedLessonIds?: readonly string[] };
type Request = { p_operation_id: string; p_goal_id: string; p_expected: State['snapshot']; p_current: number; p_day: string; p_history: boolean; p_confirmed: readonly string[]; p_dates: Array<{id:string;date:string}> };
const pending = new WeakMap<SupabaseClient, Map<string,{intent:string;request:Request;ambiguous:boolean}>>();

/** Proposal only: server independently validates the gap, book order and final projection. */
export function planContainedRecalibration(state: State, current: number, history=false): Array<{id:string;date:string}> | null {
  const {goal,rows,vacations} = state.snapshot;
  if (!Number.isInteger(current) || current < 1 || current > goal.total_lessons) return null;
  const book=bookOrderView(rows,{...goal,start_at_lesson:goal.start_at_lesson??1});
  const selected=book.rows.find(r=>r.lesson_number===current&&!r.completed&&r.queue_preserved);
  if(selected&&(selected.queue_position!==current||selected.skipped||selected.is_backfill))return null;
  const gap=new Set(planRecalibrateGap(book.rows,book.drifted?book.currentLesson:goal.current_lesson,current).toComplete.map(r=>r.id));
  const next = book.rows.map(r=>{if(r.lesson_number===current&&!r.completed)return{...r,queue_pinned:false,queue_preserved:false};if(gap.has(r.id)&&!r.queue_preserved)return {...r,completed:history,scheduled_date:null};return r;});
  const cfg = {...goal,current_lesson:current-1};
  const projection = computeNextLessonsForGoal(cfg,new Date(`${state.localDay}T00:00:00`),3650,vacations,
    countDoneToday(rows.filter(r=>r.queue_position!=null),state.dayStartIso,state.dayEndIso),[...queueHoldsFromRows(next,goal.id),...reservedSlotsFromRows(next,current-1,goal.id),...doneTodayHolds(countDoneToday(rows.filter(r=>r.queue_position===null),state.dayStartIso,state.dayEndIso),state.localDay)]);
  const bySlot = new Map(projection.map(p=>[p.lesson_number,p.date]));
  const dates: Array<{id:string;date:string}> = [];
  for (const row of next) {
    if (row.completed || row.skipped || row.is_backfill || row.queue_position == null || row.queue_position < current || row.queue_pinned || row.queue_preserved) continue;
    const date=bySlot.get(row.queue_position);if (!date) return null;
    dates.push({id:row.id,date});
  }
  return dates;
}
function refusal(status:string): Error {
  return new Error(status==='selected_queue' ? 'This lesson’s queue position needs review before it can be resumed. Nothing changed.' : status==='unknown' ? 'We could not confirm the recalibration. Try the same choice again to check its saved result before making another change.' :
    status==='paused' ? 'Schedule changes are temporarily paused. Your saved work is safe.' :
    status==='busy' ? 'Another change is still saving. Nothing changed; reload and try again.' :
    'Your lessons changed or this recalibration would alter protected work. Nothing changed; reload and review the lessons before trying again.');
}
/** null is the only legacy fallback. An ambiguous protected write never enters legacy phases. */
export async function recalibrateContained(client:SupabaseClient,opts:Intent):Promise<RecalibrateResult|null> {
  let entries=pending.get(client);if(!entries){entries=new Map();pending.set(client,entries);}
  const intent=JSON.stringify({...opts,recordHistory:!!opts.recordHistory,confirmedLessonIds:[...(opts.confirmedLessonIds??[])].sort()});
  let retained=entries.get(opts.goalId);
  if(retained && retained.intent!==intent) throw refusal('unknown');
  if(!retained){
    const {data:state,error}=await client.rpc('read_scheduler_state',{p_goal_id:opts.goalId});
    if(error?.code==='PGRST202') return null;
    if(error || state?.status!=='ready') throw refusal('invalid');
    if(state.mode==='legacy') return null;
    if(state.mode!=='atomic_v2') throw refusal(state.mode==='paused'?'paused':'invalid');
    const current=Math.max(1,Math.min(state.snapshot.goal.total_lessons,opts.newCurrentLesson));
    const dates=planContainedRecalibration(state,current,!!opts.recordHistory);if(!dates) throw refusal(state.snapshot.rows.some((r:CascadeRow)=>r.lesson_number===current&&!r.completed&&r.queue_preserved)?'selected_queue':'invalid');
    retained={intent,ambiguous:false,request:{p_operation_id:crypto.randomUUID(),p_goal_id:opts.goalId,p_expected:state.snapshot,p_current:current,p_day:state.localDay,p_history:!!opts.recordHistory,p_confirmed:opts.confirmedLessonIds??[],p_dates:dates}};
    entries.set(opts.goalId,retained);
  }
  for(let attempt=0;attempt<2;attempt++){
    try{
      const {data,error}=await durableSchedulerRpc(client,'commit_scheduler_recalibration',retained.request);
      if(error){
        if (/^(P0001|42501|22|23|55P03|57014|40|PGRST202)/.test(error.code??'') && !retained.ambiguous){entries.delete(opts.goalId);throw refusal(error.code==='55P03'?'busy':'invalid');}
        retained.ambiguous=true;continue;
      }
      if((data?.status==='applied'||data?.status==='already_applied') && Number.isInteger(data.gapCount) &&
          ['keptPinned','estimates','unscheduled','respread'].every(key=>Array.isArray(data[key])) && typeof data.bookOrderRestored==='boolean'){
        entries.delete(opts.goalId);
        const outcome=(ids:string[])=>({expected:ids.length,written:ids.length,writtenIds:ids,failedIds:[]});
        return {operationId:retained.request.p_operation_id,resumedLessonIds:data.resumedLessonIds??[],clamped:retained.request.p_current,newCountDone:retained.request.p_current-1,gapCount:data.gapCount,recordedHistory:retained.request.p_history,keptPinned:data.keptPinned,estimates:outcome(data.estimates),unscheduled:outcome(data.unscheduled),respread:outcome(data.respread),respreadReadFailed:false,bookOrderRestored:data.bookOrderRestored,releasedPin:Array.isArray(data.releasedPin)?outcome(data.releasedPin):NO_WRITES};
      }
      if(data?.status==='already_undone'){entries.delete(opts.goalId);throw new Error('This schedule change was already undone. Reload to review the current schedule.');}
      if(data && (isDefinitiveSchedulerRejection(data) || ['busy','stale','invalid','paused'].includes(data.status) && !retained.ambiguous)){entries.delete(opts.goalId);throw refusal(data.reason==='selected_queue'?'selected_queue':data.status);}
      retained.ambiguous=true;
    }catch(error){if(!entries.has(opts.goalId)) throw error;retained.ambiguous=true;}
  }
  throw refusal('unknown');
}

export async function undoContainedRecalibration(client:SupabaseClient,operationId:string):Promise<{status:string;reason?:string}>{
 for(let attempt=0;attempt<2;attempt++){
  try{const {data,error}=await durableSchedulerRpc(client,'undo_scheduler_recalibration',{p_operation_id:operationId});if(!error&&data?.status)return data;}catch{/* Replay only the retained receipt identity. */}
 }
 return {status:'unknown'};
}
