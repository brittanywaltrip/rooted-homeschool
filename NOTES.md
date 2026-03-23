# Rooted Homeschool — Product Bible & Session Handoff

> Last updated: March 23, 2026 (v2 launch + affiliate system + Phase 1 & 2 shipped)
> This file is the source of truth for the app vision, decisions, architecture, and what comes next.
> Read this before every Claude Code session.

---

## The North Star

A mom opens Rooted every morning because it makes her feel calm, prepared, and proud — not overwhelmed. She checks off lessons with one tap, logs a memory of the volcano they built, and gets a gentle "you did it" at the end of the day. At the end of the month the app writes her family's story and she sends it to grandma. Every decision should serve this.

---

## The One-Sentence Vision

Rooted replaces three things homeschool moms currently need separately:
1. **Facebook groups** → Resources tab
2. **A planner/spreadsheet** → Today + Plan
3. **A scrapbook/journal** → Memories

---

## Tech Stack

- **Framework**: Next.js (App Router, "use client" where needed)
- **Styling**: Tailwind v4 (inline @theme, no tailwind.config.ts)
- **Database**: Supabase (Postgres + RLS + Auth)
- **Hosting**: Vercel (auto-deploys on push to any branch)
- **Email**: Resend + ImprovMX forwarding to hello@rootedhomeschoolapp.com
- **Payments**: Stripe (Apple Pay + Google Pay enabled)
- **Fonts**: Lora (serif, ALL headings via font-serif) + Geist (sans, body)
- **GitHub**: brittanywaltrip/rooted-homeschool
- **Supabase project**: gvkbegvvmhcrmxdorctk
- **Live URL**: rootedhomeschoolapp.com
- **Staging URL**: rooted-homeschool-git-staging-brittanywaltrips-projects.vercel.app
- **Safety net branch**: staging-backup-mar22 (DO NOT DELETE)

---

## Design System (non-negotiable)

| Token | Value | Used for |
|-------|-------|---------|
| Dark green | #3d5c42 | Primary brand, hero backgrounds, buttons |
| Medium green | #5c7f63 | Secondary buttons, accents, progress bars |
| Warm off-white | #f8f7f4 | Page backgrounds |
| Warm white | #fefcf9 | Cards |
| Warm border | #e8e2d9 | All card borders |
| Near-black | #2d2926 | Primary text |
| Muted | #7a6f65 | Secondary text, labels |

- **Headings**: font-serif (Lora), bold — NEVER Geist for headings
- **Border radius**: rounded-xl (12px) inputs/buttons, rounded-2xl (16px) cards
- **App Store feel**: clean, flat, purposeful — no gradients, no decorative shadows

---

## Navigation (final)

**5 bottom nav tabs (mobile) / sidebar (desktop):**
1. Today → /dashboard
2. Plan → /dashboard/plan
3. Garden → /dashboard/garden
4. Memories → /dashboard/memories
5. Resources → /dashboard/resources

**Settings**: avatar top-right → /dashboard/settings. NOT a nav tab.
**Sign Out**: bottom of Settings page, below Help & More. Visible all screen sizes.

---

## Key Distinction — Two Separate Actions on Today

- **Checking off a lesson** = tapping the checkbox on a preset curriculum lesson. One tap, instant green, leaf animation. This is the daily tracker habit.
- **"+ Log something"** = opening the memory scrapbook to record a field trip, book, project, photo, reflection. Completely separate intent. Do NOT conflate these.

---

## Page-by-Page Purpose

### Today (/dashboard)
- **School day**: lesson list per child, tap to check off, progress bar, week strip dots, streak counter, contextual greeting, "+ Log something" FAB
- **Non-school day**: "No school today" hero, "Coming up [next school day]" preview
- **All done**: celebratory greeting, "Capture a memory from today?" prompt, tomorrow preview. Friday: week recap.
- **Vacation**: ocean-blue hero, vacation name, palm tree, return date. Lesson list hidden.
- Priority order: vacation > non-school-day > school day
- Contextual greetings rotate by day of week, time of day, streak, all-done state

### Plan (/dashboard/plan)
- Calendar view (week + month toggle) with dots on school days
- school_days pulled from profile (set during onboarding)
- Pace cards per curriculum with finish dates
- "+ Add break" and "+ Add vacation" buttons

### Garden (/dashboard/garden)
- EMOTIONAL page — trees grow with lessons. NOT a data dashboard.
- Sections: garden scene → stat cards → subject progress bars → milestone badges → export buttons
- NOTE: Currently skews young/female. Future: alternate themes for older kids/boys (adventure map, space, etc.)

