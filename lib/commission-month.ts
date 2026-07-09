// commission_payments.month is stored as "YYYY-MM" (e.g. "2026-05").
// Settings page filters and renders against this value, so we centralize
// the format helpers here. Extracted from the page so the math is unit-
// testable without booting a JSX environment.
//
// Bug context: the original Settings page compared `p.month` against
// `new Date().toLocaleDateString("en-US", { month: "long", year:
// "numeric" })` which produces "May 2026", never matching the stored
// "2026-05" key. Every affiliate saw "Paid this month: $0.00" forever.

export function formatMonthKey(monthKey: string): string {
  // Accept only YYYY-MM with month 01-12. The month-rolling Date
  // constructor would otherwise turn "2026-13" into "January 2027",
  // hiding the upstream data error in user-visible UI.
  if (!monthKey || !/^\d{4}-(0[1-9]|1[0-2])$/.test(monthKey)) return monthKey;
  const [yy, mm] = monthKey.split("-").map(Number);
  return new Date(yy, mm - 1, 1).toLocaleDateString("en-US", { month: "long", year: "numeric" });
}

export function currentMonthKey(d: Date = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

// Reduce an ISO timestamp (e.g. a referral's created_at) to its "YYYY-MM"
// month key. Returns "" for empty/unparseable input so callers can skip it.
export function monthKeyFromISO(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return currentMonthKey(d);
}

// Inclusive ascending list of "YYYY-MM" keys from startKey to endKey. Returns
// [] when either key is malformed or start is after end. Capped so a bad input
// can never produce an unbounded list.
export function monthKeyRange(startKey: string, endKey: string): string[] {
  const re = /^\d{4}-(0[1-9]|1[0-2])$/;
  if (!re.test(startKey) || !re.test(endKey) || startKey > endKey) return [];
  const [sy, sm] = startKey.split("-").map(Number);
  const [ey, em] = endKey.split("-").map(Number);
  const out: string[] = [];
  let y = sy;
  let m = sm;
  // 240 months = 20 years, far beyond any real affiliate history.
  for (let guard = 0; guard < 240; guard++) {
    out.push(`${y}-${String(m).padStart(2, "0")}`);
    if (y === ey && m === em) break;
    m += 1;
    if (m > 12) { m = 1; y += 1; }
  }
  return out;
}

export interface MonthlyEarning {
  monthKey: string; // "2026-07"
  label: string; // "July 2026"
  earned: number; // commission earned from referrals converted this month
  conversions: number; // # of converted referrals this month
  paid: number; // commission_payments recorded for this earning month
  paidAt: string | null; // most recent paid_at for this month, if any
  status: "paid" | "pending" | "none";
}

// Build the month-by-month earnings record shown on the partner dashboard.
// Every month from startMonthKey..endMonthKey is present (zero months included)
// so the record is unbroken. Earnings are keyed by the referral's conversion
// month (created_at); payouts are keyed by commission_payments.month, which is
// the earning month being covered (paid_at is when it was actually sent, on the
// 1st of the following month).
export function buildMonthlyEarnings(opts: {
  referrals: { createdAt: string; converted: boolean; commissionAmount: number }[];
  payments: { month: string; amount: number | string; paid_at?: string | null }[];
  startMonthKey: string;
  endMonthKey: string;
}): MonthlyEarning[] {
  const round2 = (n: number) => Math.round(n * 100) / 100;

  const earnedByMonth = new Map<string, { earned: number; conversions: number }>();
  for (const r of opts.referrals) {
    if (!r.converted) continue;
    const key = monthKeyFromISO(r.createdAt);
    if (!key) continue;
    const agg = earnedByMonth.get(key) ?? { earned: 0, conversions: 0 };
    agg.earned += Number(r.commissionAmount) || 0;
    agg.conversions += 1;
    earnedByMonth.set(key, agg);
  }

  const paidByMonth = new Map<string, { paid: number; paidAt: string | null }>();
  for (const p of opts.payments) {
    const key = p.month;
    if (!key) continue;
    const cur = paidByMonth.get(key) ?? { paid: 0, paidAt: null };
    cur.paid += Number(p.amount) || 0;
    if (p.paid_at && (!cur.paidAt || p.paid_at > cur.paidAt)) cur.paidAt = p.paid_at;
    paidByMonth.set(key, cur);
  }

  // Prefer the caller's start..end window. If it's unusable (bad input), fall
  // back to the sorted union of months that actually have data so nothing is
  // silently dropped.
  let months = monthKeyRange(opts.startMonthKey, opts.endMonthKey);
  if (months.length === 0) {
    months = [...new Set([...earnedByMonth.keys(), ...paidByMonth.keys()])].sort();
  }

  return months.map((monthKey) => {
    const e = earnedByMonth.get(monthKey);
    const pd = paidByMonth.get(monthKey);
    const earned = round2(e?.earned ?? 0);
    const paid = round2(pd?.paid ?? 0);
    const status: MonthlyEarning["status"] =
      paid > 0 ? "paid" : earned > 0 ? "pending" : "none";
    return {
      monthKey,
      label: formatMonthKey(monthKey),
      earned,
      conversions: e?.conversions ?? 0,
      paid,
      paidAt: pd?.paidAt ?? null,
      status,
    };
  });
}
