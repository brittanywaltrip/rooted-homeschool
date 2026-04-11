-- Add missing columns to partner_applications
ALTER TABLE public.partner_applications ADD COLUMN IF NOT EXISTS rooted_account_email TEXT;
ALTER TABLE public.partner_applications ADD COLUMN IF NOT EXISTS has_rooted_account BOOLEAN DEFAULT false;
ALTER TABLE public.partner_applications ADD COLUMN IF NOT EXISTS social_handle TEXT;
ALTER TABLE public.partner_applications ADD COLUMN IF NOT EXISTS audience_size TEXT;
ALTER TABLE public.partner_applications ADD COLUMN IF NOT EXISTS why_rooted TEXT;
ALTER TABLE public.partner_applications ADD COLUMN IF NOT EXISTS reviewed_at TIMESTAMPTZ;
ALTER TABLE public.partner_applications ADD COLUMN IF NOT EXISTS notes TEXT;
