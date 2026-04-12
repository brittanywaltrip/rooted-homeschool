# Rooted Homeschool — Claude Code Context

## What is Rooted?
A living memory book that also plans your homeschool.
Tagline: "Stay Rooted. Teach with Intention."
Hero copy: "The homeschool years go by so fast. Rooted helps you plan your days, capture the moments, and hold onto it all."

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
- Free: lessons, garden, resources, memories 30 days, 1 AI Family Update/month
- Founding Family $39/yr (ends April 30 2026): everything unlimited + yearbook PDF
- Standard $59/yr: same as Founding
- Monthly $6.99/mo: same features as annual plans
- Stripe Founding price ID: price_1TCVWDLP14EaoUlTNwZFGS8A
- Stripe Standard price ID: price_1TCVWgLP14EaoUlT25totKGW

## Features BUILT (can mention to users)
- Lesson tracking (Today page)
- Family garden (emoji trees, animated)
- Memories (photo grid, unified memories table)
- Yearbook setup (/dashboard/yearbook) — preview only, no print yet
- Resources (Free Picks, Easy Wins, state info)
- Progress reports PDF
- AI Family Update (1/month free, unlimited paid)
- Floating camera FAB (everywhere in dashboard)
- Getting started checklist (new users)
- Affiliate/partner system

## Features NOT built (never mention to users)
- High school transcripts
- AI Graduation Letter
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
- Sign-off: "With love, Brittany" or "Cheering you on, Brittany"
- No emoji overuse — meaningful only

## Database key tables
- profiles: user settings, plan_type, school_days, family_photo_url, ai_update_last_generated
- children: name, color, sort_order
- lessons: scheduled_date, completed, curriculum_goal_id
- curriculum_goals: curriculum_name, total_lessons, current_lesson
- memories: unified memory table (photo/book/project/field_trip/art/milestone)
- app_events: legacy memory table (backward compat, still in use)
- resources: category (weekly_picks, easy_win, discounts, field_trips, printables, science)
- affiliates: partner tracking, referral codes

## Storage buckets (Supabase)
- memory-photos: user photo memories (public)
- family-photos: family profile photos (public)

## Plan system (as of April 11, 2026)
Three fields control feature gating:
- plan_type: NULL for free users, 'founding_family'/'standard'/'monthly'/'gift' for paid. Set ONLY by Stripe webhook.
- subscription_status: 'free' (DB default) or 'active'/'cancelled'/'refunded'. Set ONLY by Stripe webhook.
- is_pro: boolean, false by default. Set ONLY by Stripe webhook.
plan_type is NULL (not 'free') for all free users — this is intentional. Treat NULL as free in all components.

## Database state (April 11, 2026)
- 461 free profiles, 22 paid (founding_family), 1 gift edge case
- ~214 auth.users with no profile row (likely Google auth bug victims)
- No handle_new_user trigger — profile creation is in app code (auth callback)

## Known issues
- 214 ghost accounts — users in auth.users with no profile row, caused by Google auth bug. Backfill script at scripts/backfill-missing-profiles.ts, admin endpoint at /api/admin/backfill-profiles.

## Fixed (April 11, 2026)
- Google auth: was broken (PKCE flow mismatch — browser used implicit flow, server expected PKCE code). Fixed by: createBrowserClient from @supabase/ssr for OAuth calls (lib/supabase-browser.ts), flowType: 'pkce' in lib/supabase.ts, NEXT_PUBLIC_SUPABASE_URL in auth callback.
- CAN-SPAM: added unsubscribeUrl to weekly-summary, trial-warning, and family-digest cron emails.
- Logo: replaced old square emoji icon with rooted-logo-nav.png wordmark on FAQ, Privacy, Terms, Contact, Login, Signup pages.
- Resend email templates: all now use wordmark logo; welcome templates updated with "Add curriculum" nav fix (was "Add Subject").
- Consolidated duplicate reengagement cron (removed old /api/cron/re-engagement route).

## Cron jobs
3 jobs in vercel.json — see file for current state after session 4 cleanup.
- /api/cron/reengagement: daily 2PM UTC — 3-email drip sequence for inactive users
- /api/cron/check-links: weekly Monday 9AM UTC — validate resource links
- /api/cron/weekly-summary: weekly Monday 3PM UTC — family weekly summary emails
