-- Free-form note displayed on partner + admin dashboards in place of the
-- default "Paid subscriber" / "Free user" status when set. Originally added
-- via the Supabase MCP for the "Amber's dashboard shows Grace's story" use
-- case; this migration captures the column in the repo so future clones
-- line up with prod. Idempotent — no-op if the column already exists.

ALTER TABLE public.referrals
  ADD COLUMN IF NOT EXISTS commission_note TEXT;
