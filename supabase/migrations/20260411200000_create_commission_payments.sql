CREATE TABLE IF NOT EXISTS public.commission_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  affiliate_code TEXT NOT NULL,
  amount DECIMAL(10,2) NOT NULL,
  month TEXT NOT NULL,
  paid_at TIMESTAMPTZ DEFAULT now(),
  paypal_email TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE public.commission_payments ENABLE ROW LEVEL SECURITY;

-- Affiliates can see their own payments
CREATE POLICY "Affiliates can view own payments"
  ON public.commission_payments FOR SELECT TO authenticated
  USING (
    affiliate_code IN (
      SELECT code FROM public.affiliates WHERE user_id = auth.uid()
    )
  );

-- Service role has full access
CREATE POLICY "Service role full access on commission_payments"
  ON public.commission_payments FOR ALL
  USING (true)
  WITH CHECK (true);
