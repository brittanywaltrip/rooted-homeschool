# Rooted Homeschool — Project Notes

## Tech Stack

- **Framework**: Next.js 16 (App Router, `"use client"` components)
- **Language**: TypeScript 5 (strict mode)
- **Styling**: Tailwind CSS v4 with `@theme inline` custom color tokens in `globals.css`
- **Database & Auth**: Supabase (`@supabase/supabase-js`) — singleton client at `lib/supabase.ts`
- **Icons**: `lucide-react`
- **Fonts**: Geist Sans / Geist Mono (via `next/font`)
- **Deployment**: Vercel (assumed)

### Color Palette
| Token | Hex | Use |
|---|---|---|
| `--color-green-primary` | `#5c7f63` | Primary actions, active states |
| `--color-green-light` | `#7a9e7e` | Secondary green |
| `--color-green-pale` | `#e8f0e9` | Backgrounds, badges |
| `--color-brown` | `#8b6f47` | Tree trunks, accents |
| `--color-warm-bg` | `#f8f7f4` | Page background |
| `--color-warm-card` | `#fefcf9` | Card backgrounds |
| `--color-text` | `#2d2926` | Primary text |
| `--color-text-muted` | `#7a6f65` | Secondary text |

---

## Database Tables (Supabase)

- **`profiles`** — `id, display_name` — family name per user
- **`children`** — `id, user_id, name, color, sort_order, archived, name_key`
- **`subjects`** — `id, user_id, name, color`
- **`lessons`** — `id, user_id, child_id, subject_id, title, hours, completed, date, scheduled_date`
- **`daily_reflections`** — `id, user_id, date, reflection, updated_at`
- **`app_events`** — `id, user_id, type, payload (jsonb)` — used for: `book_read`, `memory_photo`, `memory_project`, `memory_book`

### Leaf Count Logic
Leaves = completed lessons (`lessons.completed = true`) + `app_events` where `type = 'book_read'`

### Growth Stages
| Stage | Leaves |
|---|---|
| Seed | 0–9 |
| Sprout | 10–24 |
| Sapling | 25–49 |
| Growing | 50–99 |
| Thriving | 100+ |

---

## App Structure

### Navigation
- **Desktop**: Fixed left sidebar (252px), brand logo, family name, 5 nav items + Settings gear + Sign Out
- **Mobile**: Sticky top bar with hamburger, slides in drawer nav
- **Auth guard** in `app/dashboard/layout.tsx` — redirects to `/login` if no session

### Pages

#### `/` — Landing Page
- Hero section: "Stay Rooted. Teach with Intention."
- 3 feature cards
- Links to `/signup` and `/login`

#### `/login` and `/signup`
- Supabase `signInWithPassword` / `signUp`
- `signUp` stores `family_name` in `user_metadata`
- Both redirect to `/dashboard` on success

---

## The 5 App Sections

### 1. Today (`/dashboard`)
**What it does:**
- Greeting with family name and today's date
- Daily motivational quote (rotates by day of week)
- Child filter tabs (All + each child as a colored pill)
- Growth Tree Card — SVG tree illustration at the correct stage, leaf count, progress bar to next stage
- Today's Lessons list — toggle complete/incomplete with optimistic UI update
- **Add Lesson button** — opens a modal with child selector, subject field (autocomplete from existing subjects, creates new if not found), lesson title, optional hours; inserts lesson as `completed=true`, updates leaf count and growth tree immediately, triggers leaf celebration animation
- Books Read Today — shows books logged via `app_events`; "Log a Book" modal adds to `app_events` and bumps leaf count
- Daily Reflection — textarea with upsert to `daily_reflections`, shows "saved" badge

### 2. Garden (`/dashboard/garden`)
**What it does:**
- Animated garden scene: sky gradient, sun with spinning rays, drifting clouds, rolling green hill, decorative flowers, butterflies
- Per-child tree tabs — each child has their own animated swaying tree at their growth stage
- Stage info card with progress bar and leaf count badge
- Badges grid — earned vs. locked milestone badges (First Leaf, Sprout, Sapling, etc.)

### 3. Resources (`/dashboard/resources`)
**What it does:**
- 5 static tabs of curated homeschool content:
  - **Discounts** — 8 homeschool vendor discounts
  - **Virtual Field Trips** — 9 free online field trip links
  - **Free Printables** — 8 printable resource links
  - **Science Projects** — 8 hands-on projects with difficulty, time, and materials
  - **State Requirements** — 20 states with regulation level badges and searchable filter

