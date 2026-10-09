"use client";

import { useEffect, useRef, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createDailyReconcileRunner, reconcileForDay, DAILY_RECONCILE_FAILED_NOTE, type DailyReconcileRun } from "@/app/lib/daily-reconcile";
import { CALENDAR_REFUSAL_NOTE, readReconcileBlock, saveReconcileBlock, type ReconcileBlock } from "@/app/lib/calendar-refusal";
import { ymdInTz } from "@/app/lib/timezone";

type Notice = { owner: string; note: string; block: ReconcileBlock | null };
export function useDailyReconcile(
  supabase: SupabaseClient,
  userId: string | null | undefined,
  handlers: { onRedated?: (run: DailyReconcileRun) => void },
) {
  const [notice,setNotice]=useState<Notice|null>(null);
  const [busyOwner,setBusyOwner]=useState<string|null>(null);
  const [clock,setClock]=useState(0);
  const runnerRef=useRef<{owner:string;runner:ReturnType<typeof createDailyReconcileRunner>}|null>(null);
  const handlersRef=useRef(handlers);
  useEffect(()=>{handlersRef.current=handlers;});
  useEffect(()=>{
    if(!userId) return;
    let active=true;
    // The stored marker contains only refusal kind, day and retry deadline.
    // An unavailable storage API still leaves the current mount unresolved.
    let initial:ReconcileBlock|null=null;
    try { initial=readReconcileBlock(window.sessionStorage,userId); } catch {}
    const persist=(block:ReconcileBlock|null)=>{try{saveReconcileBlock(window.sessionStorage,userId,block);}catch{}};
    const showBlock=(block:ReconcileBlock)=>{
      if(!active) return;
      persist(block);
      setNotice({owner:userId,note:block.kind==='calendar'?CALENDAR_REFUSAL_NOTE:"Plan date sync was refused. No synchronization was confirmed. Contact Rooted support before retrying.",block});
    };
    if(initial) showBlock(initial);
    const browserZone=()=>Intl.DateTimeFormat().resolvedOptions().timeZone;
    const runner=createDailyReconcileRunner({
      initialBlock:initial,
      run:(now,explicit)=>reconcileForDay(supabase,userId,{timezone:browserZone(),now,verifyCalendar:explicit}),
      now:()=>new Date(),dayOf:d=>ymdInTz(d,browserZone()),
      onRedated:r=>{if(active) handlersRef.current.onRedated?.(r);},
      onBlocked:showBlock,
      onFailure:()=>{if(active)setNotice({owner:userId,note:DAILY_RECONCILE_FAILED_NOTE,block:null});},
      onSettled:()=>{if(active){persist(null);setNotice(null);}},
    });
    runnerRef.current={owner:userId,runner};
    const kick=()=>{if(document.visibilityState==='visible')void runner.trigger();};
    kick();
    const tick=window.setInterval(kick,60_000);
    window.addEventListener('focus',kick);document.addEventListener('visibilitychange',kick);
    return ()=>{active=false;if(runnerRef.current?.runner===runner)runnerRef.current=null;window.clearInterval(tick);window.removeEventListener('focus',kick);document.removeEventListener('visibilitychange',kick);};
  },[supabase,userId]);
  const current=notice?.owner===userId?notice:null;
  const retryAt=current?.block?.retryAt??0;
  useEffect(()=>{
    if(!retryAt) return;
    const timer=window.setTimeout(()=>setClock(Date.now()),Math.max(0,retryAt-Date.now())+10);
    return()=>window.clearTimeout(timer);
  },[retryAt]);
  const retry=async()=>{
    const entry=runnerRef.current;
    if(!entry || entry.owner!==userId || busyOwner===userId)return;
    setBusyOwner(entry.owner);
    try{
      const result=await entry.runner.trigger(true);
      // Another tab may already have corrected the dates. Refresh the surface
      // after a verified no-write retry as well as after our own writes.
      if(result&&!result.retry&&!result.disabled&&result.written===0&&runnerRef.current===entry)handlersRef.current.onRedated?.(result);
    }finally{setBusyOwner(owner=>owner===entry.owner?null:owner);setClock(Date.now());}
  };
  return {failureNote:current?.note??null,calendarMismatch:current?.block?.kind==='calendar',requiresAction:!!current?.block,
    retry,retrying:!!userId&&busyOwner===userId,retryReady:Math.max(clock,Date.now())>=retryAt};
}
