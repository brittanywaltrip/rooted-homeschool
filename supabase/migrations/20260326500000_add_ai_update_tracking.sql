-- Track when free users last generated an AI family update (1/month limit)
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS ai_update_last_generated date;
