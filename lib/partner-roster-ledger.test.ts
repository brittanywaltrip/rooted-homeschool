import test from 'node:test';
import assert from 'node:assert/strict';
import { buildRosterAccounting } from './partner-roster-ledger.ts';
import { buildPayoutSummary } from './payout-ledger.ts';

const now = new Date('2026-09-30T20:00:00Z');
const partner = { code: 'TEST', name: 'Fixture', is_active: true };
const ref = (amount: number | null, date = '2026-08-15T12:00:00Z') => ({ affiliate_code: 'test', converted: true, commission_amount: amount, created_at: date });
const payment = (amount: number, month = '2026-08') => ({ affiliate_code: 'Test', amount, month, paid_at: '2026-09-01T12:00:00Z' });

test('banner includes prior unpaid months while pending stays separate', () => {
  const { affiliates, payout_summary } = buildRosterAccounting([partner], [ref(10,'2026-07-01T12:00:00Z'),ref(12.23),ref(7.8,'2026-09-15T12:00:00Z')], [payment(7.8)], now);
  assert.equal(affiliates[0].owed_now, 14.43);
  assert.equal(payout_summary.total_due, 14.43);
  assert.equal(payout_summary.pending_total, 7.8);
  assert.equal(payout_summary.per_affiliate[0].amount, 14.43);
});
test('roster balances exactly match cards, with partial payment, overpayment and legacy estimates', () => {
  for (const amount of [0, 5, 30]) {
    const refs = [ref(null), ref(7.8), ref(2,'2026-09-15T12:00:00Z')];
    const payments = [payment(amount)];
    const card = buildPayoutSummary(partner.code, refs, payments, now);
    const { affiliates, payout_summary } = buildRosterAccounting([partner], refs, payments, now);
    const a = affiliates[0];
    assert.equal(Math.round(a.owed_now * 100), card.commission_cents);
    assert.equal(Math.round(a.pending_commission * 100), card.pending_cents);
    assert.equal(a.total_paid, card.lifetime_paid);
    assert.equal(a.total_earned * 100, card.lifetime_earned_cents);
    assert.equal(payout_summary.legacy_estimate_count, 1);
    assert.ok(payout_summary.total_due >= 0);
  }
});
test('inactive partners with unpaid balances remain in the payable summary', () => {
  const r = buildRosterAccounting([{ ...partner, is_active: false }], [ref(7.8)], [], now);
  assert.equal(r.payout_summary.total_due, 7.8);
  assert.equal(r.payout_summary.per_affiliate[0].code, 'TEST');
});
test('Pacific month boundary closes pending earnings without losing old debt', () => {
  const refs = [ref(5), ref(10,'2026-09-15T12:00:00Z')];
  assert.equal(buildRosterAccounting([partner], refs, [], new Date('2026-10-01T06:59:59Z')).payout_summary.total_due, 5);
  assert.equal(buildRosterAccounting([partner], refs, [], new Date('2026-10-01T07:00:00Z')).payout_summary.total_due, 15);
});
test('monthly cells retain covering months, conversions, latest payment date and cent sums', () => {
  const r = buildRosterAccounting([partner], [ref(.1),ref(.2)], [payment(.1),{ ...payment(.2), paid_at:'2026-09-03T12:00:00Z' }], now);
  const month = r.affiliates[0].monthly_ledger.find(m=>m.month==='2026-08')!;
  assert.deepEqual(month, { month:'2026-08', earned:.3, conversions:2, paid:.3, paid_at:'2026-09-03T12:00:00Z' });
});
test('invalid financial data refuses instead of producing partial balances', () => {
  assert.throws(()=>buildRosterAccounting([partner],[ref(-1)],[],now));
  assert.throws(()=>buildRosterAccounting([partner],[ref(5,'bad')],[],now));
  assert.throws(()=>buildRosterAccounting([partner],[],[payment(-1)],now));
});
