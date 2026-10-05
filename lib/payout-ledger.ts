import { displayCommission } from "./commission.ts";

/** The business month closes at midnight Pacific, including daylight saving. */
export function payoutMonth(date: Date): string {
  if (!Number.isFinite(date.getTime())) throw new Error("Invalid ledger date");
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Los_Angeles", year: "numeric", month: "2-digit",
  }).formatToParts(date);
  return `${parts.find(p => p.type === "year")!.value}-${parts.find(p => p.type === "month")!.value}`;
}

export interface ReferralEarning {
  affiliate_code: string;
  converted: boolean;
  commission_amount?: number | string | null;
  created_at: string;
}
export interface RecordedPayment {
  affiliate_code: string;
  amount: number | string;
  month: string;
}

export function buildPayoutSummary(code: string, referrals: ReferralEarning[], payments: RecordedPayment[], now: Date) {
  const normalized = code.toUpperCase();
  const currentMonth = payoutMonth(now);
  let earned = 0, closedEarned = 0, conversions = 0, paid = 0, legacyEstimates = 0;
  let lastPaid: string | null = null;
  for (const row of referrals) {
    if (!row.converted || row.affiliate_code.toUpperCase() !== normalized) continue;
    const month = payoutMonth(new Date(row.created_at));
    if (row.commission_amount == null) legacyEstimates++;
    else if (!Number.isFinite(Number(row.commission_amount)) || Number(row.commission_amount) < 0) {
      throw new Error("Invalid stored commission");
    }
    const cents = Math.round(displayCommission(row) * 100);
    earned += cents;
    conversions++;
    if (month < currentMonth) closedEarned += cents;
  }
  for (const row of payments) {
    if (row.affiliate_code.toUpperCase() !== normalized) continue;
    const amount = Number(row.amount);
    if (!Number.isFinite(amount) || amount < 0 || !/^\d{4}-(0[1-9]|1[0-2])$/.test(row.month)) {
      throw new Error("Invalid recorded payment");
    }
    paid += Math.round(amount * 100);
    if (!lastPaid || row.month > lastPaid) lastPaid = row.month;
  }
  return {
    conversions_lifetime: conversions,
    legacy_estimate_count: legacyEstimates,
    lifetime_earned_cents: earned,
    commission_cents: Math.max(0, closedEarned - paid),
    pending_cents: Math.max(0, earned - Math.max(closedEarned, paid)),
    lifetime_paid: paid / 100,
    last_paid_month: lastPaid,
    month_label: "Closed months · Pacific time",
  };
}

/** Stop on any read failure or repeated row; never return a partial total. */
export async function readAllLedgerRows<T extends { id: string }>(
  page: (offset: number, size: number) => PromiseLike<{ data: T[] | null; error: unknown }>,
): Promise<T[]> {
  const rows: T[] = [];
  const seen = new Set<string>();
  for (;;) {
    const result = await page(rows.length, 100);
    if (result.error || !result.data) throw new Error("Incomplete ledger read");
    if (!result.data.length) return rows;
    for (const row of result.data) {
      if (!row.id || seen.has(row.id)) throw new Error("Unstable ledger pagination");
      seen.add(row.id);
      rows.push(row);
    }
  }
}
