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
        q: "Is Rooted really free to start?",
        a: "Yes! The free plan gives you full access to daily lesson logging, your family's Garden, the basic progress tracker, and state compliance reports. No credit card required. You can use Rooted free for as long as you like — Pro is available when you're ready for extra features.",
      },
      {
        q: "How do I set up my curriculum?",
        a: 'Go to Plan → Curriculum in your dashboard. Add curriculum items (subjects, courses, or books) and set a goal for how many lessons you want to complete. Rooted will spread those lessons across your school days and track your progress automatically. You can edit, pause, or adjust any curriculum item at any time.',
      },
      {
        q: "What is the Finish Line / curriculum planner?",
        a: "The Finish Line is your curriculum goal tracker. For each curriculum item, you set a total lesson count (your \"finish line\"). As you log lessons linked to that curriculum, Rooted calculates your pace and shows you whether you're on track to finish by your target date. It's a gentle way to stay intentional without rigid day-by-day scheduling.",
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
        a: "When you complete a lesson, it's recorded in your progress log and counts toward your curriculum Finish Line goals. If the lesson is tied to a curriculum item, Rooted updates your pacing automatically. Your child's Garden tree also grows a little — it's a small celebration of every learning moment.",
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
    title: "Reports & State Requirements",
    emoji: "📋",
    items: [
      {
        q: "How do I generate a compliance report?",
        a: "Go to Reports in your dashboard. Select the child, choose a date range, and click Generate Report. Rooted pulls your logged lessons, hours, subjects, and books read into a formatted PDF that meets your state's reporting format. You can download it, print it, or save it for your records.",
      },
      {
        q: "Which states does Rooted support?",
        a: "Rooted currently supports all 50 U.S. states. Each state has different homeschool requirements — some require annual notification, others require portfolio review or hours tracking. Rooted's report format is tailored to match what your state typically expects. If you're unsure of your state's requirements, your state's homeschool association is a great resource.",
      },
      {
        q: "Where do I set my state?",
        a: "Go to Settings in your dashboard and look for the State field under your family profile. Select your state from the dropdown. Rooted uses your state setting to format your compliance reports correctly. You can update this at any time if you move.",
      },
    ],
  },
  {
    title: "Billing & Pricing",
    emoji: "💳",
    items: [
      {
        q: "What does the free plan include?",
        a: "The free plan includes unlimited lesson logging, unlimited children, your family's Garden, basic progress tracking, state compliance report generation, and the Memories section. It's genuinely useful for everyday homeschooling — Pro adds AI features, the Family Update, Graduation Slideshow, curriculum pacing, and priority support.",
      },
      {
        q: "What is the Founding Family price?",
        a: "Founding Families get lifetime access to Rooted Pro for $39/year — locked in forever, even as the price increases. This is our way of thanking early supporters who helped us build and improve the app. The Founding Family price is only available for a limited time while we're in early access.",
      },
      {
        q: "When does the founding price end?",
        a: "The Founding Family pricing ($39/year) is available during our early access period. Once we exit early access and launch publicly, the standard price will be $79/year. Founding Families who subscribe before then keep their $39/year rate permanently — even as we add more features.",
      },
      {
        q: "How do I upgrade to Pro?",
        a: 'Click Upgrade to Pro in your sidebar or visit the pricing section on the homepage. You\'ll be taken to a secure Stripe checkout. Once payment is complete, your account is upgraded instantly — no waiting, no manual review. You can cancel anytime from Settings → Billing.',
      },
    ],
  },
  {
    title: "AI Features",
    emoji: "✨",
    items: [
      {
        q: "What AI features does Rooted have?",
        a: "Rooted has three AI-powered features: Family Update (generates a warm narrative summary of your recent school weeks), Graduation Letter (writes a personalized, heartfelt letter for your graduating homeschooler), and Year in Review (creates a beautiful annual summary with highlights and a narrative you'll want to save forever).",
      },
      {
        q: "Why can't I access AI features on the free plan?",
        a: "AI generation costs real money to run — every narrative requires a call to a large language model, and those costs add up. Keeping AI features Pro-only lets us keep the free plan genuinely free for families who don't need them, while making sure the features are sustainable for those who do. Rooted Pro is $39/year — less than one curriculum book.",
      },
      {
        q: "How many AI generations do I get per month?",
        a: "Pro users get 50 AI generations per month, which resets on the first of each month. That's more than enough for regular use of Family Updates, Graduation Letters, and Year in Review. If you hit the limit and need more, reach out to us — we're happy to help.",
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
          <div className="w-8 h-8 rounded-xl bg-[#5c7f63] flex items-center justify-center text-base">
            🌿
          </div>
          <span className="font-bold text-[#2d2926]">Rooted Homeschool</span>
        </div>
        <h1 className="text-3xl font-bold text-[#2d2926] mb-2">
          Frequently Asked Questions
        </h1>
        <p className="text-sm text-[#b5aca4] mb-12">
          Everything you need to know about Rooted Homeschool.
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
              href="mailto:hello.rootedapp@gmail.com"
              className="text-[#5c7f63] hover:underline"
            >
              hello.rootedapp@gmail.com
            </a>
          </p>
          <p className="text-xs text-[#b5aca4]">We&apos;re a small team and respond to every message personally.</p>
        </div>

      </div>
    </main>
  );
}
