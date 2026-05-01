-- commission_payments was created with two policies:
--   * "Affiliates can view own payments" (SELECT, owner via affiliates.user_id)
--   * "Service role full access on commission_payments" (ALL)
--
-- The browser-side Settings page (affiliate dashboard + admin preview)
-- needs an additional read scope so admins can preview another
-- affiliate's payments without going through the service role. This
-- adds a SELECT policy that grants:
--   1. The owning affiliate (same condition as the existing owner
--      policy; safe to coexist since multiple SELECT policies are OR'd).
--   2. Admin emails (so the in-app "preview affiliate view" modal in
--      Settings -> Partners works for the admin user).
-- The service-role write policy stays untouched.

CREATE POLICY "Affiliates and admins can read commission payments"
ON public.commission_payments
FOR SELECT
TO authenticated
USING (
  affiliate_code IN (
    SELECT code FROM public.affiliates WHERE user_id = auth.uid()
  )
  OR
  (auth.jwt() ->> 'email') IN (
    'garfieldbrittany@gmail.com',
    'christopherwaltrip@gmail.com',
    'hello@rootedhomeschoolapp.com'
  )
);
