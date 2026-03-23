# Rooted Homeschool — Product Bible & Session Handoff
> Last updated: March 23, 2026
> This file is the source of truth for the app vision, decisions, architecture, and what comes next.
> Read this before every Claude Code session. Reference it when starting a new Claude conversation.

---

## The One-Sentence Vision

Rooted replaces three things homeschool moms currently need separate tools for:
1. **Facebook groups** → Resources tab (curriculum picks, deals, field trips, state info)
2. **A planner/spreadsheet** → Today + Plan (auto-schedule, check off lessons)
3. **A scrapbook/journal** → Memories (timeline, AI monthly family update)

---

## Tech Stack

- **Framework**: Next.js (App Router, "use client" where needed)
- **Styling**: Tailwind v4 (inline @theme, no tailwind.config.ts)
- **Database**: Supabase (Postgres + RLS + Auth)
- **Hosting**: Vercel (auto-deploys on push to any branch)
- **Email**: Resend + ImprovMX forwarding to hello@rootedhomeschoolapp.com
- **Payments**: Stripe (Apple Pay + Google Pay enabled)
- **Fonts**: Lora (serif, for ALL headings via font-serif class) + Geist (sans, for body)
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

- **Headings**: always font-serif (Lora), bold — NEVER Geist for headings
- **Body/buttons/labels**: Geist sans-serif
- **Border radius**: rounded-xl (12px) for inputs/buttons, rounded-2xl (16px) for cards
- **App Store feel**: clean, flat, purposeful — no gradients, no decorative shadows

---

## Navigation (final — do not change without updating this file)

**5 bottom nav tabs (mobile) / sidebar (desktop):**
1. ☀️ Today → /dashboard
2. 📅 Plan → /dashboard/plan
3. 🌱 Garden → /dashboard/garden
4. 📖 Memories → /dashboard/memories
5. 🔍 Resources → /dashboard/resources

**Settings**: accessed via family avatar circle (initials) in top-right of every page header.
Taps to /dashboard/settings. NOT a nav tab.

---

## The Core Loop (how the app works end-to-end)

1. Mom signs up → onboarding collects: family name, state, children, curriculum per child, school days, start/end dates
2. App auto-schedules lessons across school days
3. Every school day: Today shows that day's lessons → mom taps to check off → leaf earned → Garden grows
4. Mom taps "+ Log something" to record field trips, books, projects, reflections (with child picker + date picker so she can backdate)
5. Garden shows visual progress: trees grow, subject progress bars, Girl Scout-style milestone badges
6. Memories captures everything logged → AI generates monthly family update to share with grandparents
7. Resources tab replaces Facebook groups: curriculum picks, deals, field trips, state info

---

## Page-by-Page Purpose

### Today (/dashboard)
- **School day**: lesson list per child, tap to check off, progress bar showing X/Y lessons, "+ Log something" FAB
- **Non-school day**: "No school today" badge, "Coming up [next day]" preview in hero, "Capture the weekend" card below
- **All done state**: hero darkens, celebration, daily recap of lessons + anything logged
- **Vacation**: ocean-blue hero with vacation name + palm tree, lesson list hidden, return date shown
- DO NOT show progress bar or lesson list on non-school days or vacation days

### Plan (/dashboard/plan)
- Calendar view (week + month toggle) with dots on school days
- School days = from profile.school_days array (M/T/W/Th/F by default)
- Breaks = amber on calendar, lessons pause and resume
- Vacations = blue on calendar, named trip, triggers palm tree in Garden + banner on Today
- Pace cards per curriculum: "Emma · Good+Beautiful Math · On pace · Finishes Sep 4"
- "+ Add break" and "+ Add vacation" buttons
- Finish date auto-recalculates when breaks/vacations added

### Garden (/dashboard/garden)
- Visual reward — trees grow with lessons. This is EMOTIONAL, not a data page.
- DO NOT turn this into a dashboard or spreadsheet
- Sections (in order): garden scene → stat cards → subject progress bars → milestone badges → export buttons
- Subject progress: pulled from growth page query (merged in)
- Milestone badges: pulled from journey page query (merged in), displayed as horizontal scrollable row
- Vacation mode: palm trees flank kids' plants, blue/teal hero, vacation name shown
- Export buttons at bottom: "Export progress PDF" → /dashboard/reports, "Year in Review" → /dashboard/year-in-review

