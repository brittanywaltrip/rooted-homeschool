-- Add missing columns to affiliates table
ALTER TABLE public.affiliates ADD COLUMN IF NOT EXISTS contact_email TEXT;
ALTER TABLE public.affiliates ADD COLUMN IF NOT EXISTS commission_rate INTEGER DEFAULT 20;
ALTER TABLE public.affiliates ADD COLUMN IF NOT EXISTS stripe_api_id TEXT;
ALTER TABLE public.affiliates ADD COLUMN IF NOT EXISTS notes TEXT;

-- Add referral tracking to profiles
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS referred_by TEXT;

-- Referrals ledger
CREATE TABLE IF NOT EXISTS public.referrals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  affiliate_code TEXT NOT NULL,
  user_id uuid REFERENCES profiles(id) ON DELETE CASCADE,
  stripe_session_id TEXT,
  converted BOOLEAN DEFAULT false,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE public.referrals ENABLE ROW LEVEL SECURITY;

-- Admin-only access to referrals
CREATE POLICY "Service role full access on referrals"
  ON public.referrals FOR ALL
  USING (true)
  WITH CHECK (true);
