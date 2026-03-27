'use client'
import { Suspense, useState, useEffect } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import Link from 'next/link'

export default function UpgradePage() {
  return (
    <Suspense fallback={null}>
      <UpgradePageInner />
    </Suspense>
  )
}

function UpgradePageInner() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [loadingPlan, setLoadingPlan] = useState<'founding' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [isPaying, setIsPaying] = useState(false)
  const [planType, setPlanType] = useState<string | null>(null)
  const [countdown, setCountdown] = useState('')
  const [foundingCount, setFoundingCount] = useState<number | null>(null)
  const refParam = searchParams.get('ref')
  const refCode = refParam || (typeof window !== 'undefined' ? localStorage.getItem('rooted_ref') : null)

  useEffect(() => {
    async function loadUserProfile() {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return

      const { data: profile } = await supabase
        .from('profiles')
        .select('is_pro, plan_type')
        .eq('id', user.id)
        .single()

      if (
        profile?.is_pro ||
        profile?.plan_type === 'founding_family' ||
        profile?.plan_type === 'standard' ||
        profile?.plan_type === 'monthly'
      ) {
        setIsPaying(true)
        setPlanType(profile.plan_type ?? null)
      }
    }


    loadUserProfile()

    // Live founding member count
    supabase.from('profiles').select('id')
      .eq('plan_type', 'founding_family')
      .then(({ data }) => { if (data) setFoundingCount(data.length) })
  }, [])

  useEffect(() => {
    if (refParam) {
      localStorage.setItem('rooted_ref', refParam)
    }
    if (refCode) {
      fetch(`/api/affiliate/track-click?code=${refCode}`).catch(() => {})
    }
  }, [refParam, refCode])

  useEffect(() => {
    const deadline = new Date('2026-04-30T00:00:00').getTime()
    function tick() {
      const diff = deadline - Date.now()
      if (diff <= 0) { setCountdown('Offer ended'); return }
      const d = Math.floor(diff / 86400000)
      const h = Math.floor((diff % 86400000) / 3600000)
      setCountdown(`${d} day${d !== 1 ? 's' : ''}, ${h} hr${h !== 1 ? 's' : ''} left`)
    }
    tick()
    const id = setInterval(tick, 1000)
    return () => clearInterval(id)
  }, [])

  async function handleClick(plan: 'founding') {
    setError(null)
    setLoadingPlan(plan)

    try {
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
        body: JSON.stringify({ plan, ref: refCode || null }),
      })

      const json = await res.json()

      if (!res.ok || json.error) {
        setError(json.error ?? 'Something went wrong. Please try again.')
        setLoadingPlan(null)
        return
      }

      if (json.url) {
        localStorage.removeItem('rooted_ref')
        window.location.href = json.url
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
    <main className="min-h-screen bg-[#f8f7f4] px-4 py-14">
      <div className="max-w-3xl mx-auto">

        {/* Header */}
        <div className="text-center mb-12">
          <div className="text-5xl mb-5">🌿</div>
          <h1 className="text-3xl font-bold text-[#2d2926] mb-3" style={{ fontFamily: 'var(--font-display)' }}>
            Your family&apos;s story deserves to be kept forever.
          </h1>
          <p className="text-[#7a6f65] leading-relaxed max-w-md mx-auto text-base">
            Upgrade to unlock unlimited memories, your family yearbook, and AI updates to share with the people you love.
          </p>
        </div>

        {/* Social proof */}
        <p className="text-sm text-[#9a8f85] text-center mb-10">
          Join 276+ homeschool families already using Rooted 🌿
        </p>

        {/* Error banner */}
        {error && (
          <div className="mb-6 bg-red-50 border border-red-200 text-red-700 text-sm rounded-xl px-4 py-3 max-w-lg mx-auto">
            {error}
          </div>
        )}

        {/* Pricing cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-10 max-w-2xl mx-auto">

          {/* Free */}
          <div className="bg-[#fefcf9] border border-[#e8e2d9] rounded-2xl p-6 flex flex-col">
            <div className="mb-5">
              <div className="flex items-center gap-2 mb-1">
                <span className="text-base font-bold text-[#2d2926]">Free</span>
                {!isPaying && (
                  <span className="text-[10px] font-semibold bg-[#f0ede8] text-[#7a6f65] px-2 py-0.5 rounded-full uppercase tracking-wide">
                    Current plan
                  </span>
                )}
              </div>
              <div className="flex items-baseline gap-1 my-3">
                <span className="text-3xl font-bold text-[#2d2926]">$0</span>
                <span className="text-sm text-[#b5aca4]">/ forever</span>
              </div>
              <p className="text-sm text-[#7a6f65]">Get started</p>
            </div>
            <ul className="space-y-2 mb-6 flex-1">
              {['Unlimited children', 'Basic lesson tracking', 'Family garden', 'Memories search', 'Curated resources'].map(f => (
                <li key={f} className="flex items-center gap-2 text-sm text-[#7a6f65]">
                  <span className="text-[#c8bfb5] shrink-0">✓</span>{f}
                </li>
              ))}
            </ul>
            <button
              disabled
              className="w-full py-2.5 rounded-xl border border-[#e8e2d9] text-sm font-semibold text-[#b5aca4] bg-[#f8f7f4] cursor-not-allowed"
            >
              Current Plan
            </button>
          </div>

          {/* Founding Family — featured */}
          <div className="relative bg-gradient-to-br from-[#e8f5ea] to-[#cfe8d2] border-2 border-[#5c7f63] rounded-2xl p-6 flex flex-col shadow-md">
            {/* Top badge */}
            <div className="absolute -top-3 left-1/2 -translate-x-1/2">
              <span className="text-[10px] font-bold bg-[#5c7f63] text-white px-3 py-1 rounded-full uppercase tracking-widest shadow-sm whitespace-nowrap">
                ⭐ Limited Time
              </span>
            </div>

            <div className="mb-5 mt-1">
              <div className="flex items-center gap-2 mb-1">
                <p className="text-base font-bold text-[#2d2926]">Founding Family</p>
                {planType === 'founding_family' && (
                  <span className="text-[10px] font-semibold bg-[#5c7f63] text-white px-2 py-0.5 rounded-full uppercase tracking-wide">
                    ✓ Your Plan
                  </span>
                )}
              </div>
              <div className="flex items-baseline gap-1 my-3">
                <span className="text-3xl font-bold text-[#2d2926]">$39</span>
                <span className="text-sm text-[#5c7f63] font-semibold">/yr · locked forever</span>
              </div>
              <p className="text-sm text-[#3d5c42] leading-relaxed">
                For the first 200 families who believe in where this is going
              </p>
              {countdown && (
                <p className="text-xs font-semibold mt-2 text-[#a08040]">
                  ⏳ {countdown}
                </p>
              )}
              <p className="text-xs font-semibold text-[#5c7f63] mt-2">
                {Math.max(foundingCount ?? 0, 6)} families have already joined as Founding Members
              </p>
            </div>

            <ul className="space-y-2 mb-6 flex-1">
              {[
                'Unlimited children',
                'Photos, books, wins, drawings, field trips',
                'Memories search',
                'Family yearbook',
                'AI-written family updates',
                'Priority support from Brittany',
                'Founding price locked forever 🎁',
              ].map((label) => (
                <li key={label} className="flex items-start gap-2 text-sm text-[#2d5c38] font-medium">
                  <span className="text-[#5c7f63] shrink-0 mt-0.5">✓</span>
                  {label}
                </li>
              ))}
            </ul>

            {isPaying ? (
              <Link
                href="/dashboard"
                className="w-full bg-[#5c7f63] hover:bg-[#3d5c42] text-white font-bold py-3 rounded-xl transition-colors text-sm shadow-sm text-center block"
              >
                ✓ You&apos;re already a member — Go to app →
              </Link>
            ) : (
              <button
                onClick={() => handleClick('founding')}
                disabled={loadingPlan !== null}
                className="w-full bg-[#5c7f63] hover:bg-[#3d5c42] disabled:opacity-60 text-white font-bold py-3 rounded-xl transition-colors text-sm shadow-sm flex items-center justify-center gap-2"
              >
                {loadingPlan === 'founding' ? (
                  <>
                    <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    Processing...
                  </>
                ) : (
                  'Become a Founding Member → $39/yr'
                )}
              </button>
            )}
          </div>



        </div>

        {/* Payment processing warning */}
        {loadingPlan !== null && (
          <div className="mb-6 bg-[#fef9e8] border border-[#f0dda8] text-[#7a4a1a] text-sm rounded-xl px-4 py-3 max-w-lg mx-auto text-center">
            <p className="font-semibold">Please don&apos;t close this page or click back</p>
            <p className="text-xs mt-1 text-[#a08040]">Your payment is being processed. This may take a few seconds.</p>
          </div>
        )}

        {/* Vision section */}
        <div className="bg-[#fefcf9] border border-[#e8e2d9] rounded-2xl p-7 mb-8 text-center max-w-xl mx-auto">
          <h2 className="text-lg font-bold text-[#2d2926] mb-3" style={{ fontFamily: 'var(--font-display)' }}>
            Rooted is just getting started 🌱
          </h2>
          <p className="text-sm text-[#7a6f65] leading-relaxed">
            The app is the foundation. We&apos;re building a community, resources, and partnerships with
            the brands and creators homeschool families already love. Founding members are part of
            that story from day one.
          </p>
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
