'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import Link from 'next/link'

export default function UpgradePage() {
  const router = useRouter()
  const [loadingPlan, setLoadingPlan] = useState<'founding' | 'standard' | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function handleClick(plan: 'founding' | 'standard') {
    setError(null)
    setLoadingPlan(plan)

    try {
      // Get current session — redirects to login if missing
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) {
        router.push('/login')
        return
      }

      const res = await fetch('/api/stripe/checkout', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ plan }),
      })

      const json = await res.json()

      if (!res.ok || json.error) {
        setError(json.error ?? 'Something went wrong. Please try again.')
        setLoadingPlan(null)
        return
      }

      if (json.url) {
        window.location.href = json.url
        // keep loading spinner while Stripe redirects
      } else {
        setError('No checkout URL returned. Please try again.')
        setLoadingPlan(null)
      }
    } catch (e) {
      console.error(e)
      setError('Network error. Please check your connection and try again.')
      setLoadingPlan(null)
    }
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

        {/* Error banner */}
        {error && (
          <div className="mb-5 bg-red-50 border border-red-200 text-red-700 text-sm rounded-xl px-4 py-3">
            {error}
          </div>
        )}

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
                <p className="text-sm text-[#7a6f65] mt-1">🕐 Founding Family pricing ends April 30</p>
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
