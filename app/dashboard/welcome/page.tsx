'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'

const FEATURES = [
  { emoji: '🗓️', label: 'Plan Your Days',        desc: 'Lesson planning & daily tracking'    },
  { emoji: '🌱', label: 'The Family Garden',      desc: 'Watch each child\'s tree bloom'       },
  { emoji: '📚', label: 'Curated Resources',      desc: 'Discounts, field trips & printables'  },
  { emoji: '📸', label: 'Capture Memories',       desc: 'Photos, books & project log'          },
  { emoji: '📋', label: 'Progress Reports',     desc: 'Print-ready PDF in one click'         },
  { emoji: '🎯', label: 'Finish Line Tracker',    desc: 'Curriculum pacing & goal tracking'    },
]

export default function WelcomePage() {
  const router = useRouter()
  const [familyName, setFamilyName] = useState('')
  const [showContent, setShowContent] = useState(false)

  useEffect(() => {
    // Load family name
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (!session) { router.push('/login'); return }
      const { data: profile } = await supabase
        .from('profiles')
        .select('display_name, first_name, last_name')
        .eq('id', session.user.id)
        .maybeSingle()
      const p = profile as { display_name?: string; first_name?: string; last_name?: string } | null
      const name = p?.display_name
        || (p?.first_name && p?.last_name ? `${p.first_name} ${p.last_name}` : null)
        || p?.first_name
        || session.user.user_metadata?.family_name
        || ''
      setFamilyName(name)
    })

    // Stagger content in
    const t = setTimeout(() => setShowContent(true), 100)

    // Fire confetti after a brief delay
    const fire = setTimeout(async () => {
      const confetti = (await import('canvas-confetti')).default
      const colors = ['#5c7f63', '#a8d8a8', '#f9d77e', '#f9a8d4', '#86efac', '#fbbf24']

      // First burst
      confetti({
        particleCount: 80,
        spread: 70,
        origin: { x: 0.5, y: 0.55 },
        colors,
        scalar: 1.1,
      })

      // Side bursts
      setTimeout(() => {
        confetti({ particleCount: 40, angle: 60,  spread: 55, origin: { x: 0, y: 0.6 }, colors })
        confetti({ particleCount: 40, angle: 120, spread: 55, origin: { x: 1, y: 0.6 }, colors })
      }, 300)

      // Gentle shower
      setTimeout(() => {
        confetti({ particleCount: 50, spread: 100, origin: { x: 0.5, y: 0.3 }, colors, scalar: 0.8, ticks: 200 })
      }, 700)
    }, 400)

    return () => { clearTimeout(t); clearTimeout(fire) }
  }, [router])

  const displayName = familyName
    ? (familyName.toLowerCase().endsWith('family') ? familyName : `The ${familyName} Family`)
    : 'Your Family'

  return (
    <main className="min-h-screen bg-[#f8f7f4] flex flex-col items-center justify-center px-4 py-16 overflow-hidden">

      {/* Animated background blobs */}
      <div className="fixed inset-0 pointer-events-none overflow-hidden" aria-hidden>
        <div className="absolute -top-32 -left-32 w-96 h-96 rounded-full opacity-20"
          style={{ background: 'radial-gradient(circle, #a8d8a8, transparent)', animation: 'pulse 4s ease-in-out infinite' }} />
        <div className="absolute -bottom-20 -right-20 w-80 h-80 rounded-full opacity-15"
          style={{ background: 'radial-gradient(circle, #f9d77e, transparent)', animation: 'pulse 5s ease-in-out infinite 1s' }} />
      </div>

      <div
        className="relative max-w-lg w-full text-center"
        style={{ opacity: showContent ? 1 : 0, transform: showContent ? 'translateY(0)' : 'translateY(16px)', transition: 'opacity 0.6s ease, transform 0.6s ease' }}
      >

        {/* Rooted logo */}
        <div className="mb-6 flex justify-center">
          <img
            src="/icon-192.png"
            alt="Rooted"
            width={88}
            height={88}
            className="rounded-2xl shadow-lg"
            style={{ animation: 'sproutGrow 0.8s cubic-bezier(0.34,1.56,0.64,1) forwards' }}
          />
        </div>

        {/* Welcome heading */}
        <div className="mb-2">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[#5c7f63] mb-2">So glad you&apos;re here</p>
          <h1 className="text-4xl font-bold text-[#2d2926] leading-tight mb-1" style={{ fontFamily: 'var(--font-display)' }}>
            {displayName}
          </h1>
          <p className="text-lg text-[#5c7f63] font-medium">You&apos;re officially Rooted. 🌿</p>
        </div>

        {/* Brittany's note */}
        <div className="mt-7 mb-7 bg-gradient-to-br from-[#e8f5ea] to-[#d4ead6] border border-[#b8d9bc] rounded-2xl p-6 text-left">
          <div className="flex items-center gap-3 mb-3">
            <div className="w-9 h-9 rounded-full bg-[#5c7f63] flex items-center justify-center text-white font-bold text-sm shrink-0">B</div>
            <div>
              <p className="text-sm font-bold text-[#2d2926]">Brittany</p>
              <p className="text-xs text-[#7a6f65]">Founder · Rooted Homeschool</p>
            </div>
          </div>
          <p className="text-sm text-[#3d5c42] leading-relaxed italic">
            &ldquo;You just made my day. As a homeschool mom who built this for families exactly like yours,
            your support means everything to me. I poured my heart into every part of this app — I hope
            it gives your family a little more calm, a little more joy, and a lot more confidence.
            Welcome to the Rooted family. 🌿&rdquo;
          </p>
        </div>

        {/* What's unlocked */}
        <div className="mb-8 bg-white border border-[#e8e2d9] rounded-2xl p-5">
          <p className="text-xs font-semibold uppercase tracking-widest text-[#b5aca4] mb-4">Everything you now have access to</p>
          <div className="grid grid-cols-2 gap-2.5">
            {FEATURES.map((f, i) => (
              <div
                key={f.label}
                className="flex items-start gap-2.5 text-left p-2.5 rounded-xl bg-[#f8f7f4]"
                style={{ animationDelay: `${i * 80}ms` }}
              >
                <span className="text-lg shrink-0 mt-0.5">{f.emoji}</span>
                <div>
                  <p className="text-xs font-bold text-[#2d2926] leading-tight">{f.label}</p>
                  <p className="text-[10px] text-[#7a6f65] leading-tight mt-0.5">{f.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* CTA */}
        <Link
          href="/dashboard"
          className="inline-flex items-center justify-center gap-2 w-full bg-[#5c7f63] hover:bg-[#3d5c42] text-white font-bold py-4 rounded-xl transition-colors text-base shadow-md"
        >
          Start Your Journey →
        </Link>

        <p className="mt-4 text-xs text-[#b5aca4]">
          Questions? Email Brittany at{' '}
          <a href="mailto:hello@rootedhomeschoolapp.com" className="text-[#5c7f63] hover:underline">
            hello@rootedhomeschoolapp.com
          </a>
        </p>
      </div>

      {/* Keyframe styles */}
      <style>{`
        @keyframes sproutGrow {
          from { opacity: 0; transform: scale(0.3) translateY(30px); }
          to   { opacity: 1; transform: scale(1) translateY(0);      }
        }
      `}</style>
    </main>
  )
}
