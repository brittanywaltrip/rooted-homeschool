# Rooted Homeschool — Claude Code Context

## Important Rules
Rooted does NOT use AI. Do not add AI features, do not install AI SDKs, do not call external AI APIs. If a user requests an AI feature, decline and tell them this is not part of the product.

## What is Rooted?
A living memory book that also plans your homeschool.
Tagline: "Stay Rooted. Teach with Intention."
Hero copy: "The homeschool years go by so fast. Rooted helps you plan your days, capture the moments, and hold onto it all."

## Auth Invariants — DO NOT VIOLATE

The Google OAuth flow broke multiple times because these rules weren't documented. If you are touching ANY file that deals with auth, sessions, cookies, or Supabase clients, read this first.

1. The browser Supabase client must always be the PKCE (cookie) flow. `@/lib/supabase-browser` exposes `createSupabaseBrowserClient()`, and `@/lib/supabase` now re-exports that SAME PKCE client as its `supabase` singleton, so both imports are safe — importing `{ supabase }` from `@/lib/supabase` no longer means implicit/localStorage flow. Use whichever fits: `import { supabase } from "@/lib/supabase"` for the shared singleton, or `import { createSupabaseBrowserClient } from "@/lib/supabase-browser"` with `const supabase = useMemo(() => createSupabaseBrowserClient(), [])` when a component wants its own instance. Never construct a browser client with implicit flow.

2. NEVER hardcode `https://www.rootedhomeschoolapp.com` in OAuth redirects. ALWAYS use `${window.location.origin}/auth/callback` on the client. On the server, derive BASE_URL from the incoming request.

3. NEVER hardcode cookie domain as `.rootedhomeschoolapp.com` without the `getCookieDomain()` helper in `lib/cookie-domain.ts`. Hardcoded domains break on vercel.app staging previews.

4. When the auth callback copies cookies between responses, ALWAYS preserve the full options object (domain, path, secure, httpOnly, sameSite, maxAge, expires). Never just `.set(name, value)` — that strips the domain.

5. Keep `queryParams: { prompt: 'select_account' }` in every signInWithOAuth call so the Google account picker always shows. Removing it breaks multi-Google-account users.

6. There are TWO OAuth providers in production, not one: **Continue with
   Google** and **Sign in with Apple**. Apple went live 2026-05-14 and
   carries roughly 40% of OAuth volume (611 button clicks vs 929 for Google,
   May to Aug 2026), yet went undocumented here for three months. Every rule
   in this section applies to BOTH. Apple's account-picker parameter is
   `prompt=login`, not Google's `prompt=select_account`. When you change one
   provider's flow, change and test the other.

7. `/auth/callback` MUST stay in the middleware bypass list in
   `middleware.ts`. The callback owns the auth cookies for its own request.
   If the middleware runs `supabase.auth.getUser()` first and that call fails
   on a stale or already-rotated session cookie, `@supabase/ssr` calls
   `_removeSession`, which deletes `<storageKey>-code-verifier` along with
   the session — so `exchangeCodeForSession` in the route handler finds no
   verifier and the family lands on `/login?error=pkce_cross_device`.
   Reproduced against production 2026-08-18. Between May and August 2026 this
   class of failure cost 48 signups and ejected 22 already-paying families
   mid-session.

8. Any cookie-presence check in middleware MUST exclude the code-verifier
   cookie. It is named `<storageKey>-auth-token-code-verifier`, so a naive
   `startsWith('sb-') && includes('auth-token')` test matches it and treats a
   mid-OAuth visitor as though they had a session.

### Auth file manifest — these files are the only ones touching auth:
- app/auth/callback/route.ts
- middleware.ts  (runs getUser() on every non-bypassed request)
- app/api/auth/login/route.ts  (server-side password sign-in)
- lib/supabase.ts and lib/supabase-browser.ts
- lib/cookie-domain.ts
- app/login/page.tsx and app/signup/page.tsx  (BOTH Google and Apple buttons)
- app/onboarding/page.tsx
- app/dashboard/layout.tsx

