import type {SupabaseClient} from '@supabase/supabase-js';
export type PreservedWork = {id:string; title:string|null; lesson_number:number|null; scheduled_date:string; curriculum_goal_id:string; curriculum_goals:{curriculum_name:string|null}|null};
/** No age, pointer or completion-history threshold may hide preserved work. */
export async function loadPreservedWork(client:SupabaseClient,userId:string):Promise<PreservedWork[]|null>{
 const rows:PreservedWork[]=[];
 for(let from=0;;from+=500){
  const {data,error}=await client.from('lessons').select('id,title,lesson_number,scheduled_date,curriculum_goal_id,curriculum_goals!inner(curriculum_name,archived)')
   .eq('user_id',userId).eq('queue_preserved',true).eq('completed',false).eq('skipped',false).eq('curriculum_goals.archived',false)
   .order('scheduled_date',{ascending:true}).order('id',{ascending:true}).range(from,from+499);
  if(error||!data)return null;
  rows.push(...data as unknown as PreservedWork[]);if(data.length<500)return rows;
 }
}
