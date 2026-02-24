# Rooted Homeschool

## Overview

Rooted Homeschool is a homeschool planning application designed to help families track lessons, monitor student progress, and create structured learning schedules. The project is in its early stages — currently consisting of a landing page with links to signup and login pages that haven't been built yet. The app is built with Next.js 16 (App Router), React 19, TypeScript, and Tailwind CSS 4.

## User Preferences

Preferred communication style: Simple, everyday language.

## System Architecture

### Frontend
- **Framework**: Next.js 16 using the App Router (`app/` directory structure)
- **Language**: TypeScript with strict mode enabled
- **Styling**: Tailwind CSS 4 (via `@tailwindcss/postcss`), with CSS custom properties for theming (light/dark mode support via `prefers-color-scheme`)
- **Fonts**: Geist and Geist Mono loaded via `next/font/google`
- **Design**: Earthy, calm color palette centered around `#7a9e7e` (muted green) with a warm off-white background `#f8f7f4`

### Path Aliases
- `@/*` maps to the project root, enabling clean imports like `@/app/...` or `@/components/...`

### Current State
The app currently only has:
- `app/layout.tsx` — Root layout with font setup and global CSS
- `app/page.tsx` — Landing page with hero section, CTA buttons for signup/login
- `app/globals.css` — Tailwind import and CSS custom properties for theming

### What Needs to Be Built
- Authentication system (signup and login pages/flows)
- Student/child management
- Lesson planning and tracking
- Progress monitoring
- Database integration for persistent data storage
- API routes for backend logic

### Design Patterns
- Server Components by default (Next.js App Router convention)
- No state management library yet — should be added as complexity grows
- No database or ORM configured yet — will need to be added (Drizzle ORM with PostgreSQL would be a good fit for this stack)

## External Dependencies

### Current Dependencies
| Package | Purpose |
|---------|---------|
| `next` 16.1.6 | Full-stack React framework |
| `react` 19.2.3 | UI library |
| `react-dom` 19.2.3 | React DOM renderer |
| `tailwindcss` 4 | Utility-first CSS framework |
| `@tailwindcss/postcss` 4 | PostCSS plugin for Tailwind |
| `typescript` 5 | Type safety |
| `eslint` + `eslint-config-next` | Linting |

### Not Yet Configured (Will Be Needed)
- **Database**: No database configured yet. PostgreSQL with Drizzle ORM is recommended.
- **Authentication**: No auth provider configured. Options include NextAuth.js, Clerk, or a custom solution.
- **API Routes**: No API routes exist yet. Next.js App Router route handlers (`app/api/`) should be used.
- **No external services** are currently integrated.