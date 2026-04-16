-- Transcript Builder: settings + courses tables
-- Phase 1: Database migration only (no UI)

-- Table 1: transcript_settings — one row per child
CREATE TABLE transcript_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  child_id uuid NOT NULL REFERENCES children(id) ON DELETE CASCADE,
  school_name text,
  state text,
  graduation_year int,
  use_weighted_gpa boolean DEFAULT false,
  grading_scale jsonb DEFAULT '{"A+":4.0,"A":4.0,"A-":3.7,"B+":3.3,"B":3.0,"B-":2.7,"C+":2.3,"C":2.0,"C-":1.7,"D+":1.3,"D":1.0,"D-":0.7,"F":0.0}'::jsonb,
  principal_name text,
  notes text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE UNIQUE INDEX idx_transcript_settings_child ON transcript_settings(child_id);
CREATE INDEX idx_transcript_settings_user ON transcript_settings(user_id);

-- Table 2: transcript_courses — one row per course per child per school year
CREATE TABLE transcript_courses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  child_id uuid NOT NULL REFERENCES children(id) ON DELETE CASCADE,
  school_year text NOT NULL,
  grade_level text,
  course_name text NOT NULL,
  subject_category text NOT NULL DEFAULT 'other',
  credit_type text NOT NULL DEFAULT 'standard',
  credits_earned decimal DEFAULT 1.0,
  hours_logged int,
  grade_letter text,
  grade_percentage decimal,
  grade_points decimal,
  semester text DEFAULT 'full_year',
  course_description text,
  curriculum_goal_id uuid REFERENCES curriculum_goals(id) ON DELETE SET NULL,
  is_external boolean DEFAULT false,
  external_provider text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX idx_transcript_courses_child ON transcript_courses(child_id);
CREATE INDEX idx_transcript_courses_user ON transcript_courses(user_id);
CREATE INDEX idx_transcript_courses_year ON transcript_courses(child_id, school_year);
CREATE INDEX idx_transcript_courses_goal ON transcript_courses(curriculum_goal_id);

-- CHECK constraints for enum-like columns
ALTER TABLE transcript_courses ADD CONSTRAINT chk_subject_category
  CHECK (subject_category IN ('english', 'math', 'science', 'social_studies', 'foreign_language', 'electives', 'life_skills', 'pe', 'arts', 'technology', 'bible', 'other'));

ALTER TABLE transcript_courses ADD CONSTRAINT chk_credit_type
  CHECK (credit_type IN ('standard', 'honors', 'ap', 'dual_enrollment', 'co_op', 'life_skills'));

ALTER TABLE transcript_courses ADD CONSTRAINT chk_semester
  CHECK (semester IN ('full_year', 'semester_1', 'semester_2'));

-- RLS Policies
ALTER TABLE transcript_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE transcript_courses ENABLE ROW LEVEL SECURITY;

-- transcript_settings policies
CREATE POLICY "Users can view own transcript settings"
  ON transcript_settings FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own transcript settings"
  ON transcript_settings FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own transcript settings"
  ON transcript_settings FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own transcript settings"
  ON transcript_settings FOR DELETE
  USING (auth.uid() = user_id);

-- transcript_courses policies
CREATE POLICY "Users can view own transcript courses"
  ON transcript_courses FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own transcript courses"
  ON transcript_courses FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own transcript courses"
  ON transcript_courses FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own transcript courses"
  ON transcript_courses FOR DELETE
  USING (auth.uid() = user_id);
