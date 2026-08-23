-- ============================================================
-- Books in progress (August 23, 2026)
--
-- ALREADY APPLIED TO PRODUCTION 2026-08-23 (via Supabase MCP apply_migration).
-- Migrations in this repo do not run on deploy; see the "Migrations are
-- applied by hand" section of CLAUDE.md. Do not re-run.
--
-- Until now a book row meant a book finished. A family reading a chapter book
-- over three weeks had nothing to log until the last page, so the Reading Log
-- showed nothing during the weeks they were actually reading.
--
-- book_status adds the in-progress state:
--
--   NULL        finished. Every row that existed before this migration.
--   'finished'  finished, written explicitly by the finish flow.
--   'reading'   in progress. Excluded from book counts and book lists until
--               finished.
--
-- NULL and 'finished' are deliberately both "finished" rather than
-- backfilling. Every one of the 173 existing book rows is a finished book, so
-- a backfill would write 173 rows to say what their NULL already says, and any
-- reader that forgets the column still behaves correctly: it sees no status
-- and treats the book as finished, which is what it is. See isFinishedBook in
-- lib/memory-leaves.ts — the predicate is `status !== 'reading'`, never
-- `status === 'finished'`, precisely so NULL keeps working.
--
-- ── What `date` means ────────────────────────────────────────────────────
--
-- UNCHANGED: `date` is the day the book counts on.
--
--   finished book   the day it was finished / logged, exactly as today
--   in-progress     the day it was started
--
-- so an in-progress book sorts and filters sensibly while it is being read,
-- and the finish flow rewrites `date` to the finish day. book_started_date
-- keeps the original start and is NOT rewritten on finish, so a finished book
-- can still say when it began.
--
-- This does mean a book's `date` MOVES when it is finished. That is the point:
-- the row counts on the day it counts. Anything keying off the old date (a
-- calendar dot, say) follows it, which is the intended behaviour.
--
-- ── What this migration deliberately does NOT add ────────────────────────
--
-- No "days since started", no staleness flag, no last-touched timestamp, no
-- reminder scaffolding of any kind. Reading Log v3 is explicitly guilt-free by
-- design: a book can sit on the shelf for a year without the app ever
-- mentioning it. If a future task asks for a nag, it should have to add the
-- column itself and argue for it.
--
-- ─── Safety check ────────────────────────────────────────────────
--
-- Should return zero rows before this runs.
--
--   SELECT column_name, data_type
--   FROM information_schema.columns
--   WHERE table_schema = 'public' AND table_name = 'memories'
--     AND column_name IN ('book_status', 'book_started_date');
-- ============================================================

alter table public.memories
  add column if not exists book_status       text,
  add column if not exists book_started_date date;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.memories'::regclass and conname = 'memories_book_status_check'
  ) then
    alter table public.memories
      add constraint memories_book_status_check
      check (book_status is null or book_status in ('reading', 'finished'));
  end if;
end $$;

comment on column public.memories.book_status is
  'NULL or ''finished'' = a finished book and counts everywhere. ''reading'' = in progress: excluded from book counts and book lists until finished. NULL is never backfilled, so readers must test status <> ''reading'' rather than status = ''finished''. See isFinishedBook in lib/memory-leaves.ts.';
comment on column public.memories.book_started_date is
  'The day an in-progress book was started. Kept when the book is finished, so a finished book can still say when it began. Never used to compute elapsed time or any reminder: Reading Log v3 is guilt-free by design.';

-- Partial: only in-progress books are ever looked up by status, and they are a
-- small minority of a mostly-finished table.
create index if not exists memories_book_status_reading_idx
  on public.memories (user_id, book_status)
  where book_status = 'reading';

-- NO BACKFILL. Existing rows keep book_status NULL, which already means
-- finished. Stated explicitly so nobody adds one later thinking it was missed.