### 4. Memories (`/dashboard/memories`)
**What it does:**
- Log memories (photo, project, book) to `app_events` table
- Modal form: title, description, date, child selector
- Filter tabs by memory type
- "AI Summary" and "Export PDF" shown as coming soon placeholders

### 5. Reports (`/dashboard/reports`)
**What it does:**
- Config panel: child selector, date range, preset buttons (This Week, This Month, Last 3 Months)
- Fetches real data: lessons, subjects, attendance, books from Supabase
- Print report shows: summary stats, subject breakdown table, books list, attendance dates
- **Print/Save PDF** via `window.print()` — sidebar/nav hidden via `@media print` in `globals.css`

### Settings (`/dashboard/settings`)
**What it does:**
- Family name field — reads from `profiles`, upserts on save
- Add child form — name input + 7-color picker with checkmark on selected, preview avatar, inserts with `sort_order`
- Children list — inline edit (name + color), soft-delete with confirmation dialog (`archived: true`)

---

## What Is Working

- [x] Full auth flow (signup, login, session guard, sign out)
- [x] Family name stored and displayed across the app
- [x] Children management (add, edit, soft-delete with archive)
- [x] Lessons — toggle complete/incomplete, optimistic UI
- [x] Add Lesson modal — find-or-create subject, insert lesson, live leaf count update
- [x] Leaf/growth system — calculated from completed lessons + book_read events
- [x] Growth tree SVG — 5 stages, progress bar, stage label
- [x] Animated garden scene — per-child trees at correct stage with sway animation
- [x] Badges grid (earned/locked)
- [x] Book logging — adds to app_events, bumps leaf count
- [x] Memories logging — photo/project/book types, child filter
- [x] Reports — real Supabase data, configurable date range, print-to-PDF
- [x] Resources — static curated content across 5 tabs
- [x] Settings page — fully functional
- [x] Celebration animation — leaves float upward after adding a lesson
- [x] Print styles — sidebar/nav hidden for clean PDF output
- [x] Mobile responsive — hamburger drawer nav

---

## What Still Needs to Be Built

### High Priority
- [ ] **Lesson scheduling** — ability to plan lessons for future dates (Plan page `/dashboard/plan`)
- [ ] **Lesson editing/deleting** — no way to edit or remove a lesson after it's added
- [ ] **Attendance tracking** — currently referenced in Reports but no UI to log attendance
- [ ] **Notifications** — shown as "Off" in More page, not yet implemented
- [ ] **Help & Feedback** — link shown in More page, not yet active

### Medium Priority
- [ ] **AI Summary in Memories** — generate a narrative summary of the month's memories (placeholder exists)
- [ ] **PDF Export in Memories** — export memory log as a PDF (placeholder exists)
- [ ] **Progress page** (`/dashboard/progress`) — detailed progress tracking per child per subject over time
- [ ] **Insights page** (`/dashboard/insights`) — data visualizations: time spent per subject, streaks, trends
- [ ] **Real photo upload** — Memories currently only logs text; no image upload

### Lower Priority
- [ ] **Push notifications** — daily reminders, streak alerts
- [ ] **Onboarding flow** — guide new users to add family name and first child
- [ ] **Dark mode** — color tokens are already in CSS variables, just needs a dark theme
- [ ] **Multi-user / co-parent access** — currently one account per family
- [ ] **Curriculum import** — CSV or structured import for lesson plans

---

## Next Steps (Priority Order)

1. **Build the Plan page** — schedule lessons for future dates; this feeds the Today page's lesson list
2. **Add edit/delete to lessons** — a swipe action or long-press menu on each lesson row
3. **Wire up attendance logging** — simple daily attendance toggle that feeds into Reports
4. **Flesh out Progress page** — charts or tables showing subject hours over time per child
5. **Add photo upload to Memories** — use Supabase Storage for image uploads
6. **Build Insights page** — weekly/monthly stats, streak counter, top subjects
7. **AI Summary for Memories** — call Claude API to generate a narrative from the month's memory events
8. **Onboarding** — detect new users (no children + no lessons) and show a welcome/setup flow

---

## Environment Variables

```
NEXT_PUBLIC_SUPABASE_URL=https://gvkbegvvmhcrmxdorctk.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=<anon key in .env.local>
```

`.env.local` is gitignored. Never commit credentials.
