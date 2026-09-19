-- ALREADY APPLIED 2026-09-19 (recorded version 20260919013700). Do not re-run.
-- Superseded in part by 20260919013822 (see the owner-lookup fix below).
--
-- Stage 0c: inert foundation for the atomic scheduling writer.
--
-- Nothing here writes a lesson, moves a date, or migrates a curriculum. It adds
-- the audit/snapshot table a future schedule_commit will use, and two READ ONLY
-- functions. Both are declared STABLE, so Postgres refuses a data-modifying
-- statement inside them: proven with a probe, which raised
--   0A000: UPDATE is not allowed in a non-volatile function
-- Read-only is enforced by the engine, not by review.

create table if not exists public.schedule_transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  action text not null,
  goal_ids uuid[] not null default '{}',
  label text,
  impact jsonb not null default '{}'::jsonb,
  preserved jsonb not null default '{}'::jsonb,
  actor text not null default 'parent',
  before_rows jsonb,
  after_version text,
  idempotency_key text,
  created_at timestamptz not null default now(),
  undone_at timestamptz,
  undone_by_transaction_id uuid references public.schedule_transactions(id),
  expires_at timestamptz not null default (now() + interval '30 days')
);

create unique index if not exists schedule_transactions_idempotency_uniq
  on public.schedule_transactions (user_id, idempotency_key)
  where idempotency_key is not null;

create index if not exists schedule_transactions_user_created_idx
  on public.schedule_transactions (user_id, created_at desc);

alter table public.schedule_transactions enable row level security;

create policy schedule_transactions_select on public.schedule_transactions
  for select using (auth.uid() = user_id);

-- No insert/update/delete policy on purpose. Only a future SECURITY DEFINER
-- commit function will write here; clients may read their own history only.

comment on table public.schedule_transactions is
  'Audit + Undo record for consequential scheduling actions. Written only by the future schedule_commit RPC inside the same transaction as the placement changes it describes.';

-- schedule_state_version and schedule_preview were created here; the current
-- definition of schedule_state_version lives in 20260919013822, which fixed a
-- min(uuid) owner lookup that made every call raise 42883.

-- ── schedule_preview (READ ONLY, STABLE) ────────────────────────────────────
-- Returns what is knowable from stored state: scope, how much is movable, what
-- stays untouched, the state version and an expiry.
--
-- It deliberately does NOT return target dates. Those come from the projector
-- in app/lib/scheduler.ts, which must stay a single implementation;
-- reimplementing it in plpgsql would create a second one that can drift. The
-- TypeScript caller adds FROM/TO later and carries state_version to commit.
-- The returned from_to says so rather than pretending.
create or replace function public.schedule_preview(p_action text, p_params jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_goal_ids uuid[];
  v_reset boolean := coalesce((p_params->>'reset_parent_placements')::boolean, false);
  v_version text;
  v_goals jsonb;
  v_movable int; v_pinned int; v_completed int; v_with_work int; v_skipped int; v_undated int;
begin
  if p_action not in ('materialize','recalculate','group_move','rebuild','vacation') then
    raise exception 'unknown action: %', p_action using errcode = '22023';
  end if;

  select array_agg(x::uuid) into v_goal_ids
    from jsonb_array_elements_text(coalesce(p_params->'goal_ids', '[]'::jsonb)) x;

  if v_goal_ids is null or array_length(v_goal_ids, 1) is null then
    raise exception 'goal_ids is required' using errcode = '22023';
  end if;

  if exists (
    select 1 from curriculum_goals
     where id = any(v_goal_ids) and user_id is distinct from auth.uid()
  ) or (select count(*) from curriculum_goals where id = any(v_goal_ids))
      <> array_length(v_goal_ids, 1) then
    raise exception 'permission denied: goals do not belong to the current user'
      using errcode = '42501';
  end if;

  v_version := public.schedule_state_version(v_goal_ids);

  select jsonb_agg(jsonb_build_object(
           'goal_id', g.id, 'name', g.curriculum_name, 'placement_mode', g.placement_mode
         ) order by g.curriculum_name)
    into v_goals from curriculum_goals g where g.id = any(v_goal_ids);

  select
    count(*) filter (
      where not l.completed and not coalesce(l.skipped, false)
        and (l.notes is null or btrim(l.notes) = '') and l.minutes_spent is null
        and (v_reset or not coalesce(l.queue_pinned, false))),
    count(*) filter (where not l.completed and coalesce(l.queue_pinned, false)),
    count(*) filter (where l.completed),
    count(*) filter (where not l.completed
        and ((l.notes is not null and btrim(l.notes) <> '') or l.minutes_spent is not null)),
    count(*) filter (where not l.completed and coalesce(l.skipped, false)),
    count(*) filter (where not l.completed and l.scheduled_date is null)
    into v_movable, v_pinned, v_completed, v_with_work, v_skipped, v_undated
    from lessons l where l.curriculum_goal_id = any(v_goal_ids);

  return jsonb_build_object(
    'action', p_action,
    'what', v_goals,
    'how_much', jsonb_build_object('lessons_to_move', v_movable,
                                   'lessons_without_a_date', v_undated),
    'preserved', jsonb_build_object(
      'parent_placed_lessons', case when v_reset then 0 else v_pinned end,
      'parent_placed_lessons_reset', case when v_reset then v_pinned else 0 end,
      'completed_lessons', v_completed,
      'lessons_with_your_notes', v_with_work,
      'skipped_lessons', v_skipped),
    'from_to', jsonb_build_object('available', false,
      'reason', 'target dates are computed by the scheduler in the application layer'),
    'state_version', v_version,
    'generated_at', now(),
    'expires_at', now() + interval '10 minutes');
end;
$$;

revoke all on function public.schedule_preview(text, jsonb) from public, anon;
grant execute on function public.schedule_preview(text, jsonb) to authenticated, service_role;