### BEFORE merging anything that touches the files above, manually verify this end-to-end flow on staging:
1. Clear cookies for the staging domain (or use a private window)
2. Go to staging /login or /signup
3. Click "Continue with Google" → pick a Google account that has never used Rooted
4. Complete the onboarding wizard
5. Confirm you land on /dashboard (Today page)
6. Repeat steps 1-5 with "Sign in with Apple". Apple is 40% of sign-ins and
   is NOT covered by the Google pass.
7. Sign in with an existing password account and confirm the session survives
   longer than the ~1 hour access-token expiry without asking you to sign in
   again. This is what the middleware exists for and what regressions here
   break first.
If any step fails, DO NOT MERGE. Diagnose, fix, re-test.

### Production auth environment, easy to get wrong locally
`NEXT_PUBLIC_SUPABASE_URL` in production is `https://auth.rootedhomeschoolapp.com`
(a Supabase custom domain), NOT the `gvkbegvvmhcrmxdorctk.supabase.co` value in
`.env.local`. The Supabase storage key is derived from that host, so production
cookies are named `sb-auth-auth-token` and `sb-auth-auth-token-code-verifier`
while local and e2e runs use different names. Never hardcode a cookie name in a
test and assume it matches production.

## Curriculum scheduler — REQUIRED READING

Before touching ANY of the following:
- `app/lib/scheduler.ts`
- `app/lib/scheduler.test.ts`
- `app/components/CurriculumWizard.tsx`
- The catch-up modal (anything referencing `last_catchup_dismissed_at`)
- `app/api/vacation-blocks/**`
- `app/api/lessons/**`
- Any file with `scheduler`, `respread`, `reschedule`, `catchup` in the name
- Any code that writes to `lessons.date` or `lessons.scheduled_date`
- Any Supabase migration that touches `lessons` or `curriculum_goals`

You MUST read `docs/CURRICULUM-SCHEDULING.md` IN FULL first. That doc is
the single source of truth for the 10 invariants the scheduler must obey.
The scheduler tests in `app/lib/scheduler.test.ts` enforce those invariants.
The CI workflow `.github/workflows/scheduler-tests.yml` blocks any merge
that breaks them.

Two production regressions happened in 2026 (April 28 and May 3) because
this rule wasn't followed. If your change touches scheduling, expect to:
1. Read `docs/CURRICULUM-SCHEDULING.md`.
2. Identify which invariant(s) your change affects.
3. Run `node --test app/lib/scheduler.test.ts` locally before commit.
4. Add a new test case if you introduce a new invariant.

## School year close flow — DO NOT VIOLATE

There is ONE close flow. `/dashboard/close-year` POSTs to
`/api/school-year/close` with `{ closingYearName, newYearName, newYearStart,
newYearEnd }`. Every field is optional; anything missing falls back to the
rollover name (`lib/school-year-name.ts`), start today, end next May 31, so a
caller that sends no body can never break the close.

Year names are FREE TEXT. "Summer 2026" and "Kindergarten Year" are as valid
as "2026-2027".
- NEVER generate en dashes (U+2013) in year names. Always a plain hyphen. The
  April 2026 backfill migration wrote "2025–2026", and every flow that asked a
  user to retype that name was unusable, because no keyboard types it.
- NEVER require a user to retype a stored year name to confirm anything. The
  close page confirms by typing CLOSE (case-insensitive, trimmed).

Closing a year archives ALL of that year's curriculum goals, completed or not,
AND stamps goals whose `school_year_id` is NULL onto the closing year and
archives those too. Those two writes are the whole reason last year's subjects
stop carrying into the new year. Do NOT weaken either filter: no
`completed_at` filter on the first, no skipping the NULL sweep.

`/api/school-year/new` was DELETED on August 11, 2026. It archived the year but
left every subject active, which is the carry-over bug real families hit.
NEVER recreate it.

`/api/school-year/create` accepts `existingSchoolYearId` and updates that year
in place after verifying ownership. Without an id it returns 409, with the
existing id in the body, when the user already has an active year whose
start_date is today or earlier, instead of silently creating a second one. The
next-year wizard (`/dashboard/plan/new-year`) prefills from the ACTIVE year,
never from a name derived from the old year, so it cannot overwrite the name
and dates the user chose on the close page.

