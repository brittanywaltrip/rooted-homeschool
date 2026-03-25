-- RLS policies for admin resource management
ALTER TABLE resources ENABLE ROW LEVEL SECURITY;

-- Everyone can read active resources (the app needs this)
CREATE POLICY IF NOT EXISTS "Everyone can read resources"
  ON resources FOR SELECT TO authenticated
  USING (true);

-- Also allow anonymous/public read for any non-auth contexts
CREATE POLICY IF NOT EXISTS "Public can read resources"
  ON resources FOR SELECT TO anon
  USING (true);

-- Admin users can insert resources
CREATE POLICY IF NOT EXISTS "Admin can insert resources"
  ON resources FOR INSERT TO authenticated
  WITH CHECK (auth.jwt() ->> 'email' IN (
    'garfieldbrittany@gmail.com',
    'hello@rootedhomeschoolapp.com',
    'christopherwaltrip@gmail.com'
  ));

-- Admin users can update resources
CREATE POLICY IF NOT EXISTS "Admin can update resources"
  ON resources FOR UPDATE TO authenticated
  USING (auth.jwt() ->> 'email' IN (
    'garfieldbrittany@gmail.com',
    'hello@rootedhomeschoolapp.com',
    'christopherwaltrip@gmail.com'
  ));

-- Admin users can delete resources
CREATE POLICY IF NOT EXISTS "Admin can delete resources"
  ON resources FOR DELETE TO authenticated
  USING (auth.jwt() ->> 'email' IN (
    'garfieldbrittany@gmail.com',
    'hello@rootedhomeschoolapp.com',
    'christopherwaltrip@gmail.com'
  ));
