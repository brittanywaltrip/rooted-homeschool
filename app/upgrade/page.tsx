'use client'
import { useState } from 'react'
import { supabase } from '@/lib/supabase'
import Link from 'next/link'

async function startCheckout(plan: 'founding' | 'standard', setLoading: (v: boolean) => void) {
  setLoading(true)
  try {
    const { data: { session } } = await supabase.auth.getSession()
    if (!session) { setLoading(false); return }

    const res = await fetch('/api/stripe/checkout', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({ plan }),
    })
    const { url, error } = await res.json()
    if (error) { console.error(error); setLoading(false); return }
    if (url) window.location.href = url
  } catch (e) {
    console.error(e)
    setLoading(false)
  }
}

export default function UpgradePage() {
  const [loadingPlan, setLoadingPlan] = useState<'founding' | 'standard' | null>(null)

  function handleClick(plan: 'founding' | 'standard') {
    setLoadingPlan(plan)
    startCheckout(plan, (v) => { if (!v) setLoadingPlan(null) })
  }

  return (
    <main className="min-h-screen bg-[#f8f7f4] flex items-center justify-center px-4 py-16">
      <div className="max-w-lg w-full">

        {/* Header */}
        <div className="text-center mb-10">
          <div className="text-5xl mb-4">🌿</div>
          <h1 className="text-3xl font-bold text-[#2d2926] mb-2">Upgrade to Rooted</h1>
          <p className="text-[#7a6f65] leading-relaxed">
            Unlock everything. Support a homeschool mom building her dream.
          </p>
        </div>

        {/* Pricing cards */}
        <div className="space-y-4 mb-8">

          {/* Founding Family */}
          <div className="bg-gradient-to-br from-[#e8f5ea] to-[#d4ead6] border-2 border-[#5c7f63] rounded-2xl p-6">
            <div className="flex items-start justify-between mb-4">
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-base font-bold text-[#2d2926]">Founding Family</span>
                  <span className="text-[10px] font-bold bg-[#5c7f63] text-white px-2 py-0.5 rounded-full uppercase tracking-wide">
                    Limited Time
                  </span>
                </div>
                <p className="text-sm text-[#5c7f63]">Lock in forever — first 200 families only</p>
              </div>
              <div className="text-right shrink-0 ml-4">
                <span className="text-3xl font-bold text-[#2d2926]">$39</span>
                <span className="text-sm text-[#7a6f65]">/yr</span>
              </div>
            </div>
            <button
              onClick={() => handleClick('founding')}
              disabled={loadingPlan !== null}
              className="w-full bg-[#5c7f63] hover:bg-[#3d5c42] disabled:opacity-60 text-white font-bold py-3 rounded-xl transition-colors text-sm shadow-sm"
            >
              {loadingPlan === 'founding' ? 'Redirecting to checkout…' : 'Subscribe — $39/yr →'}
            </button>
          </div>

          {/* Standard */}
          <div className="bg-[#fefcf9] border-2 border-[#e8e2d9] rounded-2xl p-6">
            <div className="flex items-start justify-between mb-4">
              <div>
                <span className="text-base font-bold text-[#2d2926] block mb-1">Standard</span>
                <p className="text-sm text-[#7a6f65]">Full access, billed annually</p>
              </div>
              <div className="text-right shrink-0 ml-4">
                <span className="text-3xl font-bold text-[#2d2926]">$59</span>
                <span className="text-sm text-[#7a6f65]">/yr</span>
              </div>
            </div>
            <button
              onClick={() => handleClick('standard')}
              disabled={loadingPlan !== null}
              className="w-full bg-[#2d2926] hover:bg-[#1a1714] disabled:opacity-60 text-white font-bold py-3 rounded-xl transition-colors text-sm"
            >
              {loadingPlan === 'standard' ? 'Redirecting to checkout…' : 'Subscribe — $59/yr →'}
            </button>
          </div>
        </div>

        {/* Feature list */}
        <div className="bg-[#fefcf9] border border-[#e8e2d9] rounded-2xl p-5 mb-6">
          <p className="text-xs font-semibold uppercase tracking-widest text-[#b5aca4] mb-3">Everything included</p>
          <div className="space-y-2">
            {[
              'Unlimited children',
              'All 6 app sections',
              'Photo memories & book log',
              'Compliance-ready PDF reports',
              'Finish Line curriculum pacing',
              'Priority support from Brittany',
            ].map(f => (
              <div key={f} className="flex items-center gap-2.5 text-sm text-[#2d2926]">
                <span className="text-[#5c7f63] font-bold shrink-0">✓</span>
                {f}
              </div>
            ))}
          </div>
        </div>

        {/* Footer */}
        <p className="text-center text-xs text-[#b5aca4] leading-relaxed">
          Secure checkout via Stripe · Cancel anytime ·{' '}
          <Link href="/dashboard" className="hover:underline">Back to app</Link>
        </p>

      </div>
    </main>
  )
}
