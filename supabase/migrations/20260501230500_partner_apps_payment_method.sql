-- partner_apps gains a payment_method column. The application form
-- now lets applicants pick PayPal, Venmo, Zelle, Mercury (ACH), or
-- Other; the destination address still goes into paypal_email (kept
-- as the column name to avoid schema churn). IF NOT EXISTS so this is
-- safe to apply against environments where the column already exists.

ALTER TABLE public.partner_apps
  ADD COLUMN IF NOT EXISTS payment_method TEXT;
