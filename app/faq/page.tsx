"use client";

import { useState } from "react";
import Link from "next/link";
import { ChevronDown } from "lucide-react";

// ─── Data ────────────────────────────────────────────────────────────────────

const sections = [
  {
    title: "Getting Started",
    emoji: "🌱",
    items: [
      {
        q: "How do I create an account?",
        a: "Head to rootedhomeschoolapp.com and click Sign Up. Enter your family name, email address, and a password. Once you're in, you'll be prompted to add your children and choose your state — that's it! Your account is ready to use.",
      },
      {
        q: "Is Rooted free?",
        a: "Yes! Every new user gets a 30-day free trial with full access to everything — yearbook, transcripts, family sharing, reports, badges, unlimited photos. After 30 days, you can keep using Rooted free (with a 50 photo limit and basic features) or upgrade to Rooted+ to keep all premium features.",
      },
      {
        q: "How do I set up my curriculum?",
        a: 'Go to Plan → Curriculum in your dashboard. Add curriculum items (subjects, courses, or books) and set a goal for how many lessons you want to complete. Rooted will spread those lessons across your school days and track your progress automatically. You can edit, pause, or adjust any curriculum item at any time.',
      },
      {
        q: "Can I skip the curriculum setup?",
        a: "Absolutely. Curriculum is optional. You can start capturing memories and checking off lessons right away, then add your curriculum anytime from the Plan page.",
      },
      {
        q: "Does Rooted work with our curriculum?",
        a: "Yes — Rooted works alongside any curriculum. We don't replace what you're already using, we just help you track it, remember it, and see how far you've come.",
      },
      {
        q: "How do I add my children?",
        a: "During onboarding or anytime in Settings → Our Kids.",
      },
      {
        q: "Can I use Rooted on my phone?",
        a: "Yes — Rooted is designed mobile-first. You can add it to your home screen from your browser for quick daily access.",
      },
      {
        q: "What is the curriculum planner?",
        a: "The curriculum planner is your pacing tracker. For each curriculum item, you set a total lesson count. As you log lessons linked to that curriculum, Rooted calculates your pace and shows you whether you're on track. It's a gentle way to stay intentional without rigid day-by-day scheduling.",
      },
    ],
  },
  {
    title: "Daily Use",
    emoji: "☀️",
    items: [
      {
        q: "How do I log lessons each day?",
        a: "From the Today tab, you'll see your scheduled lessons for the day. Tap the checkbox next to any lesson to mark it complete. You can also tap into a lesson to add notes, hours, or a subject. Lessons can also be added on the fly using the + button.",
      },
      {
        q: "What happens when I check off a lesson?",
        a: "When you complete a lesson, it's recorded in your progress log and counts toward your curriculum goals. If the lesson is tied to a curriculum item, Rooted updates your pacing automatically. Your child's Garden tree also grows a little — it's a small celebration of every learning moment.",
      },
      {
        q: "What if we skip a school day?",
        a: "No problem at all — life happens! Rooted doesn't penalize missed days. Unfinished lessons simply remain on your list. You can reschedule them, mark them as skipped, or just pick back up the next day. The curriculum planner adjusts your pacing automatically when you get back on track.",
      },
      {
        q: "How do I reschedule my curriculum?",
        a: "Open Plan → Curriculum and tap on any curriculum item. You'll see options to adjust your target date, daily lesson count, or school days. Rooted will recalculate the pacing from today forward. You can also reschedule individual lessons by tapping the lesson and changing its date.",
      },
    ],
  },
  {
    title: "The Garden",
    emoji: "🌳",
    items: [
      {
        q: "What is the Garden?",
        a: "The Garden is Rooted's visual progress tracker — a living forest that grows as your children learn. Each child has their own tree that reflects their learning journey. It's designed to make progress feel tangible, beautiful, and worth celebrating, rather than just a number on a report.",
      },
      {
        q: "How does my child's tree grow?",
        a: "Your child's tree grows based on completed lessons. Every lesson logged adds to their total count, which determines their growth stage. The tree advances through five stages as they reach new milestones. The Garden view shows all your children's trees side by side so you can see the whole family's progress at a glance.",
      },
      {
        q: "What are the five growth stages?",
        a: (
          <span>
            Each stage represents a milestone in your child&apos;s learning journey:
            <ul className="mt-3 space-y-1.5 list-none">
              <li><strong>🌱 Seed</strong> — Just getting started (0–24 lessons)</li>
              <li><strong>🌿 Sprout</strong> — Finding their rhythm (25–49 lessons)</li>
              <li><strong>🪴 Sapling</strong> — Growing with purpose (50–99 lessons)</li>
              <li><strong>🌲 Growing</strong> — Deep roots forming (100–199 lessons)</li>
              <li><strong>🌳 Thriving</strong> — A flourishing learner (200+ lessons)</li>
            </ul>
          </span>
        ),
      },
    ],
  },
  {
    title: "Know Your State",
    emoji: "📋",
    items: [
      {
        q: "How do I generate a progress report?",
        a: "Go to Reports in your dashboard. Select the child, choose a date range, and click Generate Report. Rooted pulls your logged lessons, hours, subjects, and books read into a formatted PDF you can download, print, or save for your records.",
      },
      {
        q: "Which states does Rooted support?",
        a: "Rooted currently supports all 50 U.S. states. Each state has different homeschool requirements — some require annual notification, others require portfolio review or hours tracking. Rooted's report format is tailored to match what your state typically expects. If you're unsure of your state's requirements, your state's homeschool association is a great resource.",
      },
      {
        q: "Where do I set my state?",
        a: "Go to Settings in your dashboard and look for the State field under your family profile. Select your state from the dropdown. Rooted uses your state setting to format your reports correctly. You can update this at any time if you move.",
      },
    ],
  },
  {
    title: "Billing & Pricing",
    emoji: "💳",
    items: [
      {
        q: "What does the free plan include?",
        a: (
          <span>
            <strong>During your 30-day trial:</strong> full access to everything — yearbook, transcripts, family sharing, PDF exports, badges & certificates, unlimited photos.
            <br /><br />
            <strong>After trial:</strong> lesson tracking & curriculum planning, scheduling, memories (50 photo limit), attendance tracking, garden, and curated resources.
            <br /><br />
            Premium features (yearbook, transcripts, family sharing, PDF exports, badges & certificates) require Rooted+.
          </span>
        ),
      },
      {
        q: "What is the Founding Family price?",
        a: "Rooted+ with Founding Family pricing is $39/year — locked in forever, even as the price increases. Regular price will be $59/year after April 30, 2026. Founding Family pricing is our way of thanking early supporters who helped us build and improve the app.",
      },
      {
        q: "When does the founding price end?",
        a: "Rooted+ Founding Family pricing ($39/year) is available during our early access period. The standard Rooted+ price is $59/year. Founding Families keep their $39/year rate permanently — even as we add more features and the price increases.",
      },
      {
        q: "How do I upgrade to a paid plan?",
        a: 'Tap "Get Rooted+" in the app or visit the upgrade page. Rooted+ Founding Family pricing is $39/yr — locked in forever. You\'ll be taken to a secure Stripe checkout. Once payment is complete, your account upgrades instantly.',
      },
      {
        q: "How do I cancel?",
        a: "Go to Settings → Account → Cancel subscription. Your access continues until the end of your billing period.",
      },
    ],
  },
  {
    title: "About Rooted",
    emoji: "🌿",
    items: [
      {
        q: "Who built Rooted?",
        a: "Brittany Waltrip — a homeschool mom who built the app she wished existed. Questions? Email hello@rootedhomeschoolapp.com",
      },
    ],
  },
  {
    title: "Family Yearbook",
    emoji: "📖",
    items: [
      {
        q: "What is the family yearbook?",
        a: "The family yearbook is a living book that builds automatically throughout your school year. Every win, quote, and book you log is added to it automatically. You can bookmark any photo to include it too. At the end of the year you have a beautiful book — a cover page, a letter from home, each child\u2019s chapter with their interview answers and a note to their future self, and messages from your family. You can flip through it page by page right on your phone.",
      },
      {
        q: "Do I have to do anything to fill the yearbook?",
        a: "Wins, quotes, and books are added automatically every time you log them — you don\u2019t have to do anything extra. For photos, tap the bookmark icon \uD83D\uDD16 on any memory to add it to the yearbook. You can add or remove photos any time during the year.",
      },
      {
        q: "How do I write the letter from home and child interviews?",
        a: "Tap \u2018Edit your book\u2019 on the yearbook page. You\u2019ll find a letter field where you can write to your family about the year — as little or as much as you want. Each child has 6 interview questions you can answer any time during the year (their answers get better the closer to year-end you ask!). Everything autosaves as you type.",
      },
      {
        q: "What is the \u2018note to future self\u2019?",
        a: "Each child\u2019s chapter includes a special section where they write a message to themselves to be read next year. Your child dictates it, you type it — or an older child can type it themselves. It seals into the archived yearbook and appears at the start of next year. It\u2019s one of the most special parts of the book.",
      },
      {
        q: "Can family members see the yearbook?",
        a: "Yes — anyone you\u2019ve shared your family link with can tap \u2018View yearbook\u2019 to see the book reader. It\u2019s the same beautiful page-by-page experience, read only. They can\u2019t edit anything.",
      },
      {
        q: "Can grandparents and family leave messages in the yearbook?",
        a: "Yes. Family viewers can write a short message addressed to a specific child, the whole family, or you. You see it first and approve it before it appears in the book. It shows up in the \u2018From the village\u2019 section at the end of the yearbook — like signing a real yearbook.",
      },
      {
        q: "What happens to my yearbook at the end of the school year?",
        a: "When you\u2019re ready, tap \u2018Close this school year\u2019 in Settings. You\u2019ll choose a cover photo, and the yearbook is saved as a beautiful read-only book. A new yearbook starts automatically for next year. Your archived yearbooks are always there to open and read.",
      },
      {
        q: "What if I start Rooted mid-year — does my yearbook still work?",
        a: "Absolutely. Your yearbook starts from the beginning of your current school year (August 1st) so any memories you add for the year — even ones you backfill with an earlier date — will appear in the right place. Starting in January or March is completely fine.",
      },
      {
        q: "Do free users get a yearbook?",
        a: "During your 30-day free trial, you have full access to the yearbook. After the trial, free users see a watermarked preview. Upgrade to Rooted+ for the full yearbook without watermarks. A print option is coming soon — stay Rooted!",
      },
      {
        q: "Are my archived yearbooks saved if I cancel my subscription?",
        a: "Yes. Your archived yearbooks are yours forever, no matter what. You can always open and read any past yearbook even if you\u2019re on the free plan or have cancelled. We will never hold your memories or your yearbook hostage.",
      },
    ],
  },
  {
    title: "Share With Family",
    emoji: "\uD83D\uDC68\u200D\uD83D\uDC69\u200D\uD83D\uDC67",
    items: [
      {
        q: "What is Share With Family?",
        a: "Share With Family is a Rooted+ feature that lets you give grandparents, family, and friends a private link to view your memories and yearbook. They can see your photos and memories, react with emojis, and leave comments — without downloading any app.",
      },
      {
        q: "Who can I share with?",
        a: "Anyone you choose — grandparents, extended family, a co-parent, or a close friend. You control the list. Each person gets the same private link. You can revoke access for any individual at any time from Settings.",
      },
      {
        q: "Do family members need to create an account?",
        a: "No. They just tap the link and they\u2019re in. No account, no app download, no password.",
      },
      {
        q: "Can family members see everything in my account?",
        a: "They can only see what you\u2019ve shared — your memories and yearbook. They cannot see your curriculum, lesson plans, progress reports, or any account settings. You stay in full control.",
      },
      {
        q: "Can family members add messages to the yearbook?",
        a: "Yes — from the family viewer, they can write a message addressed to a specific child or the whole family. You see it first and approve it before it appears in the yearbook.",
      },
      {
        q: "How do I set up Share With Family?",
        a: "Share With Family is included with Rooted+. Go to Settings \u2192 Share With Family to get a private link you can copy and share however you like \u2014 text, email, whatever works for your family.",
      },
    ],
  },
];

