-- Security fix #1: stop authenticated users writing their own entitlement fields.
--
-- APPLIED TO PRODUCTION 2026-09-17 via the Supabase migration API (migration name:
-- security_fix_1_profiles_entitlement_guard). This file is a RECORD of an applied
-- change. DO NOT RUN IT AGAIN.
--
-- THE BUG
-- `authenticated` held a TABLE-level UPDATE grant on public.profiles, and the only
-- write policy (profiles_owner_update) checked just `id = auth.uid()`. RLS is row
-- level, so nothing constrained WHICH columns a signed-in user could change. A
-- plain PostgREST PATCH with a normal user's own access token could set is_pro,
-- plan_type, subscription_status and the Stripe ids, unlocking Rooted+ with no
-- payment. Confirmed exploitable 2026-09-17 in a transaction that was rolled back.
-- A full sweep of all 2,465 profiles found no account that had used it.
--
-- WHY TWO LAYERS
-- Layer 1 is the fix: replace the blanket table grant with a column allowlist.
--   NOTE: a column-level REVOKE cannot subtract from a table-level GRANT. The
--   table grant has to be revoked first, then the permitted columns granted back.
--   Getting this wrong silently leaves the hole open, which is what happened on
--   the first rehearsal pass.
-- Layer 2 is the backstop: a trigger that rejects entitlement changes from the
--   authenticated and anon roles, so a future `grant all on all tables in schema
--   public to authenticated` cannot silently reopen layer 1.
--
-- UNAFFECTED: service_role, postgres and SECURITY DEFINER functions. The Stripe
-- webhook, expire-subscriptions cron, admin routes, /api/profile/update,
-- auth/callback profile upsert and increment_photo_count all keep working.
--
-- Rollback: supabase/rollbacks/20260917000000_security_fix_1_ROLLBACK.sql

-- ── Layer 1: column allowlist ─────────────────────────────────────────────
revoke update on public.profiles from authenticated;

grant update (
  id, display_name, created_at, partner_email, family_photo_url, onboarded, state,
  first_name, last_name, school_days, school_year_start, school_year_end,
  re_engagement_sent, email_weekly_summary, email_marketing, unsubscribe_token,
  yearbook_opened_at, yearbook_closed_at, printable_style, yearbook_settings,
  email_unsubscribed, onboarded_at, current_streak_days, longest_streak_days,
  last_logged_date, school_start_time, last_catchup_dismissed_at, timezone,
  country, homeschool_experience, primary_goal
) on public.profiles to authenticated;

-- anon has no RLS policy on profiles and must never write to it.
revoke insert, update on public.profiles from anon;

-- ── Layer 2: backstop trigger ─────────────────────────────────────────────
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

comment on function public.guard_profile_entitlement() is
  'Security fix #1 (2026-09-17). Backstop for the profiles column grants: rejects any change to an entitlement or billing field made by the authenticated or anon role. Service role, postgres and SECURITY DEFINER functions pass through untouched.';

drop trigger if exists profiles_guard_entitlement on public.profiles;

create trigger profiles_guard_entitlement
  before insert or update on public.profiles
  for each row execute function public.guard_profile_entitlement();
