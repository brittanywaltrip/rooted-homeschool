import { NextRequest, NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

// Retired September 15, 2026.
//
// This was a one-off, run by hand once (March 20, 2026, one email_log
// 'reengagement_backfill' row), that mailed the hosted rooted-winback template
// to every never-started family. It was never scheduled in vercel.json.
//
// Two reasons it cannot stay callable:
//   - rooted-winback now carries the win-back copy for families who USED Rooted
//     and went quiet ("since {{{who}}} last checked something off"), sent by
//     /api/cron/winback. A never-started family would be told they had stopped.
//   - Its audience is covered: the reengagement drip's first step is state-based
//     and drains the whole never-started backlog, newest first.
//
// Kept as a stub behind the cron secret so an old bookmark or script gets an
// answer instead of a 404 that looks like a deploy problem.
export async function GET(req: NextRequest) {
  if (req.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  return NextResponse.json(
    { error: 'Retired. Never-started families get the reengagement drip; the win-back email is /api/cron/winback.' },
    { status: 410 },
  )
}