The close route's invariant, preserve it in any future change: archiving the
old year and creating the new one are the ONLY fatal writes, they run back to
back, and if the create fails the archive is reverted, restoring status, name,
and end_date. Every step after that (stats snapshot, certificates, grade
advancement, goal and activity archiving) is non-fatal and records a warning
instead of returning a 500. Losing a snapshot is cosmetic. Losing the active
year bricks the account, which is what stranded a real user on June 19, 2026.

## Positioning
Memory book FIRST. Planner second. Memories lead emotionally.

## Stack
- Next.js / TypeScript / Tailwind CSS
- Supabase (auth, database, storage) — project: gvkbegvvmhcrmxdorctk
- Vercel (hosting) — www.rootedhomeschoolapp.com
- Stripe (payments)
- Resend (email)
- GitHub: brittanywaltrip/rooted-homeschool

## Branch strategy
ALWAYS work on staging branch. NEVER push direct to main.
Merge staging → main when batch is tested and ready.

## Before merging to main
Run `npm run test:e2e` against staging. The Playwright suite at
`e2e/smoke/` covers auth, dashboard, plan, schedule builder, memories,
yearbook, and the four critical paths (curriculum create / edit /
delete, lesson completion). All tests must pass before any staging →
main merge.

The suite reads `PLAYWRIGHT_EMAIL` and `PLAYWRIGHT_PASSWORD` from
`.env.local` (gitignored). The optional `SUPABASE_SERVICE_ROLE_KEY`
unlocks DB-side assertions in the curriculum-CRUD tests and the
data-integrity audit; without it those checks skip cleanly. Never
hardcode the test password in a spec file.

## e2e notes

### "Past start_date backfill via Schedule Builder"
This spec failed intermittently on BOTH main and staging through early August
2026. The cause was a week-view render race in `usePlanV2Data`: a stale
month-window response could overwrite newer state, so the week rendered its day
rows with no lesson cards, which is exactly what the spec catches.

Root-caused and FIXED on August 3, 2026 (commit 1d0c1b0). Each load now claims
a monotonic request id before its first await and writes state only while it is
still the newest. Verified 5/5 clean passes at the time, and green again in the
August 11, 2026 pre-merge run.

So a red backfill spec is not automatically a new regression: A/B it against
main before blocking a merge on it. But do NOT file it as expected noise
either. The known race is fixed, so a fresh failure most likely means a NEW
one, and it almost certainly belongs in `usePlanV2Data`.

### Close-year coverage lives in e2e/smoke/close-year.spec.ts
That spec drives `/dashboard/close-year` end to end: prefilled year fields,
free-text renaming of both years, the type-CLOSE confirmation, the redirect to
the year-end recap, and the DB state afterwards (old year archived under its new
name, exactly one active year, all three seeded goal shapes archived, the
NULL-year goal stamped onto the closed year, the archive keepsake row). It
finishes on the next-year wizard's prefill, the regression guard for 666f3c1.

It is OPT-IN and gated on the CLOSE_YEAR_SPEC env var. Run it deliberately, on
its own:

```
CLOSE_YEAR_SPEC=1 node --env-file-if-exists=.env.local node_modules/@playwright/test/cli.js test e2e/smoke/close-year.spec.ts
```

Without that variable the whole group skips, so `npm run test:e2e` sweeps
`e2e/smoke/` as usual and this spec simply reports as skipped. Running the
normal suite needs no special thought or flags.

The gate is enforced rather than advised because closing a year mutates
account-wide state (there is briefly no active year, and every goal on the old
year is archived) while spec files run concurrently across 5 workers, so an
accidental inline run would fight "Schedule Builder links goals to active year".
The spec also needs SUPABASE_SERVICE_ROLE_KEY to seed AND to restore; without it
the whole group skips too, by design, rather than running a half version it
cannot undo. Serializing the suite (workers: 1, or a dedicated project) is what
to do if it ever needs to run inline.

The spec snapshots six tables before it acts and restores them in `afterAll`,
which runs even when the test fails. If you extend the close route to write
anywhere new, extend that snapshot in the same commit, or the spec will start
leaving the shared e2e account dirty.

## Admin emails
- garfieldbrittany@gmail.com
- hello@rootedhomeschoolapp.com
- christopherwaltrip@gmail.com

## Contact email shown to users
hello@rootedhomeschoolapp.com
NEVER show hello.rootedapp@gmail.com to users.

