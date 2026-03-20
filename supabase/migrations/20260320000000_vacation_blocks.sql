create table vacation_blocks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users not null,
  name text not null,
  start_date date not null,
  end_date date not null,
  created_at timestamptz default now()
);

alter table vacation_blocks enable row level security;

create policy "Users manage own vacation blocks" on vacation_blocks
  for all using (auth.uid() = user_id);
