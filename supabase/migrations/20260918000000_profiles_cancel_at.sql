-- Fix #2 Phase 2: record a scheduled cancellation without touching entitlement.
--
-- ⚠ PROVISIONAL FILENAME. This migration has NOT been applied yet. Apply it with
-- the Supabase migration API under the name `profiles_cancel_at`, then read the
-- version it recorded:
--     select version from supabase_migrations.schema_migrations
--      where name = 'profiles_cancel_at';
-- and rename this file (and its rollback) to that exact version. The API assigns
-- its own version at apply time, and every older file in this folder was named by
-- hand beforehand, so none of them match the ledger. This is the first one that
-- will. See the migration convention note in CLAUDE.md.
--
-- THE GAP
-- The Stripe billing portal is configured with subscription_cancel.mode =
-- 'at_period_end', so a self-serve cancellation never terminates the
-- subscription. Stripe sets cancel_at_period_end = true and leaves status
-- 'active'. customer.subscription.updated then reached linkStripeSubscription,
-- which writes subscription_status 'active' and subscription_end_date null
-- unconditionally, so the pending cancellation was not merely unrecorded, it was
-- actively erased. For an annual plan that left Rooted believing a departing
-- family was healthy for up to eleven months.
--
-- WHY A NEW COLUMN AND NOT A NEW subscription_status
-- Access is gated on is_pro alone (lib/user-access.ts). Overloading the status
-- would have broken readers that compare against 'active': lib/family-feed.ts
-- gates the family feed on it, lib/audit-stripe-linkage.ts would report every
-- scheduled cancellation as drift, and rule 1 of the expire-subscriptions sweep
-- keys off status 'cancelled' and could have downgraded people early. Keeping
-- status 'active' and is_pro true until the term genuinely ends is what makes
-- this safe.
--
-- cancel_at is ADVISORY. It never influences access, so a wrong value here is a
-- display bug rather than an entitlement bug.
--
-- Rollback: supabase/rollbacks/20260918000000_profiles_cancel_at_ROLLBACK.sql

-- ── The column ────────────────────────────────────────────────────────────
-- Nullable with no default, so Postgres records this as metadata only: no table
-- rewrite and no meaningful lock on the 2,465 existing rows.
alter table public.profiles add column if not exists cancel_at timestamptz;

comment on column public.profiles.cancel_at is
  'When Stripe reports cancel_at_period_end, the date access is scheduled to end. Server-managed. NULL means no cancellation is scheduled. Advisory only: is_pro governs access.';

-- Deliberately NOT added to the `authenticated` column grant from security fix
-- #1. That grant is an explicit allowlist, so a column added later is unwritable
-- by users by default. The correct action here is to do nothing.

-- ── Defense in depth ──────────────────────────────────────────────────────
-- Extend the security fix #1 backstop so a future blanket grant cannot let a
-- user move their own cancellation date.
--
-- create or replace ONLY. Do NOT drop and recreate the trigger: the existing
-- trigger picks up the new function body automatically, and dropping it would
-- leave profiles briefly unprotected.
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
    or new.cancel_at                is distinct from old.cancel_at
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
    or new.cancel_at is not null
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
  'Security fix #1 (2026-09-17), extended 2026-09-18 with cancel_at. Backstop for the profiles column grants: rejects any change to an entitlement or billing field made by the authenticated or anon role. Service role, postgres and SECURITY DEFINER functions pass through untouched.';
