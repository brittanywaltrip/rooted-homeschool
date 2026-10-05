import test from "node:test";
import assert from "node:assert/strict";
import { buildPayoutSummary, payoutMonth, readAllLedgerRows } from "./payout-ledger.ts";

const now = new Date("2026-10-01T07:00:00Z");
const referral = (amount: number | string | null, date = "2026-09-15T12:00:00Z") => ({
  affiliate_code: "AMANDA15", converted: true, commission_amount: amount, created_at: date,
});

test("previously paid commissions are not payable again", () => {
  const result = buildPayoutSummary("amanda15", [referral(31.09)], [
    { affiliate_code: "Amanda15", amount: "31.09", month: "2026-09" },
  ], now);
  assert.equal(result.commission_cents, 0);
  assert.equal(result.lifetime_earned_cents, 3109);
  assert.equal(result.lifetime_paid, 31.09);
});

test("midnight Pacific closes the month, including DST", () => {
  assert.equal(payoutMonth(new Date("2026-10-01T06:59:59Z")), "2026-09");
  assert.equal(payoutMonth(now), "2026-10");
  assert.equal(payoutMonth(new Date("2026-02-01T07:59:59Z")), "2026-01");
  assert.equal(payoutMonth(new Date("2026-02-01T08:00:00Z")), "2026-02");
  assert.equal(buildPayoutSummary("AMANDA15", [referral(10)], [], new Date("2026-10-01T06:59:59Z")).commission_cents, 0);
  assert.equal(buildPayoutSummary("AMANDA15", [referral(10)], [], now).commission_cents, 1000);
});

test("current month is pending and earlier months are payable", () => {
  const result = buildPayoutSummary("AMANDA15", [referral(7.8), referral(10.03, "2026-10-02T12:00:00Z")], [], now);
  assert.equal(result.commission_cents, 780);
  assert.equal(result.pending_cents, 1003);
});

test("partial payments reduce payable while overpayments never become negative", () => {
  assert.equal(buildPayoutSummary("AMANDA15", [referral(7.8)], [
    { affiliate_code: "AMANDA15", amount: 2.8, month: "2026-09" },
  ], now).commission_cents, 500);
  const result = buildPayoutSummary("AMANDA15", [referral(7.8)], [
    { affiliate_code: "AMANDA15", amount: 9, month: "2026-09" },
  ], now);
  assert.equal(result.commission_cents, 0);
  assert.equal(result.pending_cents, 0);
});

test("only converted referrals for this partner count, with explicit and legacy amounts", () => {
  const result = buildPayoutSummary("AMANDA15", [referral(0), referral(null),
    { ...referral(100), converted: false }, { ...referral(100), affiliate_code: "OTHER" },
  ], [], now);
  assert.equal(result.conversions_lifetime, 2);
  assert.equal(result.lifetime_earned_cents, 663);
  assert.equal(result.legacy_estimate_count, 1);
});

test("currency is summed in cents instead of floating-point dollars", () => {
  assert.equal(buildPayoutSummary("AMANDA15", [referral(0.1), referral(0.2)], [], now).commission_cents, 30);
});

test("bad dates or payment records refuse instead of showing zero paid", () => {
  assert.throws(() => buildPayoutSummary("AMANDA15", [referral(7.8, "bad")], [], now));
  for (const amount of ["bad", -1, Infinity]) {
    assert.throws(() => buildPayoutSummary("AMANDA15", [referral(amount)], [], now));
    assert.throws(() => buildPayoutSummary("AMANDA15", [], [{ affiliate_code: "AMANDA15", amount, month: "2026-09" }], now));
  }
});

test("pagination reads beyond 1,000 rows and honors smaller server pages", async () => {
  const source = Array.from({ length: 1205 }, (_, id) => ({ id: String(id) }));
  const rows = await readAllLedgerRows(async offset => ({ data: source.slice(offset, offset + 37), error: null }));
  assert.equal(rows.length, 1205);
  assert.deepEqual(rows, source);
});

test("a later-page failure and a repeated row never return partial totals", async () => {
  await assert.rejects(readAllLedgerRows(async offset => offset === 0
    ? { data: [{ id: "1" }], error: null } : { data: null, error: new Error("outage") }));
  await assert.rejects(readAllLedgerRows(async () => ({ data: [{ id: "1" }], error: null })));
});
