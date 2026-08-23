"use client";

import { useEffect } from "react";
import Link from "next/link";
import { ChevronLeft } from "lucide-react";

// ─── Changelog entries ────────────────────────────────────────────────────────

const UPDATES = [
  {
    date: "August 2026",
    emoji: "🔖",
    title: "Books in progress",
    description:
      "Reading a chapter book that takes weeks? Log it with 'Still reading it' and it sits on a little Currently Reading shelf on your Reading Log until you're done. When you finish, one tap marks it complete, and that's the moment to add your child's leaf rating and what they thought. You can also now edit or remove any book right from the log, wrong kid, wrong book, two taps to fix. No reminders, no nagging, ever. Books finish when they finish.",
    inspiredByFamily: true,
  },
  {
    date: "August 2026",
    emoji: "📚",
    title: "Your Reading Log is here",
    description:
      "A mom emailed on a Thursday night asking where books go. By the weekend, Rooted had a Reading Log. Log a book from the Today screen and Rooted finds the cover, author, and page count for you. Log it for one child, a few, or the whole family at once. Tag how it was read, read aloud, together, independent, audiobook, or assigned, add a note about what they thought, and let your child rate it with little leaves. It all becomes a per-child Reading Log under Reports, with a Print button that offers a simple titles-and-dates list for state portfolios or a detailed version with everything.",
    inspiredByFamily: true,
  },
  {
    date: "August 2026",
    emoji: "📷",
    title: "Take a photo, right from the lesson",
    description:
      "Every Add a photo button on a lesson now offers your camera as well as your library, so you can check off the lesson, jot your note, and snap the moment without leaving the page. Live now on the web. If you use the installed app, the camera arrives with the next app update, already on its way to the stores.",
    inspiredByFamily: true,
  },
  {
    date: "August 2026",
    emoji: "🧾",
    title: "Your records now tell the whole story",
    description:
      "Books and memories you've captured since spring now show up everywhere they should: your Books Read count, your printed reports, the Plan calendar's memory markers, and each child's garden. If your numbers just went up, that's months of your real work finally being counted.",
    inspiredByFamily: false,
  },
  {
    date: "August 2026",
    emoji: "🧭",
    title: "Reports, easier to find",
    description:
      "The Reports page, your hours, attendance, and the new Reading Log, now lives in the sidebar and the More menu. It was always there; now it's findable.",
    inspiredByFamily: false,
  },
  {
    date: "August 2026",
    emoji: "🔒",
    title: "Straight answers on privacy",
    description:
      "A thoughtful mom asked hard questions about where photos live and what happens when you delete your account, and the honest audit that followed made Rooted better. The privacy policy now names every service Rooted uses and what each one sees, account deletion now verifiably removes every photo file, and the new book lookup is documented too: when you search a book title, only the title you typed is sent, never anything about your family.",
    inspiredByFamily: true,
  },
  {
    date: "August 2026",
    emoji: "🖨️",
    title: "Print your plan",
    description:
      "There's a new Print button on your Plan page, right next to the Week and Month toggle. Print today's checklist, the week you're looking at day by day, or the whole month at a glance. Weekly and monthly sheets include your appointments and recurring activities, with room for notes, made to stick on the fridge or hand to whoever is teaching.",
    inspiredByFamily: true,
  },
  {
    date: "August 2026",
    emoji: "⏰",
    title: "Start times, everywhere you plan",
    description:
      "If you give a subject a start time in the Schedule Builder, it now shows on your Today page and on your printed plans, in order, earliest first. And if you don't use times, nothing changes: your day stays a simple, flexible checklist.",
    inspiredByFamily: false,
  },
  {
    date: "August 2026",
    emoji: "💾",
    title: "Your schedule setup saves as you go",
    description:
      "Setting up your schedule and life interrupts? Rooted now saves your work as you type. When you come back, your draft is waiting right where you left off, nothing lost. Your schedule still isn't final until you tap Save & build schedule.",
    inspiredByFamily: true,
  },
  {
    date: "August 2026",
    emoji: "📅",
    title: "Per-day lesson plans, honored everywhere",
    description:
      "If you set different lesson counts for different days, like two Math lessons on Mondays, your Today page and printed plans now follow that plan exactly. A few families may notice lessons settling onto the days they actually chose. That's your plan being respected, not a glitch.",
    inspiredByFamily: false,
  },
  {
    date: "June 2026",
    emoji: "💬",
    title: "One question a month",
    description:
      "Once a month, answer one gentle question about your family's life right now. Your answers become an 'Our year, month by month' page in your yearbook, in your own words. No pressure and no nagging, just a small moment worth keeping.",
    inspiredByFamily: true,
  },
  {
    date: "June 2026",
    emoji: "💌",
    title: "New keepsake pages for each child",
    description:
      "Three new pages in every child's chapter: a snapshot of who they are this year, the little things you never want to forget, and a letter for them to open when they're grown. Fill in as much or as little as you like. Anything left blank simply doesn't show.",
    inspiredByFamily: true,
  },
  {
    date: "June 2026",
    emoji: "📖",
    title: "A more beautiful yearbook",
    description:
      "Your yearbook got a full redesign. Full-page photo collages fill every page, with chapter dividers, page numbers, and a warmer, more readable look throughout. Photos are framed to fit beautifully, so nothing important gets cropped out.",
    inspiredByFamily: true,
  },
  {
    date: "June 2026",
    emoji: "🎨",
    title: "Make your yearbook yours",
    description:
      "You're in control of how your yearbook looks. Reorder photos within a chapter, reposition any photo to keep faces in view, feature a favorite as its own full page, or hide a photo from the book. It's all in the yearbook editor.",
    inspiredByFamily: true,
  },
  {
    date: "June 2026",
    emoji: "📸",
    title: "First Day Photo",
    description:
      "Capture that first-day-of-school moment with a special framed photo. It flows straight into your Memories and your yearbook.",
    inspiredByFamily: true,
  },
  {
    date: "June 2026",
    emoji: "🍎",
    title: "Attach a photo to a lesson",
    description:
      "Snap a photo while you're learning and attach it right to a lesson. Your lesson photos show up in Memories and your yearbook automatically.",
    inspiredByFamily: true,
  },
  {
    date: "April 2026",
    emoji: "📖",
    title: "Yearbook",
    description:
      "Your family's year, captured in one beautiful, scrollable yearbook. Photos, memories, milestones, all in one place. Free to build with up to 50 memories.",
    inspiredByFamily: true,
  },
  {
    date: "April 2026",
    emoji: "👨‍👩‍👧‍👦",
    title: "Family Sharing",
    description:
      "Invite grandparents, co-parents, or anyone who wants to follow along. They get a read-only view of your family's progress, no account needed.",
    inspiredByFamily: true,
  },
  {
    date: "April 2026",
    emoji: "📋",
    title: "Hours & Attendance Log",
    description:
      "Track your homeschool hours and attendance in one place. Download or print a PDF anytime, perfect for state requirements or your own records. Free for everyone.",
    inspiredByFamily: true,
  },
  {
    date: "April 2026",
    emoji: "🌿",
    title: "Meet Rooted & Rooted+",
    description:
      "We gave our plans real names! The free plan is now called Rooted, and the paid plan is Rooted+. Same features you love, just a cleaner look throughout the app.",
    inspiredByFamily: false,
  },
  {
    date: "March 2026",
    emoji: "📅",
    title: "Reschedule a Lesson",
    description:
      "Life happens: doctor appointments, off days, spontaneous field trips. Now you can reschedule any lesson right from Today. Tap ··· on any lesson and choose Reschedule. Move it to tomorrow, pick a specific day, push all remaining lessons back, or double up tomorrow to stay on track. Undo available for 8 seconds.",
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
      "Download a full record of your homeschool year from the Plan page. Choose a specific child or all children. Includes total hours, lessons per subject, books read, field trips, wins, and a daily activity log, ready to share or save.",
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
      "Every lesson you check off now feels like it matters. A little burst when you check a lesson, a toast when your child finishes their day, and an 'Amazing day!' banner when the whole family is done, because you earned it.",
    inspiredByFamily: true,
  },
  {
    date: "March 2026",
    emoji: "📸",
    title: "+ Log Something, Field Trips & Activities",
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
    title: '"+ Log Something", Not Just Lessons',
    description:
      "We renamed 'Log Today' to '+ Log something' because that's what you're really doing, capturing your homeschool story, not just checking boxes. The button now lives in the bottom corner of your Today page, always ready.",
    inspiredByFamily: false,
  },
  {
    date: "March 2026",
    emoji: "🌴",
    title: "Vacation Blocking",
    description:
      "Mark breaks and holidays on your calendar and your lessons will automatically shift around them, and your garden will show a little vacation sign while you're away.",
    inspiredByFamily: true,
  },
  {
    date: "March 2026",
    emoji: "✨",
    title: "Introducing Rooted+",
    description:
      "We redesigned the upgrade page to tell the real story, you're not just getting an app, you're joining a movement. Rooted+ Founding Family pricing is locked forever for the first 200 families.",
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
      "Your curriculum pacing goal now shows up right on your Today page, so you always know if you're on track without having to go looking for it.",
    inspiredByFamily: false,
  },
  {
    date: "March 2026",
    emoji: "📋",
    title: "View All Upcoming Lessons",
    description:
      "Tap '5 remaining' on any curriculum to see all your upcoming lessons and their dates in one place, no more clicking through the calendar week by week.",
    inspiredByFamily: false,
  },
  {
    date: "March 2026",
    emoji: "🌱",
    title: "Curriculum Wizard Fixed",
    description:
      "The Set Up Curriculum wizard is now fully working, lessons save correctly, populate your calendar, and show up on Today ready to check off.",
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
          Updates, improvements, and features, shaped by families like yours.
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

      <p className="text-center text-xs text-[#c8bfb5] pb-4">More updates soon 🌿</p>
    </div>
  );
}
