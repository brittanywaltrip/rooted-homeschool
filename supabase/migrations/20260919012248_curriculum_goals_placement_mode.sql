-- ALREADY APPLIED 2026-09-19 (recorded version 20260919012248). Do not re-run.
--
-- Stage 0b: placement authority marker.
--
-- Today currently PROJECTS a schedule and rewrites lessons.scheduled_date on
-- every page load; Plan READS scheduled_date. Two derivations of one fact.
-- The transition to one writer is per curriculum, not global, because a global
-- flip would replace "start today" with months-old stored dates for the 1,703
-- dormant goals measured in Stage 0a.
--
-- legacy_projection : Today projects, exactly as today. Existing behaviour.
-- authoritative     : lessons.scheduled_date is the single source of truth and
--                     page load may only VERIFY it, never rewrite it.
--
-- Every existing curriculum stays legacy_projection. Nothing is migrated here,
-- no dates are touched, no lessons are repaired. The authoritative branch is
-- dead on arrival by construction.

create type placement_mode_t as enum ('legacy_projection', 'authoritative');

alter table public.curriculum_goals
  add column placement_mode placement_mode_t not null default 'legacy_projection',
  add column placement_migrated_at timestamptz;

comment on column public.curriculum_goals.placement_mode is
  'legacy_projection: Today projects placement and may rewrite the scheduled_date cache. authoritative: lessons.scheduled_date is the single source of truth; page load verifies only and never writes. Set only by an explicit parent scheduling action.';

comment on column public.curriculum_goals.placement_migrated_at is
  'When this curriculum crossed to authoritative placement. Null while legacy.';

-- A curriculum that has crossed must record when. Keeps the marker auditable
-- and makes an accidental bulk flip visible rather than silent.
alter table public.curriculum_goals
  add constraint curriculum_goals_placement_migrated_at_ck
  check (
    (placement_mode = 'legacy_projection' and placement_migrated_at is null)
    or (placement_mode = 'authoritative' and placement_migrated_at is not null)
  );

create index if not exists curriculum_goals_placement_mode_idx
  on public.curriculum_goals (placement_mode)
  where placement_mode = 'authoritative';