## Brand colors
- Primary dark green: #2d5a3d
- CTA green: #5c7f63
- Hover green: #3d5c42
- Warm background: #faf8f4
- Card background: #fefcf9
- Text primary: #2d2926
- Text muted: #7a6f65
- Border: #e8e2d9

## Typography
- Headings/emotional: Lora (serif)
- Body/UI: Geist Sans
- Font weights: 400 regular, 500 medium only. Never 600 or 700.
- Sentence case always. Never ALL CAPS.

## Pricing plans
- Rooted (free): lessons, garden, resources, memories 30 days
- Rooted+ Founding Family $39/yr (ends April 30 2026): everything unlimited + yearbook PDF
- Rooted+ Standard $59/yr: same as Founding Family
- Rooted+ Monthly $9.99/mo: same features (LIVE as of July 2026; was $6.99 and hidden
  during the Founding Family window. Do not revert to $6.99 or re-hide it)
- Stripe Founding price ID: price_1TCVWDLP14EaoUlTNwZFGS8A
- Stripe Standard price ID: price_1TCVWgLP14EaoUlT25totKGW
- Stripe Monthly price ID: via STRIPE_MONTHLY_PRICE_ID env var only, never hardcoded
  (current: price_1Tqk81LP14EaoUlTBLucUTSD, $9.99/mo). The old $6.99 price
  (price_1TDwyALP14EaoUlTRKgMiqtf) is unreferenced; do not reuse it.
- Display name convention: free tier = "Rooted", all paid tiers = "Rooted+" (always use + symbol, never "Plus")

## Features BUILT (can mention to users)
- Lesson tracking (Today page)
- Family garden (emoji trees, animated)
- Memories (photo grid, unified memories table)
- Yearbook setup (/dashboard/yearbook) — preview only, no print yet
- Resources (Free Picks, Easy Wins, state info)
- Progress reports PDF
- Floating camera FAB (everywhere in dashboard)
- Getting started checklist (new users)
- Affiliate/partner system
- Transcripts (high school transcript generation per state requirements)

## Features NOT built (never mention to users)
- Kid Mode (hidden)
- Co-teacher full login (view-only only)
- Print yearbook service (preview only)
- Grandparent shareable view

## Key UX decisions (don't undo these)
- Curriculum is OPTIONAL — equal-weight skip button
- ONE floating camera button everywhere — not multiple log buttons
- State info on Resources = collapsed by default
- No Insights tab — hidden
- School tab removed from Settings
- Family photo shows ONCE on Today — in hero only
- Contact email = hello@rootedhomeschoolapp.com everywhere

## Onboarding flow
Step 0: Emotional opening — "The homeschool years go by so fast"
Step 1: Family name + kids (name + color only)
Step 2: First memory photo (before curriculum!)
Step 3: School days (Mon-Fri default)
Step 4: Curriculum (OPTIONAL — equal skip button)
Step 5: Done + Brittany founder closing moment

## Writing style
- Warm and personal — from Brittany, not corporate
- "families" not "users"
- "memories" not "logs"
- Sign-off: "Cheering you on, Brittany". NEVER "With love, Brittany" (Brittany hates it,
  removed July 2026). Do not use "with love" in any copy anywhere.
- No emoji overuse — meaningful only

## Database key tables
- profiles: user settings, plan_type, school_days (text[] of weekday labels:
  "monday".."sunday"), family_photo_url, last_catchup_dismissed_at
- children: name, color, sort_order
- lessons: completed, curriculum_goal_id, lesson_number. scheduled_date and
  date are now CACHES (Path A queue scheduling, May 2026), not the source
  of truth for what to render. Today / Plan read from
  curriculum_goals.current_lesson + lessons_per_day + school_days. Old code
  paths still write the cache columns; new read code ignores them.
  vacation_blocks rows scoped by user_id define break ranges. Queue
  projector skips these dates. Manual completions are still allowed on
  break days and advance current_lesson normally.
- curriculum_goals: curriculum_name, total_lessons, current_lesson,
  lessons_per_day, school_days (text[] of weekday labels: "Mon".."Sun",
  defaults to Mon-Fri; null/empty also normalizes to Mon-Fri at the read
  boundary)
