-- Partner application submissions from /partners page
CREATE TABLE IF NOT EXISTS partner_applications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  first_name text NOT NULL,
  last_name text NOT NULL,
  email text NOT NULL,
  platforms text[] DEFAULT '{}',
  platform_links jsonb DEFAULT '{}',
  platform_sizes jsonb DEFAULT '{}',
  about_journey text DEFAULT '',
  what_share text DEFAULT '',
  used_rooted text DEFAULT '',
  post_frequency text DEFAULT '',
  paypal_email text DEFAULT '',
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'declined')),
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE partner_applications ENABLE ROW LEVEL SECURITY;

-- Admin can read/update all applications
CREATE POLICY IF NOT EXISTS "Admin can read applications"
  ON partner_applications FOR SELECT TO authenticated
  USING (auth.jwt() ->> 'email' IN (
    'garfieldbrittany@gmail.com', 'christopherwaltrip@gmail.com', 'hello@rootedhomeschoolapp.com'
  ));

CREATE POLICY IF NOT EXISTS "Admin can update applications"
  ON partner_applications FOR UPDATE TO authenticated
  USING (auth.jwt() ->> 'email' IN (
    'garfieldbrittany@gmail.com', 'christopherwaltrip@gmail.com', 'hello@rootedhomeschoolapp.com'
  ));

-- The API route inserts using service role key, so no INSERT policy needed for anon
-- But add one for the server-side service role just in case
CREATE POLICY IF NOT EXISTS "Service can insert applications"
  ON partner_applications FOR INSERT TO authenticated
  WITH CHECK (true);
