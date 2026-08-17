import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'

/**
 * Nightly sweep that ends access for subscriptions whose paid term is over.
 *
 * Why this exists: when a family cancels an annual plan partway through,
 * Rooted honours the term they already paid for (see the
 * customer.subscription.deleted branch in app/api/stripe/webhook/route.ts).
 * That leaves profiles sitting at is_pro = true with subscription_status
 * 'cancelled' and a subscription_end_date in the future. Nothing in the
 * Stripe event stream fires again for those subscriptions, because Stripe
 * already considers them finished, so the downgrade has to be swept for.
 *
 * Deliberately narrow. It only ever touches rows that are ALL of:
 *   - subscription_status = 'cancelled'   (Stripe told us they cancelled)
 *   - is_pro = true                       (not already downgraded)
 *   - subscription_end_date < now         (their paid term has run out)
 *
 * An active subscriber can never match, because a live subscription is
 * status 'active'. A refunded cancellation can never match either, because
 * the webhook already set is_pro = false and stamped the end date at the
 * moment of the refund.
 */
export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  // Vercel cron authentication, same shape as the other cron routes.
  if (
    request.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`
  ) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const nowIso = new Date().toISOString()

  const { data: due, error: readErr } = await supabaseAdmin
    .from('profiles')
    .select('id, display_name, plan_type, subscription_end_date')
    .eq('subscription_status', 'cancelled')
    .eq('is_pro', true)
    .not('subscription_end_date', 'is', null)
    .lt('subscription_end_date', nowIso)

  if (readErr) {
    console.error('[cron/expire-subscriptions] read failed:', readErr.message)
    return NextResponse.json({ error: readErr.message }, { status: 500 })
  }

  if (!due || due.length === 0) {
    console.log('[cron/expire-subscriptions] nothing due')
    return NextResponse.json({ expired: 0 })
  }

  const ids = due.map((p) => p.id)

  const { error: writeErr } = await supabaseAdmin
    .from('profiles')
    .update({ is_pro: false, plan_type: null })
    .in('id', ids)

  if (writeErr) {
    console.error('[cron/expire-subscriptions] write failed:', writeErr.message)
    return NextResponse.json({ error: writeErr.message }, { status: 500 })
  }

  for (const p of due) {
    console.log(
      '[cron/expire-subscriptions] expired',
      p.id,
      p.display_name ?? '(no name)',
      'term ended',
      p.subscription_end_date,
    )
  }

  return NextResponse.json({ expired: due.length, ids })
}
