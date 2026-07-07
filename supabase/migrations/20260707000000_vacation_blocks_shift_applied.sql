-- Persist whether a break's creation pushed lessons forward.
-- Set true only when the user chose "shift forward" AND the break spanned at
-- least one teaching day. Read back when a break is opened so the delete flow
-- can offer to move those lessons back into the freed days. Additive column
-- only, defaults false, no data rewrite (does not touch lessons; safe per
-- Anti-pattern H in docs/CURRICULUM-SCHEDULING.md).
ALTER TABLE public.vacation_blocks
  ADD COLUMN IF NOT EXISTS shift_applied boolean NOT NULL DEFAULT false;
