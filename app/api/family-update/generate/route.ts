import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { createClient } from '@supabase/supabase-js'
import { checkAndIncrementAIUsage } from '@/lib/ai-usage'

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! })

export async function POST(req: NextRequest) {
  const token = req.headers.get('authorization')?.replace('Bearer ', '')
  if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
  const { data: { user } } = await supabase.auth.getUser(token)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await supabase
    .from('profiles')
    .select('subscription_status')
    .eq('id', user.id)
    .maybeSingle()

  const isPro = profile?.subscription_status === 'active'

  const usage = await checkAndIncrementAIUsage(user.id, isPro)
  if (!usage.allowed) {
    const message = isPro
      ? `You've reached your 50 AI generations for this month. Your limit resets on ${usage.resetDate}.`
      : `You've used your free update this month. Upgrade to Founding Family for unlimited updates — your limit resets on ${usage.resetDate}.`
    return NextResponse.json({ error: message }, { status: 403 })
  }

  const { familyName, dateFrom, dateTo, stats, bookTitles, projectTitles } = await req.json()

  const fromLabel = new Date(dateFrom + 'T12:00:00').toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
  const toLabel   = new Date(dateTo   + 'T12:00:00').toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })

  const booksText    = bookTitles?.length    ? `Books read: ${bookTitles.join(', ')}.`     : ''
  const projectsText = projectTitles?.length ? `Projects: ${projectTitles.join(', ')}.`    : ''

  const prompt = `You are writing a warm, heartfelt family update for a homeschooling family. Write 2-3 short paragraphs (total ~120 words) that celebrate their learning journey in a personal, joyful tone — like a letter to grandparents. Do not use bullet points or headers.

Important rules:
- Do NOT start with any salutation, greeting, or opener like "Dear ones", "Hello", "Hi friends", "Greetings", or anything similar. Jump straight into the content.
- The title of the narrative is always "What We've Been Up To" — do not include a title in your response, just the paragraphs.

Family: ${familyName || 'Our Family'}
Date range: ${fromLabel} – ${toLabel}
Lessons completed: ${stats.lessons}
Books read: ${stats.books}
Photos captured: ${stats.photos}
Projects logged: ${stats.projects}
${booksText}
${projectsText}

Write the narrative now. Start with something warm and specific about what they did. End with a forward-looking sentence about what's coming next. Do not mention Rooted or any app.`

  const message = await anthropic.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 300,
    messages: [{ role: 'user', content: prompt }],
  })

  const narrative = (message.content[0] as { type: string; text: string }).text.trim()
  return NextResponse.json({ narrative })
}
