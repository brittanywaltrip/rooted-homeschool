/** Stripe moved the invoice's subscription reference under parent in newer API versions. */
export function invoiceSubscriptionId(invoice: {
  parent?: { subscription_details?: { subscription?: string | { id: string } | null } | null } | null;
  subscription?: string | { id: string } | null;
}): string | null {
  const current = invoice.parent?.subscription_details?.subscription;
  const legacy = invoice.subscription;
  const value = current ?? legacy;
  return typeof value === 'string' ? value : value?.id ?? null;
}
