import { displayCommission } from './commission.ts';
import { buildPayoutSummary, payoutMonth, type ReferralEarning, type RecordedPayment } from './payout-ledger.ts';

type Partner = { code: string; name: string; payment_method?: string | null; payment_notes?: string | null };
type Payment = RecordedPayment & { paid_at?: string | null };

/** Both admin views use the same lifetime/closed-month balance calculation. */
export function buildRosterAccounting<T extends Partner>(partners: T[], referrals: ReferralEarning[], payments: Payment[], now: Date) {
  const currentMonth = payoutMonth(now);
  const year = currentMonth.slice(0, 4);
  const affiliates = partners.map(partner => {
    const code = partner.code.toUpperCase();
    const ownReferrals = referrals.filter(r => r.affiliate_code.toUpperCase() === code);
    const ownPayments = payments.filter(p => p.affiliate_code.toUpperCase() === code);
    const summary = buildPayoutSummary(partner.code, ownReferrals, ownPayments, now);
    const earnedByMonth = new Map<string, { cents: number; conversions: number }>();
    const paidByMonth = new Map<string, { cents: number; paidAt: string | null }>();
    for (const row of ownReferrals) {
      if (!row.converted) continue;
      const month = payoutMonth(new Date(row.created_at));
      const bucket = earnedByMonth.get(month) ?? { cents: 0, conversions: 0 };
      bucket.cents += Math.round(displayCommission(row) * 100);
      bucket.conversions++;
      earnedByMonth.set(month, bucket);
    }
    for (const row of ownPayments) {
      const bucket = paidByMonth.get(row.month) ?? { cents: 0, paidAt: null };
      bucket.cents += Math.round(Number(row.amount) * 100);
      if (row.paid_at && (!bucket.paidAt || row.paid_at > bucket.paidAt)) bucket.paidAt = row.paid_at;
      paidByMonth.set(row.month, bucket);
    }
    const monthly_ledger = Array.from({ length: 12 }, (_, index) => {
      const month = `${year}-${String(index + 1).padStart(2, '0')}`;
      const earned = earnedByMonth.get(month);
      const paid = paidByMonth.get(month);
      return { month, earned: (earned?.cents ?? 0) / 100, conversions: earned?.conversions ?? 0,
        paid: (paid?.cents ?? 0) / 100, paid_at: paid?.paidAt ?? null };
    });
    return {
      ...partner,
      paying_customers: summary.conversions_lifetime,
      total_earned: summary.lifetime_earned_cents / 100,
      total_paid: summary.lifetime_paid,
      commission_owed: Math.max(0, summary.lifetime_earned_cents - Math.round(summary.lifetime_paid * 100)) / 100,
      owed_now: summary.commission_cents / 100,
      pending_commission: summary.pending_cents / 100,
      legacy_estimate_count: summary.legacy_estimate_count,
      last_paid_month: summary.last_paid_month,
      monthly_ledger,
    };
  });
  const per_affiliate = affiliates.filter(a => a.owed_now > 0).map(a => ({
    code: a.code, name: a.name, amount: a.owed_now,
    payment_method: a.payment_method ?? null, payment_notes: a.payment_notes ?? null,
  }));
  return {
    affiliates,
    payout_summary: {
      payout_month: currentMonth,
      total_due: per_affiliate.reduce((cents, a) => cents + Math.round(a.amount * 100), 0) / 100,
      pending_total: affiliates.reduce((cents, a) => cents + Math.round(a.pending_commission * 100), 0) / 100,
      legacy_estimate_count: affiliates.reduce((count, a) => count + a.legacy_estimate_count, 0),
      per_affiliate,
    },
  };
}