// ─── Accordion Item ───────────────────────────────────────────────────────────

function AccordionItem({ q, a }: { q: string; a: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="border-b border-[#e8e2d9] last:border-0">
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-start justify-between gap-4 py-4 text-left group"
        aria-expanded={open}
      >
        <span className="text-sm font-medium text-[#2d2926] group-hover:text-[#5c7f63] transition-colors leading-snug">
          {q}
        </span>
        <ChevronDown
          size={16}
          strokeWidth={2}
          className={`shrink-0 mt-0.5 text-[#b5aca4] transition-transform duration-200 ${open ? "rotate-180" : ""}`}
        />
      </button>
      {open && (
        <div className="pb-4 text-sm text-[#5c5248] leading-relaxed">
          {a}
        </div>
      )}
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function FAQPage() {
  return (
    <main className="min-h-screen bg-[#f8f7f4]">
      <div className="max-w-3xl mx-auto px-6 py-16">

        {/* Back link */}
        <div className="mb-10">
          <Link href="/" className="text-sm text-[#5c7f63] hover:underline">
            ← Back to Rooted
          </Link>
        </div>

        {/* Header */}
        <div className="flex items-center gap-3 mb-4">
          <img src="/rooted-logo-nav.png" alt="Rooted" style={{ height: '36px', width: 'auto' }} />
        </div>
        <h1 className="text-3xl font-bold text-[#2d2926] mb-2">
          Frequently Asked Questions
        </h1>
        <p className="text-sm text-[#b5aca4] mb-12">
          Everything you need to know about Rooted.
        </p>

        {/* Sections */}
        <div className="space-y-10">
          {sections.map((section) => (
            <div key={section.title}>
              <div className="flex items-center gap-2 mb-4">
                <span className="text-lg">{section.emoji}</span>
                <h2 className="text-base font-bold text-[#2d2926] uppercase tracking-wide text-xs">
                  {section.title}
                </h2>
              </div>
              <div className="bg-[#fefcf9] rounded-2xl border border-[#e8e2d9] px-5 divide-y divide-[#e8e2d9]">
                {section.items.map((item) => (
                  <AccordionItem key={item.q} q={item.q} a={item.a} />
                ))}
              </div>
            </div>
          ))}
        </div>

        {/* Footer CTA */}
        <div className="mt-14 pt-8 border-t border-[#e8e2d9] text-center space-y-2">
          <p className="text-sm text-[#7a6f65]">
            Still have questions?{" "}
            <Link href="/contact" className="text-[#5c7f63] hover:underline">
              Contact us
            </Link>{" "}
            or email{" "}
            <a
              href="mailto:hello@rootedhomeschoolapp.com"
              className="text-[#5c7f63] hover:underline"
            >
              hello@rootedhomeschoolapp.com
            </a>
          </p>
          <p className="text-xs text-[#b5aca4]">We&apos;re a small team and respond to every message personally.</p>
        </div>

      </div>
    </main>
  );
}
