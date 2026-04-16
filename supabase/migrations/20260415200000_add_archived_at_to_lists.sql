-- Add archived_at column for soft-delete with 30-day recovery
ALTER TABLE lists ADD COLUMN archived_at TIMESTAMPTZ;
