-- Add school start time to profiles for optional time display on Today page
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS school_start_time TIME DEFAULT NULL;
