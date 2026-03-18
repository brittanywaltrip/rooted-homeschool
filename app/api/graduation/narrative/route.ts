import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { createClient } from '@supabase/supabase-js'

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

  const { childName, yearsHomeschooled, totalLessons, totalBooks, totalPhotos, yearSummaries } = await req.json()

  const yearLines = (yearSummaries as { label: string; lessons: number; books: number }[])
    .map(y => `  • ${y.label}: ${y.lessons} lessons, ${y.books} books read`)
    .join('\n')

  const prompt = `You are writing a personal graduation letter for a homeschooled child. Write a warm, celebratory, heartfelt letter addressed directly to the child (use "you" / "your"). It should feel like it was written by a loving parent or mentor — joyful, proud, and specific to their journey.

Child's name: ${childName}
Years homeschooled: ${yearsHomeschooled}
Total lessons completed: ${totalLessons}
Total books read: ${totalBooks}
Total memories captured: ${totalPhotos}
Year-by-year highlights:
${yearLines}

Guidelines:
- Write 3 short paragraphs, ~150 words total
- Address the child directly by first name in the opening line
- Celebrate their specific journey (years, lessons, books) with warmth and pride
- End with an inspiring, forward-looking sentence about their future
- Do NOT use generic platitudes — make it feel personal and specific
- Do NOT include a subject line, date, signature, or any formatting — just the paragraphs`

  const message = await anthropic.messages.create({
    model: 'claude-opus-4-6',
    max_tokens: 400,
    messages: [{ role: 'user', content: prompt }],
  })

  const narrative = (message.content[0] as { type: string; text: string }).text.trim()
  return NextResponse.json({ narrative })
}
