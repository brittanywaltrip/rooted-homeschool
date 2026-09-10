-- ALREADY APPLIED 2026-09-10 via MCP, do not re-run.
--
-- Repo-record only. Verified live 2026-09-10: all four policies exist on
-- storage.objects with exactly these definitions.
--
-- Before this, the only DELETE policy on storage.objects covered the
-- `memories` bucket, so a browser-side remove() against memory-photos,
-- family-photos, yearbook-covers or media matched zero rows and supabase-js
-- resolved without an error. The Memories page then deleted the row and left
-- the file behind (seen on staging 2026-09-09 with a Quick photo memory).

create policy "owners delete their own memory photos" on storage.objects for delete to authenticated using (bucket_id = 'memory-photos' and (select auth.uid())::text = (storage.foldername(name))[1]);
create policy "owners delete their own family photos" on storage.objects for delete to authenticated using (bucket_id = 'family-photos' and (select auth.uid())::text = (storage.foldername(name))[1]);
create policy "owners delete their own yearbook covers" on storage.objects for delete to authenticated using (bucket_id = 'yearbook-covers' and (select auth.uid())::text = (storage.foldername(name))[1]);
create policy "owners delete their own media" on storage.objects for delete to authenticated using (bucket_id = 'media' and (select auth.uid())::text = (storage.foldername(name))[1]);
