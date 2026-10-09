"use client";
import { useState } from 'react';
import { CALENDAR_REFUSAL_HELP } from '../lib/calendar-refusal';

/** Hiding details never dismisses the unresolved status or marks sync complete. */
export default function DateSyncNotice({note,requiresAction,calendarMismatch,retry,retrying,retryReady}:{
  note:string|null;requiresAction:boolean;calendarMismatch:boolean;retry:()=>void;retrying:boolean;retryReady:boolean;
}) {
  const [details,setDetails]=useState(true);
  if(!note)return null;
  return <section className="text-[12px] text-[#7a4a1a] bg-[#fdf6e8] border border-[#e8d9a8] rounded-xl px-3.5 py-2.5">
    <p role="status">{requiresAction?'Plan date sync needs attention.':note}</p>
    {requiresAction&&<>
      {details&&<div><p className="mt-2">{note}</p>{calendarMismatch&&<p className="mt-2">{CALENDAR_REFUSAL_HELP}</p>}</div>}
      <div className="flex gap-3 mt-2">
        <button type="button" onClick={retry} disabled={retrying||!retryReady} className="font-semibold underline disabled:opacity-50">{retrying?'Checking calendar…':'Retry date sync'}</button>
        <button type="button" onClick={()=>setDetails(v=>!v)} aria-expanded={details}>{details?'Hide explanation':'Show explanation'}</button>
      </div>
      {!retryReady&&!retrying&&<p className="mt-1">Please wait 30 seconds between retries.</p>}
    </>}
  </section>;
}
