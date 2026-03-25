-- ============================================================
-- Migration: Fix RLS policies on resources table
-- Problem:   Admin UI cannot save new resources or edits because
--            existing policies only allowed a single email.
-- ============================================================

-- Drop the old, single-email policies
DROP POLICY IF EXISTS "Public read active resources"   ON public.resources;
DROP POLICY IF EXISTS "Admin read all resources"        ON public.resources;
DROP POLICY IF EXISTS "Admin insert resources"          ON public.resources;
DROP POLICY IF EXISTS "Admin update resources"          ON public.resources;
DROP POLICY IF EXISTS "Admin delete resources"          ON public.resources;

-- Ensure RLS is enabled (idempotent)
ALTER TABLE public.resources ENABLE ROW LEVEL SECURITY;

-- Any authenticated user can read resources
CREATE POLICY "Everyone can read resources"
  ON public.resources FOR SELECT
  TO authenticated
  USING (true);

-- Admin emails that can write
CREATE POLICY "Admin can insert resources"
  ON public.resources FOR INSERT
  TO authenticated
  WITH CHECK (
    auth.jwt() ->> 'email' IN (
      'garfieldbrittany@gmail.com',
      'hello@rootedhomeschoolapp.com',
      'christopherwaltrip@gmail.com'
    )
  );

CREATE POLICY "Admin can update resources"
  ON public.resources FOR UPDATE
  TO authenticated
  USING (
    auth.jwt() ->> 'email' IN (
      'garfieldbrittany@gmail.com',
      'hello@rootedhomeschoolapp.com',
      'christopherwaltrip@gmail.com'
    )
  );

CREATE POLICY "Admin can delete resources"
  ON public.resources FOR DELETE
  TO authenticated
  USING (
    auth.jwt() ->> 'email' IN (
      'garfieldbrittany@gmail.com',
      'hello@rootedhomeschoolapp.com',
      'christopherwaltrip@gmail.com'
    )
  );
