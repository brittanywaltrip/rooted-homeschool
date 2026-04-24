-- Pin profiles.plan_type to the documented enum so the out-of-band value
-- 'partner_comp' (written by the pre-fix handleCompAccount handler) can't
-- silently come back. The helper lib/comp-partner.ts + the rewired
-- partner-action route are the primary fix — this constraint is the
-- belt-and-suspenders guard.
--
-- Valid values per CLAUDE.md:
--   NULL            → free user
--   founding_family → Rooted+ $39/yr (founding window) AND comped partners
--   standard        → Rooted+ $59/yr (post-founding window)
--   monthly         → Rooted+ $6.99/mo
--   gift            → 12-month family gift extension
--
-- Pre-step heals any lingering 'partner_comp' rows so the constraint can
-- apply without conflict. Expected to affect 0 rows after the morning
-- Amanda Potts cleanup; included here so the migration is idempotent on
-- any snapshot.

UPDATE public.profiles
   SET plan_type = 'founding_family'
 WHERE plan_type = 'partner_comp';

-- Drop first in case a prior attempt left a partially-applied constraint.
ALTER TABLE public.profiles
  DROP CONSTRAINT IF EXISTS plan_type_valid;

ALTER TABLE public.profiles
  ADD CONSTRAINT plan_type_valid
    CHECK (plan_type IS NULL OR plan_type IN ('founding_family', 'standard', 'monthly', 'gift'));
