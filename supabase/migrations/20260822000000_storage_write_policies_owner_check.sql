-- ALREADY APPLIED TO PRODUCTION 2026-08-22. DO NOT RUN THIS FILE.
-- It exists so the repo's migration history matches the live database.
--
-- Three write policies on storage.objects checked only the bucket name and
-- never the owner. RLS policies are PERMISSIVE and OR'd together, so these
-- three granted exactly what their correctly-scoped siblings were withholding:
-- any signed-in user could write an object into another family's
-- <userId>/ folder, and could overwrite another family's existing photo.
-- Read access was never affected; the SELECT policies were always scoped.
--
-- Previous definitions, recorded here for rollback:
--   family_photos_insert : WITH CHECK (bucket_id = 'family-photos')
--   family_photos_update : USING (bucket_id = 'family-photos'), no WITH CHECK
--   memories_insert      : WITH CHECK (bucket_id = 'memories')
--
-- Each is recreated below with the owner check every other write policy in
-- these buckets already had: the first path segment of the object name must be
-- the caller's own user id. That works because every user-uploaded object in
-- every bucket is stored at <userId>/<filename>, exactly one level deep
-- (verified across all 1,889 production objects).
--
-- (select auth.uid()) rather than a bare auth.uid() so Postgres evaluates it
-- once per statement instead of once per row.

-- ── family-photos INSERT ─────────────────────────────────────────────────────
drop policy if exists "family_photos_insert" on storage.objects;

create policy "family_photos_insert"
  on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'family-photos'
    and (select auth.uid())::text = (storage.foldername(name))[1]
  );

-- ── family-photos UPDATE ─────────────────────────────────────────────────────
-- Needs the check on BOTH sides: USING decides which rows may be updated,
-- WITH CHECK decides what they may be updated to. Without WITH CHECK a user
-- could move their own object into someone else's folder.
drop policy if exists "family_photos_update" on storage.objects;

create policy "family_photos_update"
  on storage.objects
  for update
  to authenticated
  using (
    bucket_id = 'family-photos'
    and (select auth.uid())::text = (storage.foldername(name))[1]
  )
  with check (
    bucket_id = 'family-photos'
    and (select auth.uid())::text = (storage.foldername(name))[1]
  );

-- ── memories INSERT ──────────────────────────────────────────────────────────
drop policy if exists "memories_insert" on storage.objects;

create policy "memories_insert"
  on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'memories'
    and (select auth.uid())::text = (storage.foldername(name))[1]
  );
