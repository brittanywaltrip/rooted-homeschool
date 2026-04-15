"use client";

import { useEffect } from "react";
import Link from "next/link";
import { ChevronLeft } from "lucide-react";

// ─── Changelog entries ────────────────────────────────────────────────────────

const UPDATES = [
  {
    date: "March 2026",
    emoji: "📅",
    title: "Reschedule a Lesson",
    description:
      "Life happens — doctor appointments, off days, spontaneous field trips. Now you can reschedule any lesson right from Today. Tap ··· on any lesson and choose Reschedule. Move it to tomorrow, pick a specific day, push all remaining lessons back, or double up tomorrow to stay on track. Undo available for 8 seconds.",
    inspiredByFamily: true,
  },
  {
    date: "March 2026",
    emoji: "➕",
    title: "Log Extra Lessons",
    description:
      'When your child is on a roll and does more than planned, tap "+ [child] did an extra lesson today" to log it. The next lesson in sequence gets checked off automatically. You can also tap Undo or edit/delete it from the ··· menu.',
    inspiredByFamily: true,
  },
  {
    date: "March 2026",
    emoji: "✏️",
    title: "Curriculum Edits Now Save Correctly",
    description:
      "Fixed a bug where editing your curriculum name, lesson count, or days done wasn't saving. All changes now update immediately on your Plan page.",
    inspiredByFamily: false,
  },
  {
    date: "March 2026",
    emoji: "📊",
    title: "Progress Report",
    description:
      "Download a full record of your homeschool year from the Plan page. Choose a specific child or all children. Includes total hours, lessons per subject, books read, field trips, wins, and a daily activity log — ready to share or save.",
    inspiredByFamily: false,
  },
  {
    date: "March 2026",
    emoji: "⏱️",
    title: "Hours Tracking",
    description:
      "Your total hours for the year are now auto-tracked every time you check off a lesson. See your running total on the Plan page. You can also log time on unplanned activities from the capture sheet.",
    inspiredByFamily: false,
  },
  {
    date: "March 2026",
    emoji: "🎉",
    title: "Celebrations When You Finish",
    description:
      "Every lesson you check off now feels like it matters. A little burst when you check a lesson, a toast when your child finishes their day, and an 'Amazing day!' banner when the whole family is done — because you earned it.",
    inspiredByFamily: true,
  },
  {
    date: "March 2026",
    emoji: "📸",
    title: "+ Log Something — Field Trips & Activities",
    description:
      "Tap '+ Log something' to log more than just lessons. Add a field trip (where did you go?), an activity like piano or co-op, a book, a photo, a project, or a reflection. Everything saves to Memories automatically.",
    inspiredByFamily: false,
  },
  {
    date: "March 2026",
    emoji: "⚙️",
    title: "Settings, Simplified",
    description:
      "Settings now has three clear tabs: Our Family (your name, photo, and state), Our Kids (add, edit, or reorder children), and Account (subscription and sign out). Everything in its place.",
    inspiredByFamily: false,
  },
  {
    date: "March 2026",
    emoji: "🌿",
    title: '"+ Log Something" — Not Just Lessons',
    description:
      "We renamed 'Log Today' to '+ Log something' because that's what you're really doing — capturing your homeschool story, not just checking boxes. The button now lives in the bottom corner of your Today page, always ready.",
    inspiredByFamily: false,
  },
  {
    date: "March 2026",
    emoji: "🌴",
    title: "Vacation Blocking",
    description:
      "Mark breaks and holidays on your calendar and your lessons will automatically shift around them — and your garden will show a little vacation sign while you're away.",
    inspiredByFamily: true,
  },
  {
    date: "March 2026",
    emoji: "✨",
    title: "Introducing Rooted+",
    description:
      "We redesigned the upgrade page to tell the real story — you're not just getting an app, you're joining a movement. Rooted+ Founding Family pricing is locked forever for the first 200 families.",
    inspiredByFamily: false,
  },
  {
    date: "March 2026",
    emoji: "📅",
    title: "Smarter Lesson Scheduling",
    description:
      "Fixed a bug where lessons could land on the wrong day for families in certain time zones. Your schedule is now always based on your local date.",
    inspiredByFamily: false,
  },
  {
    date: "March 2026",
    emoji: "🎯",
    title: "Finish Line on Today",
    description:
      "Your curriculum pacing goal now shows up right on your Today page — so you always know if you're on track without having to go looking for it.",
    inspiredByFamily: false,
  },
  {
    date: "March 2026",
    emoji: "📋",
    title: "View All Upcoming Lessons",
    description:
      "Tap '5 remaining' on any curriculum to see all your upcoming lessons and their dates in one place — no more clicking through the calendar week by week.",
    inspiredByFamily: false,
  },
  {
    date: "March 2026",
    emoji: "🌱",
    title: "Curriculum Wizard Fixed",
    description:
      "The Set Up Curriculum wizard is now fully working — lessons save correctly, populate your calendar, and show up on Today ready to check off.",
    inspiredByFamily: false,
  },
];

const LAST_SEEN_KEY = "rooted_whats_new_last_seen";

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function WhatsNewPage() {
  useEffect(() => { document.title = "What\u2019s New \u00b7 Rooted"; }, []);

  useEffect(() => {
    localStorage.setItem(LAST_SEEN_KEY, new Date().toISOString().split("T")[0]);
  }, []);

  return (
    <div className="max-w-xl mx-auto px-5 py-8 space-y-6">

      {/* Back link */}
      <Link
        href="/dashboard/more"
        className="inline-flex items-center gap-1 text-xs font-medium text-[#7a6f65] hover:text-[#5c7f63] transition-colors"
      >
        <ChevronLeft size={14} />Back to More
      </Link>

      {/* Header */}
      <div>
        <p className="text-xs font-semibold uppercase tracking-widest text-[#7a9e7e] mb-1">Rooted</p>
        <h1 className="text-2xl font-bold text-[#2d2926]" style={{ fontFamily: "var(--font-display)" }}>
          What&apos;s New 🌱
        </h1>
        <p className="text-sm text-[#7a6f65] mt-1 leading-relaxed">
          Updates, improvements, and features — shaped by families like yours.
        </p>
      </div>

      {/* Changelog cards */}
      <div className="space-y-3">
        {UPDATES.map((update, i) => (
          <div
            key={i}
            className="bg-[#fefcf9] border border-[#e8e2d9] rounded-2xl px-5 py-4 space-y-2"
          >
            <p className="text-[10px] font-semibold uppercase tracking-widest text-[#b5aca4]">
              {update.date}
            </p>
            <h2 className="text-base font-bold text-[#2d2926] leading-snug">
              {update.emoji} {update.title}
            </h2>
            <p className="text-sm text-[#7a6f65] leading-relaxed">
              {update.description}
            </p>
            {update.inspiredByFamily && (
              <div className="inline-flex items-center gap-1.5 bg-[#fef9e8] border border-[#f0dda8] rounded-full px-3 py-1 text-xs font-semibold text-[#7a4a1a]">
                💛 Inspired by a Rooted family!
              </div>
            )}
          </div>
        ))}
      </div>

      <p className="text-center text-xs text-[#c8bfb5] pb-4">More updates coming soon 🌿</p>
    </div>
  );
}
