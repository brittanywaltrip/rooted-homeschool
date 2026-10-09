"use client";
import {useEffect,useState} from 'react';
import {supabase} from '@/lib/supabase';
import {loadPreservedWork,type PreservedWork} from '../lib/preserved-work';

/** Shared visible unresolved list, independent of queue position and age. */
export default function PreservedWorkPanel({userId,revision,onOpenDate}:{userId:string|null|undefined;revision?:unknown;onOpenDate?:(date:string)=>void}){
 const [state,setState]=useState<{owner:string;rows:PreservedWork[];error:boolean}|null>(null);
 useEffect(()=>{
  if(!userId)return;
  let active=true;
  const refresh=async()=>{const rows=await loadPreservedWork(supabase,userId);if(active)setState(previous=>({owner:userId,rows:rows??(previous?.owner===userId?previous.rows:[]),error:rows===null}));};
  void refresh();window.addEventListener('rooted:lessons-updated',refresh);
  return()=>{active=false;window.removeEventListener('rooted:lessons-updated',refresh);};
 },[userId,revision]);
 if(!userId||state?.owner!==userId)return null;
 if(!state.rows.length && !state.error)return null;
 return <section aria-label="Unfinished work kept on earlier dates" className="rounded-2xl border border-[#e8e2d9] bg-white p-4 my-3">
  {state.error ? <p role="status">Couldn&apos;t refresh unfinished work. Previously loaded lessons are shown; please reload.</p> : null}
  <h2 className="font-semibold text-[#2d5a3d]">Still unfinished</h2>
  <p className="text-sm text-[#7a6f65]">These lessons stayed on their dates when you shifted later lessons. Nothing here has been marked done.</p>
  <ul className="mt-3 space-y-2">{state.rows.map(row=><li key={row.id} className="text-sm">
   <span className="font-medium">{row.curriculum_goals?.curriculum_name ?? 'Curriculum'}: {row.title || `Lesson ${row.lesson_number ?? ''}`}</span>
   <span> — unfinished, kept on <time dateTime={row.scheduled_date}>{row.scheduled_date}</time></span>
   {onOpenDate ? <button type="button" className="ml-2 underline" onClick={()=>onOpenDate(row.scheduled_date)}>View on Plan</button> : <a className="ml-2 underline" href={`/dashboard/plan?unfinishedDate=${encodeURIComponent(row.scheduled_date)}`}>View on Plan</a>}
  </li>)}</ul>
 </section>;
}
