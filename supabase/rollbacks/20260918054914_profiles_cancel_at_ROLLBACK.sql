-- ROLLBACK for 20260918054914_profiles_cancel_at.sql
--
-- NOT NEEDED FOR A CODE ROLLBACK. An unused nullable column is completely inert,
-- so reverting the deploy is sufficient on its own and leaving cancel_at in place
-- is the recommended stopping point. Run this only if you want the column gone.
--
-- Order matters: the guard function must stop referencing cancel_at BEFORE the
-- column is dropped, or the trigger raises on the next profiles write.
--
-- Do NOT confuse this with supabase/rollbacks/20260917000000_security_fix_1_ROLLBACK.sql.
-- That one reopens the entitlement exploit and must not be run as part of this.

-- ── Step 1: restore the pre-Phase-2 guard body (cancel_at removed) ────────
create or replace function public.guard_profile_entitlement()
returns trigger
language plpgsql
security invoker
set search_path = public
as $fn$
begin
  if current_user not in ('authenticated', 'anon') then
    return new;
  end if;

  if tg_op = 'UPDATE' then
    if new.is_pro                   is distinct from old.is_pro
    or new.plan_type                is distinct from old.plan_type
    or new.subscription_status      is distinct from old.subscription_status
    or new.stripe_customer_id       is distinct from old.stripe_customer_id
    or new.stripe_subscription_id   is distinct from old.stripe_subscription_id
    or new.current_period_end       is distinct from old.current_period_end
    or new.subscription_end_date    is distinct from old.subscription_end_date
    or new.trial_started_at         is distinct from old.trial_started_at
    or new.legacy_free              is distinct from old.legacy_free
    or new.referred_by              is distinct from old.referred_by
    or new.photo_count              is distinct from old.photo_count
    or new.yearly_review_count      is distinct from old.yearly_review_count
    or new.yearly_review_reset_year is distinct from old.yearly_review_reset_year
    then
      raise exception 'profiles: entitlement fields are server-managed and cannot be changed by %', current_user
        using errcode = '42501';
    end if;

  elsif tg_op = 'INSERT' then
    if coalesce(new.is_pro, false)
    or new.plan_type is not null
    or coalesce(new.subscription_status, 'free') <> 'free'
    or new.stripe_customer_id is not null
    or new.stripe_subscription_id is not null
    or new.current_period_end is not null
    or new.subscription_end_date is not null
    or coalesce(new.legacy_free, false)
    or new.referred_by is not null
    then
      raise exception 'profiles: entitlement fields are server-managed and cannot be set on insert by %', current_user
        using errcode = '42501';
    end if;
  end if;

  return new;
end;
$fn$;

-- ── Step 2: drop the column ───────────────────────────────────────────────
alter table public.profiles drop column if exists cancel_at;
