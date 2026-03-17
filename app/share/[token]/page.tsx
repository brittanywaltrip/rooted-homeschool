import { createClient } from '@supabase/supabase-js'
import Link from 'next/link'
import { notFound } from 'next/navigation'

// Public page — no auth required
// Uses service role to fetch by token

type Update = {
  family_name: string | null
  date_from: string
  date_to: string
  narrative: string
  stats: {
    lessons: number
    books: number
    photos: number
    projects: number
  }
  created_at: string
}

function fmt(date: string) {
  return new Date(date + 'T12:00:00').toLocaleDateString('en-US', {
    month: 'long', day: 'numeric', year: 'numeric',
  })
}

export default async function SharePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )

  const { data, error } = await supabase
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

  return (
    <main className="min-h-screen bg-[#f8f7f4] flex flex-col items-center justify-center px-4 py-12">
      <div className="max-w-lg w-full">

        {/* Rooted brand header */}
        <div className="text-center mb-8">
          <Link href="/" className="inline-flex items-center gap-2 text-[#5c7f63] hover:opacity-80 transition-opacity">
            <div className="w-8 h-8 rounded-xl bg-[#5c7f63] flex items-center justify-center text-sm">🌿</div>
            <span className="font-bold text-[#2d2926]">Rooted Homeschool</span>
          </Link>
        </div>

        {/* Update card */}
        <div className="bg-white border border-[#e8e2d9] rounded-3xl shadow-md overflow-hidden">

          {/* Card top bar */}
          <div className="bg-gradient-to-r from-[#5c7f63] to-[#3d8c5c] px-6 py-5">
            <p className="text-white/75 text-[11px] font-semibold uppercase tracking-widest mb-0.5">
              Family Update
            </p>
            <h1 className="text-xl font-bold text-white">{displayFamily}</h1>
            <p className="text-white/80 text-sm mt-0.5">
              {fmt(update.date_from)} – {fmt(update.date_to)}
            </p>
          </div>

          <div className="p-6 space-y-5">

            {/* Stats grid */}
            <div className="grid grid-cols-4 gap-2">
              {[
                { label: 'Lessons', value: update.stats.lessons,  emoji: '📚' },
                { label: 'Books',   value: update.stats.books,    emoji: '📖' },
                { label: 'Photos',  value: update.stats.photos,   emoji: '📷' },
                { label: 'Projects',value: update.stats.projects, emoji: '📁' },
              ].map(s => (
                <div key={s.label} className="text-center bg-[#f8f7f4] rounded-2xl py-3 px-1">
                  <div className="text-xl mb-1">{s.emoji}</div>
                  <div className="text-lg font-bold text-[#2d2926]">{s.value}</div>
                  <div className="text-[9px] text-[#7a6f65] leading-tight">{s.label}</div>
                </div>
              ))}
            </div>

            {/* Divider */}
            <div className="border-t border-[#f0ede8]" />

            {/* Narrative */}
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-widest text-[#b5aca4] mb-2">
                This period in their words
              </p>
              <p className="text-[#3d4c3e] text-sm leading-relaxed whitespace-pre-wrap">
                {update.narrative}
              </p>
            </div>

          </div>

          {/* Footer */}
          <div className="border-t border-[#f0ede8] px-6 py-4 bg-[#fefcf9] flex items-center justify-between">
            <p className="text-[10px] text-[#b5aca4]">Shared {sharedOn}</p>
            <Link
              href="/"
              className="text-[10px] font-semibold text-[#5c7f63] hover:underline"
            >
              Track your family at rootedhomeschoolapp.com →
            </Link>
          </div>
        </div>

        {/* CTA for non-users */}
        <div className="mt-6 text-center">
          <p className="text-sm text-[#7a6f65] mb-3">
            Want to track your own family&apos;s homeschool journey?
          </p>
          <Link
            href="/signup"
            className="inline-flex items-center gap-2 bg-[#5c7f63] hover:bg-[#3d5c42] text-white font-semibold px-6 py-2.5 rounded-xl transition-colors text-sm shadow-sm"
          >
            🌿 Start Free with Rooted
          </Link>
        </div>

      </div>
    </main>
  )
}
