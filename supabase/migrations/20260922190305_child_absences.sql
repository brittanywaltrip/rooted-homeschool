-- child_absences: a day one child was out (a sick day), for the Hours &
-- Attendance report only.
--
-- LEDGER: applied to rooted-staging as 20260922190305 (child_absences) plus
-- 20260922190511 (child_absences_tighten_grants, the final REVOKE below).
-- NOT YET APPLIED TO PRODUCTION. When it is, apply this whole file as one
-- migration named child_absences and rename this file to the production
-- version, per CLAUDE.md "Filenames do not match the migration ledger".
--
-- A break in Plan (vacation_blocks) has no child and pauses the whole
-- family's lessons, so it prints on every child's report. A parent recording
-- one child's sick day needs it on that child's report alone. This table is
-- that record. Nothing that schedules lessons reads it (enforced by
-- lib/reports-evidence-wiring.test.ts): it never moves, skips, completes or
-- hides a lesson, and it never changes Days Present.
--
-- Owner-only, like vacation_blocks. Both foreign keys cascade so deleting the
-- account or the child cannot fail on these rows (see the vacation_blocks
-- NO ACTION incident in app/api/account/delete/route.ts).

create table public.child_absences (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  child_id uuid not null references public.children(id) on delete cascade,
  start_date date not null,
  end_date date not null,
  reason text not null default 'Sick day',
  created_at timestamptz not null default now(),
  constraint child_absences_range check (start_date <= end_date),
  constraint child_absences_reason_len check (char_length(btrim(reason)) between 1 and 80)
);

create index child_absences_user_start_idx on public.child_absences (user_id, start_date);

alter table public.child_absences enable row level security;

-- The child must belong to the same family as the row's owner.
create policy "Owners manage their children's absences" on public.child_absences
  for all to authenticated
  using ((select auth.uid()) = user_id)
  with check (
    (select auth.uid()) = user_id
    and exists (select 1 from public.children c where c.id = child_id and c.user_id = (select auth.uid()))
  );

revoke all on public.child_absences from anon;
grant select, insert, update, delete on public.child_absences to authenticated;
-- Default privileges also hand authenticated TRUNCATE, REFERENCES and TRIGGER.
-- TRUNCATE ignores row level security, so take all three back.
revoke truncate, references, trigger on public.child_absences from authenticated;
