import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

// Core increment logic shared by GET (legacy /upgrade callers) and POST
// (the landing page). Returns { ok: true } on every path — we intentionally
// don't surface "unknown code" / "self referral skipped" so status codes
// can't be used to probe for valid codes.
async function handleClick(code: string | null, authToken: string | null) {
  if (!code) return { ok: true }
  const upper = code.trim().toUpperCase()
  if (!upper) return { ok: true }

  try {
    const { data: affiliate } = await supabase
      .from('affiliates')
      .select('id, clicks, user_id')
      .eq('code', upper)
      .maybeSingle()

    // Unknown code → silent 200. Don't leak which codes exist.
    if (!affiliate) {
      console.log('[track-click] unknown code — skipping increment', { code: upper })
      return { ok: true }
    }

    // Self-referral guard — if the requester is the affiliate themselves
    // (Kendra testing her own link), don't inflate her count.
    if (authToken && affiliate.user_id) {
      const { data: { user }, error: authErr } = await supabase.auth.getUser(authToken)
      if (!authErr && user && user.id === affiliate.user_id) {
        console.log('[track-click] self-referral skipped', { code: upper, userId: user.id })
        return { ok: true }
      }
    }

    await supabase
      .from('affiliates')
      .update({ clicks: (affiliate.clicks ?? 0) + 1 })
      .eq('id', affiliate.id)
    console.log('[track-click] incremented', {
      code: upper,
      newClicks: (affiliate.clicks ?? 0) + 1,
    })
  } catch (err) {
    console.error('[track-click] error:', err instanceof Error ? err.message : err)
  }
  return { ok: true }
}

function authTokenFrom(req: NextRequest): string | null {
  return req.headers.get('authorization')?.replace('Bearer ', '') ?? null
}

// GET is kept for backward compatibility with the /upgrade page, which
// already fires `fetch('/api/affiliate/track-click?code=...')` on load.
export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get('code')
  return NextResponse.json(await handleClick(code, authTokenFrom(req)))
}

// POST is what the landing page uses — keeps the endpoint out of any
// browser speculative-prefetch path and accepts either ?code=X or
// { code: X } in the body.
export async function POST(req: NextRequest) {
  let code: string | null = req.nextUrl.searchParams.get('code')
  if (!code) {
    try {
      const body = await req.json()
      code = (body as { code?: string } | null)?.code ?? null
    } catch {
      // Empty body is fine — fall through with code=null.
    }
  }
  return NextResponse.json(await handleClick(code, authTokenFrom(req)))
}
