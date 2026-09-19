-- Rollback for 20260919021050. Safe while schedule_transactions is empty.
--   select count(*) from schedule_transactions;
alter table public.schedule_transactions drop constraint if exists schedule_transactions_actor_ck;
drop index if exists schedule_transactions_actor_idx;
alter table public.schedule_transactions
  drop column if exists actor_ref,
  drop column if exists actor_user_id,
  drop column if exists actor_type;
drop type if exists actor_type_t;
alter table public.schedule_transactions add column actor text not null default 'parent';
