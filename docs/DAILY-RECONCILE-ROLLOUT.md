# Daily reconciliation: rollout and recovery

PR #84. Staging only as of 2026-09-22. Production has no part of this.

## What the parent sees

- **Today** lists today's lessons, as before. When an earlier school day passed
  without a lesson being marked, a prompt asks "You have lessons from earlier"
  and lists each lesson with the day it was due. A lesson that is overdue and
  also today's next lesson is tagged "Also on today's list". The answers are
  "Mark N done on these days" (each lesson is filed on its due day, dates can be
  changed) and "No, reschedule them" (nothing is marked; the question is closed
  for those days). A small "N lessons from earlier" link reopens it.
- **Plan** shows the same lessons in an amber banner, "N lessons from earlier
  aren't marked yet", with Review (the same prompt, the same answers). Below it:
  "Taking some time off? Add a break", which opens the existing break sheet.
- **Plan's old catch-up banner is gone** ("You're N lessons behind", with
  "Re-spread from today" and "Push schedule back"). Re-spreading is what the
  daily reconciliation now does every morning. Push schedule back wrote dates
  with no break behind them: Today never showed it, and the next morning's
  reconciliation put the lessons back (`daily-reconcile.test.ts`). A break is
  the pause both screens honour.
- **Unchanged:** checking, unchecking, moving, rescheduling and skipping single
  lessons from the calendar and day panel, and bulk mark-done in select mode.
- **Dates:** once per curriculum per day, the first time a family's app is open
  on the new day, Plan's dates are brought in line with what Today shows. If
  that cannot finish, both pages say "Couldn't bring your plan's dates up to
  today. Rooted will try again." until a later attempt succeeds.

## Three separate levers

| Lever | What it does | What it does not do |
|---|---|---|
| **Switch off**: `update rooted_private.app_switches set enabled = false, updated_at = now() where name = 'daily_reconcile';` | Every call from every build, including tabs already open, gets `disabled` and writes nothing, from the next call on. Instant, no deploy. | Does not undo dates already written. The UI stays: the missed-work prompt, the break link, no catch-up banner. |
| **App rollback** (promote the previous Vercel deployment) | Old builds never call the function, and Plan's old stored-date missed banner and catch-up banner come back. | Does not undo dates already written. Tabs still open on the new build keep calling until reloaded, which is why the switch goes off first. |
| **Date repair** (`supabase/rollbacks/20260921230610_daily_reconcile_REPAIR.sql`) | Puts back the date each lesson had before its first reconciliation since a cutoff, only where nothing else has touched it since. Dry run first; the apply refuses unless confirmed in its transaction. | Rarely right: a reconciled date is Today's own projection, and reverting it re-creates the drift. Only for a projector bug. Switch off first or the next morning redoes it. |

The full removal (`20260921230610_daily_reconcile_ROLLBACK.sql`) drops the
function and the switch row and keeps the log. Needed only to retire the feature.

## If the parts are out of step

| Database | App | Switch | Behaviour |
|---|---|---|---|
| migration applied | new build | on | Reconciles once per curriculum per local day. |
| migration applied | new build | off | Calls return `disabled`; nothing written, no failure note. Missed-work UI is the new one. |
| migration applied | **rolled back** | any | The function and tables sit unused. The old build behaves exactly as production does today (sync compiled out, stored dates drift). Switch position is irrelevant. |
| **no migration** | new build | n/a | Calls get `PGRST202` (function missing), read as `disabled`: nothing written, no note (`daily-reconcile.test.ts`). Deploy order does not matter. |

## Production rollout

1. Re-read the production ledger and confirm no `daily_reconcile` objects exist.
2. Apply the migration with `apply_migration` (name `daily_reconcile`); read back
   its version and add it to `docs/MIGRATION-LEDGER-CONTAINMENT.md` beside the
   staging version `20260921230610`. It is created **off**.
3. Merge and deploy. With the switch off, the new missed-work UI ships and no
   date is written by the job.
4. Turn the switch on at a quiet hour. Watch `rooted_private.daily_reconcile_log`
   (rows per day), `rooted_private.lesson_date_changes` where
   `new_scheduled_source = 'daily_reconcile'` (no date before its local day,
   attributed to the family), stale refusals, and Sentry.
5. If anything looks wrong: switch off first, then decide on app rollback, then
   (only for a projector bug) the date repair.

## Co-teachers (proposal, not built)

A co-teacher is the account whose email is in the owner's `profiles.partner_email`.
Every policy on `lessons`, `curriculum_goals` and `vacation_blocks` is owner
only (`auth.uid() = user_id`) on production and staging, so a co-teacher's own
session cannot read the owner's schedule at all today, current or stale.
Production (2026-09-22): 2 families have set a co-teacher email; neither
co-teacher has an account.

- The reconciliation is not what stands in the way; read access is. Giving a
  co-teacher read access is a permission change and needs its own review.
- Smallest way to keep dates current without the owner opening the app, with
  no new access for anyone: a daily server job (service role, the same function
  logic keyed by `profiles.timezone`) that reconciles each family shortly after
  its local midnight, behind the same switch. It would also serve families who
  only read the weekly email.
- Not built. Worth building only together with a reviewed co-teacher read path,
  since without that no co-teacher can see the result.

## Staging ledger (#83)

The staging ledger gained this migration's row, so #83's preflight was
refreshed on 2026-09-22 (123 rows, fingerprint `b2f32591…`). Re-read the live
fingerprint immediately before running #83, and refresh again if anything else
has been applied to staging.
