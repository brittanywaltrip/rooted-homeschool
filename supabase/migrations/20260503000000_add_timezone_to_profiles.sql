-- Adds timezone (IANA, e.g. America/New_York) to profiles.
-- Default for existing rows is America/New_York. New rows: detected
-- client-side from Intl.DateTimeFormat().resolvedOptions().timeZone on
-- first save (handled in app code, not here).
--
-- This is required by Invariant 9 in docs/CURRICULUM-SCHEDULING.md.
-- The scheduler reads this column to compute "today" in the user's
-- local timezone instead of UTC.

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS timezone text NOT NULL DEFAULT 'America/New_York';

-- Sanity constraint: must be a non-empty IANA-style string (rough check).
ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_timezone_format
    CHECK (timezone ~ '^[A-Za-z]+(/[A-Za-z_]+)+$' OR timezone = 'UTC');

COMMENT ON COLUMN public.profiles.timezone IS
  'IANA timezone (e.g. America/New_York). Used by the scheduler to compute "today" in the user''s local time. Default America/New_York for legacy users; new users are populated from Intl.DateTimeFormat on first profile save.';
