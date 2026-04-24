// Partner commission math — one source of truth for both the webhook
// (when recording conversions) and the display endpoints (when rendering
// ledger rows that pre-date the schema change).

export const COMMISSION_RATE = 0.20

// Legacy flat-rate fallback used for rows that lack a stored
// commission_amount. 20% × $33.15 ($39 × 0.85 coupon-discounted net) = $6.63.
export const LEGACY_COMMISSION_PER_PAYING = 6.63

// Converts a Stripe amount expressed in cents to the partner's commission
// in dollars, rounded to 2 decimal places. Returns null when the input is
// missing or non-positive — callers fall back to the legacy default.
//
// Examples:
//   commissionFromCents(3315) → 6.63   ($33.15 founding-after-coupon)
//   commissionFromCents(3900) → 7.80   ($39.00 founding full price)
//   commissionFromCents(0) | null | undefined → null
export function commissionFromCents(cents: number | null | undefined): number | null {
  if (typeof cents !== 'number' || !Number.isFinite(cents) || cents <= 0) return null
  return Math.round(cents * COMMISSION_RATE) / 100
}

// Returns the dollars-commission that should be displayed for a referral
// row. Prefers the stored per-row value (set by the webhook on conversion
// or by the backfill script); falls back to the flat $6.63 when the row
// predates the commission_amount column.
export function displayCommission(row: {
  converted: boolean
  commission_amount?: number | string | null
}): number {
  if (!row.converted) return 0
  const stored = row.commission_amount
  if (stored !== null && stored !== undefined) {
    const asNum = typeof stored === 'string' ? Number(stored) : stored
    if (Number.isFinite(asNum) && asNum >= 0) {
      return Math.round(asNum * 100) / 100
    }
  }
  return LEGACY_COMMISSION_PER_PAYING
}
