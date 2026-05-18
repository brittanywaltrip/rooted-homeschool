-- Per-occurrence completion tracking for recurring appointments.
--
-- One-time appointments already record completion on appointments.completed.
-- Recurring instances have no row of their own — they're synthesized at read
-- time by expandRecurring() in /api/appointments. To mark a single occurrence
-- complete without touching the base series, we store the flag here on the
-- per-date exception row. expandRecurring() reads it alongside skipped and
-- override_fields and overlays it onto the emitted instance.

ALTER TABLE public.appointment_exceptions
  ADD COLUMN IF NOT EXISTS completed boolean NOT NULL DEFAULT false;
