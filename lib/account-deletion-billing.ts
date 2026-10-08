import type Stripe from "stripe";

type Subscription = Pick<Stripe.Subscription, "id" | "status">;
export type DeletionSubscriptions = {
  list: (params: Stripe.SubscriptionListParams) => Promise<{
    data: Subscription[];
    has_more: boolean;
  }>;
  cancel: (id: string, params: Stripe.SubscriptionCancelParams) => Promise<Subscription>;
};

// Run before any destructive deletion. A failed or partially successful billing
// operation leaves the profile/customer mapping available for a safe retry.
export async function prepareDeletionBilling(
  profile: { stripe_customer_id: string | null; stripe_subscription_id: string | null } | null,
  profileError: unknown,
  getSubscriptions: () => DeletionSubscriptions,
): Promise<void> {
  if (profileError || !profile) throw new Error("Could not verify account billing profile");
  if (!profile.stripe_customer_id) {
    if (profile.stripe_subscription_id) throw new Error("Subscription has no customer mapping");
    return;
  }

  const subscriptions = getSubscriptions();
  const collect = async () => {
    const rows: Subscription[] = [];
    const seen = new Set<string>();
    let cursor: string | undefined;
    for (;;) {
      const page = await subscriptions.list({
        customer: profile.stripe_customer_id!, status: "all", limit: 100,
        ...(cursor ? { starting_after: cursor } : {}),
      });
      for (const row of page.data) {
        if (seen.has(row.id)) throw new Error("Subscription pagination repeated an id");
        seen.add(row.id);
        rows.push(row);
      }
      if (!page.has_more) return rows;
      cursor = page.data.at(-1)?.id;
      if (!cursor) throw new Error("Subscription pagination returned an empty page");
    }
  };
  const terminal = (row: Subscription) => row.status === "canceled" || row.status === "incomplete_expired";
  const before = await collect();
  if (profile.stripe_subscription_id && !before.some(row => row.id === profile.stripe_subscription_id)) {
    throw new Error("Stored subscription was not found for the customer");
  }
  for (const row of before) {
    if (terminal(row)) continue;
    const canceled = await subscriptions.cancel(row.id, { invoice_now: false, prorate: false });
    if (canceled.id !== row.id || canceled.status !== "canceled") {
      throw new Error("Stripe did not confirm subscription cancellation");
    }
  }
  if ((await collect()).some(row => !terminal(row))) {
    throw new Error("A subscription remains open after cancellation");
  }
}
