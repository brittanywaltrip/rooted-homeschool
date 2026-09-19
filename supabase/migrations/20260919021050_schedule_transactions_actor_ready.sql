-- ALREADY APPLIED 2026-09-19 (recorded version 20260919021050). Do not re-run.
--
-- Stage 0e step 1: actor-ready scheduling history.
--
-- The old column was `actor text not null default 'parent'`. Free text would
-- repeat the mistake already visible in app_events, where 4,509 rows carry
-- actor values that conflate WHO with HOW: 'user' is a principal, 'backfill' is
-- a mechanism, 'drag' is an input method. A column that cannot answer "what
-- kind of principal did this" is useless for the authorization questions child
-- and guardian accounts will eventually ask.
--
-- actor_ref is deliberately NOT a foreign key. A child or delegate may never be
-- an auth.users row, and a FK would permanently encode "an actor is an
-- account", which is the assumption this migration exists to avoid.
--
-- Display names are deliberately absent; they are resolved at read time.
-- memory_comments and memory_reactions each carry TWO name columns that have
-- drifted apart. Immutable history must not repeat that.
--
-- schedule_transactions was empty, so this is a pure schema change.

create type actor_type_t as enum ('parent', 'system');

comment on type actor_type_t is
  'Kind of principal that performed a scheduling action. Future values, deliberately NOT added yet: guardian (another authorized adult), child (a dependent account acting in permitted scope), delegate (a scoped grant such as a tutor or co-op leader). Adding a value later is a one-line migration; un-conflating free text after a year of history is not.';

alter table public.schedule_transactions drop column if exists actor;

alter table public.schedule_transactions
  add column actor_type actor_type_t not null default 'parent',
  add column actor_user_id uuid references auth.users(id) on delete set null,
  add column actor_ref text;

-- A parent action must name its account. A system action must name its job and
-- must not claim an account.
alter table public.schedule_transactions
  add constraint schedule_transactions_actor_ck
  check (
    (actor_type = 'parent' and actor_user_id is not null)
    or (actor_type = 'system' and actor_user_id is null and actor_ref is not null)
  );

create index if not exists schedule_transactions_actor_idx
  on public.schedule_transactions (actor_type, actor_user_id);

comment on column public.schedule_transactions.actor_type is
  'Kind of principal. parent | system today.';
comment on column public.schedule_transactions.actor_user_id is
  'The authenticated account, when the actor has one. ON DELETE SET NULL so history survives a co-parent deleting their account; the owning family is schedule_transactions.user_id, which still cascades.';
comment on column public.schedule_transactions.actor_ref is
  'Stable non-auth handle for an actor with no auth account: a job name such as cron:expire-subscriptions today, later a children.id or invite key. Not a FK on purpose.';