- memories: unified memory table (photo/book/project/field_trip/art/milestone)
- app_events: legacy memory table (backward compat, still in use)
- resources: category (weekly_picks, easy_win, discounts, field_trips, printables, science)
- affiliates: partner tracking, referral codes

## Storage buckets (Supabase)
- memory-photos: user photo memories (PRIVATE — access via signed URLs, e.g.
  `signedPhotoUrlsAdmin` in lib/photo-url.ts. Raw `photo_url` values render
  blank.)
- family-photos: family profile photos (PRIVATE — signed URLs, same as above)

## Plan system (as of April 14, 2026)
Display names: "Rooted" (free), "Rooted+" (all paid tiers). Use + symbol, never "Plus".
Founding Family = pricing tier within Rooted+ ($39/yr, locked forever, ends April 30).

Three fields control feature gating:
- plan_type: NULL for free users, 'founding_family'/'standard'/'monthly'/'gift' for paid. Set ONLY by Stripe webhook.
- subscription_status: 'free' (DB default) or 'active'/'cancelled'/'refunded'. Set ONLY by Stripe webhook.
- is_pro: boolean, false by default. Set ONLY by Stripe webhook.
plan_type is NULL (not 'free') for all free users — this is intentional. Treat NULL as free in all components.
DB values are NEVER "rooted" or "rooted+" — always use founding_family/standard/monthly/gift.

## Partner / Affiliate Rules — DO NOT VIOLATE

### New partners do NOT get a comp Rooted+ subscription (effective April 2026)
When approving a new affiliate, the ONLY DB writes are:
1. INSERT a row into `affiliates` (code, stripe_coupon_id, stripe_api_id, contact_email, paypal_email, commission_rate, is_active, etc.)
2. UPDATE the matching `partner_apps` row to `status = 'approved'`

Do NOT touch the partner's `profiles` row. `plan_type`, `is_pro`, and `subscription_status` are owned by the Stripe webhook and must never be written by the partner-action flow. New partners pay for Rooted+ like any other customer.

The 9 founding partners with comped memberships are grandfathered — their profile rows stay as they are. `compPartnerProfile` in `lib/comp-partner.ts` is kept for one-off manual comping but is NOT called from the standard approval flow.

### Verify the partner dashboard after each new affiliate
After creating a new affiliate record, manually verify the **Settings → Partners** tab works for that user. The dashboard shows clicks, signups, commissions, and payout status; if any of those are broken, the partner can't track their work.

Baseline: Blair Torres (`blairkernwi@gmail.com`, code `BLAIR`) — first partner without a comp. Use her account as the reference for "what the partner dashboard should look like for a paid affiliate."

## Database state (April 11, 2026)
- 461 free profiles, 22 paid (founding_family), 1 gift edge case
- ~214 auth.users with no profile row (likely Google auth bug victims)
- No handle_new_user trigger — profile creation is in app code (auth callback)

## Security Rules

### get_user_id_by_email — service_role only
The function `public.get_user_id_by_email(text)` is a SECURITY DEFINER function that queries auth.users. Any role that can execute it can enumerate whether an email address has a Rooted account (user enumeration vulnerability), so execute is locked down to `service_role` only. The sole caller is `app/api/gift/route.ts`, which uses the SUPABASE_SERVICE_ROLE_KEY, so no anon or authenticated access is needed.

The correct permissions are:
- anon: NO EXECUTE
- authenticated: NO EXECUTE
- service_role: EXECUTE

If this function is ever dropped and recreated, run this immediately after:
```sql
REVOKE EXECUTE ON FUNCTION public.get_user_id_by_email(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_user_id_by_email(text) TO service_role;
```

Originally patched May 4, 2026 (anon revoked, authenticated retained); tightened to service_role only on July 18, 2026 (migration 20260718000000_get_user_id_by_email_lockdown.sql). Do not undo it.

### recompute_curriculum_current_lesson — service_role / trigger only
`public.recompute_curriculum_current_lesson(uuid)` is service_role and trigger only as of July 21, 2026 (migration 20260722000000_recompute_curriculum_current_lesson_lockdown.sql). It runs from the `lessons` trigger as SECURITY DEFINER, so the trigger path is unaffected; anon and authenticated no longer have execute, closing the `/rest/v1/rpc` path that let any signed-in user recompute an arbitrary goal_id. No app code calls it directly.

