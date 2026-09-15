// The nightly downgrade for paid time that has run out, with the client passed
// in so node --test can run it (the cron route imports next/server and the "@/"
// alias). app/api/cron/expire-subscriptions/route.ts is the thin wrapper.
//
// Two rules, both deliberately narrow. A row is downgraded only when it is ALL
// of one of these:
//
// 1. A cancelled paid plan whose paid term is over.
//      subscription_status = 'cancelled'   (Stripe told us they cancelled)
//      is_pro = true                       (not already downgraded)
//      subscription_end_date < now         (their paid term has run out)
//    When a family cancels an annual plan partway through, Rooted honours the
//    term they paid for (the customer.subscription.deleted branch of the Stripe
//    webhook), and Stripe sends nothing more, so the end has to be swept for.
//    Downgrade: is_pro false, plan_type null. subscription_status stays
//    'cancelled', as it always has.
//
// 2. A gifted year that has ended (September 2026).
//      plan_type = 'gift'                  (the family_gift checkout branch)
//      is_pro = true
//      current_period_end < now            (the gifted year is over)
//      and NO live Stripe subscription
//    The gift branch sets is_pro, subscription_status 'active', plan_type
//    'gift' and current_period_end one year out, and nothing ever turned it
//    off, so a gifted family kept Rooted+ for good.
//
//    "No live subscription" cannot be read off stripe_subscription_id alone:
//    linkStripeSubscription writes it and nothing ever clears it, so a family
//    who paid, cancelled, and was later gifted a year still carries their old,
//    finished subscription's id. So a row with no id qualifies at once, and a
//    row WITH an id qualifies only when Stripe says that subscription is over
//    (canceled or incomplete_expired, or it no longer exists). If Stripe cannot
//    be asked, the row is left alone: a family is never downgraded on a guess.
//    A family who subscribes has plan_type rewritten by linkStripeSubscription,
//    and the write below re-checks plan_type = 'gift', so a purchase made
//    between the read and the write is never undone.
//    Downgrade: is_pro false, plan_type null, subscription_status 'free', the
//    value a family with no paid plan carries (the column's default). Not
//    'cancelled': nobody cancelled anything, and admin reads that as churn.
//
// The family portal links the gift extended (family_invites.trial_ends_at) are
// left alone: the portal's own after-end-date rule handles them.

export interface SweepQuery extends PromiseLike<{ data?: unknown; error?: { message?: string } | null }> {
  eq(column: string, value: unknown): SweepQuery;
  not(column: string, operator: string, value: unknown): SweepQuery;
  is(column: string, value: unknown): SweepQuery;
  lt(column: string, value: unknown): SweepQuery;
  in(column: string, values: unknown[]): SweepQuery;
}

export interface SweepClient {
  from(table: string): {
    select(columns: string): SweepQuery;
    update(values: Record<string, unknown>): SweepQuery;
  };
}

type DueRow = {
  id: string;
  display_name: string | null;
  plan_type: string | null;
  subscription_end_date?: string | null;
  current_period_end?: string | null;
  stripe_subscription_id?: string | null;
};

/**
 * Is this Stripe subscription still live? true, false, or null when Stripe
 * could not be asked. The route answers it with stripe.subscriptions.retrieve.
 */
export type SubscriptionLiveCheck = (subscriptionId: string) => Promise<boolean | null>;

export type SweepResult =
  | { ok: true; expired: number; ids: string[]; giftsExpired: number; giftIds: string[] }
  | { ok: false; error: string };

export async function sweepExpiredAccess(
  client: SweepClient,
  now: Date = new Date(),
  log: (...parts: unknown[]) => void = console.log,
  isSubscriptionLive: SubscriptionLiveCheck = async () => null,
): Promise<SweepResult> {
  const nowIso = now.toISOString();

  const [cancelledRead, giftRead] = await Promise.all([
    client
      .from("profiles")
      .select("id, display_name, plan_type, subscription_end_date")
      .eq("subscription_status", "cancelled")
      .eq("is_pro", true)
      .not("subscription_end_date", "is", null)
      .lt("subscription_end_date", nowIso),
    client
      .from("profiles")
      .select("id, display_name, plan_type, current_period_end, stripe_subscription_id")
      .eq("plan_type", "gift")
      .eq("is_pro", true)
      .not("current_period_end", "is", null)
      .lt("current_period_end", nowIso),
  ]);
  if (cancelledRead.error) return { ok: false, error: `read cancelled: ${cancelledRead.error.message}` };
  if (giftRead.error) return { ok: false, error: `read gifts: ${giftRead.error.message}` };

  const cancelled = (cancelledRead.data ?? []) as DueRow[];
  const giftCandidates = ((giftRead.data ?? []) as DueRow[]).filter((g) => !cancelled.some((c) => c.id === g.id));
  const gifts: DueRow[] = [];
  for (const g of giftCandidates) {
    if (!g.stripe_subscription_id) {
      gifts.push(g);
      continue;
    }
    const live = await isSubscriptionLive(g.stripe_subscription_id);
    if (live === false) {
      gifts.push(g);
    } else if (live === null) {
      log("[cron/expire-subscriptions] gift left alone, Stripe could not confirm", g.id, g.stripe_subscription_id);
    }
  }

  if (cancelled.length > 0) {
    const { error } = await client
      .from("profiles")
      .update({ is_pro: false, plan_type: null })
      .in("id", cancelled.map((p) => p.id));
    if (error) return { ok: false, error: `write cancelled: ${error.message}` };
    for (const p of cancelled) {
      log("[cron/expire-subscriptions] expired", p.id, p.display_name ?? "(no name)", "term ended", p.subscription_end_date);
    }
  }

  if (gifts.length > 0) {
    const { error } = await client
      .from("profiles")
      .update({ is_pro: false, plan_type: null, subscription_status: "free" })
      .in("id", gifts.map((p) => p.id))
      // Re-assert the rule in the write: subscribing rewrites plan_type, so a
      // family who subscribed between the read and this update is never
      // downgraded.
      .eq("plan_type", "gift")
      .eq("is_pro", true);
    if (error) return { ok: false, error: `write gifts: ${error.message}` };
    for (const p of gifts) {
      log("[cron/expire-subscriptions] expired gift", p.id, p.display_name ?? "(no name)", "gift ended", p.current_period_end);
    }
  }

  if (cancelled.length === 0 && gifts.length === 0) log("[cron/expire-subscriptions] nothing due");

  return {
    ok: true,
    expired: cancelled.length,
    ids: cancelled.map((p) => p.id),
    giftsExpired: gifts.length,
    giftIds: gifts.map((p) => p.id),
  };
}
