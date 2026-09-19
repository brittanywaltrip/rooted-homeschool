-- ALREADY APPLIED 2026-09-19 (recorded version 20260919015230). Do not re-run.
-- The schedule_seal_proposal body was superseded by 20260919015417.
--
-- Stage 0d: the sealed proposal.
--
-- state_version proves the world has not moved. It does NOT prove the proposal
-- being committed is the proposal Mom confirmed: the same lesson set with
-- different target dates hashes the same world. The seal closes that.
--
-- The server stores a SHA-256 of the canonical proposal and the confirmation
-- facts it computed itself. The client holds only an opaque preview_id and
-- cannot write this table, so recomputing a hash after altering a destination
-- achieves nothing: commit compares against the STORED hash.
--
-- OPERATIONAL METADATA ONLY. No scheduler path reads it, it holds no date any
-- projection consumes, and deleting every row changes no family's schedule.
--
-- Consumption is NOT implemented. consumed_at / consumed_by_transaction_id
-- exist for the future schedule_commit; nothing here sets them.

create table if not exists public.schedule_proposals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  action text not null,
  goal_ids uuid[] not null,
  proposal_hash text not null,
  canonical_form text not null,
  state_version text not null,
  confirmation_facts jsonb not null,
  placement_count int not null,
  reset_parent_placements boolean not null default false,
  become_authoritative boolean not null default false,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '15 minutes'),
  consumed_at timestamptz,
  consumed_by_transaction_id uuid,
  constraint schedule_proposals_action_ck
    check (action in ('materialize','recalculate','group_move','rebuild','vacation')),
  constraint schedule_proposals_hash_ck check (proposal_hash ~ '^[0-9a-f]{64}$'),
  constraint schedule_proposals_goals_ck check (array_length(goal_ids, 1) between 1 and 200),
  constraint schedule_proposals_count_ck check (placement_count between 0 and 5000),
  constraint schedule_proposals_consumed_ck
    check ((consumed_at is null) = (consumed_by_transaction_id is null))
);

create index if not exists schedule_proposals_user_created_idx
  on public.schedule_proposals (user_id, created_at desc);
create index if not exists schedule_proposals_expiry_idx
  on public.schedule_proposals (expires_at) where consumed_at is null;

alter table public.schedule_proposals enable row level security;

-- Owner may READ. No insert/update/delete policy exists, so RLS matches no row
-- for those commands: a client UPDATE or DELETE affects ZERO rows rather than
-- raising. Verified by row_count, not by absence of an exception.
create policy schedule_proposals_select on public.schedule_proposals
  for select using (auth.uid() = user_id);

comment on table public.schedule_proposals is
  'Short-lived sealed scheduling proposals. Operational metadata only: no scheduler path reads it and deleting a row cannot change any schedule. Written solely by schedule_seal_proposal.';

-- ── canonicalization ────────────────────────────────────────────────────────
--   line 0  "v1"
--   line 1  action
--   line 2  goal_ids sorted ascending, comma joined
--   line 3  reset_parent_placements        true|false
--   line 4  become_authoritative           true|false
--   line 5+ one line per placement, SORTED BY lesson_id:
--           lesson_id|scheduled_date|queue_position|queue_pinned
--
-- NULL renders as the sentinel '~'. A real value can never render as '~'
-- because dates are YYYY-MM-DD, integers are digits and booleans are
-- true/false, so "absent" and "null" cannot collide with a real value.
create or replace function public.schedule_canonicalize_proposal(
  p_action text, p_goal_ids uuid[], p_placements jsonb,
  p_reset_parent_placements boolean, p_become_authoritative boolean
) returns text
language sql immutable
as $$
  select
    'v1' || e'\n' || p_action || e'\n'
    || coalesce((select string_agg(g::text, ',' order by g::text) from unnest(p_goal_ids) g), '') || e'\n'
    || (case when coalesce(p_reset_parent_placements,false) then 'true' else 'false' end) || e'\n'
    || (case when coalesce(p_become_authoritative,false) then 'true' else 'false' end)
    || coalesce((
         select e'\n' || string_agg(line, e'\n' order by sort_key)
         from (
           select (e->>'lesson_id') as sort_key,
             (e->>'lesson_id')
               || '|' || coalesce(nullif(e->>'scheduled_date',''), '~')
               || '|' || coalesce(nullif(e->>'queue_position',''), '~')
               || '|' || (case when e->'queue_pinned' is null
                                 or jsonb_typeof(e->'queue_pinned') = 'null' then '~'
                               when (e->>'queue_pinned')::boolean then 'true'
                               else 'false' end) as line
           from jsonb_array_elements(coalesce(p_placements, '[]'::jsonb)) e
         ) s), '');
$$;

revoke all on function public.schedule_canonicalize_proposal(text, uuid[], jsonb, boolean, boolean) from public, anon;
grant execute on function public.schedule_canonicalize_proposal(text, uuid[], jsonb, boolean, boolean) to authenticated, service_role;

-- schedule_seal_proposal was created here; its current body lives in
-- 20260919015417, which added an explicit missing-lesson_id check.
