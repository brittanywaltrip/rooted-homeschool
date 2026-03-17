import { createClient } from '@supabase/supabase-js'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import type { Metadata } from 'next'

// ─── Types ────────────────────────────────────────────────────────────────────

type Stats = { lessons: number; books: number; photos: number; projects: number }

type Update = {
  user_id:     string
  family_name: string | null
  date_from:   string
  date_to:     string
  narrative:   string
  stats:       Stats
  created_at:  string
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmt(date: string, opts?: Intl.DateTimeFormatOptions) {
  return new Date(date + 'T12:00:00').toLocaleDateString('en-US',
    opts ?? { month: 'long', day: 'numeric', year: 'numeric' }
  )
}

function displayName(family_name: string | null) {
  if (!family_name) return 'A Rooted Family'
  return family_name.toLowerCase().endsWith('family')
    ? family_name
    : `The ${family_name} Family`
}

function supabaseAdmin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

const BASE_URL = 'https://www.rootedhomeschoolapp.com'

// Masonry photo layout: [width, height] for picsum, plus column span hint
const PHOTO_SLOTS = [
  { seed: 'homeschool1', alt: 'Learning together',  w: 600, h: 800 },
  { seed: 'reading2',    alt: 'Reading time',        w: 600, h: 450 },
  { seed: 'nature3',     alt: 'Nature study',        w: 600, h: 700 },
  { seed: 'art4',        alt: 'Creative project',    w: 600, h: 450 },
  { seed: 'garden5',     alt: 'Garden work',         w: 600, h: 600 },
  { seed: 'kids6',       alt: 'A beautiful day',     w: 600, h: 500 },
]

// ─── OG Metadata ──────────────────────────────────────────────────────────────

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

  const family      = displayName(data.family_name)
  const title       = `${family}'s Homeschool Update`
  const description = (data.narrative ?? '').slice(0, 150).trimEnd() +
                      ((data.narrative ?? '').length > 150 ? '…' : '')
  const fmtShort    = (d: string) => fmt(d, { month: 'short', day: 'numeric', year: 'numeric' })

  const s = data.stats as Stats | null
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
  const pageUrl = `${BASE_URL}/share/${token}`

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

// ─── Page ─────────────────────────────────────────────────────────────────────

export default async function SharePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const db = supabaseAdmin()

  const { data, error } = await db
    .from('family_updates')
    .select('user_id, family_name, date_from, date_to, narrative, stats, created_at')
    .eq('token', token)
    .maybeSingle()

  if (error || !data) notFound()

  const update = data as Update
  const family = displayName(update.family_name)
  const initial = family.replace('The ', '').charAt(0).toUpperCase()

  const sharedOn = fmt(update.created_at.split('T')[0])
  const dateRange = `${fmt(update.date_from, { month: 'long', day: 'numeric' })} – ${fmt(update.date_to)}`
  const dateShort = `${fmt(update.date_from, { month: 'short', day: 'numeric' })} – ${fmt(update.date_to, { month: 'short', day: 'numeric', year: 'numeric' })}`

  // Fetch book titles + real photos from app_events
  const { data: events } = await db
    .from('app_events')
    .select('type, payload')
    .eq('user_id', update.user_id)
    .in('type', ['memory_book', 'memory_photo'])
    .gte('created_at', update.date_from + 'T00:00:00')
    .lte('created_at', update.date_to + 'T23:59:59')

  const bookTitles: string[] = (events ?? [])
    .filter(e => e.type === 'memory_book' && e.payload?.title)
    .map(e => e.payload.title as string)

  // Use real photo URLs if available, otherwise fall back to picsum
  const realPhotoUrls: string[] = (events ?? [])
    .filter(e => e.type === 'memory_photo' && (e.payload?.url || e.payload?.photo_url))
    .map(e => (e.payload.url || e.payload.photo_url) as string)

  const s = update.stats

  const statCards = [
    {
      icon: '☀️',
      value: s.lessons,
      phrase: `${s.lessons} day${s.lessons !== 1 ? 's' : ''} of learning`,
      sub: 'Lessons completed',
      bg: '#f0f7f0',
      border: '#c8ddb8',
      color: '#3d6044',
    },
    {
      icon: '📚',
      value: s.books,
      phrase: `${s.books} ${s.books !== 1 ? 'stories' : 'story'} explored`,
      sub: 'Books read',
      bg: '#e8f2f7',
      border: '#b8d4e0',
      color: '#2d5a70',
    },
    {
      icon: '📷',
      value: s.photos,
      phrase: `${s.photos} moment${s.photos !== 1 ? 's' : ''} captured`,
      sub: 'Memories saved',
      bg: '#fdf5e8',
      border: '#e8d4a8',
      color: '#7a5c2a',
    },
    {
      icon: '✏️',
      value: s.projects,
      phrase: `${s.projects} project${s.projects !== 1 ? 's' : ''} created`,
      sub: 'Hands-on work',
      bg: '#f5f0fb',
      border: '#d4c0e8',
      color: '#5a3d7a',
    },
  ]

  return (
    <main className="min-h-screen" style={{ background: '#faf8f4' }}>

      {/* ── NAV ─────────────────────────────────────────────────────── */}
      <nav className="sticky top-0 z-20 bg-white/85 backdrop-blur-md border-b border-[#ede8e0]">
        <div className="max-w-2xl mx-auto px-5 py-3 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2 hover:opacity-75 transition-opacity">
            <div className="w-7 h-7 rounded-lg bg-[#3d6044] flex items-center justify-center text-sm leading-none">🌿</div>
            <span className="text-sm font-bold text-[#2d2926] tracking-tight">Rooted Homeschool</span>
          </Link>
          <span className="text-[11px] font-medium text-[#b5aca4] uppercase tracking-widest">Family Update</span>
        </div>
      </nav>

      {/* ── HERO ────────────────────────────────────────────────────── */}
      <div
        className="relative overflow-hidden"
        style={{ background: 'linear-gradient(160deg, #1e4228 0%, #2d5c38 45%, #3d7a50 80%, #4a8a5c 100%)' }}
      >
        {/* Leaf silhouette overlay */}
        <svg
          className="absolute inset-0 w-full h-full pointer-events-none"
          viewBox="0 0 800 420"
          preserveAspectRatio="xMidYMid slice"
          aria-hidden
        >
          {/* Large background leaves */}
          <ellipse cx="700" cy="80"  rx="180" ry="110" fill="white" opacity="0.04" transform="rotate(-25 700 80)"  />
          <ellipse cx="100" cy="350" rx="160" ry="100" fill="white" opacity="0.04" transform="rotate(18 100 350)"  />
          <ellipse cx="400" cy="-30" rx="140" ry="90"  fill="white" opacity="0.03" transform="rotate(-8 400 -30)" />
          <ellipse cx="650" cy="380" rx="130" ry="80"  fill="white" opacity="0.04" transform="rotate(12 650 380)" />
          {/* Dot texture */}
          <pattern id="heroGrid" x="0" y="0" width="28" height="28" patternUnits="userSpaceOnUse">
            <circle cx="1.5" cy="1.5" r="1" fill="white" opacity="0.08"/>
          </pattern>
          <rect width="800" height="420" fill="url(#heroGrid)"/>
          {/* Decorative botanical line art */}
          <g opacity="0.07" fill="none" stroke="white" strokeWidth="1.5">
            <path d="M 60 420 Q 80 350 120 300 Q 160 250 140 180 Q 120 120 160 80"/>
            <path d="M 140 180 Q 100 200 70 230"/>
            <path d="M 140 180 Q 170 165 185 140"/>
            <path d="M 730 0 Q 710 70 680 120 Q 650 170 670 240 Q 690 300 660 360"/>
            <path d="M 670 240 Q 700 220 730 240"/>
            <path d="M 670 240 Q 645 260 630 290"/>
          </g>
        </svg>

        <div className="relative z-10 max-w-2xl mx-auto px-6 py-16 sm:py-20 text-center">
          {/* Eyebrow */}
          <p className="text-white/55 text-[10px] font-bold uppercase tracking-[0.3em] mb-5">
            Homeschool Family Update
          </p>

          {/* Family name — large, elegant */}
          <h1
            className="text-white mb-4 leading-[1.05]"
            style={{
              fontFamily: 'Georgia, "Times New Roman", serif',
              fontSize: 'clamp(2.4rem, 8vw, 4rem)',
              fontWeight: 700,
              letterSpacing: '-0.01em',
              textShadow: '0 2px 20px rgba(0,0,0,0.15)',
            }}
          >
            {family}
          </h1>

          {/* Date pill */}
          <div className="inline-flex items-center gap-2 bg-white/12 border border-white/20 rounded-full px-5 py-2 mb-8">
            <span className="text-white/90 text-sm font-medium">{dateRange}</span>
          </div>

          {/* Stat chips row */}
          <div className="flex flex-wrap justify-center gap-2">
            {[
              { emoji: '☀️', n: s.lessons,  label: 'lessons'  },
              { emoji: '📚', n: s.books,    label: 'books'    },
              { emoji: '📷', n: s.photos,   label: 'photos'   },
              { emoji: '✏️', n: s.projects, label: 'projects' },
            ].map(c => (
              <div
                key={c.label}
                className="flex items-center gap-1.5 bg-white/10 border border-white/15 rounded-full px-3.5 py-1.5"
              >
                <span className="text-sm leading-none">{c.emoji}</span>
                <span className="text-white font-bold text-sm">{c.n}</span>
                <span className="text-white/65 text-xs">{c.label}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Organic bottom fade */}
        <div
          className="absolute bottom-0 left-0 right-0 h-16 pointer-events-none"
          style={{ background: 'linear-gradient(to bottom, transparent, #faf8f4)' }}
        />
      </div>

      {/* ── PAGE BODY ───────────────────────────────────────────────── */}
      <div className="max-w-2xl mx-auto px-4 pb-20">

        {/* ── NARRATIVE CARD ──────────────────────────────────────── */}
        <div
          className="relative overflow-hidden rounded-3xl shadow-sm mb-10 mt-2"
          style={{ background: '#fefcf8', border: '1px solid #ede8de' }}
        >
          {/* Top green rule */}
          <div style={{ height: 3, background: 'linear-gradient(to right, #3d6044, #7aaa78, #c8ddb8)' }} />

          {/* Leaf watermark top-right */}
          <div className="absolute top-0 right-0 w-52 h-52 pointer-events-none opacity-[0.035]" aria-hidden>
            <svg viewBox="0 0 200 200" className="w-full h-full">
              <path d="M100 10 C140 10 180 40 190 80 C200 120 180 160 150 175 C120 190 80 190 50 175 C20 160 0 120 10 80 C20 40 60 10 100 10 Z" fill="#3d6044"/>
              <path d="M100 10 L100 190 M50 50 Q100 80 150 50 M40 100 Q100 130 160 100 M50 150 Q100 170 150 150" stroke="#3d6044" strokeWidth="5" fill="none"/>
            </svg>
          </div>

          <div className="px-8 pt-7 pb-8 sm:px-10">
            {/* Opening quote */}
            <div
              aria-hidden
              style={{
                fontFamily: 'Georgia, serif',
                fontSize: 96,
                lineHeight: 0.75,
                color: '#c8ddb8',
                marginBottom: 12,
                userSelect: 'none',
              }}
            >
              &ldquo;
            </div>

            <p
              className="whitespace-pre-wrap leading-[1.9] text-[#3a3530]"
              style={{
                fontFamily: 'Georgia, "Times New Roman", serif',
                fontSize: '1.0625rem',
              }}
            >
              {update.narrative}
            </p>

            {/* Signature */}
            <div className="mt-8 pt-6 border-t border-[#ede8de] flex items-center gap-3">
              <div
                className="w-10 h-10 rounded-full flex items-center justify-center text-white font-bold text-sm shrink-0"
                style={{ background: 'linear-gradient(135deg, #3d6044, #5c7f63)' }}
              >
                {initial}
              </div>
              <div>
                <p className="text-sm font-semibold text-[#2d2926]">{family}</p>
                <p className="text-xs text-[#a09890] mt-0.5">
                  {dateShort} · Shared with love
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* ── STATS 2×2 ───────────────────────────────────────────── */}
        <section className="mb-10">
          <p className="text-[10px] font-bold uppercase tracking-[0.22em] text-[#b5aca4] mb-4 px-0.5">
            This Season at a Glance
          </p>
          <div className="grid grid-cols-2 gap-3">
            {statCards.map(card => (
              <div
                key={card.sub}
                className="rounded-2xl p-5 flex flex-col gap-1"
                style={{
                  background: card.bg,
                  border: `1px solid ${card.border}`,
                  boxShadow: '0 1px 4px rgba(0,0,0,0.04)',
                }}
              >
                <span className="text-2xl leading-none mb-1">{card.icon}</span>
                <p
                  className="font-bold leading-snug"
                  style={{ color: card.color, fontSize: '1rem' }}
                >
                  {card.phrase}
                </p>
                <p className="text-xs font-medium" style={{ color: card.color + '99' }}>
                  {card.sub}
                </p>
              </div>
            ))}
          </div>
        </section>

        {/* ── BOOKS WE LOVED ──────────────────────────────────────── */}
        {bookTitles.length > 0 && (
          <section className="mb-10">
            <p className="text-[10px] font-bold uppercase tracking-[0.22em] text-[#b5aca4] mb-3 px-0.5">
              Books We Loved
            </p>
            <div
              className="flex gap-2 overflow-x-auto pb-2"
              style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}
            >
              {bookTitles.map((title, i) => (
                <div
                  key={i}
                  className="shrink-0 flex items-center gap-2 rounded-full px-4 py-2"
                  style={{
                    background: '#fef3e4',
                    border: '1px solid #f0d4a0',
                  }}
                >
                  <span className="text-sm leading-none">📖</span>
                  <span className="text-sm font-medium text-[#7a5c2a] whitespace-nowrap">{title}</span>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* ── PHOTO GRID — masonry columns ────────────────────────── */}
        <section className="mb-12">
          <p className="text-[10px] font-bold uppercase tracking-[0.22em] text-[#b5aca4] mb-4 px-0.5">
            Moments from This Season 📸
          </p>
          <div className="columns-2 gap-2.5 sm:gap-3">
            {PHOTO_SLOTS.map((p, i) => {
              const src = realPhotoUrls[i]
                ?? `https://picsum.photos/seed/${p.seed}/${p.w}/${p.h}`
              return (
                <div
                  key={p.seed}
                  className="relative overflow-hidden rounded-2xl mb-2.5 sm:mb-3 break-inside-avoid bg-[#ede8de] shadow-sm"
                  style={{ aspectRatio: `${p.w}/${p.h}` }}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={src}
                    alt={p.alt}
                    loading="lazy"
                    className="w-full h-full object-cover hover:scale-[1.03] transition-transform duration-700"
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-black/25 via-transparent to-transparent" />
                </div>
              )
            })}
          </div>
        </section>

        {/* ── FOOTER ──────────────────────────────────────────────── */}
        <footer className="text-center">
          <div className="border-t border-[#ede8de] pt-10">

            {/* Rooted logo */}
            <Link
              href="https://www.rootedhomeschoolapp.com"
              className="inline-flex flex-col items-center gap-2 mb-4 hover:opacity-75 transition-opacity"
            >
              <div
                className="w-12 h-12 rounded-2xl flex items-center justify-center text-2xl shadow-sm"
                style={{ background: 'linear-gradient(135deg, #3d6044, #5c7f63)' }}
              >
                🌿
              </div>
              <span className="text-sm font-bold text-[#2d2926] tracking-tight">Rooted Homeschool</span>
            </Link>

            <p className="text-xs font-semibold text-[#5c7f63] tracking-wide mb-1">
              Stay Rooted. Teach with Intention.
            </p>
            <p className="text-xs text-[#c0b8b0] mb-8">Shared on {sharedOn}</p>

            {/* CTA — warm invitation, not an ad */}
            <div
              className="rounded-3xl px-7 py-7 max-w-sm mx-auto text-left"
              style={{
                background: 'linear-gradient(135deg, #f0f7f0 0%, #e8f3e8 100%)',
                border: '1px solid #c8ddb8',
                boxShadow: '0 2px 16px rgba(60,96,68,0.07)',
              }}
            >
              <p className="text-xs font-bold uppercase tracking-[0.18em] text-[#5c7f63] mb-2">
                A note from Brittany
              </p>
              <p className="text-sm text-[#3a4e3c] leading-relaxed mb-5">
                If this update made you smile, imagine having a place to capture every lesson,
                book, and memory like this — all in one beautiful, private app built just for
                homeschool families.
              </p>
              <Link
                href="https://www.rootedhomeschoolapp.com/signup"
                className="inline-flex items-center gap-2 text-white font-semibold px-5 py-2.5 rounded-xl text-sm transition-colors shadow-sm"
                style={{ background: 'linear-gradient(135deg, #3d6044, #5c7f63)' }}
              >
                🌿 Try Rooted Free
              </Link>
              <p className="text-[11px] text-[#8aaa8c] mt-3">
                rootedhomeschoolapp.com · No credit card needed
              </p>
            </div>

          </div>
        </footer>

      </div>
    </main>
  )
}