### Memories (/dashboard/memories)
- **This is the killer feature.** Daily logging → monthly AI update → share with grandparents = the moment that makes moms cry and share the app.
- AI Family Update card at TOP
- Chronological timeline below
- Once/month: surface the update on Today's hero ("Your March update is ready ✨") — don't bury it here

### Resources (/dashboard/resources)
- Replaces Facebook groups. Primary feature.
- Know your state + curated weekly picks + educator deals
- NO compliance language — informational only

### Settings (/dashboard/settings)
Tabs: Our Family · Our Kids · Account · Partners (admin only)
- Our Family: photo (upload working), name, email, state. Shows "Saved ✓" inline after save. Calls refreshProfile() after every save so Today updates immediately.
- Partners tab (admin): table of affiliates — code (tap to copy), link (tap to copy), clicks, families, revenue, status
- Affiliates see own stats in Account tab
- TODO: Settings Our Family tab needs a full restyle (backlogged)

### Admin (/admin)
- Accessible from Settings → Account → "Founder Dashboard"
- Has ← Back to app link
- /admin/resources has ← Back to admin link
- Session refresh on load prevents 403 from expired tokens

---

## What Is Hidden (do not delete)

- /dashboard/challenges — revisit at 3 months
- /dashboard/insights — revisit at 3 months
- /dashboard/growth — merged into Garden
- /dashboard/journey — merged into Garden
- /dashboard/progress — replaced by pace cards
- /dashboard/graduation — needs 1+ yr of data
- /dashboard/welcome — onboarding artifact
- /dashboard/more — absorbed into Settings

---

## Database Schema
```
profiles: id, first_name, last_name, display_name, family_photo_url, state,
          subscription_status, is_pro, onboarded, plan_type,
          school_days[], school_year_start, school_year_end, partner_email

children: id, user_id, name, grade, color
lessons: scheduled per child per day based on school_days
app_events: field trips, books, projects, activities, photos
daily_reflections: is_private flag
vacations: id, user_id, name, start_date, end_date
affiliates: id, user_id, name, code, stripe_coupon_id, paypal_email, is_active, clicks, created_at
```

### Affiliates RLS:
- `auth.uid() = user_id` — affiliates see own row
- `auth.jwt() ->> 'email' IN ('garfieldbrittany@gmail.com', 'christopherwaltrip@gmail.com')` — admins see all

---

## Pricing

| Plan | Price | Stripe ID |
|------|-------|-----------|
| Free | $0 | — |
| Founding Family | $39/yr | price_1TCVWDLP14EaoUlTNwZFGS8A |
| Standard | $59/yr | price_1TCVWgLP14EaoUlT25totKGW |

Founding Family ends April 30, 2026. First 200 families only.

---

## Affiliate / Partner Program

- Referral link: rootedhomeschoolapp.com/upgrade?ref=CODE
- Auto-applies 15% discount via Stripe promotion code at checkout
- 20% commission, paid 1st of month via PayPal Business
- All partners get Founding Family comped (SQL, no Stripe sub)
- Click tracking: /api/affiliate/track-click?code=CODE on upgrade page load
- Do NOT create a new plan_type for affiliates — use affiliates table

### Admin emails: garfieldbrittany@gmail.com, christopherwaltrip@gmail.com

### Current Partners

| Name | Code | Coupon | PayPal | Joined |
|------|------|--------|--------|--------|
| Amber Cody | AMBER | H9P6S2Cu | acody93@aol.com | Mar 23, 2026 |

### New Partner SOP (~5 min)
Full doc: Rooted-Partner-SOP.docx on desktop

1. Stripe: create coupon (15% forever) → add promo code (FIRSTNAME ALL CAPS)
2. Supabase SQL:
```sql
SELECT id FROM profiles WHERE email = 'their@email.com';
INSERT INTO affiliates (user_id, name, code, stripe_coupon_id, paypal_email, is_active)
VALUES ('id', 'Name', 'CODE', 'coupon-id', 'paypal@email.com', true);
UPDATE profiles SET plan_type='founding_family', is_pro=true, subscription_status='active'
WHERE email = 'their@email.com';
```
3. Send welcome email (template in SOP doc)
4. Add row to Current Partners table above

---

## CRITICAL: Auth Architecture

Rooted uses **localStorage-based auth** via `createClient`. Sessions stored in browser, NOT cookies.

### NEVER add auth checks to middleware.ts
Middleware reads cookies → finds nothing → redirects to /login → all users locked out.
```ts
export function middleware(request: NextRequest) {
  // Stripe webhook bypass only. Nothing else. No auth checks ever.
  return NextResponse.next()
}
```

