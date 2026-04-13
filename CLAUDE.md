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
- Google auth button hidden on main — SUPABASE_URL env var fix deployed, needs testing with fresh Gmail
- CAN-SPAM: rooted-family-digest, rooted-weekly-summary, rooted-trial-warning missing unsubscribe links
- Logo: Tour/FAQ/Privacy/Terms/Contact still use old square icon (fix in CC session 2)

## Cron jobs
3 jobs in vercel.json — see file for current state after session 4 cleanup.
- /api/cron/reengagement: daily 2PM UTC — 3-email drip sequence for inactive users
- /api/cron/check-links: weekly Monday 9AM UTC — validate resource links
- /api/cron/weekly-summary: weekly Monday 3PM UTC — family weekly summary emails

## Auth Rules — Never Break These
- The app is served at BOTH rootedhomeschoolapp.com and www.rootedhomeschoolapp.com
- NEVER use window.location.origin for Supabase redirectTo — it will return www and break auth
- ALWAYS hardcode: redirectTo: 'https://www.rootedhomeschoolapp.com/reset-password' (or whichever path)
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
  Rooted auto-schedules. Missed lessons
  auto-reschedule. Breaks pause and resume lessons.
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
- NEVER say "transcripts" — not built yet
- NEVER say "unlock your yearbook" — say "View full yearbook"
- NEVER show upgrade/lock messaging to 0-memory users
- NEVER say "near you" for resources — not all location-based
- NEVER say "updated weekly" for resources unless confirmed automated
- Headers use --g-brand (#2D5A3D) NOT --g-deep (#1a2c22)
- Today page has its own hardcoded header (not PageHero)
- Printables has DOWNLOADS not just printing
- Progress Report is on the Plan page, not separate
- ID cards require photo to download
