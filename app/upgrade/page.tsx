'use client'
import { useState } from 'react'
import { supabase } from '@/lib/supabase'
import Link from 'next/link'

export default function UpgradePage() {
  const [loading, setLoading] = useState(false)
  const [plan, setPlan] = useState<'founding' | 'standard'>('founding')

  async function handleUpgrade() {
    setLoading(true)
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { setLoading(false); return }

    const priceId = plan === 'founding'
      ? process.env.NEXT_PUBLIC_STRIPE_FOUNDING_PRICE_ID
      : process.env.NEXT_PUBLIC_STRIPE_STANDARD_PRICE_ID

    const res = await fetch('/api/create-checkout-session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ priceId, userId: user.id, email: user.email }),
    })
    const { url } = await res.json()
    if (url) window.location.href = url
    setLoading(false)
  }

  return (
    <main className="min-h-screen bg-[#f8f7f4] flex items-center justify-center px-4 py-16">
      <div className="max-w-lg w-full">
        <div className="text-center mb-10">
          <div className="text-5xl mb-4">🌿</div>
          <h1 className="text-3xl font-bold text-[#2d2926] mb-2">Upgrade to Rooted</h1>
          <p className="text-[#7a6f65]">Unlock everything. Support a homeschool mom building her dream.</p>
        </div>

        <div className="space-y-4 mb-8">
          {/* Founding Family */}
          <button
            onClick={() => setPlan('founding')}
            className={`w-full text-left p-5 rounded-2xl border-2 transition-all ${
              plan === 'founding'
                ? 'border-[#5c7f63] bg-[#e8f5ea]'
                : 'border-[#e8e2d9] bg-[#fefcf9] hover:border-[#5c7f63]'
            }`}
          >
            <div className="flex items-start justify-between">
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-sm font-bold text-[#2d2926]">Founding Family</span>
                  <span className="text-xs bg-[#5c7f63] text-white px-2 py-0.5 rounded-full">Best Value</span>
                </div>
                <p className="text-xs text-[#7a6f65]">Lock in this price forever — first 200 families only</p>
              </div>
              <div className="text-right shrink-0">
                <span className="text-2xl font-bold text-[#2d2926]">$39</span>
                <span className="text-sm text-[#7a6f65]">/yr</span>
              </div>
            </div>
          </button>

          {/* Standard */}
          <button
            onClick={() => setPlan('standard')}
            className={`w-full text-left p-5 rounded-2xl border-2 transition-all ${
              plan === 'standard'
                ? 'border-[#5c7f63] bg-[#e8f5ea]'
                : 'border-[#e8e2d9] bg-[#fefcf9] hover:border-[#5c7f63]'
            }`}
          >
            <div className="flex items-start justify-between">
              <div>
                <span className="text-sm font-bold text-[#2d2926] block mb-1">Standard</span>
                <p className="text-xs text-[#7a6f65]">Full access, billed annually</p>
              </div>
              <div className="text-right shrink-0">
                <span className="text-2xl font-bold text-[#2d2926]">$59</span>
                <span className="text-sm text-[#7a6f65]">/yr</span>
              </div>
            </div>
          </button>
        </div>

        <div className="bg-[#fefcf9] border border-[#e8e2d9] rounded-2xl p-4 mb-6 space-y-2">
          {['Unlimited children', 'All 6 app sections', 'Photo memories', 'Compliance reports', 'Finish Line pacing tracker', 'Priority support'].map(f => (
            <div key={f} className="flex items-center gap-2 text-sm text-[#2d2926]">
              <span className="text-[#5c7f63] font-bold">✓</span> {f}
            </div>
          ))}
        </div>

        <button
          onClick={handleUpgrade}
          disabled={loading}
          className="w-full bg-[#5c7f63] hover:bg-[#3d5c42] disabled:opacity-60 text-white font-bold py-4 rounded-xl transition-colors text-base shadow-sm"
        >
          {loading ? 'Redirecting to checkout…' : `Get Started — ${plan === 'founding' ? '$39/yr' : '$59/yr'} →`}
        </button>

        <p className="text-center text-xs text-[#b5aca4] mt-4">
          Secure payment via Stripe · Cancel anytime · <Link href="/dashboard" className="hover:underline">Back to app</Link>
        </p>
      </div>
    </main>
  )
}
