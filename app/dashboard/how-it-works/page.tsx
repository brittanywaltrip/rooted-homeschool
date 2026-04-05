"use client";

import Link from "next/link";
import { ChevronLeft } from "lucide-react";

const GETTING_STARTED = [
  { step: 1, label: "Add your kids", href: "/dashboard/settings?tab=kids" },
  { step: 2, label: "Capture your first memory", href: "/dashboard/memories" },
  { step: 3, label: "Set up your curriculum", href: "/dashboard/plan" },
  { step: 4, label: "Share with family", href: "/dashboard/settings?tab=account" },
];

const FEATURES = [
  {
    emoji: "📅",
    name: "Today",
    what: "Your home base — see today's lessons, what you've captured today, and what's coming up.",
    how: "Tap \u2720 Capture a memory to add photos, wins, books, field trips and more. Check off lessons as you go.",
    href: "/dashboard",
  },
  {
    emoji: "📆",
    name: "Plan",
    what: "Your curriculum planner — schedule lessons for each child and track progress.",
    how: "Add your curriculum, set up subjects, then check off lessons each day. Rooted tracks your time and shows a projected finish date.",
    href: "/dashboard/plan",
  },
  {
    emoji: "🌱",
    name: "Garden",
    what: "Your kids' visual reward system — every lesson grows their tree and earns badges.",
    how: "Just check off lessons on the Plan page — the garden grows automatically. Show it to your kids to keep them motivated.",
    href: "/dashboard/garden",
  },
  {
    emoji: "📸",
    name: "Memories",
    what: "Your family's private memory timeline — every photo, win, book, and field trip you've captured.",
    how: "Tap any memory to view it. Tap the \ud83d\udd16 bookmark icon to add it to your yearbook. Filter by child using the avatar pills at the top.",
    href: "/dashboard/memories",
  },
  {
    emoji: "📖",
    name: "Yearbook",
    what: "A beautiful digital keepsake book built automatically from everything you've bookmarked.",
    how: "Bookmark memories with \ud83d\udd16 throughout the year. Open your yearbook anytime from the top of the Memories page. Fill in the Favorite Things pages with your kids.",
    href: "/dashboard/memories/yearbook",
  },
  {
    emoji: "📚",
    name: "Resources",
    what: "Curated homeschool resources — discounts, field trips, classes, printables, and curriculum guides.",
    how: "Browse Featured Free Picks or use the search bar and filter pills to find what you need.",
    href: "/dashboard/resources",
  },
  {
    emoji: "👨\u200d👩\u200d👧",
    name: "Share with family",
    what: "Send a private link to grandparents and family so they can follow along in real time.",
    how: "Go to Settings \u2192 Account \u2192 Share with family. Send the link to anyone you choose. They can react and leave comments \u2014 no app download needed.",
    href: "/dashboard/settings?tab=account",
  },
];

export default function HowItWorksPage() {
  return (
    <div className="min-h-screen pb-32" style={{ background: "#faf8f4" }}>
      {/* Back button */}
      <div className="sticky top-0 z-20 bg-[#faf8f4]/95 backdrop-blur-sm border-b border-[#e8e2d9] px-4 py-3">
        <Link href="/dashboard/settings" className="inline-flex items-center gap-1 text-sm text-[#7a6f65] hover:text-[#2d2926] transition-colors">
          <ChevronLeft size={18} />
          Back
        </Link>
      </div>

      <div className="max-w-lg mx-auto px-5 py-8">
        {/* Header */}
        <div className="text-center mb-8">
          <h1 className="text-2xl text-[#2d2926] mb-2" style={{ fontFamily: "var(--font-display)" }}>
            Welcome to Rooted 🌿
          </h1>
          <p className="text-sm text-[#7a6f65] leading-relaxed">
            Everything you need to plan your days, capture the moments, and hold onto it all.
          </p>
        </div>

        {/* Where to start */}
        <section className="mb-10">
          <h2 className="text-xs font-semibold uppercase tracking-widest text-[#7a6f65] mb-3 px-1">
            Where to start
          </h2>
          <div className="bg-[#fefcf9] border border-[#e8e2d9] rounded-2xl overflow-hidden divide-y divide-[#f0ede8]">
            {GETTING_STARTED.map((s) => (
              <Link
                key={s.step}
                href={s.href}
                className="flex items-center gap-4 px-5 py-4 hover:bg-[#f8f5f0] transition-colors"
              >
                <span className="shrink-0 w-7 h-7 rounded-full bg-[#2d5a3d] text-white text-xs font-semibold flex items-center justify-center">
                  {s.step}
                </span>
                <span className="text-sm font-medium text-[#2d2926]">{s.label}</span>
                <span className="ml-auto text-[#c8bfb5]">→</span>
              </Link>
            ))}
          </div>
        </section>

        {/* Feature cards */}
        <section>
          <h2 className="text-xs font-semibold uppercase tracking-widest text-[#7a6f65] mb-3 px-1">
            Here&apos;s how each part works
          </h2>
          <div className="space-y-3">
            {FEATURES.map((f) => (
              <div
                key={f.name}
                className="bg-[#fefcf9] border border-[#e8e2d9] rounded-2xl p-5 border-l-[3px] border-l-[#8cba8e]"
              >
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-lg">{f.emoji}</span>
                  <h3 className="text-sm font-semibold text-[#2d2926]">{f.name}</h3>
                </div>
                <p className="text-[13px] text-[#2d2926] leading-relaxed mb-1">
                  {f.what}
                </p>
                <p className="text-[13px] text-[#7a6f65] leading-relaxed mb-3">
                  {f.how}
                </p>
                <Link
                  href={f.href}
                  className="text-xs font-medium text-[#5c7f63] hover:text-[#3d5c42] transition-colors"
                >
                  Go there →
                </Link>
              </div>
            ))}
          </div>
        </section>

        {/* Closing */}
        <p className="text-center text-sm text-[#9a8f85] mt-10" style={{ fontFamily: "var(--font-display)" }}>
          🌿 You&apos;ve got this.
        </p>
      </div>
    </div>
  );
}
