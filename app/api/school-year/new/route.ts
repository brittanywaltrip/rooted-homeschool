import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

function getCurrentSchoolYear(): string {
  const now = new Date()
  const month = now.getMonth() + 1 // 1–12
  const year = now.getFullYear()
  const startYear = month >= 8 ? year : year - 1
  return `${startYear}-${startYear + 1}`
}

export async function POST(req: NextRequest) {
  const token = req.headers.get('authorization')?.replace('Bearer ', '')
  if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )

  const { data: { user } } = await supabase.auth.getUser(token)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const schoolYear = getCurrentSchoolYear()
  const today = new Date().toISOString().slice(0, 10)

  // 1. Stamp all incomplete lessons with the current school year
  const { error: stampErr } = await supabase
    .from('lessons')
    .update({ school_year: schoolYear })
    .eq('user_id', user.id)
    .eq('completed', false)

  if (stampErr) {
    return NextResponse.json({ error: `Failed to archive lessons: ${stampErr.message}` }, { status: 500 })
  }

  // 2. Delete all future incomplete lessons so the plan is clean
  const { error: deleteErr } = await supabase
    .from('lessons')
    .delete()
    .eq('user_id', user.id)
    .eq('completed', false)
    .gt('scheduled_date', today)

  if (deleteErr) {
    return NextResponse.json({ error: `Failed to clear future lessons: ${deleteErr.message}` }, { status: 500 })
  }

  // 3. Delete all curriculum goals so Finish Line is empty and ready
  const { error: goalsErr } = await supabase
    .from('curriculum_goals')
    .delete()
    .eq('user_id', user.id)

  if (goalsErr) {
    return NextResponse.json({ error: `Failed to clear curriculum goals: ${goalsErr.message}` }, { status: 500 })
  }

  return NextResponse.json({ ok: true, schoolYear })
}