### Memories (/dashboard/memories)
- AI Family Update card at TOP (always visible, links to /dashboard/family-update)
- Below: chronological timeline of everything logged (field trips, books, projects, photos, reflections)
- "+ Log something" button accessible from this page too
- Family Update = AI-written monthly summary, shareable with grandparents via text/email

### Resources (/dashboard/resources)
- This REPLACES Facebook groups. It is a primary feature, not secondary.
- Sections: search bar → filter chips (All/Curriculum/Books/Field Trips/Activities) → curated weekly picks → educator deals → "Know your state" section
- "Know your state" = factual state info + HSLDA link + state education dept link
- Disclaimer always shown: "Rooted provides this as helpful information only. For legal questions about homeschooling in your state, consult HSLDA or a local homeschool association."
- NO compliance language anywhere — we are informational, not legal advisors

### Settings (/dashboard/settings — accessed via avatar, NOT nav tab)
Sections in order:
1. Your family (photo, family name, parent name, email, state — all editable)
2. Your children (name + grade per child, editable, + Add child)
3. Curriculum (each child's curriculum shown, Edit button per child)
4. Account (subscription status, co-teacher field marked "Coming soon", Start New School Year)
5. Kid view (link to /child — "Show the garden to your child")
6. Help & More (What's New, FAQ, Contact Us, Install App)

---

## What Is Hidden (code intact, unreachable from UI)

These pages exist but have NO nav links pointing to them. Do not delete:
- /dashboard/challenges — tabled, revisit at 3 months
- /dashboard/insights — tabled, revisit at 3 months
- /dashboard/growth — merged into Garden
- /dashboard/journey — merged into Garden
- /dashboard/progress — replaced by pace cards in Plan
- /dashboard/graduation — future feature (needs 1+ years of data to be meaningful)
- /dashboard/welcome — onboarding artifact
- /dashboard/more — absorbed into Settings

---

## Database Schema (key tables)

```
profiles: id, first_name, last_name, display_name, family_photo_url,
          state, subscription_status, is_pro, onboarded,
          school_days[] (e.g. ['monday','tuesday','wednesday','thursday','friday']),
          school_year_start (date), school_year_end (date),
          partner_email

children: id, user_id, name, grade, color

curricula/subjects: per child, lesson counts, curriculum name

lessons: scheduled per child per day based on school_days

app_events: field trips, books, projects, activities, photos

daily_reflections: reflection logs, is_private flag

vacations: id, user_id, name, start_date, end_date

badges/milestones: tracked in journey page, displayed in Garden
```

---

## Pricing

| Plan | Price | Stripe ID |
|------|-------|-----------|
| Free | $0 | — |
| Founding Family | $39/yr | price_1TCVWDLP14EaoUlTNwZFGS8A |
| Standard | $59/yr | price_1TCVWgLP14EaoUlT25totKGW |
| Monthly | $6.99/mo | — |

Founding Family deadline: April 30, 2026. First 200 families only.

---

## ⚠️ CRITICAL: Auth Architecture — Do Not Break This

Rooted uses **localStorage-based auth** via `createClient` from `@supabase/supabase-js` (in `lib/supabase.ts`).
This is a **client-side only** session — stored in the browser, NOT in cookies.

### The Rule: middleware.ts must NEVER verify auth sessions

The middleware CANNOT read Supabase sessions because:
- `createServerClient` (used in middleware) reads from **cookies**
- `createClient` (used in the app) stores sessions in **localStorage**
- These are different storage locations — middleware will NEVER find the session

**What happens if you add auth checks to middleware.ts:**
User logs in → app calls router.push('/dashboard') → middleware intercepts → calls getUser() → finds nothing in cookies → redirects to /login → user stuck on "Logging in..." forever. ALL users locked out.

### What middleware.ts is allowed to do (only this):
```ts
// Stripe webhook routes bypass only. Nothing else.
export function middleware(request: NextRequest) {
  if (pathname.startsWith('/api/stripe/webhook') || ...) return NextResponse.next()
  return NextResponse.next() // pass everything through — do NOT add auth checks here
}
```

### How route protection actually works:
- Auth is checked INSIDE each dashboard layout/page via `supabase.auth.getUser()` client-side
- If no session → the component itself redirects to /login
- DO NOT add server-side auth checks in middleware — it will break login for all users

### If you ever see "stuck on Logging in...":
1. Check middleware.ts immediately — remove any auth/session/getUser logic
2. Matcher should only include the 4 Stripe/cron routes
3. Never use `createServerClient` from `@supabase/ssr` in middleware

---

## What's NOT Allowed (decisions made, do not reverse without discussion)

- ❌ No compliance language anywhere ("state requirements", "legally required", "for compliance")
- ❌ No nav tab for Settings (avatar only)
- ❌ No More tab in nav (absorbed into Settings)
- ❌ No Reports tab in nav (export buttons live in Garden)
- ❌ No progress bars or lesson lists on non-school days
- ❌ No rebuilding pages from scratch without explicit instruction
- ❌ Do not change Supabase queries without explicit instruction
- ❌ Do not merge staging to main without a full audit pass

---

## What Comes Next (prioritized backlog)

### Immediate (next session after v2 ships)
1. Full end-to-end audit: create new test account, walk every page, screenshot everything
2. Fix any issues found in audit
3. Performance check: verify no duplicate Supabase queries in Garden (growth data merged)
4. Merge staging → main once audit passes

### Next wave (after merge)
5. Homepage feature grid: swap Reports card → Resources, remove Insights & Streaks card, remove compliance copy
6. Tour page: audit for any remaining compliance language
7. Onboarding school schedule step (Parts 4+9 Claude Code skipped — needs onboarding rewrite)
8. Today page non-school-day state (needs school_days from onboarding to be populated first)
9. Vacation state on Today hero + Garden (Claude Code flagged as needing deeper integration)
10. "Log something" bottom sheet: add child picker pills, improve date UX

### Future features (do not build yet)
11. Milestone badge celebrations: animate when earned (burst effect like leaf)
12. Monthly AI family update: make it beautiful, shareable as a card image
13. Vacation feature refinement: palm trees in Garden scene SVG
14. Transcript builder: credit hours, GPA, college-ready PDF (high school moms)
15. Graduation slideshow: needs 1+ years of data — launch in Year 2
16. Kid Mode: polish and re-surface properly
17. Co-teacher: full shared access system
18. Challenges: user-set learning goals (revisit at 3 months)
19. Insights/streaks: week-over-week analytics (revisit at 3 months with retention data)
20. Garden redesign Wave 2: plant stages (seedling → full bloom → fruit tree)

---

## How to Start a New Claude Session

Paste this at the start of every new conversation:

---
I'm building Rooted Homeschool (rootedhomeschoolapp.com) — a Next.js/TypeScript/Tailwind v4/Supabase app.
GitHub: brittanywaltrip/rooted-homeschool | Active branch: staging | Safety net: staging-backup-mar22
Read the full product context in NOTES.md on the staging branch before doing anything.
The app vision, all architecture decisions, what's built, what's hidden, and what comes next are all documented there.
Today I need help with: [describe what you need]
---

The NOTES.md file IS the handoff. It lives in the repo so it can never be separated from the code.

---

## How to Work With Claude Code

Claude Code is a separate AI that writes and commits code directly. It reads files from the repo.
When writing a Claude Code prompt:
- Always specify the branch (staging)
- Always say "do not touch main"
- Always say "run npm run build and fix all TypeScript errors before committing"
- Break work into numbered parts so it can be checked systematically
- Specify exactly what NOT to change (data logic, Supabase queries)
- End with a checklist of what to verify

Claude Code does NOT have context from your conversation. It only has what's in the files and what you tell it in the prompt. The NOTES.md is how you give it context without repeating yourself every time.

---

## Stats (as of March 23, 2026)
- 119 total families
- 6 Founding Members paying ($234 est. annual revenue)
- MRR: ~$20/mo
- Funnel: 94 signed up → 24 set up subjects (26%) → 11 logged a lesson (12%)
- 75 families added kids but never set up subjects (re-engagement cron running)
