-- ============================================================================
-- Rooted Homeschool: Mail Adventures page support
--
-- Companion to 20260901000000_mailbox_adventures.sql, which created the three
-- tables and seeded 119 listings. This migration adds the one index the page's
-- Requested / Received toggles need, and records two verification findings.
--
-- PRIVACY RULE (carried forward from the parent migration, do not remove):
-- No table here stores a mailing address, a street, a city, a ZIP, or any part
-- of one. Families send their address directly to the organization, never
-- through Rooted. A future "autofill my address" column is rejected on sight.
-- It would alter Rooted's App Store data disclosure and its breach exposure.
--
-- CONTENTS
--   1. mailbox_progress family-scoped unique index  (schema change)
--   2. mailbox_progress RLS confirmation            (comment only, no change)
--   3. Verification status                          (NOT APPLIED, see below)
-- ============================================================================


-- ---------------------------------------------------------------------------
-- 1. The family-scoped unique index
--
-- mailbox_progress already carries unique (user_id, child_id, listing_id). That
-- constraint does NOT stop duplicates for this page, because this version writes
-- child_id as null and two NULLs never collide in a unique constraint: a family
-- could accumulate one row per tap of Requested, and the page would read back
-- whichever the planner happened to return.
--
-- A partial unique index over the non-null columns closes it.
--
-- It is a DUPLICATE GUARD, not an upsert conflict target. Postgres cannot infer
-- a partial index from a bare column list: the statement has to repeat the index
-- predicate (WHERE child_id IS NULL), and PostgREST's `on_conflict` parameter
-- takes column names only, with no way to send it. An upsert on
-- (user_id, listing_id) therefore fails with 42P10, "there is no unique or
-- exclusion constraint matching the ON CONFLICT specification". That was tried
-- against staging first, and every toggle 400d. The page writes an explicit
-- UPDATE-or-INSERT instead, with a 23505 fallback that this index is what
-- raises. Do not "simplify" it back to an upsert.
--
-- The per-child split is deliberately not in this version. When it arrives it
-- needs its own index over (user_id, child_id, listing_id) where child_id is
-- not null; this one keeps covering the family-level rows unchanged.
-- ---------------------------------------------------------------------------
create unique index if not exists mailbox_progress_family_listing_uniq
  on public.mailbox_progress (user_id, listing_id)
  where child_id is null;

comment on index public.mailbox_progress_family_listing_uniq is
  'Family-level (child_id null) uniqueness. The table constraint cannot enforce this because NULLs never collide. A duplicate guard, NOT an ON CONFLICT target: a partial index cannot be inferred from a bare column list, so PostgREST upserts on it fail with 42P10.';


-- ---------------------------------------------------------------------------
-- 2. RLS on mailbox_progress: confirmed, nothing added
--
-- Verified against the live database while writing this migration. The parent
-- migration already installed all four owner-scoped policies, and they are the
-- only policies on the table:
--
--   families read   their own mailbox progress   SELECT  auth.uid() = user_id
--   families insert their own mailbox progress   INSERT  auth.uid() = user_id
--   families update their own mailbox progress   UPDATE  auth.uid() = user_id
--   families delete their own mailbox progress   DELETE  auth.uid() = user_id
--
-- The UPDATE policy carries both USING and WITH CHECK, so a family cannot move
-- one of its rows onto another user_id. The page's UPDATE-or-INSERT write is
-- covered by the INSERT and UPDATE policies together. Nothing to add here. Do not "helpfully" re-create these:
-- a redefinition that dropped the WITH CHECK would open exactly that hole.
-- ---------------------------------------------------------------------------


-- ---------------------------------------------------------------------------
-- 3. Verification status: the planned update was NOT applied
--
-- The plan for this migration called for setting verification_status to
-- 'needs_recheck' on thirteen state listings said to have been imported without
-- an official-source confirmation, named as CT, HI, IL, IN, KY, MS, MT, NH, NM,
-- OH, OK, VT and WA.
--
-- Checked against the live database first. Those thirteen states have no
-- listings at all, in any spelling:
--
--   mailbox_listings                     119 rows, all is_active
--   category = '50_states'                76 rows
--   distinct state_region values          37
--   rows matching the thirteen, abbreviated   0
--   rows matching the thirteen, spelled out   0
--
-- state_region stores full state names ('Alabama'), never abbreviations, so the
-- abbreviated form in the plan would not have matched regardless. The thirteen
-- named states are precisely the thirteen with NO listing: 37 covered + 13
-- absent = 50. The intended statement could only ever have reported
-- "UPDATE 0". It is omitted rather than shipped as a no-op that reads like a
-- data fix in the migration history.
--
-- ROWS UPDATED BY THIS MIGRATION: 0. This file makes no content changes.
--
-- The real soft spot in the catalog is a different set of rows: nine listings
-- still marked 'verified' whose url_quality is 'general_page', meaning the
-- stored link opens the organization's page rather than a direct order form.
-- They are california-visitor-s-guide, maine-official-travel-planner-adventure-
-- guide, maryland-destination-maryland-travel-guide, the four Oregon listings
-- (oregon-visitor-guide, oregon-guide-to-indian-country, oregon-scenic-byways-
-- guide, official-oregon-state-map) and the two West Virginia listings
-- (west-virginia-vacation-guide, west-virginia-highway-map). A tenth,
-- louisiana-official-travel-guide, is already 'needs_recheck'.
--
-- Flipping those nine is a content judgement about listings Brittany curated,
-- not a schema fix, so it is deliberately left out of this migration. The page
-- already handles them: url_quality 'general_page' renders the hint line
-- "This opens the organization's page; look for the request or order form."
-- ---------------------------------------------------------------------------
