-- Year archive foundation: tag yearbook content by school year,
-- store year-end snapshots, and persist per-child completion certificates.

ALTER TABLE yearbook_content
  ADD COLUMN IF NOT EXISTS school_year_id uuid REFERENCES school_years(id) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS school_year_archives (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  school_year_id uuid NOT NULL REFERENCES school_years(id) ON DELETE CASCADE,
  year_name text NOT NULL,
  start_date date NOT NULL,
  end_date date NOT NULL,
  closed_at timestamptz NOT NULL DEFAULT now(),
  stats jsonb NOT NULL DEFAULT '{}',
  per_child_data jsonb NOT NULL DEFAULT '[]',
  garden_snapshot jsonb NOT NULL DEFAULT '[]',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(school_year_id)
);

ALTER TABLE school_year_archives ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own year archives"
  ON school_year_archives FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

GRANT SELECT ON school_year_archives TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON school_year_archives TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON school_year_archives TO service_role;

CREATE TABLE IF NOT EXISTS year_archive_certificates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  school_year_id uuid NOT NULL REFERENCES school_years(id) ON DELETE CASCADE,
  child_id uuid NOT NULL REFERENCES children(id) ON DELETE CASCADE,
  child_name text NOT NULL,
  grade_completed text NOT NULL,
  grade_advancing_to text,
  school_name text,
  completion_date date NOT NULL DEFAULT CURRENT_DATE,
  certificate_url text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(school_year_id, child_id)
);

ALTER TABLE year_archive_certificates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own certificates"
  ON year_archive_certificates FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

GRANT SELECT ON year_archive_certificates TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON year_archive_certificates TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON year_archive_certificates TO service_role;
