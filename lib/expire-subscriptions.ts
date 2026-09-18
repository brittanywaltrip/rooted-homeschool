import { classifyPaidThrough, type InvoiceStatus } from "./paid-through.ts";

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
// 3. A paid profile whose Stripe subscription is over, but whose row never
//    heard about it (September 2026).
//      is_pro = true
//      stripe_subscription_id is set
//      subscription_status is anything but 'cancelled'
//      plan_type is not 'gift'                (rule 2 owns those)
//      and Stripe DEFINITIVELY reports that subscription canceled
//    Rule 1 can only act on a row that already carries 'cancelled' and an end
//    date. A row that never got them is invisible to it forever, which is what
//    happened when a stale customer.subscription.updated landed after the
//    deleted event and linkStripeSubscription reset subscription_status to
//    'active' and subscription_end_date to null (fixed going forward by the
//    webhook's stale-event guard, e6cdeb4). Any deleted event that is lost,
//    fails permanently, or was never subscribed leaves the same shape. This
//    rule makes Stripe the source of truth so the row heals itself.
//
//    It only ever SYNCHRONISES state: it writes subscription_status
//    'cancelled' and subscription_end_date = the end of the term the family
//    paid for, and never touches is_pro or plan_type. Rule 1 then ends access
//    on the correct day, on its own schedule. So this rule can never take
//    access away from anyone, which is the point: the worst it can do is hand
//    rule 1 a date.
//
//    "Definitively canceled" means Stripe answered and said 'canceled' or
//    'incomplete_expired'. Anything else (active, trialing, past_due, unpaid,
//    incomplete, paused) is left alone, and so is a subscription Stripe could
//    not be asked about, or one with no paid-through date to write. Nobody is
//    synchronised on a guess, and no end date is ever invented.
//
//    Idempotent by construction: the write sets subscription_status
//    'cancelled', which removes the row from this rule's own candidate filter,
//    so a second run finds nothing. The write re-asserts is_pro and the
//    subscription id, so a family who resubscribed between the read and the
//    write (linkStripeSubscription gives them a new id) is never stamped.
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
  subscription_status?: string | null;
};

/**
 * Is this Stripe subscription still live? true, false, or null when Stripe
 * could not be asked. The route answers it with stripe.subscriptions.retrieve.
 */
export type SubscriptionLiveCheck = (subscriptionId: string) => Promise<boolean | null>;

/**
 * What Stripe currently says about one subscription. `null` from the check
 * means Stripe could not be asked, or could not answer, and the row must be
 * left alone.
 */
export type SubscriptionSnapshot = {
  /** Stripe's own status string, e.g. 'active' | 'canceled' | 'past_due'. */
  status: string;
  /**
   * Status of the subscription's latest invoice, or null when it could not be
   * read. Rule 3 classifies from this, never from a period end.
   */
  latestInvoiceStatus: InvoiceStatus | null;
  /**
   * The billed line period for THIS subscription, ISO, or null when the right
   * line could not be identified deterministically (see
   * lib/stripe-invoice-line.ts). NOT the invoice's own period_start/period_end,
   * which describe the previous cycle.
   */
  linePeriodStart: string | null;
  linePeriodEnd: string | null;
};

export type SubscriptionSnapshotCheck = (
  subscriptionId: string,
) => Promise<SubscriptionSnapshot | null>;

/**
 * Bulk form: given the subscription ids rule 3 cares about, return what Stripe
 * says about them, as a map keyed by subscription id.
 *
 * The contract that keeps this as conservative as asking one at a time:
 * **an id missing from the map means "Stripe did not tell us", never "gone".**
 * A subscription Stripe did not return, because the listing was cut short, the
 * page errored, or for any other reason, is inconclusive and its family is left
 * alone. Only an id that IS in the map, carrying a terminal status, is acted on.
 *
 * Returning null means Stripe could not be asked at all, and rule 3 sits out the
 * whole run.
 */
export type SubscriptionSnapshotBatch = (
  subscriptionIds: string[],
) => Promise<Map<string, SubscriptionSnapshot> | null>;

