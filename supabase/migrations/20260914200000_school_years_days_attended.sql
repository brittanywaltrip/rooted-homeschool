-- ============================================================
-- APPLIED 2026-09-14. Applied by hand to the live database at 6:40 PM, before
-- this file landed. This file is the record of that change, not an
-- instruction: do not re-run it (CLAUDE.md, "Migrations are applied by hand").
-- The `if not exists` makes a re-run a no-op anyway.
--
-- school_years.days_attended: for a year filed through Add a past year, how
-- many days the family says they schooled. The flow dates that year's lessons
-- on exactly that many school days, chosen evenly across the range, so the
-- Hours & Attendance Log's Days Present for the year equals this number.
--
-- Why: a family filed her kindergarten year on 2026-09-14. Its lessons were
-- spread over every school day in the range, and Reports counts a day with a
-- completed lesson as present, so all 180 weekdays read as attended in a year
-- that had sick days in it. Attendance is the number families keep for the
-- state.
--
-- NULL for every year lived in Rooted (its days are the ones logged) and for a
-- year filed before this column existed. The same number is also written to
-- school_year_archives.stats.days_attended, so the Years page reads a filed
-- year's archive the way it reads a closed one.
-- ============================================================

alter table public.school_years
  add column if not exists days_attended integer null;
