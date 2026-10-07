export const DISCOVERY_SOURCES = {
  friend_family: 'Friend or family',
  homeschool_group: 'Homeschool group or community',
  facebook: 'Facebook',
  instagram: 'Instagram',
  search: 'Search engine',
  app_store: 'App Store or Google Play',
  partner: 'Rooted partner',
  other: 'Other',
} as const;

export function discoveryLabel(value: unknown): string {
  return typeof value === 'string' && Object.hasOwn(DISCOVERY_SOURCES, value)
    ? DISCOVERY_SOURCES[value as keyof typeof DISCOVERY_SOURCES] : 'Unknown';
}

export function daysToUpgrade(signup: string, paidAt: number | null): number | null {
  const start = Date.parse(signup);
  if (!Number.isFinite(start) || !paidAt || paidAt * 1000 < start) return null;
  return Math.floor((paidAt * 1000 - start) / 86400000);
}

export type PaidInvoiceEvidence = {
  customer: string | { id: string } | null;
  status: string | null;
  amount_paid: number;
  parent?: { subscription_details?: { subscription: string | { id: string } | null } | null } | null;
  status_transitions: { paid_at: number | null };
};

// Historical first positive subscription payment, including customers who
// later canceled/refunded. This is not current revenue or active membership.
export function firstPayments(invoices: PaidInvoiceEvidence[]): Map<string, number> {
  const first = new Map<string, number>();
  for (const i of invoices) {
    const customer = typeof i.customer === 'string' ? i.customer : i.customer?.id;
    const paid = i.status_transitions.paid_at;
    if (!customer || i.status !== 'paid' || i.amount_paid <= 0 || !paid ||
        !i.parent?.subscription_details?.subscription) continue;
    first.set(customer, Math.min(first.get(customer) ?? paid, paid));
  }
  return first;
}