## Known issues
- Google auth button hidden on main — SUPABASE_URL env var fix deployed, needs testing with fresh Gmail
- CAN-SPAM: rooted-family-digest, rooted-weekly-summary, rooted-trial-warning missing unsubscribe links
- Logo: Tour/FAQ/Privacy/Terms/Contact still use old square icon (fix in CC session 2)

## Cron jobs
6 jobs in vercel.json. vercel.json is the source of truth; this list has
drifted before, so re-read the file rather than trusting the count here.
- /api/cron/reengagement: daily 2PM UTC — 3-email drip sequence for inactive users
- /api/cron/check-links: weekly Monday 9AM UTC — validate resource links
- /api/cron/weekly-summary: weekly Monday 3PM UTC — family weekly summary emails
- /api/cron/onboarding-reminder: daily 2PM UTC — nudge families who signed up but never onboarded
- /api/cron/health-check: daily 1PM UTC — smoke-checks a known memory row, emails on failure
- /api/cron/expire-subscriptions: daily 11AM UTC — ends access for cancelled subscriptions
  whose PAID TERM has run out. A family who buys a year and cancels in month
  three keeps access to the end of that year (see the customer.subscription
  .deleted branch in app/api/stripe/webhook/route.ts); refunded cancellations
  are revoked immediately by the webhook instead. Only ever touches rows that
  are cancelled AND is_pro AND past subscription_end_date.

## Auth Rules — password reset only

CORRECTION, 2026-08-18: this section used to contradict the Auth Invariants at
the top of this file, and people acted on both. The invariants at the top are
the ones that are true. What follows applies ONLY to the password-reset flow.

- The app is served at BOTH rootedhomeschoolapp.com and www.rootedhomeschoolapp.com.
  Apex 308-redirects to www, and auth cookies are written with
  `Domain=.rootedhomeschoolapp.com`, so they span both hosts.
- For PASSWORD RESET only, hardcode
  `redirectTo: 'https://www.rootedhomeschoolapp.com/reset-password'`.
- For OAuth (Google and Apple), use `${window.location.origin}/auth/callback`,
  per invariant 2 at the top of this file. Do NOT hardcode it.
- The browser client is PKCE/cookie flow, NOT implicit. `@supabase/ssr`'s
  `createBrowserClient` hardcodes `flowType: 'pkce'`; no app code sets implicit
  anywhere. The old "flowType must stay implicit" line was stale and has been
  removed.
- The Supabase allowlist must have BOTH https://rootedhomeschoolapp.com/** AND https://www.rootedhomeschoolapp.com/**
- flowType must stay 'implicit' — never change it back to 'pkce' for password reset
- After any auth change, test password reset end-to-end before shipping

## App Feature Map

### TODAY — /dashboard
Daily home base. Shows lessons, last captured memory,
Today's Story. New users (0 memories + 0 lessons) see
single activation card + contextual nudge trail.
Upgrade banner hidden until 3+ memories AND 48hrs old.

### PLAN — /dashboard/plan
Curriculum planning + lesson scheduling. Contains:
- Week/Month calendar with day selector
- Lesson checklist (tap to complete)
- Course Progress / Finish Line pacing (PAID) —
  set total lessons, school days, target date.
  Schedule is QUEUE-BASED (Path A, May 2026):
  source of truth is curriculum_goals.current_lesson
  + lessons_per_day + school_days. Today / Plan
  project forward live from the queue.
  - Today shows current_lesson + 1 .. current_lesson
    + lessons_per_day on a school day; nothing on a
    non-school day.
  - Mark a lesson complete: current_lesson advances 1.
  - Complete extra: current_lesson jumps; future
    block shifts EARLIER as a whole, finish date
    moves in.
  - Complete nothing today: current_lesson does not
    move; tomorrow re-shows today's lesson; future
    block shifts LATER as a whole, finish date moves
    out.
  - Lessons NEVER appear out of order. Manual
    queue reordering is a future PR.
  Breaks pause and resume lessons.
- Progress Report (visible to all, DOWNLOAD paid) —
  shows total school hours + individual lesson log.
  Filter by child and time period. Only hours report
  in the app. NOT a separate page.
- Breaks & Vacations — add school breaks

