# Rooted — Where We Are

Your one place. Open this first, every time. I keep it updated so you don't have to
hold it all in your head.

Last updated: July 8, 2026, overnight session close (marathon day: 4 production ships)

## SESSION CLOSE July 10 — monthly verified end to end + Resend webhook fixed
DONE TODAY, ALL VERIFIED IN PRODUCTION:
- MONTHLY PLAN VERIFIED END TO END with a real $9.99 subscription (fresh test account
  hello.rootedapp+monthlytest@gmail.com): checkout charged $9.99 on the new price,
  profile flipped to plan_type=monthly instantly, welcome + admin emails sent, cancel
  flow returned the account to free, charge refunded. Test account remains as a free
  account; delete whenever.
- CAUGHT + FIXED: the rooted-welcome-standard Resend template told monthly subscribers
  "Your $59 a year unlocks everything." Now price-neutral ("Your Rooted+ membership
  unlocks everything Rooted has to offer:") and PUBLISHED in Resend. Only the test saw
  the wrong copy.
- Pricing page (/dashboard/pricing) now shows the $9.99 Monthly card; admin partners
  label fixed. Commit b5d2f9e merged to main, production deploy READY.
- Old $6.99 Stripe price ARCHIVED (was still active). Founding $39 price left active
  on purpose. STRIPE_MONTHLY_PRICE_ID confirmed = price_1Tqk81LP14EaoUlTBLucUTSD.
- ITEM 0 CLOSED — RESEND WEBHOOK FIXED: root cause was 401 Invalid signature (Vercel
  secret didn't match the webhook's signing secret). Secret synced, redeployed,
  endpoint re-enabled, all 75 failed events replayed: 42 unique hard-bounced addresses
  now suppressed in DB + Resend + profile flags. Bounce tracking live going forward;
  resend-to-non-openers is unblocked.
NEXT UP (order unchanged): affiliate Part A promo-code check at monthly checkout, then
send the affiliate touch-base draft; founder dashboard overhaul prompt; review-ask
email to paying families; landing page Monthly; native polish; THE ONBOARDING DESIGN
SESSION.
SMALL BACKLOG: welcome template firstName/dashboardUrl fallbacks + preview text in
Resend; webhook suppresses ALL bounces including Transient (consider hard-only later);
Supabase SECURITY DEFINER advisor warnings.

## PICK UP HERE July 10 (morning)
Last night ended with the affiliate commissions prompt RUNNING in CC (Parts A/B/C:
monthly commission verify, month-by-month partner records, comped-account button fix).
MORNING ORDER:
1. Read CC's affiliate report. Part A gates everything: does the 15% code work at
   monthly checkout, and are renewals guarded from accruing commission? Approve any
   backfill SQL it proposes. Verify on staging, then merge.
2. Send the affiliate touch-base email (Gmail drafts, BCC to all 13). Only after
   Part A confirms the promises in it are true.
3. Fix the Resend webhook (item 0 below). Ten minutes, gates the non-opener resend.
4. Run docs/saved-plans/cc-prompt-founder-dashboard-overhaul.md (one CC window,
   after affiliate work is committed).
5. Review-ask email to the 57 paying families (moon plan lever 1, Claude drafts).
6. Then: landing page Monthly, native polish, and THE ONBOARDING DESIGN SESSION
   (Brittany + Claude, one hour, no code; the highest-leverage hour available).
WATCHING: first Monthly subscriber (email went to 1,451 at ~9pm July 8 PT; window is
24-72h), first organic grandparent reaction, Instagram post performance.
KEY DOCS: MOON-PLAN-back-to-school-2026.md (growth levers ranked),
APP-AUDIT-2026-07-08.md (full product audit), May-June-2026-Close-Summary.md
(books closed; CPA tracker is canonical). All in docs/saved-plans + Rooted Finances.

## SESSION CLOSE July 9 (launch day) — newest on top
SHIPPED AND VERIFIED July 9:
- MONTHLY ANNOUNCEMENT EMAIL SENT to 1,451 free families (2 suppressed, 4 malformed
  addresses). Sender survived a Resend rate-limit incident with zero double-sends;
  pacing fix shipped. Instagram post live same evening. Watch Stripe for first
  monthly/annual subs over 24-72h.
- MERGED TO MAIN + production READY (96a089b): school-year stranding-proof close flow
  (Jessica bug hardening, recovery card, en dash parser), email sender, wordmark,
  pacing fix. Verified deploy dpl_23MXda6dK... aliased to both domains.
- Jessica Gauder's account fixed same-day; reply sent; she lost nothing.
- May + June books CLOSED (see Desktop/Rooted_2026_CPA_Tracker 2.xlsx + Rooted
  Finances/2026/May-June-2026-Close-Summary.md). Affiliates: $0 was due June 1 and
  July 1, confirmed; only payout ever was May 1 $43.29, fully recorded.
- Affiliate touch-base email DRAFTED in Gmail (13 partners, BCC). HOLD until the
  affiliate commission prompt's Part A confirms codes work at monthly checkout and
  renewals don't accrue commission. Commission rule decided: 20% of FIRST payment,
  any plan.
NEXT UP (in order):
0. FIX THE RESEND WEBHOOK (found July 9, late): Resend disabled the webhook to
   /api/webhooks/resend on July 3 (email in hello inbox). Zero bounce/complaint
   suppressions have ever recorded; last night's 1,451-send bounces went untracked.
   Fix: Resend dashboard > Webhooks > find why it failed (the endpoint may error),
   fix endpoint, re-enable, send test event. Small CC prompt or 10-minute manual.
   Do BEFORE any resend-to-non-openers. Note: unsubscribe flow verified working in
   production (1 real unsubscribe post-announcement, 0.07% rate, healthy).
1. Run docs/saved-plans/cc-prompt-affiliate-monthly-commissions.md (Parts A/B/C:
   verify monthly commission capture, month-by-month partner records, comped-account
   Manage Subscription fix). AFTER it reports, send the affiliate email draft.
2. Landing page Monthly (landing-page-redesign branch, CC has line numbers).
3. Native polish phase 1 (prompt written), then the onboarding design session (the
   main event, before back-to-school).

## SESSION CLOSE July 8 — read this first with coffee
SHIPPED TO PRODUCTION July 7-8, all verified live:
1. Monthly plan at $9.99 (Stripe price + env var + upgrade page + checkout tested end
   to end; Stripe product renamed "Rooted+" so checkout reads right)
2. Family portal reaction fix (3-layer bug: emoji mismatch + DB constraint + NOT NULL
   family_token; reactions NEVER saved before; now verified saving) + love-hint UI
3. Metadata em dash cleanup + CLAUDE.md pricing/sign-off rules
4. FAQ pricing truth (both prices + 2 new billing Q&As + growth stages) + phantom
   Insights tab removed from tour
ALSO DONE OVERNIGHT:
- Full app audit: docs/saved-plans/APP-AUDIT-2026-07-08.md (READ SECTION 1 FIRST)
- Curriculum integrity review: docs/saved-plans/curriculum-integrity-review-2026-07-07.md
  (H fix declined = 6 families protected; CC caught my Spanish-goals error = 1 child's
  course protected; only DB write was a 2-row child_id patch, verified twice)
- Scheduled audit task rewritten (query v3: queue_position-based H, no-DELETE standing
  rule, Blair baseline recorded) so future 8am runs are honest
- CC queued a read-only investigation: why queue_resync skips Blair's goal 49ce90dc

MORNING CHECKLIST, in order:
1. Approve/edit the Monthly announcement email:
   docs/saved-plans/monthly-announcement-email-draft.md (verify unsubscribe footer
   before sending). Fastest revenue action available.
2. Landing page Monthly: CC's July 7 report has exact line numbers; belongs on the
   landing-page-redesign branch. Second fastest.
3. Run native polish phase 1: docs/saved-plans/cc-prompt-native-polish-phase1.md
   (needs one Xcode/Android Studio rebuild at the end).
4. Then THE MAIN EVENT: design session (Brittany + Claude) for onboarding that ends on
   a saved memory + family invite. The audit confirmed current onboarding has NO
   capture step at all. Do this before back-to-school traffic (~6 weeks out).
5. Whenever: back-to-school IG post about $9.99 (Claude offered to draft), the tour
   Garden card's old stage names, audit SQL into version control (low priority).
LOOSE ENDS: delete the "Ella reacted" test emails from your inbox; a Chrome tab may
still be logged into the test account; the old $6.99 Stripe price is unreferenced
(archive whenever); admin summary API is slow (15-20s, known, admin-only).

## July 9: Jessica Gauder bug (Close This School Year stranding)
User report -> root cause in ~30 min: the close-year route archived her old year then
crashed (step 11, snapshot insert) before creating the new one. No active year = Plan
and Today filter everything out + edits silently fail. She was the ONLY user in this
state. DATA FIXED July 9 (new active 2026-2027 year, 5 goals + 273 lessons repointed).
Reply drafted in Gmail. Code hardening prompt sent to CC:
docs/saved-plans/cc-prompt-fix-school-year-close.md (stranding-proof flow, en dash name
parse bug, recovery card, Sentry visibility). Also found: close failures return handled
500s that never reach Sentry, which is why this sat invisible since June 19.
Note: her duplicate "Violet Grace" child profile is her workaround artifact; she'll
remove it or we will on her reply.

## Status: shipped and live
- The entire yearbook overhaul is LIVE in production (commit 68dc934).
- Tiny Moments + Adventure Pages (e612dcb) is LIVE in production. It rode along with the
  break fix merge (198238d), so no separate merge was needed. Verified July 7: main and
  staging are identical, all 6 pre-merge QA checks pass, "Adventures Together" shows in
  the yearbook table of contents.
- Break edit/delete fix (198238d) is live on main.
- A QA pass + copy fixes also shipped (commit 9b989fb, deploy READY): the monthly card
  placeholder em dash is now a comma, the editor toggle reads "Looking back 🌿" instead
  of "Year in Numbers 📊", and every user-facing em dash on the 9 public pages (landing,
  tour, FAQ, upgrade, privacy, contact, signup, two family views) is gone. En dashes and
  the "— Zoe" quote attributions were left as-is on purpose. Verified clean on main.
- What's New got 2 of the 4 new cards (One question a month + New keepsake pages).
- All plans/audits are saved in this repo at docs/saved-plans/ so they travel with the
  project.

## Live on production (the entire yearbook revamp — shipped June 29)
- Photo collages that never crop + fill the page (mosaic)
- Themes: The Garden / Heirloom / The Gallery
- Book-like wording (cover line, real chapter names, "Dear Future Us" letter, "Until
  Next Year" closing)
- "Looking Back" recap = named lists (books, places, moments), no number-stats
- Year-End Conversation (new questions) + decoupled Favorites
- Tiny Masterpieces (drawings) page
- Wave 2 keepsake pages: This Was {Child}, Things I Never Want to Forget, Open When
  You're Grown
- One Question a Month: a monthly question card on Today + a year-end "Our year, month
  by month" spread (their real words, no AI)
- Edit controls: reposition, reorder, feature, hide
- Plus earlier: First Day Photo frame, Lesson photos, Family-preview fix,
  Re-engagement email fix

## THE ONE INSIGHT DRIVING EVERYTHING (from your July 7 data)
Conversion tracks memory-capture almost perfectly: 0 memories = 1.4% pay, 5-19 = 37%,
20+ = 78%. But only 8% of signups ever capture ONE memory, and 9 were active last week.
Your product converts itself once used. The whole game is ACTIVATION: get a family to
their first 5 memories, then keep them coming back. North star: memories per new family.
Full detail in PLAN-duolingo-level-rooted.md.

## NEW July 8: full app audit done overnight
docs/saved-plans/APP-AUDIT-2026-07-08.md. Read section 1 first: FAQ still sells only
$59/yr (contradicts the live Monthly plan), landing has no Monthly, tour still shows
the phantom Insights tab, and a Monthly announcement email to ~1,400 onboarded free
families is the fastest revenue action available. Also confirmed in code: onboarding
currently has NO memory capture step at all (name, location, about, kids, school year,
celebration), which makes the activation fix even more clearly the main event.

## Next up (one order, highest-leverage first)
1. SHIP MONTHLY at $9.99 (price confirmed July 7):
   - DONE: Stripe monthly price created (live): price_1Tqk81LP14EaoUlTBLucUTSD
   - DONE: STRIPE_MONTHLY_PRICE_ID updated in Vercel (All Environments). It previously
     pointed at the old $6.99 price (price_1TDwyALP14EaoUlTRKgMiqtf), which still exists
     in Stripe but is no longer referenced. Takes effect on the next deploy.
   - DONE, LIVE IN PRODUCTION July 7 evening (merge commit on main, deploy of 0b9b9b2
     READY on www.rootedhomeschoolapp.com). Verified live: /upgrade shows 3 cards,
     $9.99/mo, annual gold-featured "Save $61 a year", /api/stripe/plans returns
     monthly:true, metadata em dash gone, Today/Plan/Memories all healthy.
   - Operational gotcha learned: pushing main right after the same SHA built on staging
     can make Vercel skip the production deploy (same-SHA dedup). Fix: dashboard
     "Create Deployment" from main (builds with Production env vars). Do NOT "promote"
     a staging preview build; it would carry Preview env vars.
   - TODO Brittany: sanity check /upgrade on the phone with the test account (free, shows
     real Subscribe buttons). Optionally do a real $9.99 checkout end to end.
   - NOTE: landing page (app/page.tsx) still hides Monthly; that change belongs on the
     landing-page-redesign branch (CC left exact line numbers in its July 7 report).
     FAQ + UpgradeBanner still only mention $59/yr; fine, but could mention Monthly later.
   (Tiny Moments merge is DONE, see status above.)
2. NATIVE POLISH phase 1 (fast "real app" feel, zero auth risk): haptics + branded splash
   + status bar/safe areas + native share. See PLAN-make-rooted-feel-native.md.
3. ACTIVATION FIX (the emergency): onboarding ends on a saved memory; prompt family invite
   in onboarding. This is where growth unlocks.
   NOTE (checked July 7): the family comments/reactions save bug is ALREADY FIXED and on
   main (May 23; route app/api/family/[token]/comment works, test rows in DB, UI posts
   correctly). The real problem is adoption, not the code: 34 invites, 20 visited, ZERO
   organic comments or reactions in 6 weeks. One viewer was actively browsing today and
   never engaged. So item 3 = drive the loop (invite in onboarding + make reacting
   irresistible in the portal), not a bug fix.
   UPDATE (July 7 late evening): REACTIONS NEVER SAVED AT ALL. Three layers of the same
   bug, all found and fixed tonight:
   1. UI/API emoji list mismatch (🙌 😍 rejected) — fixed by CC in 1da0bf3 (shared
      constant + rollback on non-ok + 44px targets + one-time "send some love" hint).
   2. DB CHECK constraint still had the old emoji list — fixed by live migration.
   3. THE BIG ONE: memory_reactions.family_token (and memory_comments.family_token) were
      NOT NULL legacy columns the routes never write, so EVERY reaction insert failed
      silently while the API returned 200 (and still emailed the mom). Fixed by live
      migrations dropping NOT NULL on both.
   VERIFIED end to end on staging (twice, including through the hardened route in
   e9865b6): a reaction persists across reloads, lands in the DB with BOTH token columns,
   and toggle-off works. Test data cleaned up (one May ❤️ remains, which is real).
   SHIPPED July 7 late night: merged to main (e9865b6), production deploy READY on
   www.rootedhomeschoolapp.com, verified live (hint + big reaction chips render on the
   real portal). Grandparents can finally send love and it will actually save.
   Also confirmed: parent-written captions DO show in the family feed (loader selects
   caption, FamilyFeed renders it under the date). Bare cards just have no caption.
   Note: the family portal fixes are safe to merge independently of native polish, which
   has NOT been run yet (cc-prompt-native-polish-phase1.md still queued).
4. LOCAL NOTIFICATIONS (the habit engine): soft-ask after first memory, gentle weekly
   nudges, garden never wilts, no guilt copy. Then On-This-Day + rotating daily prompt.
5. REMOTE PUSH (OneSignal): weekly recap, garden growth, yearbook milestone, trial nudge.
6. PAYWALL MOVE + trial test (value-moment paywall; A/B 3-day vs 30-day trial).
7. SMALL STUFF whenever: First Day Photo on tour/landing; align the tour Garden card's
   old stage names (CC flagged July 8). DONE July 8: FAQ pricing reflects Monthly +
   2 new billing Q&As, growth stages answer fixed, phantom Insights tab removed from
   tour, metadata em dashes gone. All LIVE in production (a36acfe).

## Parked on purpose (do NOT spend time here until activation works)
- Yearbook stickers/embellishments + in-book edit mode + the yearbook_overrides table
  (Phase 3.3). The yearbook is already beautiful; this is polish.
- Print-quality PDF (DocRaptor) + print & ship the physical book (Lulu/Gelato + Stripe).
  A real future revenue line, but only matters once families are engaged enough to want a book.
- Optional yearbook layout controls (per-day layout, move-to-own-page).

## Reference docs (all in docs/ and docs/saved-plans/)
- YEARBOOK-CUSTOMIZATION-ROADMAP.md — controls + print roadmap
- YEARBOOK-CONTENT-REVAMP.md — all keepsake wording + the waves
- saved-plans/Printed-Yearbook-The-Full-Path.md — exact path to a printed book + costs
- saved-plans/Rooted-Back-to-School-Growth-Plan.md — the revenue plan
- saved-plans/Rooted-Public-Pages-Audit-2026-06-24.md — marketing-page audit
- saved-plans/ also holds the app checkup, email audits, and all CC prompts

## One travel note
The re-engagement "did it send" check is scheduled for ~8am, but scheduled tasks only
run while the Claude app is open — if your Mac is off, it'll run the next time you open
the app. Not a problem, just so you're not surprised.

## How we work (so it stays calm)
One Claude Code build at a time on the yearbook (shared files): staging → I verify →
next. You paste me CC's report; I hand you the next prompt. I update this page at the
end of each session.
