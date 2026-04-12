'use client'

import { useState, useEffect, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import { usePartner } from '@/lib/partner-context'
import Link from 'next/link'
import { Copy, Check, Sparkles, ArrowLeft, Lock } from 'lucide-react'

// ─── Types ────────────────────────────────────────────────────────────────────

type DatePreset = 'week' | 'month' | 'year' | 'custom'

type Stats = {
  lessons: number
  books: number
  photos: number
  projects: number
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function toISO(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function presetDates(preset: DatePreset): { from: string; to: string } {
  const today = new Date()
  const to = toISO(today)
  if (preset === 'week') {
    const from = new Date(today); from.setDate(today.getDate() - 7)
    return { from: toISO(from), to }
  }
  if (preset === 'month') {
    const from = new Date(today); from.setDate(today.getDate() - 30)
    return { from: toISO(from), to }
  }
  if (preset === 'year') {
    const from = new Date(today.getFullYear(), 0, 1)
    return { from: toISO(from), to }
  }
  return { from: toISO(new Date(today.getFullYear(), today.getMonth(), 1)), to }
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function FamilyUpdatePage() {
  const { effectiveUserId } = usePartner()

  const [familyName,    setFamilyName]    = useState('')
  const [preset,        setPreset]        = useState<DatePreset>('month')
  const [dateFrom,      setDateFrom]      = useState(presetDates('month').from)
  const [dateTo,        setDateTo]        = useState(presetDates('month').to)

  const [stats,         setStats]         = useState<Stats | null>(null)
  const [bookTitles,    setBookTitles]    = useState<string[]>([])
  const [projectTitles, setProjectTitles] = useState<string[]>([])

  const [narrative,     setNarrative]     = useState('')
  const [generating,    setGenerating]    = useState(false)
  const [genError,      setGenError]      = useState<string | null>(null)

  const [shareUrl,      setShareUrl]      = useState<string | null>(null)
  const [saving,        setSaving]        = useState(false)
  const [copied,        setCopied]        = useState(false)
  const [userIsPro,     setUserIsPro]     = useState(false)
  const [usedThisMonth, setUsedThisMonth] = useState(false)
  const [resetDate,     setResetDate]     = useState('')

  useEffect(() => { document.title = "Family Update \u00b7 Rooted"; }, []);

  // Load family name + usage tracking
  useEffect(() => {
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (!session) return
      const { data: profile } = await supabase
        .from('profiles').select('display_name, is_pro, ai_update_last_generated').eq('id', session.user.id).maybeSingle()
      const p = profile as { display_name?: string; is_pro?: boolean; ai_update_last_generated?: string } | null
      setFamilyName(p?.display_name || session.user.user_metadata?.family_name || '')
      setUserIsPro(p?.is_pro ?? false)

      // Check if free user already used their monthly update
      if (!p?.is_pro && p?.ai_update_last_generated) {
        const lastGen = new Date(p.ai_update_last_generated)
        const now = new Date()
        if (lastGen.getFullYear() === now.getFullYear() && lastGen.getMonth() === now.getMonth()) {
          setUsedThisMonth(true)
          const nextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1)
          setResetDate(nextMonth.toLocaleDateString('en-US', { month: 'long', day: 'numeric' }))
        }
      }
    })
  }, [])

  // Update dates when preset changes
  function applyPreset(p: DatePreset) {
    setPreset(p)
    if (p !== 'custom') {
      const { from, to } = presetDates(p)
      setDateFrom(from); setDateTo(to)
    }
    setStats(null); setNarrative(''); setShareUrl(null)
  }

  // Fetch stats for the selected date range
  const fetchStats = useCallback(async (): Promise<{ stats: Stats; books: string[]; projects: string[] } | null> => {
    if (!effectiveUserId) return null

    const [
      { data: lessons },
      { data: events },
    ] = await Promise.all([
      supabase.from('lessons')
        .select('id')
        .eq('user_id', effectiveUserId)
        .eq('completed', true)
        .gte('date', dateFrom)
        .lte('date', dateTo),
      supabase.from('app_events')
        .select('type, payload')
        .eq('user_id', effectiveUserId)
        .in('type', ['memory_book', 'memory_photo', 'memory_project'])
        .gte('created_at', dateFrom + 'T00:00:00')
        .lte('created_at', dateTo + 'T23:59:59'),
    ])

    const books    = (events ?? []).filter(e => e.type === 'memory_book')
    const photos   = (events ?? []).filter(e => e.type === 'memory_photo')
    const projects = (events ?? []).filter(e => e.type === 'memory_project')

    return {
      stats: {
        lessons:  (lessons ?? []).length,
        books:    books.length,
        photos:   photos.length,
        projects: projects.length,
      },
      books:    books.map(e => e.payload?.title).filter(Boolean) as string[],
      projects: projects.map(e => e.payload?.title).filter(Boolean) as string[],
    }
  }, [effectiveUserId, dateFrom, dateTo])

  // Generate narrative via Claude
  async function handleGenerate() {
    setGenerating(true); setGenError(null); setNarrative(''); setShareUrl(null)

    const result = await fetchStats()
    if (!result) { setGenerating(false); return }

    setStats(result.stats)
    setBookTitles(result.books)
    setProjectTitles(result.projects)

    try {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) { setGenerating(false); return }

      const res = await fetch('/api/family-update/generate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          familyName,
          dateFrom,
          dateTo,
          stats: result.stats,
          bookTitles: result.books,
          projectTitles: result.projects,
        }),
      })
      const json = await res.json()
      if (json.error) { setGenError(json.error); setGenerating(false); return }
      setNarrative(json.narrative)

      // Record usage for free user monthly limit
      if (!userIsPro) {
        await supabase.from('profiles').update({ ai_update_last_generated: toISO(new Date()) }).eq('id', session.user.id)
        setUsedThisMonth(true)
        const nextMonth = new Date(new Date().getFullYear(), new Date().getMonth() + 1, 1)
        setResetDate(nextMonth.toLocaleDateString('en-US', { month: 'long', day: 'numeric' }))
      }
    } catch {
      setGenError('Failed to generate narrative. Please try again.')
    }
    setGenerating(false)
  }

  // Save to Supabase and generate share link
  async function handleShare() {
    if (!narrative || !stats) return
    setSaving(true)

    const token = crypto.randomUUID().replace(/-/g, '').slice(0, 16)
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { setSaving(false); return }

    const { error } = await supabase.from('family_updates').insert({
      user_id:   user.id,
      token,
      date_from: dateFrom,
      date_to:   dateTo,
      narrative,
      stats,
      family_name: familyName,
    })

    if (error) {
      console.error('Save error:', error)
      setGenError('Could not save update. Make sure the family_updates table exists.')
      setSaving(false)
      return
    }

    const url = `${window.location.origin}/share/${token}`
    setShareUrl(url)
    setSaving(false)
  }

  // Copy to clipboard
  async function handleCopy() {
    if (!shareUrl) return
    await navigator.clipboard.writeText(shareUrl)
    setCopied(true)
    setTimeout(() => setCopied(false), 2500)
  }

  const fromLabel = new Date(dateFrom + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  const toLabel   = new Date(dateTo   + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
  const displayFamily = familyName
    ? (familyName.toLowerCase().endsWith('family') ? familyName : `The ${familyName} Family`)
    : 'Our Family'

  return (
    <div className="max-w-2xl px-4 py-7 space-y-6">

      {/* Header */}
      <div>
        <Link href="/dashboard/memories" className="inline-flex items-center gap-1.5 text-xs text-[#7a6f65] hover:text-[#2d2926] mb-3">
          <ArrowLeft size={12} /> Back to Memories
        </Link>
        <h1 className="text-2xl font-bold text-[#2d2926]">Family Update 📬</h1>
        <p className="text-sm text-[#7a6f65] mt-1">
          Generate a warm summary of your homeschool week to share with family and friends.
        </p>
      </div>

      {/* Date range selector */}
      <div className="bg-[#fefcf9] border border-[#e8e2d9] rounded-2xl p-5 space-y-4">
        <p className="text-sm font-semibold text-[#2d2926]">Date Range</p>

        <div className="flex gap-2 flex-wrap">
          {(['week', 'month', 'year', 'custom'] as DatePreset[]).map(p => (
            <button
              key={p}
              onClick={() => applyPreset(p)}
              className={`px-3.5 py-1.5 rounded-full text-sm font-medium transition-colors ${
                preset === p
                  ? 'bg-[#5c7f63] text-white'
                  : 'bg-[#f0ede8] text-[#7a6f65] hover:bg-[#e8e2d9]'
              }`}
            >
              {p === 'week' ? 'This Week' : p === 'month' ? 'This Month' : p === 'year' ? 'This Year' : 'Custom'}
            </button>
          ))}
        </div>

        {preset === 'custom' && (
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-[#7a6f65] font-medium block mb-1">From</label>
              <input type="date" value={dateFrom} onChange={e => { setDateFrom(e.target.value); setStats(null); setNarrative('') }}
                className="w-full px-3 py-2 rounded-xl border border-[#e8e2d9] bg-white text-sm text-[#2d2926] focus:outline-none focus:border-[#5c7f63]" />
            </div>
            <div>
              <label className="text-xs text-[#7a6f65] font-medium block mb-1">To</label>
              <input type="date" value={dateTo} onChange={e => { setDateTo(e.target.value); setStats(null); setNarrative('') }}
                className="w-full px-3 py-2 rounded-xl border border-[#e8e2d9] bg-white text-sm text-[#2d2926] focus:outline-none focus:border-[#5c7f63]" />
            </div>
          </div>
        )}

        <p className="text-xs text-[#b5aca4]">
          {fromLabel} – {toLabel}
        </p>
      </div>

      {/* Generate button */}
      {!userIsPro && usedThisMonth && !narrative ? (
        <button
          disabled
          className="w-full flex items-center justify-center gap-2 bg-[#e8e2d9] text-[#7a6f65] font-bold py-3.5 rounded-xl opacity-60 cursor-not-allowed"
        >
          <Lock size={16} />
          Used this month — resets {resetDate}
        </button>
      ) : (
        <button
          onClick={handleGenerate}
          disabled={generating}
          className="w-full flex items-center justify-center gap-2 bg-[#5c7f63] hover:bg-[var(--g-deep)] disabled:opacity-60 text-white font-bold py-3.5 rounded-xl transition-colors shadow-sm"
        >
          <Sparkles size={16} />
          {generating ? 'Generating your update…' : 'Generate Update ✨'}
        </button>
      )}
      {!userIsPro && !usedThisMonth && (
        <p className="text-[10px] text-[#b5aca4] text-center">Free plan: 1 update per month · <Link href="/upgrade" className="underline font-semibold text-[#5c7f63]">Claim Founding Price — $39/yr</Link></p>
      )}

      {genError && (
        <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-xl px-4 py-3">{genError}</div>
      )}

      {/* Stats preview (shown after generate) */}
      {stats && (
        <div className="grid grid-cols-4 gap-3">
          {[
            { label: 'Lessons', value: stats.lessons, emoji: '📚' },
            { label: 'Books',   value: stats.books,   emoji: '📖' },
            { label: 'Photos',  value: stats.photos,  emoji: '📷' },
            { label: 'Projects',value: stats.projects,emoji: '📁' },
          ].map(s => (
            <div key={s.label} className="bg-[#fefcf9] border border-[#e8e2d9] rounded-2xl p-3 text-center">
              <div className="text-xl mb-1">{s.emoji}</div>
              <div className="text-xl font-bold text-[#2d2926]">{s.value}</div>
              <div className="text-[10px] text-[#7a6f65]">{s.label}</div>
            </div>
          ))}
        </div>
      )}

      {/* Upgrade nudge for free users — below stats, not blocking */}
      {!userIsPro && usedThisMonth && !narrative && (
        <Link
          href="/upgrade"
          className="block bg-gradient-to-br from-[#e8f5ea] to-[#d4ead6] border border-[#b8d9bc] rounded-2xl px-5 py-4 hover:from-[#ddeade] hover:to-[#c5e0c8] transition-colors"
        >
          <p className="text-sm font-semibold text-[#2d2926] mb-1">
            ✨ Upgrade to Founding Family to generate your update
          </p>
          <p className="text-xs text-[#5c7f63]">
            $39/year, locked in forever. Unlimited AI updates, yearbook, and more.
          </p>
        </Link>
      )}

      {/* Shareable card preview */}
      {narrative && stats && (
        <div className="space-y-4">
          {/* Preview card */}
          <div className="bg-gradient-to-br from-[#e8f5ea] to-[#f0f7f0] border border-[#b8d9bc] rounded-3xl p-6 shadow-sm">
            {/* Card header */}
            <div className="flex items-center gap-2.5 mb-4">
              <div className="w-8 h-8 rounded-xl bg-[#5c7f63] flex items-center justify-center text-sm">🌿</div>
              <div>
                <p className="text-sm font-bold text-[#2d2926]">{displayFamily}</p>
                <p className="text-[10px] text-[#7a6f65]">{fromLabel} – {toLabel}</p>
              </div>
            </div>

            {/* Narrative */}
            <p className="text-sm text-[#3d4c3e] leading-relaxed whitespace-pre-wrap mb-3">{narrative}</p>
            <p className="text-[10px] text-[#7a9e7e] italic mb-5">Narrative generated by AI · Review before sharing</p>

            {/* Stats row */}
            <div className="grid grid-cols-4 gap-2 bg-white/60 rounded-2xl p-3">
              {[
                { label: 'Lessons', value: stats.lessons, emoji: '📚' },
                { label: 'Books',   value: stats.books,   emoji: '📖' },
                { label: 'Photos',  value: stats.photos,  emoji: '📷' },
                { label: 'Projects',value: stats.projects,emoji: '📁' },
              ].map(s => (
                <div key={s.label} className="text-center">
                  <div className="text-base">{s.emoji}</div>
                  <div className="text-base font-bold text-[#2d2926]">{s.value}</div>
                  <div className="text-[9px] text-[#7a6f65]">{s.label}</div>
                </div>
              ))}
            </div>

            {/* Footer */}
            <p className="text-[10px] text-[#7a6f65] text-center mt-3">
              Shared via Rooted · rootedhomeschoolapp.com
            </p>
          </div>

          {/* Share link section */}
          {!shareUrl ? (
            <button
              onClick={handleShare}
              disabled={saving}
              className="w-full flex items-center justify-center gap-2 bg-[#2d2926] hover:bg-[#1a1714] disabled:opacity-60 text-white font-bold py-3.5 rounded-xl transition-colors"
            >
              {saving ? 'Saving…' : '🔗 Create Share Link'}
            </button>
          ) : (
            <div className="bg-[#fefcf9] border border-[#e8e2d9] rounded-2xl p-4 space-y-2">
              <p className="text-xs font-semibold text-[#5c7f63] uppercase tracking-wide">Your share link is ready!</p>
              <div className="flex items-center gap-2">
                <input
                  readOnly
                  value={shareUrl}
                  className="flex-1 text-xs bg-[#f0ede8] rounded-xl px-3 py-2 text-[#2d2926] border-none outline-none font-mono"
                />
                <button
                  onClick={handleCopy}
                  className="flex items-center gap-1.5 px-3 py-2 bg-[#5c7f63] hover:bg-[var(--g-deep)] text-white text-xs font-semibold rounded-xl transition-colors shrink-0"
                >
                  {copied ? <Check size={13} /> : <Copy size={13} />}
                  {copied ? 'Copied!' : 'Copy'}
                </button>
              </div>
              <p className="text-[11px] text-[#b5aca4]">Anyone with this link can view the update — no login required.</p>
            </div>
          )}
        </div>
      )}

      <div className="h-4" />
    </div>
  )
}
