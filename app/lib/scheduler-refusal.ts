import type { SupabaseClient } from '@supabase/supabase-js';
import {assertLegacySchedulingEdit} from './scheduler-contained.ts';
export const PROTECTED_ACTION_NOTICE = 'This action is unavailable for a protected curriculum. Your saved schedule is unchanged. Use Plan to review its supported actions.';
/** Preflight every target before a legacy multi-request action starts. DB guards still arbitrate races. */
export async function assertLegacyLessonAction(client: SupabaseClient, ids: string[]): Promise<void> {
  const unique = [...new Set(ids)]; const goals = new Set<string>();
  for (let i=0;i<unique.length;i+=100) {
    const batch=unique.slice(i,i+100);
    const {data,error}=await client.from('lessons').select('id,curriculum_goal_id').in('id',batch);
    if(error || !data || data.length!==batch.length) throw new Error('Could not check every lesson. Reload and review the schedule before trying again.');
    for(const row of data) if(row.curriculum_goal_id) goals.add(row.curriculum_goal_id);
  }
  await assertLegacySchedulingEdit(client,[...goals],PROTECTED_ACTION_NOTICE);
}
export async function checkedLessonWrite<T extends {error: {message?: string;code?:string}|null}>(query: PromiseLike<T>): Promise<T> {
  const result=await query;
  if(result.error) throw new Error(result.error.message?.includes('scheduler_')
    ? 'This action could not be saved for a protected curriculum. Reload to review what is saved before trying again.'
    : 'This change could not be saved. Reload to review what is saved before trying again.');
  return result;
}
