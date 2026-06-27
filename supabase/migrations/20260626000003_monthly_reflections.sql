-- One Question a Month: a simple per-user, per-month answer store (month,
-- question, answer). One row per (user, "YYYY-MM"). Owner-only RLS.
CREATE TABLE IF NOT EXISTS public.monthly_reflections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  month text NOT NULL,
  question text NOT NULL,
  answer text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, month)
);

ALTER TABLE public.monthly_reflections ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS monthly_reflections_select_own ON public.monthly_reflections;
CREATE POLICY monthly_reflections_select_own ON public.monthly_reflections
  FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS monthly_reflections_insert_own ON public.monthly_reflections;
CREATE POLICY monthly_reflections_insert_own ON public.monthly_reflections
  FOR INSERT WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS monthly_reflections_update_own ON public.monthly_reflections;
CREATE POLICY monthly_reflections_update_own ON public.monthly_reflections
  FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS monthly_reflections_delete_own ON public.monthly_reflections;
CREATE POLICY monthly_reflections_delete_own ON public.monthly_reflections
  FOR DELETE USING (auth.uid() = user_id);
