-- ============================================================
-- Cleanup: delete all lessons belonging to test accounts
-- Only the real user account (f30ede7e-ad40-42a9-a134-8fd70932ba0f)
-- should have lessons in production.
-- Run this once in your Supabase SQL Editor.
-- ============================================================

delete from public.lessons
where user_id != 'f30ede7e-ad40-42a9-a134-8fd70932ba0f';
