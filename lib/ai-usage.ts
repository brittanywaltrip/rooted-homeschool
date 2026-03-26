import { createClient } from '@supabase/supabase-js'

const FREE_LIMIT = 1
const PRO_LIMIT = 50

function getMonthString(): string {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
}

function getResetDate(): string {
  const now = new Date()
  const firstOfNext = new Date(now.getFullYear(), now.getMonth() + 1, 1)
  return firstOfNext.toLocaleDateString('en-US', { month: 'long', day: 'numeric' })
}

export async function checkAndIncrementAIUsage(
  userId: string,
  isPro: boolean
): Promise<{ allowed: boolean; remaining: number; resetDate: string }> {
  const resetDate = getResetDate()

  const limit = isPro ? PRO_LIMIT : FREE_LIMIT

  const month = getMonthString()
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )

  // Read current count
  const { data } = await supabase
    .from('ai_usage')
    .select('count')
    .eq('user_id', userId)
    .eq('month', month)
    .maybeSingle()

  const currentCount = data?.count ?? 0

  if (currentCount >= limit) {
    return { allowed: false, remaining: 0, resetDate }
  }

  // Upsert with incremented count
  await supabase
    .from('ai_usage')
    .upsert(
      { user_id: userId, month, count: currentCount + 1, updated_at: new Date().toISOString() },
      { onConflict: 'user_id,month' }
    )

  return { allowed: true, remaining: limit - (currentCount + 1), resetDate }
}
