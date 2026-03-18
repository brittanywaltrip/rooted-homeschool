-- Create ai_usage table for tracking per-user monthly AI generation counts
create table if not exists ai_usage (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references profiles(id) on delete cascade not null,
  month text not null, -- format: YYYY-MM
  count integer not null default 0,
  updated_at timestamptz not null default now(),
  constraint ai_usage_user_month_unique unique (user_id, month)
);

-- Enable RLS
alter table ai_usage enable row level security;

-- Users can only see their own usage
create policy "Users can view own ai_usage"
  on ai_usage for select
  using (auth.uid() = user_id);

-- Service role handles inserts/updates via API routes
