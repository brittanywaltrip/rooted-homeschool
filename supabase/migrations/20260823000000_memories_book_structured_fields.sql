-- ============================================================
-- Structured book fields on memories (August 23, 2026)
--
-- ALREADY APPLIED TO PRODUCTION 2026-08-23 (via Supabase MCP apply_migration).
-- Migrations in this repo do not run on deploy; see the "Migrations are
-- applied by hand" section of CLAUDE.md. Do not re-run.
--
-- Books have been carrying their structured data inside a free-text caption
-- since March 2026, written by the Today book modal as
-- "Author: X | Pages: N" with either half optional. That was fine while the
-- only consumer was a line of display text; it stopped being fine once the
-- Reading Log started summing pages for a state portfolio, because every
-- reader had to re-parse a string a family can edit by hand in Memories.
--
-- These columns give books real fields. Reading Log v2 display (ratings,
-- notes, how-it-was-read) is a separate later task; this migration is the
-- data layer only.
--
-- CAPTION IS NOT TOUCHED, here or by the app. The modal keeps writing the
-- same "Author: X | Pages: N" string alongside the new columns, and every
-- existing reader keeps parsing it, so nothing that reads a book today
-- breaks. The caption stays the compatibility surface; the columns are the
-- truth going forward.
--
-- ── book_child_ids and multi-child attribution ───────────────────────────
--
-- memories.child_id is a single nullable uuid: one child, or NULL meaning
-- "whole family". A read-aloud to three of four kids could not be recorded.
-- book_child_ids is the new answer:
--
--   NULL           whole family — counts for every child, same as child_id NULL
--   {a}            exactly that child
--   {a,b}          exactly those children, and NO ONE ELSE
--
-- child_id keeps being written: the single id when exactly one child is
-- selected, NULL otherwise. Readers that predate this column therefore treat
-- a two-child book as a whole-family book, which over-counts rather than
-- hiding it — the safe direction to be wrong in. Readers that know about the
-- array must honour it exactly (see bookBelongsToChild in
-- lib/memory-leaves.ts).
--
-- No foreign key on the array. Postgres cannot REFERENCES an array element,
-- and the alternative (a join table) is a much larger change than this task
-- calls for. A child deleted from children is soft-deleted (archived = true,
-- see 20260818000000), so the ids stay resolvable.
--
-- ── Backfill ─────────────────────────────────────────────────────────────
--
-- Parses the existing caption into book_author / book_pages. Measured
-- against production before writing this file, over 173 book rows:
--
--   106 have a non-empty caption
--    86 yield an author
--    50 yield a page count
--     7 yield neither and are left entirely alone ("Great book",
--       "First chapter book all by herself", and similar free text)
--
-- The regexes anchor each half to the start of the string or to just after a
-- pipe, mirroring how parseBookCaption in app/dashboard/reports/page.tsx
-- splits on "|" and then requires the segment to START with the label. That
-- keeps a caption like "My author: notes" out of book_author, in SQL and in
-- TypeScript alike.
--
-- Idempotent: `where book_author is null and book_pages is null` means a
-- re-run cannot overwrite anything a family has since edited through the app.
--
-- ─── Safety check ────────────────────────────────────────────────
--
-- Should return zero rows. A pre-existing column of one of these names with
-- a different type would make ADD COLUMN IF NOT EXISTS a silent no-op.
--
--   SELECT column_name, data_type
--   FROM information_schema.columns
--   WHERE table_schema = 'public' AND table_name = 'memories'
--     AND column_name LIKE 'book\_%';
-- ============================================================

alter table public.memories
  add column if not exists book_child_ids uuid[],
  add column if not exists book_how       text,
  add column if not exists book_author    text,
  add column if not exists book_pages     integer,
  add column if not exists book_rating    smallint,
  add column if not exists book_notes     text,
  add column if not exists book_cover_url text;

-- Constraints are added separately and guarded, so a re-run is a no-op
-- rather than a 42710. NOT VALID is deliberately NOT used: these columns are
-- brand new and entirely NULL, so there is nothing existing to validate
-- against and the check is free.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.memories'::regclass and conname = 'memories_book_how_check'
  ) then
    alter table public.memories
      add constraint memories_book_how_check
      check (book_how is null or book_how in
        ('read_aloud', 'read_together', 'independent', 'audiobook', 'assigned'));
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.memories'::regclass and conname = 'memories_book_pages_check'
  ) then
    alter table public.memories
      add constraint memories_book_pages_check
      check (book_pages is null or book_pages > 0);
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.memories'::regclass and conname = 'memories_book_rating_check'
  ) then
    alter table public.memories
      add constraint memories_book_rating_check
      check (book_rating is null or (book_rating >= 1 and book_rating <= 5));
  end if;
end $$;

comment on column public.memories.book_child_ids is
  'Which children this book counts for. NULL = whole family (counts for every child). A non-empty array counts for exactly those children and no one else. child_id is still written alongside: the single id when the array holds exactly one, NULL otherwise. See bookBelongsToChild in lib/memory-leaves.ts.';
comment on column public.memories.book_how is
  'How the book was read: read_aloud | read_together | independent | audiobook | assigned. Optional, no default.';
comment on column public.memories.book_author is
  'Author. Also still written into caption as "Author: X | Pages: N" for readers that predate this column.';
comment on column public.memories.book_pages is
  'Page count, > 0. Also still written into caption. Summed for the portfolio Reading Log.';
comment on column public.memories.book_rating is
  'The child''s rating, 1 to 5. Captured now, displayed in a later task.';
comment on column public.memories.book_notes is
  'Free-text notes about the book. Distinct from caption, which stays the legacy "Author: X | Pages: N" compatibility string.';
comment on column public.memories.book_cover_url is
  'Cover from Open Library autofill. Display order is photo_url (the family''s own photo) first, then this, then a placeholder.';

-- ── Backfill: caption -> book_author / book_pages ────────────────────────
-- Only rows that have neither field set, so this cannot clobber app writes.
update public.memories
set
  book_author = nullif(btrim(substring(caption from '(?i)(?:^|\|)\s*author\s*:\s*([^|]+)')), ''),
  book_pages  = nullif((substring(caption from '(?i)(?:^|\|)\s*pages\s*:\s*([0-9]{1,6})'))::int, 0)
where type = 'book'
  and caption is not null
  and caption <> ''
  and book_author is null
  and book_pages is null;

-- Partial index: the Reading Log filters books by child, and the array is
-- only ever consulted for type = 'book' rows.
create index if not exists memories_book_child_ids_idx
  on public.memories using gin (book_child_ids)
  where book_child_ids is not null;
