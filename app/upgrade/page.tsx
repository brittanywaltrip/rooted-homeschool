'use client'
import { Suspense, useState, useEffect } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import Link from 'next/link'
import { posthog } from '@/lib/posthog'
import { normalizeAffiliateCode } from '@/lib/referrals'
import { copyToClipboard } from '@/lib/clipboard'
import { TRIAL_DAYS } from '@/lib/user-access'

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
  const [loadingPlan, setLoadingPlan] = useState<'standard' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [isPaying, setIsPaying] = useState(false)
  const [planType, setPlanType] = useState<string | null>(null)
  const [trialStartedAt, setTrialStartedAt] = useState<string | null>(null)
  // giftCopyState is the Copy link button's UX feedback (staging
  // commit 56ea41f). Kept on resolve. The countdown state from the
  // Founding Family deadline timer was dropped — feat/may-1-pricing
  // intentionally removed it because the deadline (April 30 PDT) has
  // passed.
  const [giftCopyState, setGiftCopyState] = useState<'idle' | 'copied' | 'failed'>('idle')
  // Apply legacy alias (e.g. MILKELYS → MICKEY) at every ingestion source so
  // old shareable links, prior cookies, and prior localStorage values all
  // resolve to the partner's current code before display, tracking, or
  // checkout.
  const refParam = normalizeAffiliateCode(searchParams.get('ref')) || null
  const refCode = refParam
    || (typeof window !== 'undefined' ? normalizeAffiliateCode(localStorage.getItem('rooted_ref')) || null : null)
    || (typeof document !== 'undefined' ? normalizeAffiliateCode(document.cookie.match(/rooted_ref=([^;]+)/)?.[1] ?? null) || null : null)
  const [refAffiliateName, setRefAffiliateName] = useState<string | null>(null)

  useEffect(() => { posthog.capture('upgrade_page_viewed') }, [])

  useEffect(() => {
    if (!refCode) return
    fetch(`/api/affiliate/lookup?code=${encodeURIComponent(refCode)}`)
      .then(r => r.ok ? r.json() : null)
      .then(data => { if (data?.name) setRefAffiliateName(data.name) })
      .catch(() => {})
  }, [refCode])

  useEffect(() => {
    async function loadUserProfile() {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return

      const { data: profile } = await supabase
        .from('profiles')
        .select('is_pro, plan_type, trial_started_at')
        .eq('id', user.id)
        .single()

      setTrialStartedAt((profile as { trial_started_at?: string | null } | null)?.trial_started_at ?? null)

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

  }, [])

  useEffect(() => {
    if (refParam) {
      localStorage.setItem('rooted_ref', refParam)
    }
    if (refCode) {
      fetch(`/api/affiliate/track-click?code=${refCode}`).catch(() => {})
    }
  }, [refParam, refCode])

  async function handleClick(plan: 'standard') {
    posthog.capture('upgrade_clicked', { plan })
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

  const trialAlreadyUsed = !!trialStartedAt
    && new Date(trialStartedAt).getTime() + TRIAL_DAYS * 24 * 60 * 60 * 1000 <= Date.now()

  return (
    <main className="min-h-screen bg-[#f8f7f4] px-4 py-14">
      <div className="max-w-3xl mx-auto">

        {/* Header */}
        <div className="text-center mb-12">
          <div className="text-5xl mb-5">🌿</div>
          <h1 className="text-3xl font-bold text-[#2d2926] mb-3" style={{ fontFamily: 'var(--font-display)' }}>
            Keep everything you&apos;ve built 🌿
          </h1>
          <p className="text-[#7a6f65] leading-relaxed max-w-md mx-auto text-base mb-2">
            Your homeschool, organized, saved, and ready whenever you need it.
          </p>
          <p className="text-[#5c7f63] font-medium max-w-md mx-auto text-sm">
            {trialAlreadyUsed
              ? 'Your free trial has ended. Upgrade to keep everything you built.'
              : 'Start with 30 days free, full access to every feature, no credit card needed.'}
          </p>
        </div>

        {/* Social proof */}
        <p className="text-sm text-[#9a8f85] text-center mb-10">
          Join 1,500+ homeschool families already using Rooted 🌿
        </p>

        {/* Referral discount banner */}
        {refCode && refAffiliateName && (
          <div className="mb-6 bg-green-50 border border-green-200 text-green-800 text-sm rounded-xl px-4 py-3 max-w-lg mx-auto text-center">
            🎁 15% off applied, referred by {refAffiliateName}. Use code <span className="font-bold font-mono tracking-wider">{refCode}</span> at checkout.
          </div>
        )}

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
                <span className="text-base font-bold text-[#2d2926]">Rooted</span>
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
              <p className="text-sm text-[#7a6f65]">Free forever</p>
            </div>
            <ul className="space-y-2 mb-6 flex-1">
              {[
                ...(trialAlreadyUsed ? [] : ['30-day free trial, full access to everything']),
                'After trial: lesson logging & curriculum planning',
                'After trial: garden & scheduling',
                'After trial: memories (50 photo limit)',
                'After trial: curated resources',
              ].map(f => (
                <li key={f} className="flex items-start gap-2 text-sm text-[#7a6f65]">
                  <span className="text-[#c8bfb5] shrink-0 mt-0.5">✓</span>{f}
                </li>
              ))}
            </ul>
            <button
              disabled
              className="w-full py-2.5 rounded-xl border border-[#e8e2d9] text-sm font-semibold text-[#b5aca4] bg-[#f8f7f4] cursor-not-allowed"
            >
              Current plan
            </button>
          </div>

          {/* Rooted+ featured card */}
          <div className="relative bg-gradient-to-br from-[#e8f5ea] to-[#cfe8d2] border-2 border-[#5c7f63] rounded-2xl p-6 flex flex-col shadow-md">
            <div className="mb-5">
              <div className="flex items-center gap-2 mb-1">
                <p className="text-base font-bold text-[#2d2926]">Rooted+</p>
                {planType === 'founding_family' && (
                  <span className="text-[10px] font-semibold bg-[#C4962A] text-white px-2 py-0.5 rounded-full uppercase tracking-wide">
                    ✓ Founding Family
                  </span>
                )}
              </div>
              <div className="flex items-baseline gap-1 my-3">
                {refCode && refAffiliateName ? (
                  <>
                    <span className="text-xl text-[#b5aca4] line-through font-bold">$59</span>
                    <span className="text-3xl font-bold text-[var(--g-brand)]">$50.15</span>
                    <span className="text-sm text-[#5c7f63] font-semibold">/yr</span>
                  </>
                ) : (
                  <>
                    <span className="text-3xl font-bold text-[#2d2926]">$59</span>
                    <span className="text-sm text-[#5c7f63] font-semibold">/yr</span>
                  </>
                )}
              </div>
              {refCode && refAffiliateName && (
                <p className="text-xs text-[#5c7f63] font-medium -mt-1 mb-1">with {refAffiliateName}&apos;s referral</p>
              )}
              <p className="text-sm text-[var(--g-deep)] leading-relaxed">
                Unlimited photos, exports, and family sharing.
              </p>
            </div>

            <ul className="space-y-2 mb-6 flex-1">
              {[
                'Unlimited photos, keep every memory',
                'Full yearbook, no watermark, download anytime',
                'Transcripts & PDF reports, export anytime',
                'Family sharing, invite grandparents & family',
                'Hours & attendance log, track and export',
                'Badges & certificates',
                'All PDF exports',
                'Priority support from Brittany',
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
                className="w-full bg-[#5c7f63] hover:bg-[var(--g-deep)] text-white font-bold py-3 rounded-xl transition-colors text-sm shadow-sm text-center block"
              >
                ✓ You&apos;re already a member. Go to app →
              </Link>
            ) : (
              <button
                onClick={() => handleClick('standard')}
                disabled={loadingPlan !== null}
                className="w-full bg-[#5c7f63] hover:bg-[var(--g-deep)] disabled:opacity-60 text-white font-bold py-3 rounded-xl transition-colors text-sm shadow-sm flex items-center justify-center gap-2"
              >
                {loadingPlan === 'standard' ? (
                  <>
                    <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    Processing...
                  </>
                ) : (
                  refCode && refAffiliateName
                    ? 'Get Rooted+ → $50.15/yr'
                    : 'Get Rooted+ → $59/yr'
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
            the brands and creators homeschool families already love. Rooted+ members are part of
            that story from day one.
          </p>
        </div>

        {/* Gift section */}
        <div className="bg-[#fefcf9] border border-[#e8e2d9] rounded-2xl p-5 mb-8 max-w-lg mx-auto text-center">
          <p className="text-sm font-medium text-[#2d2926] mb-1">Want someone to gift this for you? 🎁</p>
          <p className="text-xs text-[#7a6f65] mb-3">Share this link with a grandparent or family member:</p>
          <div className="flex items-center gap-2 bg-white border border-[#e8e2d9] rounded-xl px-3 py-2">
            <span className="flex-1 text-xs text-[#2d2926] truncate font-mono">rootedhomeschoolapp.com/gift</span>
            <button
              type="button"
              onClick={async () => {
                const ok = await copyToClipboard('https://rootedhomeschoolapp.com/gift')
                setGiftCopyState(ok ? 'copied' : 'failed')
                setTimeout(() => setGiftCopyState('idle'), 2000)
              }}
              className="shrink-0 text-xs font-medium text-[#5c7f63] hover:text-[var(--g-deep)] transition-colors px-2 py-1"
            >
              {giftCopyState === 'copied' ? '✓ Copied!' : giftCopyState === 'failed' ? '✗ Try again' : 'Copy link'}
            </button>
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
