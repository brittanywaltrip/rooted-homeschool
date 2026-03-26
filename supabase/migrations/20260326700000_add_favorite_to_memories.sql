-- Add favorite column to memories table
ALTER TABLE memories ADD COLUMN IF NOT EXISTS favorite boolean DEFAULT false;
