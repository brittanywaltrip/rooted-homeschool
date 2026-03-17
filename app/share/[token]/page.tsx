import { createClient } from '@supabase/supabase-js'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import type { Metadata } from 'next'

type Update = {
  family_name: string | null
  date_from:   string
  date_to:     string
  narrative:   string
  stats: { lessons: number; books: number; photos: number; projects: number }
  created_at:  string
}

function fmt(date: string, short = false) {
  return new Date(date + 'T12:00:00').toLocaleDateString('en-US',
    short
      ? { month: 'short', day: 'numeric' }
      : { month: 'long', day: 'numeric', year: 'numeric' }
  )
}

const PHOTOS = [
  { seed: 'learning1', alt: 'Learning moment' },
  { seed: 'books2',    alt: 'Book time'        },
  { seed: 'nature3',   alt: 'Nature study'     },
  { seed: 'family4',   alt: 'Family time'      },
  { seed: 'garden5',   alt: 'Garden work'      },
  { seed: 'art6',      alt: 'Creative project' },
]

const BASE_URL = 'https://www.rootedhomeschoolapp.com'

function supabaseAdmin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

export async function generateMetadata(
  { params }: { params: Promise<{ token: string }> }
): Promise<Metadata> {
  const { token } = await params
  const { data } = await supabaseAdmin()
    .from('family_updates')
    .select('family_name, date_from, date_to, narrative, stats')
    .eq('token', token)
    .maybeSingle()

  if (!data) return {}

  const family = data.family_name
    ? (data.family_name.toLowerCase().endsWith('family')
        ? data.family_name
        : `The ${data.family_name} Family`)
    : 'A Rooted Family'

  const title       = `${family}'s Homeschool Update`
  const description = data.narrative?.slice(0, 150).trimEnd() + (data.narrative?.length > 150 ? '…' : '')
  const fmtShort = (d: string) => new Date(d + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })

  const s = data.stats as { lessons: number; books: number; photos: number; projects: number } | null
  const previewParts: string[] = []
  if (s?.lessons)  previewParts.push(`${s.lessons} lesson${s.lessons !== 1 ? 's' : ''} completed`)
  if (s?.books)    previewParts.push(`${s.books} book${s.books !== 1 ? 's' : ''} read`)
  if (s?.projects) previewParts.push(`${s.projects} project${s.projects !== 1 ? 's' : ''}`)
  const preview = previewParts.join(' · ')

  const ogImageUrl = [
    `${BASE_URL}/api/og`,
    `?family=${encodeURIComponent(family)}`,
    `&from=${encodeURIComponent(fmtShort(data.date_from))}`,
    `&to=${encodeURIComponent(fmtShort(data.date_to))}`,
    preview ? `&preview=${encodeURIComponent(preview)}` : '',
  ].join('')
  const pageUrl     = `${BASE_URL}/share/${token}`

  return {
    title,
    description,
    openGraph: {
      title,
      description,
      url: pageUrl,
      siteName: 'Rooted Homeschool',
      images: [{ url: ogImageUrl, width: 1200, height: 630, alt: title }],
      type: 'article',
    },
    twitter: {
      card: 'summary_large_image',
      title,
      description,
      images: [ogImageUrl],
    },
  }
}

