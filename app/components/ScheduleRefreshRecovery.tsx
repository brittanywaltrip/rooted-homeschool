"use client";
import {useEffect, useState} from 'react';

type Recovery = {goalId: string; retry: () => Promise<{ok: boolean}>};
/** A failed tail refresh must never ask the parent to toggle completion again. */
export default function ScheduleRefreshRecovery() {
  const [pending,setPending]=useState<Map<string,Recovery>>(new Map());
  const [busy,setBusy]=useState(false);
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
  if(!pending.size)return null;
  return <div role="status" className="fixed bottom-24 left-1/2 z-[80] w-[min(90vw,32rem)] -translate-x-1/2 rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-stone-900 shadow-lg">
    <p>Upcoming lesson dates still need to refresh. Saved completions and notes stay recorded; you don’t need to mark work again.</p>
    <button className="mt-2 font-semibold underline disabled:opacity-50" disabled={busy} onClick={async()=>{
      setBusy(true);
      try {
        for(const recovery of pending.values()) {
          try {if((await recovery.retry()).ok){window.dispatchEvent(new CustomEvent('rooted:lessons-updated'));window.dispatchEvent(new CustomEvent('rooted:schedule-refresh-recovered'));}}
          catch {/* Keep the recovery visible until the server confirms it. */}
        }
      } finally {setBusy(false);}
    }}>{busy?'Refreshing…':'Refresh upcoming lessons'}</button>
  </div>;
}
