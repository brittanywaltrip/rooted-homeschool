-- Rollback for child_absences. Drops every recorded child day off.
-- Roll the app back first: the Hours & Attendance report reads this table
-- (a missing table only empties the Days Off list, but "Add a day off" would
-- fail on save).
drop table if exists public.child_absences;