### GARDEN — /dashboard/garden
Visual garden where each child has a tree. Every
memory captured and lesson completed grows a leaf.
10 growth stages for parents, 5 for kids.
Kids view at /child — simplified, animated.

### MEMORIES — /dashboard/memories
All memory types: Photo, Win, Book, Field Trip,
Drawing. Filter by type, child, favorites, search.
Free: last 30 days visible, 50 photo limit.
Paid: all memories, unlimited photos.
Empty state (0 memories): warm invitation, NO locks
or upgrade messaging.
Connects to yearbook automatically.

### YEARBOOK READER — /dashboard/memories/yearbook/read
Auto-generated family yearbook. Builds itself from
memories. 100% client-side, zero API cost.
7 sections: Memories, Books, Field Trips, Drawings,
Wins, Lessons, Family.
Free: first 4 spreads. Paid: all spreads.
NEVER say "unlock" — use "View full yearbook".
Gear icon → Customize page.

### YEARBOOK CUSTOMIZE — /dashboard/memories/yearbook/edit
Single page for all yearbook settings + content.
Section toggles, cover photo upload, family name,
school year, letter from home, child interviews.
Save button → redirects to reader.

### PRINTABLES — /dashboard/printables
DOWNLOADS not just printing. Auto-filled from real
profile data. 3 styles: The Garden, The Heritage,
The Artisan (applies to all printables).

Student Achievement Certificates (per child):
Reading Achievement, Weekly Win, Learning Streak,
First Day of School, Bookworm Award, Explorer Award,
Artist Award, Daily Champion.

For the Educator Certificates (for parent):
You Started, Memory Capturer, Read Together, First
Field Trip, One Whole Week, One Whole Month, 100 Days
Strong, Memory Keeper, Story Keeper, You Did That,
Founding Homeschooler.

Graduation & Subject Completion:
- Graduation Certificate (grade level selector K-12)
- Subject Completion Certificate (child + subject name)
- Custom Certificate (any recipient, title, accomplishment)

ID Cards (require photo upload to download):
- Parent Homeschool Administrator ID Card
- Student ID Card (one per child)
- Both: 3.5" x 2", option for card back,
  "Made with Rooted" toggle

### RESOURCES — /dashboard/resources
Curated homeschool resources. NOT location-specific
(do NOT say "near you").
Sections: Today's Easy Win (daily activity idea),
This Week's Free Picks, Browse Everything.
Categories: Curriculum, Online Classes, Science
(experiments), Field Trips (virtual + in-person),
Printables (external links), Discounts, Virtual Tours,
By State, Saved.
Resources are bookmarkable. External links open in
new tab.

### SETTINGS — /dashboard/settings
4 tabs:
- Our Family: family photo, name/email/state,
  Share with Family (invite portal — viewers can
  like + comment on memories), School Year reset,
  Spread the word, Gift Rooted
- Our Kids: children list, edit/add/archive,
  Kid view link per child
- Account: subscription status, upgrade CTA,
  reset password, export data, delete account,
  admin links (admin only), sign out
- Partners: affiliate dashboard (if user is affiliate)

### SHARE WITH FAMILY — /family/[token]
Grandparent/family viewer portal. Free 90-day trial,
unlimited for paid. Viewers can like + comment on
memories. Parents can mark individual memories private.

### KIDS VIEW — /child
Simplified animated garden for kids. 5 growth stages.
Access via Settings → Our Kids → "Kid view".

### FREE vs PAID SUMMARY
Free: memories (30 days), 50 photos, full garden,
first 4 yearbook spreads, full plan, full resources,
full printables, 90-day family sharing trial.
Paid ($39/yr Founding Family): all memories,
unlimited photos, full yearbook, Finish Line pacing,
Progress Report download, unlimited family sharing.

### COPY RULES — NEVER GET THESE WRONG
- NEVER say "unlock your yearbook" — say "View full yearbook"
- NEVER show upgrade/lock messaging to 0-memory users
- NEVER say "near you" for resources — not all location-based
- NEVER say "updated weekly" for resources unless confirmed automated
- Headers use --g-brand (#2D5A3D) NOT --g-deep (#1a2c22)
- Today page has its own hardcoded header (not PageHero)
- Printables has DOWNLOADS not just printing
- Progress Report is on the Plan page, not separate
- ID cards require photo to download