export default async function SharePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params

  const { data, error } = await supabaseAdmin()
    .from('family_updates')
    .select('family_name, date_from, date_to, narrative, stats, created_at')
    .eq('token', token)
    .maybeSingle()

  if (error || !data) notFound()

  const update = data as Update

  const displayFamily = update.family_name
    ? (update.family_name.toLowerCase().endsWith('family')
        ? update.family_name
        : `The ${update.family_name} Family`)
    : 'A Rooted Family'

  const sharedOn = new Date(update.created_at).toLocaleDateString('en-US', {
    month: 'long', day: 'numeric', year: 'numeric',
  })

  const statItems = [
    { emoji: '📚', value: update.stats.lessons,  label: 'Lessons\nCompleted',  color: '#5c7f63', bg: '#e8f5ea' },
    { emoji: '📖', value: update.stats.books,    label: 'Books\nRead',         color: '#4a7a8a', bg: '#e4f0f4' },
    { emoji: '📷', value: update.stats.photos,   label: 'Memories\nCaptured',  color: '#8b6f47', bg: '#f5ede0' },
    { emoji: '📁', value: update.stats.projects, label: 'Projects\nCompleted', color: '#7a5a8a', bg: '#f0e8f8' },
  ]

  return (
    <main className="min-h-screen bg-[#f4f1eb]">

      {/* ── TOP NAV ─────────────────────────────────────────────── */}
      <nav className="bg-white/80 backdrop-blur-sm border-b border-[#e8e2d9] sticky top-0 z-10">
        <div className="max-w-3xl mx-auto px-5 py-3 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2 hover:opacity-80 transition-opacity">
            <div className="w-7 h-7 rounded-lg bg-[#5c7f63] flex items-center justify-center text-sm">🌿</div>
            <span className="text-sm font-bold text-[#2d2926]">Rooted Homeschool</span>
          </Link>
          <span className="text-xs text-[#b5aca4]">Family Update</span>
        </div>
      </nav>

      <div className="max-w-3xl mx-auto px-4 pb-16">

        {/* ── HERO HEADER ─────────────────────────────────────────── */}
        <div
          className="relative overflow-hidden rounded-3xl mt-6 mb-8 shadow-lg"
          style={{ background: 'linear-gradient(135deg, #2d5c38 0%, #3d7a4a 30%, #5c7f63 60%, #4a9e6a 100%)' }}
        >
          {/* Decorative leaf shapes */}
          <svg className="absolute inset-0 w-full h-full pointer-events-none opacity-10" viewBox="0 0 600 280" preserveAspectRatio="xMidYMid slice">
            <ellipse cx="520" cy="60"  rx="120" ry="80"  fill="white" transform="rotate(-30 520 60)"  />
            <ellipse cx="80"  cy="220" rx="100" ry="65"  fill="white" transform="rotate(20 80 220)"   />
            <ellipse cx="300" cy="-20" rx="90"  ry="60"  fill="white" transform="rotate(-10 300 -20)" />
            <ellipse cx="450" cy="250" rx="80"  ry="50"  fill="white" transform="rotate(15 450 250)"  />
          </svg>

          {/* Subtle grid texture */}
          <div className="absolute inset-0 opacity-5"
            style={{ backgroundImage: 'radial-gradient(circle, white 1px, transparent 1px)', backgroundSize: '24px 24px' }} />

          <div className="relative z-10 px-8 py-10 sm:py-14">
            <p className="text-white/60 text-[11px] font-semibold uppercase tracking-[0.25em] mb-3">
              Homeschool Family Update
            </p>
            <h1 className="text-3xl sm:text-4xl font-bold text-white mb-2 leading-tight">
              {displayFamily}
            </h1>
            <p className="text-white/80 text-base font-medium">
              {fmt(update.date_from)} – {fmt(update.date_to)}
            </p>

            {/* Stat pills on hero */}
            <div className="flex flex-wrap gap-2 mt-6">
              {statItems.map(s => (
                <div key={s.label} className="bg-white/15 backdrop-blur-sm border border-white/20 rounded-full px-3.5 py-1.5 flex items-center gap-1.5">
                  <span className="text-sm">{s.emoji}</span>
                  <span className="text-white font-bold text-sm">{s.value}</span>
                  <span className="text-white/70 text-xs">{s.label.replace('\n', ' ')}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* ── STATS CARDS ─────────────────────────────────────────── */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-8">
          {statItems.map(s => (
            <div
              key={s.label}
              className="rounded-2xl p-4 text-center shadow-sm border border-white/60"
              style={{ backgroundColor: s.bg }}
            >
              <div className="text-3xl mb-2">{s.emoji}</div>
              <div className="text-3xl font-bold mb-1" style={{ color: s.color }}>{s.value}</div>
              <div className="text-[11px] font-semibold whitespace-pre-line leading-tight" style={{ color: s.color + 'bb' }}>
                {s.label}
              </div>
            </div>
          ))}
        </div>

        {/* ── PHOTO GRID ──────────────────────────────────────────── */}
        <div className="mb-8">
          <p className="text-xs font-semibold uppercase tracking-widest text-[#b5aca4] mb-4">
            Moments from this period
          </p>
          <div className="grid grid-cols-3 gap-2 sm:gap-3">
            {PHOTOS.map((p, i) => (
              <div
                key={p.seed}
                className={`relative overflow-hidden rounded-2xl bg-[#e8e2d9] shadow-sm ${
                  i === 0 ? 'col-span-2 row-span-1' : ''
                }`}
                style={{ aspectRatio: i === 0 ? '2/1.2' : '1/1' }}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={`https://picsum.photos/seed/${p.seed}/600/400`}
                  alt={p.alt}
                  className="w-full h-full object-cover hover:scale-105 transition-transform duration-500"
                  loading="lazy"
                />
                {/* Subtle gradient overlay */}
                <div className="absolute inset-0 bg-gradient-to-t from-black/20 to-transparent" />
              </div>
            ))}
          </div>
        </div>

        {/* ── NARRATIVE CARD ──────────────────────────────────────── */}
        <div className="relative bg-white rounded-3xl shadow-sm border border-[#e8e2d9] overflow-hidden mb-8">
          {/* Leaf watermark */}
          <div className="absolute top-0 right-0 w-48 h-48 pointer-events-none opacity-[0.04]" aria-hidden>
            <svg viewBox="0 0 200 200" className="w-full h-full">
              <path d="M100 10 C140 10 180 40 190 80 C200 120 180 160 150 175 C120 190 80 190 50 175 C20 160 0 120 10 80 C20 40 60 10 100 10 Z" fill="#5c7f63"/>
              <path d="M100 10 L100 190 M50 50 Q100 80 150 50 M40 100 Q100 130 160 100 M50 150 Q100 170 150 150" stroke="#5c7f63" strokeWidth="4" fill="none"/>
            </svg>
          </div>

          {/* Green top accent bar */}
          <div className="h-1.5 w-full bg-gradient-to-r from-[#5c7f63] via-[#7aaa78] to-[#a8d8a8]" />

          <div className="p-7 sm:p-8">
            {/* Decorative opening quote */}
            <div
              className="text-7xl leading-none select-none mb-2"
              style={{ color: '#d4ead6', fontFamily: 'Georgia, serif', lineHeight: 0.8 }}
              aria-hidden
            >
              &ldquo;
            </div>

            <p className="text-[#2d3a2e] text-[15px] sm:text-base leading-[1.85] whitespace-pre-wrap font-medium">
              {update.narrative}
            </p>

            {/* Signature line */}
            <div className="mt-6 pt-5 border-t border-[#f0ede8] flex items-center gap-3">
              <div className="w-8 h-8 rounded-full bg-[#5c7f63] flex items-center justify-center text-white text-xs font-bold shrink-0">
                {displayFamily.replace('The ', '').charAt(0)}
              </div>
              <div>
                <p className="text-xs font-bold text-[#2d2926]">{displayFamily}</p>
                <p className="text-[11px] text-[#7a6f65]">{fmt(update.date_from, true)} – {fmt(update.date_to)}</p>
              </div>
            </div>
          </div>
        </div>

        {/* ── THIS PERIOD AT A GLANCE ─────────────────────────────── */}
        <div className="bg-gradient-to-br from-[#e8f5ea] to-[#d4ead6] rounded-3xl border border-[#b8d9bc] p-6 mb-8">
          <p className="text-xs font-semibold uppercase tracking-widest text-[#5c7f63] mb-4">
            This period at a glance
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {[
              {
                icon: '🌱',
                title: 'Growing Every Day',
                desc: `${update.stats.lessons} lessons completed and logged in their learning journey.`,
              },
              {
                icon: '📖',
                title: 'A Reading Family',
                desc: `${update.stats.books} book${update.stats.books !== 1 ? 's' : ''} read and recorded this period.`,
              },
              {
                icon: '📷',
                title: 'Captured Moments',
                desc: `${update.stats.photos} photo memor${update.stats.photos !== 1 ? 'ies' : 'y'} preserved for years to come.`,
              },
              {
                icon: '✏️',
                title: 'Hands-On Learning',
                desc: `${update.stats.projects} project${update.stats.projects !== 1 ? 's' : ''} completed and documented.`,
              },
            ].map(item => (
              <div key={item.title} className="flex items-start gap-3 bg-white/60 rounded-2xl p-4">
                <span className="text-2xl shrink-0 mt-0.5">{item.icon}</span>
                <div>
                  <p className="text-sm font-bold text-[#2d2926] mb-0.5">{item.title}</p>
                  <p className="text-xs text-[#5c7f63] leading-relaxed">{item.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* ── FOOTER ──────────────────────────────────────────────── */}
        <footer className="text-center pt-6 border-t border-[#e8e2d9]">
          {/* Logo */}
          <Link href="https://www.rootedhomeschoolapp.com" className="inline-flex flex-col items-center gap-2 mb-4 hover:opacity-80 transition-opacity">
            <div className="w-10 h-10 rounded-2xl bg-[#5c7f63] flex items-center justify-center text-xl shadow-sm">🌿</div>
            <span className="text-sm font-bold text-[#2d2926]">Rooted Homeschool</span>
          </Link>

          <p className="text-xs font-semibold text-[#5c7f63] tracking-wide mb-1">
            Stay Rooted. Teach with Intention.
          </p>
          <p className="text-xs text-[#b5aca4] mb-5">Shared {sharedOn}</p>

          {/* CTA */}
          <div className="bg-white border border-[#e8e2d9] rounded-2xl px-6 py-5 inline-block max-w-sm">
            <p className="text-sm text-[#7a6f65] leading-relaxed mb-3">
              Want to document your homeschool journey and share beautiful updates like this one?
            </p>
            <Link
              href="https://www.rootedhomeschoolapp.com/signup"
              className="inline-flex items-center gap-2 bg-[#5c7f63] hover:bg-[#3d5c42] text-white font-semibold px-5 py-2.5 rounded-xl transition-colors text-sm shadow-sm"
            >
              🌿 Join Rooted — It&apos;s Free
            </Link>
            <p className="text-[11px] text-[#b5aca4] mt-2">rootedhomeschoolapp.com</p>
          </div>
        </footer>

      </div>
    </main>
  )
}