### Admin pages use refreshSession() pattern (applied Mar 23):
```ts
supabase.auth.onAuthStateChange(async (event, session) => {
  if (event === 'INITIAL_SESSION') {
    const { data: refreshed } = await supabase.auth.refreshSession()
    const token = refreshed.session?.access_token ?? session.access_token
    await fetchData(token)
  }
})
```

### If stuck on "Logging in...": check middleware.ts immediately.

---

## What's NOT Allowed

- No compliance language anywhere
- No nav tab for Settings
- No More tab in nav
- No Reports tab in nav
- No progress bars/lesson lists on non-school days
- No rebuilding pages from scratch without explicit instruction
- No new plan_type for affiliates — use affiliates table

---

## MASTER BACKLOG (as of March 23, 2026)

Goal: 10/10 core experience before growth features.

### SHIPPED ✅
- Phase 1: school_days wired to Today, vacation state, auto-capitalize onboarding
- Phase 2: contextual greetings, week strip (M T W T F dots), streak counter
- Settings: photo upload fixed, name change refreshes Today instantly, "Saved ✓" feedback
- Admin: back navigation, session refresh fix, old /admin/dashboard removed
- Affiliates: click tracking, Partners table, RLS fixed, Amber onboarded

### PHASE 3 — Connect Today → Memories (next up)
1. After all-done state: show "Capture a memory from today?" prompt — one tap, date pre-filled
2. Surface AI family update on Today hero once/month ("Your March update is ready ✨")
3. Memories logging streak ("You've captured something 4 days this week")
4. Monthly update as a beautiful shareable card image

### PHASE 4 — Garden emotional payoff
5. Faster early growth — meaningful visual change within first 3-5 lessons (currently looks like sticks too long)
6. Milestone badge celebrations — burst/confetti animation when earned
7. Alternate Garden themes for older kids/boys — adventure map, space, building (backlogged, not urgent)

### PHASE 5 — Polish that drives word of mouth
8. Settings Our Family tab restyle — cleaner layout, better photo section, feels premium
9. Weekly recap as shareable card — Friday all-done generates image: "The [Family] school week 🌱 · 10 lessons · 1 book"
10. Garden screenshot mode — clean shareable image of family garden scene
11. Vacation palm trees in Garden SVG scene

### PHASE 6 — Partner + affiliate tools
12. Partner Toolkit in Settings — QR code generator, pre-written captions, content ideas
13. "Share Rooted" for regular users — personal referral link, QR, copy button (no reward yet)
14. $5 credit reward system — wait until 500+ families

### PHASE 7 — Future (do not build yet)
15. Transcript builder (high school moms)
16. Co-teacher full access system
17. Kid Mode polish
18. Graduation slideshow (needs 1+ yr data)
19. Garden Wave 2: seedling → sprout → tree → fruit tree
20. Gather: community platform for co-ops (post-Rooted, 500+ families)

---

## Pending Business Tasks
- PayPal Business setup (Finicity failing — try manual or call 1-888-221-1161)
- Update Stripe to Mercury bank account
- ImprovMX DNS propagation → update emails in FAQ/Privacy/Terms

---

## Workflow: Staging → Main

ALL new development goes to **staging** branch first.
Test on: rooted-homeschool-git-staging-brittanywaltrips-projects.vercel.app
When verified → open PR staging → main → merge.

**Never push directly to main for feature work.**

---

## How to Start a New Claude Session
```
I'm building Rooted Homeschool (rootedhomeschoolapp.com) — a Next.js/TypeScript/Tailwind v4/Supabase/Vercel app.
GitHub: brittanywaltrip/rooted-homeschool | Active branch: staging | Safety net: staging-backup-mar22 (DO NOT DELETE).
Read NOTES.md on main before doing anything.
Today I need help with: [describe what you need]
```

## How to Work With Claude Code
- Always say "Read NOTES.md before making any changes"
- Always say "Active branch: staging. Do NOT touch main."
- Always say "run npm run build and fix all TypeScript errors before committing"
- End with a commit message

---

## Stats (March 23, 2026 — v2 launch day)

- **233 real families** | **6 paying** @ $39/yr = $234 ARR (~$20 MRR) | **1 comped partner**
- Today: 15 signups | Yesterday: 46 | Funnel: 26% set up subjects, 12% logged a lesson
- 417 total children | avg 1.7/family | 48 curricula set up

### Paying customers (6)
1. Amanda Deardorff — Mar 18
2. Amber Hudson Slaughter — Mar 20
3. Donna Ward — Mar 20
4. Lacie Hawkins — Mar 21
5. Christopher Waltrip — Mar 21
6. Joselyn Minchey — Mar 21

### Comped: Amber Cody (AMBER) — Mar 23
### Refunded/deleted: garfieldbrittany@gmail.com — Mar 23
