import type {SupabaseClient} from '@supabase/supabase-js';
import {prepareContainedDeletion,schedulerRefusalMessage,type SchedulerResult} from './scheduler-contained.ts';
/** Prepare every group before hiding rows. Undo cancels this callback; it never
 * recreates deleted content. Per-goal failures remain visible to the caller. */
export async function prepareLessonDelete(client:SupabaseClient,rows:Array<{id:string;curriculum_goal_id?:string|null}>):Promise<()=>Promise<void>> {
 const groups=new Map<string|null,string[]>();
 for(const row of rows){const goal=row.curriculum_goal_id??null;groups.set(goal,[...(groups.get(goal)??[]),row.id]);}
 const work:Array<{ids:string[];commit:()=>Promise<SchedulerResult>}>=[];
 for(const [goal,ids] of groups)work.push({ids,commit:await prepareContainedDeletion(client,goal,ids)});
 return async()=>{
  for(const group of work){
   const result=await group.commit();
   if(result.status==='legacy'){
    const {data,error}=await client.from('lessons').delete().in('id',group.ids).select('id');
    if(error||data?.length!==group.ids.length)throw Error('Could not confirm every deletion. Some lessons may already have been deleted; reload to review.');
   }else if(result.status!=='applied'&&result.status!=='already_applied'){
    throw Error(schedulerRefusalMessage(result)+' Some other selected curricula may already have saved; reload to review.');
   }
  }
 };
}
