-- Idempotency guard for the one-off Monthly announcement send
-- (app/api/admin/announce-monthly). One row per family we have sent the
-- announcement to. The send route inserts the row BEFORE sending and deletes
-- it again if the send fails, so a re-run only re-attempts failures and never
-- double-mails anyone. Service-role only (the route uses the service key);
-- RLS is enabled with no policies so anon/authenticated get no access, matching
-- email_suppressions.
CREATE TABLE IF NOT EXISTS public.announce_monthly_sends (
  user_id uuid PRIMARY KEY REFERENCES auth.users (id) ON DELETE CASCADE,
  sent_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.announce_monthly_sends ENABLE ROW LEVEL SECURITY;