/** Parse an ISO string into a usable Date, or null. Never throws. */
function toDateOrNull(iso: string | null | undefined): Date | null {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Stripe statuses that mean the subscription is definitively over. */
const TERMINAL_STRIPE_STATUSES = new Set(["canceled", "incomplete_expired"]);

export interface SweepOptions {
  /**
   * Compute and report every change without writing any of them. Suppresses
   * ALL THREE rules' writes, not just the reconciliation, so a dry run can
   * never expire anybody either.
   */
  dryRun?: boolean;
  /**
   * Supplies rule 3 with Stripe's current view of a subscription, one id at a
   * time. Kept as the reference semantics and for tests; in production prefer
   * getSubscriptionSnapshots, which asks Stripe once instead of once per
   * subscriber. When both are given the bulk form wins.
   */
  getSubscriptionSnapshot?: SubscriptionSnapshotCheck;
  /**
   * Bulk form of the above: one Stripe listing for the whole run rather than
   * one API call per paid subscriber. Identical decision rules apply, because
   * both forms end up as the same map and an absent id is inconclusive either
   * way. Rule 3 does not run at all when neither is supplied, so reconciliation
   * stays opt-in and the existing two rules behave exactly as before.
   */
  getSubscriptionSnapshots?: SubscriptionSnapshotBatch;
}

/** One change the sweep made, or would make on a dry run. */
export type PlannedWrite = {
  id: string;
  rule: "cancelled-term-ended" | "gift-ended" | "reconcile-cancelled";
  patch: Record<string, unknown>;
  because: string;
};

export type SweepResult =
  | {
      ok: true;
      expired: number;
      ids: string[];
      giftsExpired: number;
      giftIds: string[];
      /** Rows rule 3 synchronised with Stripe (state only, no downgrade). */
      reconciled: number;
      reconciledIds: string[];
      /** Every write made, or on a dry run every write that would be made. */
      planned: PlannedWrite[];
      dryRun: boolean;
    }
  | { ok: false; error: string };

export async function sweepExpiredAccess(
  client: SweepClient,
  now: Date = new Date(),
  log: (...parts: unknown[]) => void = console.log,
  isSubscriptionLive: SubscriptionLiveCheck = async () => null,
  options: SweepOptions = {},
): Promise<SweepResult> {
  const nowIso = now.toISOString();
  const dryRun = options.dryRun ?? false;
  // One decision path regardless of which source was supplied: both forms are
  // reduced to a map, and rule 3 only ever reads that map. The per-id form is
  // adapted rather than duplicated, so the two cannot drift apart.
  const singleSnapshot = options.getSubscriptionSnapshot;
  const resolveSnapshots: SubscriptionSnapshotBatch | undefined =
    options.getSubscriptionSnapshots ??
    (singleSnapshot
      ? async (ids) => {
          const map = new Map<string, SubscriptionSnapshot>();
          for (const id of ids) {
            const snap = await singleSnapshot(id);
            // A null answer means Stripe could not tell us. Leaving the id out
            // of the map is exactly how the bulk form reports the same thing.
            if (snap) map.set(id, snap);
          }
          return map;
        }
      : undefined);
  const tag = dryRun ? "[cron/expire-subscriptions][dry-run]" : "[cron/expire-subscriptions]";
  const planned: PlannedWrite[] = [];

  const [cancelledRead, giftRead, reconcileRead] = await Promise.all([
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
    // Rule 3 candidates. Deliberately broad in SQL and narrowed in JS below,
    // because "anything but 'cancelled'" has to include NULL, which PostgREST
    // cannot express as a single filter.
    resolveSnapshots
      ? client
          .from("profiles")
          .select("id, display_name, plan_type, subscription_status, subscription_end_date, current_period_end, stripe_subscription_id")
          .eq("is_pro", true)
          .not("stripe_subscription_id", "is", null)
      : Promise.resolve({ data: [], error: null }),
  ]);
  if (cancelledRead.error) return { ok: false, error: `read cancelled: ${cancelledRead.error.message}` };
  if (giftRead.error) return { ok: false, error: `read gifts: ${giftRead.error.message}` };
  if (reconcileRead.error) return { ok: false, error: `read reconcile: ${reconcileRead.error.message}` };

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
    for (const p of cancelled) {
      planned.push({
        id: p.id,
        rule: "cancelled-term-ended",
        patch: { is_pro: false, plan_type: null },
        because: `paid term ended ${p.subscription_end_date}`,
      });
    }
    if (!dryRun) {
      const { error } = await client
        .from("profiles")
        .update({ is_pro: false, plan_type: null })
        .in("id", cancelled.map((p) => p.id));
      if (error) return { ok: false, error: `write cancelled: ${error.message}` };
    }
    for (const p of cancelled) {
      log(tag, "expired", p.id, p.display_name ?? "(no name)", "term ended", p.subscription_end_date);
    }
  }

  if (gifts.length > 0) {
    for (const p of gifts) {
      planned.push({
        id: p.id,
        rule: "gift-ended",
        patch: { is_pro: false, plan_type: null, subscription_status: "free" },
        because: `gifted year ended ${p.current_period_end}`,
      });
    }
    if (!dryRun) {
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
    }
    for (const p of gifts) {
      log(tag, "expired gift", p.id, p.display_name ?? "(no name)", "gift ended", p.current_period_end);
    }
  }

  // ── Rule 3: make Stripe the source of truth for paid rows ────────────────
  const reconciled: DueRow[] = [];
  if (resolveSnapshots) {
    const handled = new Set([...cancelled.map((r) => r.id), ...gifts.map((r) => r.id)]);
    const candidates = ((reconcileRead.data ?? []) as DueRow[]).filter(
      (r) =>
        !handled.has(r.id) &&
        r.plan_type !== "gift" &&
        r.subscription_status !== "cancelled" &&
        !!r.stripe_subscription_id,
    );

    // One Stripe round trip for the whole run instead of one per subscriber.
    const wantedIds = [...new Set(candidates.map((r) => r.stripe_subscription_id as string))];
    const snapshots = wantedIds.length > 0 ? await resolveSnapshots(wantedIds) : new Map();

    if (!snapshots) {
      // Stripe could not be asked at all. Nobody is synchronised on silence.
      log(tag, "reconcile skipped for the whole run, Stripe could not be reached");
    }
    // No snapshots means no candidates are considered at all this run.
    const confirmed = snapshots ?? new Map<string, SubscriptionSnapshot>();
    const toCheck = snapshots ? candidates : [];

    for (const r of toCheck) {
      const subId = r.stripe_subscription_id as string;
      const snap = confirmed.get(subId);

      if (!snap) {
        // Absent from the map is "Stripe did not tell us", never "gone".
        log(tag, "reconcile left alone, Stripe could not confirm", r.id, subId);
        continue;
      }
      if (!TERMINAL_STRIPE_STATUSES.has(snap.status)) continue;

      // What did this family actually PAY for? Never "when does the period
      // end", which is the question that hands out unpaid terms: Stripe
      // advances current_period_end when it CREATES the renewal invoice, not
      // when that invoice is paid. lib/paid-through.ts is the single answer
      // the webhook path will ask too, so the two can never disagree.
      //
      // The row's own current_period_end is deliberately NOT consulted as a
      // fallback any more. It is a copy of the same untrustworthy field.
      const classification = classifyPaidThrough({
        latestInvoiceStatus: snap.latestInvoiceStatus,
        latestInvoiceLinePeriodStart: toDateOrNull(snap.linePeriodStart),
        latestInvoiceLinePeriodEnd: toDateOrNull(snap.linePeriodEnd),
        // Rule 3 only ever SYNCHRONISES state and never revokes, so it does
        // not carry charge-level refund data. Refund scoping belongs to the
        // webhook path, which is the one that can take access away.
        currentChargeFullyRefunded: false,
      });

      if (classification.kind === "unknown") {
        log(
          tag,
          "reconcile left alone, no trustworthy paid-through date",
          r.id, subId,
          "stripe:", snap.status,
          "invoice:", snap.latestInvoiceStatus ?? "unreadable",
        );
        continue;
      }

      const paidThrough = classification.through.toISOString();

      const patch = { subscription_status: "cancelled", subscription_end_date: paidThrough };
      planned.push({
        id: r.id,
        rule: "reconcile-cancelled",
        patch,
        because: `Stripe reports ${snap.status} for ${subId}; profile still says ${r.subscription_status ?? "null"}`,
      });

      if (!dryRun) {
        const { error } = await client
          .from("profiles")
          .update(patch)
          .eq("id", r.id)
          // Re-assert what was read. A family downgraded in the meantime, or one
          // who resubscribed (linkStripeSubscription writes them a new
          // subscription id), is never stamped on the strength of a stale read.
          .eq("is_pro", true)
          .eq("stripe_subscription_id", subId);
        if (error) return { ok: false, error: `write reconcile: ${error.message}` };
      }

      reconciled.push(r);
      log(tag, "reconciled", r.id, r.display_name ?? "(no name)", "stripe:", snap.status, "paid through", paidThrough);
    }
  }

  if (cancelled.length === 0 && gifts.length === 0 && reconciled.length === 0) log(tag, "nothing due");

  return {
    ok: true,
    expired: cancelled.length,
    ids: cancelled.map((p) => p.id),
    giftsExpired: gifts.length,
    giftIds: gifts.map((p) => p.id),
    reconciled: reconciled.length,
    reconciledIds: reconciled.map((p) => p.id),
    planned,
    dryRun,
  };
}
