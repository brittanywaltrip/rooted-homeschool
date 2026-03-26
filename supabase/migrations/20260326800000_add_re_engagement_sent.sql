-- Add re_engagement_sent column to profiles for tracking re-engagement emails
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS re_engagement_sent boolean DEFAULT false;
