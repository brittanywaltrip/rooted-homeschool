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
  const [loadingPlan, setLoadingPlan] = useState<'founding' | 'standard' | 'monthly' | null>(null)
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
    supabase.from('profiles').select('id', { count: 'exact', head: true })
      .eq('plan_type', 'founding_family')
      .then(({ count }) => { if (typeof count === 'number') setFoundingCount(count) })
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

  async function handleClick(plan: 'founding' | 'standard' | 'monthly') {
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

        {/* Testimonials */}
        <div className="mb-10">
          <p className="text-[10px] font-semibold uppercase tracking-widest text-[#b5aca4] text-center mb-4">Loved by homeschool families</p>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {[
              { quote: "Finally an app that gets how we actually homeschool.", name: "Sarah M.", loc: "Texas" },
              { quote: "I've tried every planner. Rooted is the only one that stuck.", name: "Jessica T.", loc: "Ohio" },
              { quote: "The garden is our kids' favourite part of the day.", name: "Amanda D.", loc: "Florida" },
            ].map((t) => (
              <div key={t.name} className="bg-[#fefcf9] border border-[#e8e2d9] rounded-2xl p-4">
                <p className="text-sm text-[#2d2926] leading-relaxed mb-3" style={{ fontFamily: 'var(--font-display)' }}>
                  &ldquo;{t.quote}&rdquo;
                </p>
                <p className="text-xs text-[#7a6f65]">{t.name}, {t.loc}</p>
              </div>
            ))}
          </div>
        </div>

        {/* Error banner */}
        {error && (
          <div className="mb-6 bg-red-50 border border-red-200 text-red-700 text-sm rounded-xl px-4 py-3 max-w-lg mx-auto">
            {error}
          </div>
        )}

        {/* 3-tier pricing cards */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-10">

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
              {foundingCount !== null && (
                <div className="mt-2">
                  <div className="flex items-center gap-1.5 mb-1.5">
                    <span className="w-2 h-2 rounded-full bg-[#3d5c42]" style={{ animation: 'pulse 2s ease-in-out infinite' }} />
                    <p className="text-xs font-semibold text-[#5c7f63]">
                      {foundingCount} of 200 spots claimed
                    </p>
                  </div>
                  <div className="w-full h-2 rounded-full bg-[#f0ede8] overflow-hidden">
                    <div
                      className="h-full rounded-full transition-all duration-700"
                      style={{ width: `${Math.min((foundingCount / 200) * 100, 100)}%`, backgroundColor: '#3d5c42' }}
                    />
                  </div>
                </div>
              )}
            </div>

            <ul className="space-y-2 mb-6 flex-1">
              {[
                'Unlimited children',
                'Photos, books, wins, drawings, field trips',
                'Memories search',
                'Family yearbook',
                'Progress reports & transcripts',
                'AI-written family updates',
                'Share with family',
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

          {/* Standard */}
          <div className="bg-[#fefcf9] border border-[#e8e2d9] rounded-2xl p-6 flex flex-col">
            <div className="mb-5">
              <div className="flex items-center gap-2 mb-1">
                <p className="text-base font-bold text-[#2d2926]">Standard</p>
                {planType === 'standard' && (
                  <span className="text-[10px] font-semibold bg-[#5c7f63] text-white px-2 py-0.5 rounded-full uppercase tracking-wide">
                    ✓ Your Plan
                  </span>
                )}
              </div>
              <div className="flex items-baseline gap-1 my-3">
                <span className="text-3xl font-bold text-[#2d2926]">$59</span>
                <span className="text-sm text-[#b5aca4]">/yr</span>
              </div>
              <p className="text-sm text-[#7a6f65]">Full access, billed annually</p>
            </div>
            <ul className="space-y-2 mb-6 flex-1">
              {[
                'Unlimited children',
                'Photos, books, wins, drawings, field trips',
                'Memories search',
                'Family yearbook',
                'Progress reports & transcripts',
                'AI-written family updates',
                'Share with family',
              ].map((label) => (
                <li key={label} className="flex items-start gap-2 text-sm text-[#7a6f65]">
                  <span className="text-[#5c7f63] shrink-0 mt-0.5">✓</span>
                  {label}
                </li>
              ))}
            </ul>
            {isPaying ? (
              <Link
                href="/dashboard"
                className="w-full bg-[#5c7f63] hover:bg-[#3d5c42] text-white font-bold py-3 rounded-xl transition-colors text-sm text-center block"
              >
                ✓ You&apos;re already a member — Go to app →
              </Link>
            ) : (
              <button
                onClick={() => handleClick('standard')}
                disabled={loadingPlan !== null}
                className="w-full bg-[#2d2926] hover:bg-[#1a1714] disabled:opacity-60 text-white font-bold py-3 rounded-xl transition-colors text-sm flex items-center justify-center gap-2"
              >
                {loadingPlan === 'standard' ? (
                  <>
                    <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    Processing...
                  </>
                ) : (
                  'Subscribe — $59/yr →'
                )}
              </button>
            )}
          </div>

          {/* Monthly */}
          <div className="bg-[#fefcf9] border border-[#e8e2d9] rounded-2xl p-6 flex flex-col">
            <div className="mb-5">
              <div className="flex items-center gap-2 mb-1">
                <p className="text-base font-bold text-[#2d2926]">Monthly</p>
                {planType === 'monthly' && (
                  <span className="text-[10px] font-semibold bg-[#5c7f63] text-white px-2 py-0.5 rounded-full uppercase tracking-wide">
                    ✓ Your Plan
                  </span>
                )}
              </div>
              <div className="flex items-baseline gap-1 my-3">
                <span className="text-3xl font-bold text-[#2d2926]">$6.99</span>
                <span className="text-sm text-[#b5aca4]">/mo</span>
              </div>
              <p className="text-sm text-[#7a6f65]">Pay as you go · ≈ $83.88/year</p>
            </div>
            <ul className="space-y-2 mb-6 flex-1">
              {[
                'Unlimited children',
                'Photos, books, wins, drawings, field trips',
                'Memories search',
                'Family yearbook',
                'Progress reports & transcripts',
                'AI-written family updates',
                'Share with family',
              ].map((label) => (
                <li key={label} className="flex items-start gap-2 text-sm text-[#7a6f65]">
                  <span className="text-[#5c7f63] shrink-0 mt-0.5">✓</span>
                  {label}
                </li>
              ))}
            </ul>
            {isPaying ? (
              <Link
                href="/dashboard"
                className="w-full bg-[#5c7f63] hover:bg-[#3d5c42] text-white font-bold py-3 rounded-xl transition-colors text-sm text-center block"
              >
                ✓ You&apos;re already a member — Go to app →
              </Link>
            ) : (
              <button
                onClick={() => handleClick('monthly')}
                disabled={loadingPlan !== null}
                className="w-full bg-[#2d2926] hover:bg-[#1a1714] disabled:opacity-60 text-white font-bold py-3 rounded-xl transition-colors text-sm flex items-center justify-center gap-2"
              >
                {loadingPlan === 'monthly' ? (
                  <>
                    <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    Processing...
                  </>
                ) : (
                  'Start Monthly →'
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
