"use client";
import {useEffect, useState} from 'react';
import {supabase} from '@/lib/supabase';
import {schedulerRecoveryForClient,recoverSchedulerEntry,undoRecoveredChange,dismissRecoveredChange,type RecoveryEntry} from '@/app/lib/scheduler-recovery-journal';

type Recovery = {goalId: string; retry: () => Promise<{ok: boolean}>};
/** A failed tail refresh must never ask the parent to toggle completion again. */
export default function ScheduleRefreshRecovery() {
  const [pending,setPending]=useState<Map<string,Recovery>>(new Map());
  const [busy,setBusy]=useState(false);
  const [durable,setDurable]=useState<RecoveryEntry[]>([]);
  const [storageError,setStorageError]=useState(false);
  const [undoMessage,setUndoMessage]=useState('');
  useEffect(()=>{
    let live=true;
    const load=()=>{void schedulerRecoveryForClient(supabase).then(entries=>{if(live){setDurable(entries);setStorageError(false);}},()=>{if(live)setStorageError(true);});};
    load();window.addEventListener('rooted:scheduler-recovery-changed',load);window.addEventListener('storage',load);
    return()=>{live=false;window.removeEventListener('rooted:scheduler-recovery-changed',load);window.removeEventListener('storage',load);};
  },[]);
  useEffect(()=>{
    const receive=(event:Event)=>{
      const recovery=(event as CustomEvent<Recovery>).detail;
      if(!recovery || typeof recovery.goalId!=='string' || typeof recovery.retry!=='function')return;
      setPending(prior=>prior.has(recovery.goalId)?prior:new Map(prior).set(recovery.goalId,recovery));
    };
    const resolved=(event:Event)=>setPending(prior=>{
      const next=new Map(prior);next.delete((event as CustomEvent<{goalId:string}>).detail?.goalId);return next;
    });
    window.addEventListener('rooted:schedule-refresh-needed',receive);
    window.addEventListener('rooted:schedule-refresh-resolved',resolved);
    return()=>{window.removeEventListener('rooted:schedule-refresh-needed',receive);window.removeEventListener('rooted:schedule-refresh-resolved',resolved);};
  },[]);
  if(!pending.size&&!durable.length&&!storageError&&!undoMessage)return null;
  return <div role="status" data-scheduler-recovery-banner className="fixed bottom-24 left-1/2 z-[80] w-[min(90vw,32rem)] max-h-[calc(100dvh-16rem)] overflow-y-auto -translate-x-1/2 rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-stone-900 shadow-lg">
    {undoMessage&&<p>{undoMessage} <button className="underline" onClick={()=>setUndoMessage('')}>Dismiss</button></p>}
    {storageError&&<p>Saved changes could not be checked. Reconnect and reload before making another scheduling change.</p>}
    {durable.filter(e=>e.phase==='confirmed').map(entry=><div key={entry.rpc+entry.operation}><p>Your schedule change was saved.</p><button className="mr-4 underline" disabled={busy} onClick={async()=>{setBusy(true);try{const outcome=await undoRecoveredChange(supabase,entry);if(outcome==='undone')window.location.reload();else setUndoMessage(outcome==='refused'?'This change could not be undone because its Undo expired or the schedule changed afterward. Your current schedule was kept.':'Undo still needs checking. Use Check saved changes before trying again.');}catch{setUndoMessage('Undo could not be confirmed. Use Check saved changes before trying again.');}finally{setBusy(false);}}}>Undo schedule change</button><button className="underline" onClick={()=>dismissRecoveredChange(entry)}>Done</button></div>)}
    {durable.some(e=>e.deferred&&e.phase==='tail')&&<p>A course is archived. Its remaining schedule refresh is saved; check again after unarchiving the course.</p>}
    {durable.some(e=>e.deferred&&e.phase==='issued')&&<p>An archived course has an unconfirmed change. Its recovery token is saved; check again after unarchiving the course.</p>}
    {!!durable.filter(e=>e.phase!=='confirmed').length&&<><p>A saved change still needs checking. Check it here before repeating the action.</p>
    <button className="mt-2 font-semibold underline disabled:opacity-50" disabled={busy} onClick={async()=>{
      setBusy(true);
      try {
        // A resolved completion can leave only its tail refresh for the second pass.
        for(let pass=0;pass<2;pass++)for(const entry of (await schedulerRecoveryForClient(supabase)).sort((a,b)=>Number(a.phase==='tail')-Number(b.phase==='tail')))await recoverSchedulerEntry(supabase,entry);
        window.location.reload();
      }catch{setStorageError(true);}finally{setBusy(false);}
    }}>{busy?'Checking…':'Check saved changes'}</button></>}
    {!!pending.size&&<><p>Upcoming lesson dates still need to refresh. Saved completions and notes stay recorded; you don’t need to mark work again.</p>
    <button className="mt-2 font-semibold underline disabled:opacity-50" disabled={busy} onClick={async()=>{
      setBusy(true);
      try {
        for(const recovery of pending.values()) {
          try {if((await recovery.retry()).ok){window.dispatchEvent(new CustomEvent('rooted:lessons-updated'));window.dispatchEvent(new CustomEvent('rooted:schedule-refresh-recovered'));}}
          catch {/* Keep the recovery visible until the server confirms it. */}
        }
      } finally {setBusy(false);}
    }}>{busy?'Refreshing…':'Refresh upcoming lessons'}</button></>}
  </div>;
}
