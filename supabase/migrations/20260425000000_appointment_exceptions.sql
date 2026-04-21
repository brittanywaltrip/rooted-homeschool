-- appointment_exceptions — per-occurrence overrides for recurring appointments.
--
-- When a user edits/deletes a single occurrence of a recurring series:
--   - "Edit this occurrence"  → row with override_fields set (skipped=false)
--   - "Delete this occurrence" → row with skipped=true
--
-- expandRecurring() in app/api/appointments/route.ts reads this table at
-- expansion time; matching exceptions either merge their override_fields
-- into the emitted instance or omit it entirely when skipped=true.
--
-- The base appointment row is unchanged. "Edit all future" is handled by
-- capping the base series' end_date and inserting a new appointment — no
-- exception row needed for that path. Exceptions are always scoped to
-- dates that still fall within the base series' active range.

create table if not exists public.appointment_exceptions (
  id uuid primary key default gen_random_uuid(),
  appointment_id uuid not null references public.appointments(id) on delete cascade,
  exception_date date not null,
  override_fields jsonb,
  skipped boolean not null default false,
  created_at timestamptz not null default now(),
  unique (appointment_id, exception_date)
);

alter table public.appointment_exceptions enable row level security;

-- RLS: a user can only touch exceptions for appointments they own. The app
-- server uses the service role (bypasses RLS) so the policies are for
-- defense-in-depth against any future direct-from-client access.

drop policy if exists "appointment_exceptions_select_own" on public.appointment_exceptions;
create policy "appointment_exceptions_select_own" on public.appointment_exceptions
  for select using (
    exists (
      select 1 from public.appointments a
      where a.id = appointment_id and a.user_id = auth.uid()
    )
  );

drop policy if exists "appointment_exceptions_insert_own" on public.appointment_exceptions;
create policy "appointment_exceptions_insert_own" on public.appointment_exceptions
  for insert with check (
    exists (
      select 1 from public.appointments a
      where a.id = appointment_id and a.user_id = auth.uid()
    )
  );

drop policy if exists "appointment_exceptions_update_own" on public.appointment_exceptions;
create policy "appointment_exceptions_update_own" on public.appointment_exceptions
  for update using (
    exists (
      select 1 from public.appointments a
      where a.id = appointment_id and a.user_id = auth.uid()
    )
  );

drop policy if exists "appointment_exceptions_delete_own" on public.appointment_exceptions;
create policy "appointment_exceptions_delete_own" on public.appointment_exceptions
  for delete using (
    exists (
      select 1 from public.appointments a
      where a.id = appointment_id and a.user_id = auth.uid()
    )
  );

create index if not exists idx_appointment_exceptions_appt_date
  on public.appointment_exceptions (appointment_id, exception_date);
