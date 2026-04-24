-- Per-referral commission amount, captured by the Stripe webhook at the time
-- of conversion (20% × actual amount paid, post-coupon). Supersedes the
-- previous flat-rate assumption. Nullable so pre-migration rows fall through
-- to the $6.63 legacy default in the display endpoints until the backfill
-- script (scripts/backfill-commission-amounts.ts) runs.

ALTER TABLE public.referrals
  ADD COLUMN IF NOT EXISTS commission_amount NUMERIC(10, 2);
