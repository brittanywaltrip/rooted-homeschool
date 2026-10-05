# Complete partner roster accounting — September 30, 2026

## Before and after

CC's #135 rehearsal found three follow-ups: the roster ignored read errors and some lifetime reads stopped at the server row limit; inactive partners with money owed had no payout card; and the roster's next-payout banner showed only current-month earnings, excluding older unpaid months.

The roster now reads affiliates, referred profiles, converted referrals, payments and applications with stable-id pagination, including smaller server pages. Profile enrichment is batched and paginated. All database read failures, including later pages, return 503 without a partial balance response. Account-lookup outages also refuse the response; a legitimately deleted account (404) retains its financial ledger. Existing authentication and admin email checks remain before database reads. No access policy or payment-writing code changes.

Both admin views use the existing shared payout calculation from #135. The banner is now **Payable now**, showing all unpaid closed months; pending amounts and their next eligibility date are separate. Lifetime conversion counts come from the ledger, not the capped activity feed. Monthly cells and summaries sum currency in cents. Legacy estimates are flagged. The activity feed remains intentionally limited to 100 recent entries and is never used for lifetime totals.

Inactive partners remain visible on payout cards when they have payable or pending balances. Inactive partners with no outstanding balance are omitted; active partners still appear when paid in full. The cards label inactive status.

The roster hides its payment controls and balances while loading and after a failed or incomplete response, with a retry screen instead of zeros or stale figures. Its client month fallback now uses Pacific time, matching the server. Existing route responses use no-store headers.

## Production read-only cross-check

Production's current recorded ledger contains 13 active partners, 7 conversions, no legacy estimates, $53.32 earned and $53.32 recorded paid across four payment records. Per-partner lifetime outstanding balances total $0.00. Earnings dated before October 2026, less recorded payments, also total $0.00 outstanding for October 1. The latest recorded payment is August 1, 2026 at 17:21:14 UTC.

This confirms the saved morning audit. It does not establish bank/PayPal settlement, and no payment record was added. Repeat the reconciliation after September closes at midnight Pacific and before making any payment, since new conversions may arrive.

## Validation and limits

19 additional tests cover roster/card agreement, older unpaid months, separate pending earnings, Pacific month closing, inactive balances, legacy estimates, cent math, deleted accounts and refused partial reads. The actual roster handler is exercised with 1,205 referrals, profiles and payments, including a server cap of 37 rows per page. It also refuses each source-table failure and a later-page payment failure. Admin authorization runs before any ledger read.

Focused commission/roster/payout suite: 49 passed. Full suite: 2,002 passed, 0 failed, 8 skipped. TypeScript and targeted helper/route lint pass. The two admin pages retain four existing next/no-img-element warnings; there are no new lint errors. React review checked hook ordering, explicit loading/error states and independent server-read batching. Signed-in browser behavior still requires staging verification.

This follows #135 and is based on its exact b9428cf9 commit. #135 itself was not changed. The patch keeps its existing accounting policy: earning months use referral created_at, not a dedicated conversion timestamp, and refunds/provider settlement are outside this recorded-ledger balance calculation. It is not a certification of all commission attribution or refund handling.

## CC staging handoff

After finishing #136/#137, deploy this exact branch on rooted-staging and verify health/database identity before making fixtures. Check admin access and ordinary-family/public refusal. Use synthetic partners covering active, inactive-but-owed, inactive-paid, partial payment, overpayment, current-month pending, older unpaid months and missing commission estimates.

Verify payout cards, roster rows, monthly cells, lifetime conversions, payable banner and pending line agree. Exercise more than 1,000 rows and a later-page failure. Confirm a failed refresh removes stale balances and payment controls; retry restores the complete view. Verify the browser around Pacific month rollover. Never record a real payment or send an email from a fixture. Remove all synthetic data/logins afterward and run smoke against the exact deployment.

Release after #135 and the staged verification of this follow-up. No production write, merge, payout, customer email or deployment was performed while preparing it.
