'use client';
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { createSupabaseBrowserClient } from '@/lib/supabase-browser';

type Insights = { rows: { id: string; email: string; signupAt: string; firstPaidAt: string | null; daysToUpgrade: number | null; discoverySource: string }[]; medianDays: number | null; generatedAt: string };
const date = (value: string | null) => value && Number.isFinite(Date.parse(value)) ? new Date(value).toLocaleDateString('en-US', { timeZone: 'America/Los_Angeles', year: 'numeric', month: 'short', day: 'numeric' }) : 'Unknown';
export default function SignupUpgradeInsightsPage() {
  const [data, setData] = useState<Insights | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const load = useCallback(async (signal?: AbortSignal) => {
    setLoading(true); setError(''); setData(null);
    try {
      const { data: session } = await createSupabaseBrowserClient().auth.getSession();
      if (!session.session) throw new Error('Sign in with an admin account to view insights.');
      const r = await fetch('/api/admin/signup-upgrade-insights', { headers: { Authorization: `Bearer ${session.session.access_token}` }, signal, cache: 'no-store' });
      if (!r.ok) throw new Error(r.status === 403 ? 'This page is available to admins only.' : 'Insights could not be loaded. Please try again.');
      const result: Insights = await r.json();
      if (!signal?.aborted) setData(result);
    } catch (e) { if (!signal?.aborted) setError(e instanceof Error ? e.message : 'Could not load insights.'); }
    finally { if (!signal?.aborted) setLoading(false); }
  }, []);
  useEffect(() => { const controller = new AbortController(); void load(controller.signal); return () => controller.abort(); }, [load]);
  return <main className="mx-auto max-w-5xl space-y-6 px-5 py-8 text-[#2d2926]">
    <Link href="/admin" className="text-sm text-[#2D5A3D]">← Admin</Link>
    <h1 className="text-2xl font-bold">Signup &amp; Upgrade Insights</h1>
    <p className="text-sm">See how long families had an account before their first paid Stripe subscription invoice. Discovery sources are optional, self-reported answers.</p>
    <p className="text-xs text-[#7a6f65]">Historical upgrades include later cancellations and refunds. Complimentary and test accounts are excluded. App-store payments, gifts and unmatched Stripe customers are outside this view. Dates use Pacific time.</p>
    {loading ? <p role="status">Loading insights…</p> : error ? <div role="alert"><p>{error}</p><button onClick={() => void load()} className="mt-3 rounded-xl bg-[#2D5A3D] px-4 py-2 text-white">Retry</button></div> : data ? <>
      <div className="flex flex-wrap gap-6 rounded-2xl border p-5"><p><strong>{data.rows.length}</strong> matched historical upgrades</p><p>Median time to upgrade: <strong>{data.medianDays === null ? 'Unknown' : `${data.medianDays} days`}</strong></p></div>
      <div className="overflow-x-auto"><table className="w-full text-left text-sm"><caption className="pb-3 text-left">Families ordered by their first paid upgrade; unknown dates appear last and do not count toward the median.</caption><thead><tr>{['Family account', 'Signed up', 'First paid upgrade', 'Days before upgrade', 'Discovery source'].map(h => <th scope="col" key={h} className="border-b p-3">{h}</th>)}</tr></thead><tbody>{data.rows.map(r => <tr key={r.id}><td className="border-b p-3">{r.email}</td><td className="border-b p-3">{date(r.signupAt)}</td><td className="border-b p-3">{date(r.firstPaidAt)}</td><td className="border-b p-3">{r.daysToUpgrade ?? 'Unknown'}</td><td className="border-b p-3">{r.discoverySource}</td></tr>)}</tbody></table></div>
      {data.rows.length === 0 ? <p>No matched paid upgrades found.</p> : null}
      <p className="text-xs">Checked {new Date(data.generatedAt).toLocaleString('en-US', { timeZone: 'America/Los_Angeles' })} Pacific.</p>
    </> : null}
  </main>;
}
