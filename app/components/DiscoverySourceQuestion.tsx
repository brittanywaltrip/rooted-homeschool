'use client';
import { useState } from 'react';
import { createSupabaseBrowserClient } from '@/lib/supabase-browser';
import { DISCOVERY_SOURCES } from '@/lib/signup-upgrade-insights';

export default function DiscoverySourceQuestion() {
  const [source, setSource] = useState('');
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  async function save() {
    setStatus('saving');
    try {
      const { data } = await createSupabaseBrowserClient().auth.getSession();
      const token = data.session?.access_token;
      if (!token) throw new Error('No session');
      const r = await fetch('/api/account/discovery-source', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify({ source }) });
      if (!r.ok) throw new Error('Save failed');
      setStatus('saved');
    } catch { setStatus('error'); }
  }
  return <div className="mt-8 rounded-2xl border border-white/25 p-4 text-left text-white">
    <label htmlFor="rooted-discovery-source" className="block text-sm font-semibold">How did you hear about Rooted? <span className="font-normal">(optional)</span></label>
    <p className="mt-1 text-xs text-white/80">Your answer helps us reach more homeschool families.</p>
    <div className="mt-3 flex flex-wrap gap-2">
      <select id="rooted-discovery-source" value={source} disabled={status === 'saving'} onChange={e => { setSource(e.target.value); setStatus('idle'); }} className="min-w-0 flex-1 rounded-xl bg-white p-3 text-sm text-[#2d2926]">
        <option value="">Choose an answer</option>
        {Object.entries(DISCOVERY_SOURCES).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
      </select>
      <button type="button" onClick={save} disabled={!source || status === 'saving' || status === 'saved'} className="rounded-xl bg-white px-4 py-3 text-sm font-semibold text-[#2D5A3D] disabled:opacity-60">{status === 'saving' ? 'Saving…' : status === 'saved' ? 'Saved' : 'Save answer'}</button>
    </div>
    <p role="status" className="mt-2 text-xs">{status === 'saved' ? 'Thank you! Your answer is saved.' : status === 'error' ? 'Your answer was not saved. You can retry or continue without answering.' : 'You can continue without answering.'}</p>
  </div>;
}
