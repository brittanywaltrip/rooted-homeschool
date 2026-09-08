-- The day a family answered the catch-up prompt for one curriculum.
--
-- WHY THIS EXISTS. The recovery prompt asks "did you do these on the days they
-- were due?" and, until 2c697c7, an unchecked row meant nothing: the gap is
-- recomputed on every Today load from (last completion + 1 day) forward, so the
-- same lessons came back with the same past dates, session after session. A
-- family who skipped a week was asked every day.
--
-- The fix records that the question was ANSWERED for a goal and clamps the next
-- gap window to the day after. That shipped against localStorage, which made it
-- per browser: the same family signing in on a phone got asked the whole thing
-- again. An answer about a family's own record should follow the family.
--
-- WHY ON curriculum_goals AND NOT profiles. The answer is per goal, so this is
-- where it belongs:
--
--   * It dies with the goal. A jsonb map on profiles would accumulate the ids
--     of deleted goals forever and need its own cleanup.
--   * It cannot be clobbered. Two tabs answering two different goals both
--     read-modify-write one profiles blob and the second overwrites the first.
--     Separate rows have no such race.
--   * loadData already selects the goal row this is read alongside, so it costs
--     no extra query.
--
-- `profiles.last_catchup_dismissed_at` still exists and is a different thing: a
-- single global dismissal, not a per-curriculum answer.
--
-- A DATE, not a timestamp. The question is "which day did they answer", and the
-- gap window is measured in whole school days.

-- Nullable, no default, no backfill. NULL means "never answered", which is the
-- honest state for every existing goal and the one the read path already
-- handles. Adding a nullable column with no default is a catalogue-only change
-- in Postgres 11+, so it does not rewrite the table.
ALTER TABLE public.curriculum_goals
  ADD COLUMN IF NOT EXISTS catchup_answered_on date;

COMMENT ON COLUMN public.curriculum_goals.catchup_answered_on IS
  'The day the family last answered the missed-lesson catch-up prompt for this '
  'goal (either "No, reschedule them" or a confirm that left rows unchecked). '
  'The next gap window starts the day AFTER this, so an answer narrows what is '
  'offered without silencing the prompt for good. NULL means never answered. '
  'See app/lib/recoverySelection.ts:gapStartAfterAnswer.';

-- No policy change. "Users manage own goals" is ALL on auth.uid() = user_id,
-- so a family can already write this on their own goal and on nobody else's.

