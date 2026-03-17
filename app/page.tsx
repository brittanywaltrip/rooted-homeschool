"use client";

import Link from "next/link";
import HashRedirect from "./components/HashRedirect";
import { useState } from "react";

// ─── App mockup screenshots ───────────────────────────────────────────────────

function TodayMockup() {
  return (
    <div className="bg-[#f8f7f4] rounded-2xl overflow-hidden shadow-xl border border-[#e8e2d9] text-left select-none">
      {/* top bar */}
      <div className="bg-[#fefcf9] border-b border-[#e8e2d9] px-4 py-2.5 flex items-center gap-2">
        <div className="w-2 h-2 rounded-full bg-[#5c7f63]" />
        <span className="text-xs font-semibold text-[#2d2926]">Today</span>
      </div>
      <div className="p-4 space-y-3">
        <div>
          <p className="text-[10px] text-[#b5aca4] uppercase tracking-widest">Monday, March 16</p>
          <p className="text-sm font-bold text-[#2d2926]">Good morning, Smith! 👋</p>
        </div>
        {/* tree card */}
        <div className="bg-gradient-to-br from-[#e8f5ea] to-[#d4ead6] rounded-xl p-3 flex gap-3 items-center">
          <div className="text-3xl">🌿</div>
          <div className="flex-1">
            <p className="text-[10px] font-bold text-[#5c7f63] uppercase tracking-widest">Sapling</p>
            <p className="text-xs font-semibold text-[#2d2926]">Growing strong</p>
            <div className="mt-1.5 h-1.5 bg-white/50 rounded-full overflow-hidden">
              <div className="h-full w-3/5 bg-[#5c7f63] rounded-full" />
            </div>
          </div>
          <span className="text-xs font-bold text-[#5c7f63] bg-white/60 px-1.5 py-0.5 rounded-full">31 🍃</span>
        </div>
        {/* lessons */}
        <div className="space-y-1.5">
          {[
            { done: true,  subject: "Math",    title: "Fractions worksheet" },
            { done: true,  subject: "Reading", title: "Charlotte's Web ch. 5" },
            { done: false, subject: "Science", title: "Leaf classification" },
          ].map((l) => (
            <div key={l.title} className={`flex items-center gap-2 px-3 py-2 rounded-lg border text-xs ${
              l.done ? "bg-[#f0f7f1] border-[#c2dbc5]" : "bg-white border-[#e8e2d9]"
            }`}>
              <div className={`w-3.5 h-3.5 rounded-full border-2 flex items-center justify-center shrink-0 ${
                l.done ? "bg-[#5c7f63] border-[#5c7f63]" : "border-[#c8bfb5]"
              }`}>
                {l.done && <span className="text-[6px] text-white font-bold">✓</span>}
              </div>
              <span className={`font-medium truncate ${l.done ? "line-through text-[#7a9e7e]" : "text-[#2d2926]"}`}>{l.title}</span>
              <span className="ml-auto text-[#b5aca4] shrink-0">{l.subject}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function GardenMockup() {
  return (
    <div className="bg-[#f8f7f4] rounded-2xl overflow-hidden shadow-xl border border-[#e8e2d9] text-left select-none">
      <div className="bg-[#fefcf9] border-b border-[#e8e2d9] px-4 py-2.5 flex items-center gap-2">
        <div className="w-2 h-2 rounded-full bg-[#7a9e7e]" />
        <span className="text-xs font-semibold text-[#2d2926]">Garden</span>
      </div>
      {/* garden scene */}
      <div className="relative overflow-hidden" style={{
        background: "linear-gradient(180deg,#5bafd4 0%,#b2e4f0 55%,#c8ecb8 75%,#7ec46a 100%)",
        height: 110,
      }}>
        <span className="absolute top-2 right-3 text-2xl">☀️</span>
        <span className="absolute" style={{ top: "18%", left: "12%" }}>🌤️</span>
        {/* ground */}
        <div className="absolute bottom-0 left-0 right-0 h-8 bg-[#5c8a57] rounded-t-[40%]" />
        {/* trees */}
        {[{ x: "28%", emoji: "🌲", label: "Emma", leaves: 31 }, { x: "62%", emoji: "🌳", label: "Noah", leaves: 14 }].map((t) => (
          <div key={t.label} className="absolute text-center" style={{ bottom: "18%", left: t.x, transform: "translateX(-50%)" }}>
            <div className="text-3xl">{t.emoji}</div>
            <span className="text-[9px] font-bold bg-white/80 px-1.5 py-0.5 rounded-full text-[#2d2926]">{t.label}</span>
          </div>
        ))}
        {/* butterflies */}
        <span className="absolute text-base" style={{ top: "30%", left: "45%" }}>🦋</span>
      </div>
      <div className="p-3">
        <div className="flex items-center justify-between bg-[#e8f5ea] rounded-xl px-3 py-2">
          <div>
            <p className="text-[10px] text-[#5c7f63] font-bold uppercase tracking-widest">Emma · Sapling</p>
            <p className="text-xs text-[#2d2926]">31 leaves earned</p>
          </div>
          <div className="flex gap-1">
            {["⭐","🌱","🍃","🌿"].map((b) => (
              <span key={b} className="text-sm">{b}</span>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function ReportMockup() {
  return (
    <div className="bg-[#f8f7f4] rounded-2xl overflow-hidden shadow-xl border border-[#e8e2d9] text-left select-none">
      <div className="bg-[#fefcf9] border-b border-[#e8e2d9] px-4 py-2.5 flex items-center gap-2">
        <div className="w-2 h-2 rounded-full bg-[#8b6f47]" />
        <span className="text-xs font-semibold text-[#2d2926]">Reports</span>
      </div>
      <div className="p-4 space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-[10px] text-[#b5aca4] uppercase tracking-widest">Emma's Progress Report</p>
            <p className="text-[10px] text-[#7a6f65]">Aug 1 – Mar 16, 2025</p>
          </div>
          <div className="flex items-center gap-1 text-[10px] bg-[#5c7f63] text-white px-2 py-1 rounded-lg">
            🖨️ Print
          </div>
        </div>
        <div className="grid grid-cols-4 gap-1.5">
          {[
            { label: "Lessons", value: "94" },
            { label: "Hours",   value: "47h" },
            { label: "Books",   value: "12" },
            { label: "Subjects",value: "6" },
          ].map(({ label, value }) => (
            <div key={label} className="text-center bg-[#f0ede8] rounded-lg py-2">
              <p className="text-sm font-bold text-[#2d2926]">{value}</p>
              <p className="text-[8px] text-[#7a6f65]">{label}</p>
            </div>
          ))}
        </div>
        <div className="space-y-1.5">
          {[
            { subject: "Math",    pct: 90, color: "#5c7f63" },
            { subject: "Reading", pct: 70, color: "#4a7a8a" },
            { subject: "Science", pct: 45, color: "#8b6f47" },
          ].map((s) => (
            <div key={s.subject} className="flex items-center gap-2">
              <span className="text-[9px] w-12 text-[#7a6f65]">{s.subject}</span>
              <div className="flex-1 h-1.5 bg-[#f0ede8] rounded-full overflow-hidden">
                <div className="h-full rounded-full" style={{ width: `${s.pct}%`, backgroundColor: s.color }} />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── Waitlist form ────────────────────────────────────────────────────────────

function WaitlistForm() {
  const [email,     setEmail]     = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [loading,   setLoading]   = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim()) return;
    setLoading(true);
    // Small delay for feel — backend can be wired later
    await new Promise((r) => setTimeout(r, 800));
    setLoading(false);
    setSubmitted(true);
  }

  if (submitted) {
    return (
      <div className="flex flex-col items-center gap-3 py-4">
        <div className="w-14 h-14 rounded-full bg-[#e8f0e9] flex items-center justify-center text-2xl">🌱</div>
        <p className="font-semibold text-[#2d2926]">You&apos;re on the list!</p>
        <p className="text-sm text-[#7a6f65] text-center max-w-xs">
          We&apos;ll email <strong>{email}</strong> when founding family pricing is available.
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col sm:flex-row gap-2 w-full max-w-md mx-auto">
      <input
        type="email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        placeholder="your@email.com"
        required
        className="flex-1 px-4 py-3 rounded-xl border border-[#e8e2d9] bg-white text-sm text-[#2d2926] placeholder-[#c8bfb5] focus:outline-none focus:border-[#5c7f63] focus:ring-2 focus:ring-[#5c7f63]/20"
      />
      <button
        type="submit"
        disabled={loading}
        className="bg-[#5c7f63] hover:bg-[#3d5c42] disabled:opacity-60 text-white font-medium px-6 py-3 rounded-xl transition-colors text-sm whitespace-nowrap"
      >
        {loading ? "Saving…" : "Join Waitlist"}
      </button>
    </form>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function Home() {
  return (
    <main className="min-h-screen bg-[#f8f7f4] text-[#2d2926]">
      <HashRedirect />

      {/* ── Navbar ─────────────────────────────────────────── */}
      <header className="sticky top-0 z-40 bg-[#f8f7f4]/90 backdrop-blur border-b border-[#e8e2d9]">
        <div className="px-6 py-4 flex items-center justify-between max-w-5xl mx-auto">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg bg-[#5c7f63] flex items-center justify-center text-sm">🌿</div>
            <span className="text-base font-bold text-[#2d2926]">Rooted Homeschool</span>
          </div>
          <div className="flex items-center gap-4">
            <Link href="/login" className="text-sm font-medium text-[#7a6f65] hover:text-[#2d2926] transition-colors hidden sm:block">
              Log In
            </Link>
            <Link
              href="/signup"
              className="text-sm font-medium bg-[#5c7f63] hover:bg-[#3d5c42] text-white px-4 py-2 rounded-xl transition-colors"
            >
              Start Free
            </Link>
          </div>
        </div>
      </header>

      {/* ── Hero ───────────────────────────────────────────── */}
      <section className="flex flex-col items-center text-center px-6 pt-20 pb-16 max-w-3xl mx-auto">
        <div className="inline-flex items-center gap-2 bg-[#e8f0e9] text-[#5c7f63] text-xs font-semibold px-4 py-1.5 rounded-full mb-7 uppercase tracking-widest">
          <span className="w-1.5 h-1.5 rounded-full bg-[#5c7f63]" />
          Peaceful planning for intentional families
        </div>

        <h1 className="text-5xl sm:text-6xl font-bold leading-tight mb-6 text-[#2d2926]">
          Stay Rooted.{" "}
          <span className="text-[#5c7f63]">Teach with</span>{" "}
          Intention.
        </h1>

        <p className="text-xl text-[#7a6f65] mb-10 leading-relaxed max-w-xl">
          The calm, all-in-one homeschool companion. Plan lessons, track growth,
          celebrate milestones, and generate compliance reports — without the overwhelm.
        </p>

        <div className="flex flex-col sm:flex-row gap-3 mb-8">
          <Link
            href="/signup"
            className="bg-[#5c7f63] hover:bg-[#3d5c42] text-white px-8 py-4 rounded-xl font-semibold text-base transition-colors shadow-sm"
          >
            Start for Free →
          </Link>
          <Link
            href="/login"
            className="border-2 border-[#5c7f63] text-[#5c7f63] hover:bg-[#e8f0e9] px-8 py-4 rounded-xl font-semibold text-base transition-colors"
          >
            Log In
          </Link>
        </div>

        <p className="text-xs text-[#b5aca4]">
          No credit card required · Free to start · Works on all devices
        </p>
      </section>

      {/* ── App Screenshots ────────────────────────────────── */}
      <section className="px-6 pb-20 max-w-5xl mx-auto">
        <div className="text-center mb-10">
          <p className="text-xs font-semibold uppercase tracking-widest text-[#b5aca4] mb-2">See it in action</p>
          <h2 className="text-3xl font-bold text-[#2d2926]">Built for how you actually homeschool</h2>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-5">
          <div className="flex flex-col gap-3">
            <TodayMockup />
            <p className="text-sm font-semibold text-[#2d2926] text-center">Daily lesson tracking</p>
            <p className="text-xs text-[#7a6f65] text-center leading-relaxed">
              See today&apos;s lessons, log what you completed, and watch the growth tree grow in real time.
            </p>
          </div>
          <div className="flex flex-col gap-3">
            <GardenMockup />
            <p className="text-sm font-semibold text-[#2d2926] text-center">The Family Garden</p>
            <p className="text-xs text-[#7a6f65] text-center leading-relaxed">
              Every lesson earns a leaf. Watch each child&apos;s tree bloom from Seed to Thriving.
            </p>
          </div>
          <div className="flex flex-col gap-3">
            <ReportMockup />
            <p className="text-sm font-semibold text-[#2d2926] text-center">Printable reports</p>
            <p className="text-xs text-[#7a6f65] text-center leading-relaxed">
              Generate clean, professional progress reports for state compliance — one click, print-ready.
            </p>
          </div>
        </div>
      </section>

      {/* ── 5 Feature Pillars ─────────────────────────────── */}
      <section className="px-6 pb-20 bg-[#fefcf9] border-y border-[#e8e2d9]">
        <div className="max-w-5xl mx-auto py-16">
          <div className="text-center mb-12">
            <p className="text-xs font-semibold uppercase tracking-widest text-[#b5aca4] mb-2">Everything you need</p>
            <h2 className="text-3xl font-bold text-[#2d2926]">Five pillars of a peaceful homeschool</h2>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
            {[
              {
                emoji: "🗓️",
                title: "Plan Your Days",
                color: "#e8f0e9",
                border: "#b8d9bc",
                desc: "Schedule lessons weeks ahead, see what's up today, and keep the whole family's learning on track — without living in a spreadsheet.",
              },
              {
                emoji: "🌱",
                title: "Watch Them Grow",
                color: "#f0f7e0",
                border: "#c8d8a0",
                desc: "The Garden gives every child a living tree that grows with each lesson. Five stages, badges to earn, and a visual record of progress.",
              },
              {
                emoji: "📚",
                title: "Curated Resources",
                color: "#e8f4f8",
                border: "#a8d0e0",
                desc: "Educator discounts, virtual field trips, free printables, science projects, and state requirements — all in one tab.",
              },
              {
                emoji: "📸",
                title: "Capture Memories",
                color: "#fef3e0",
                border: "#f0d090",
                desc: "Log photos, projects, and books as they happen. Build a living record of your family&apos;s learning story over the years.",
              },
              {
                emoji: "📋",
                title: "Generate Reports",
                color: "#f5ede0",
                border: "#d4b896",
                desc: "Print professional progress reports for state compliance. Configure by child and date range, then print or save as PDF in one click.",
              },
              {
                emoji: "💡",
                title: "Insights & Streaks",
                color: "#f0e8f8",
                border: "#c8a8e0",
                desc: "See your learning streaks, most active days, and how this week compares to last. Celebrate consistency with data that actually motivates.",
              },
            ].map((f) => (
              <div
                key={f.title}
                className="rounded-2xl p-6 border"
                style={{ backgroundColor: f.color, borderColor: f.border }}
              >
                <div className="text-3xl mb-3">{f.emoji}</div>
                <h3 className="font-bold text-[#2d2926] mb-2">{f.title}</h3>
                <p className="text-sm text-[#7a6f65] leading-relaxed">{f.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Pricing ────────────────────────────────────────── */}
      <section className="px-6 py-20 max-w-3xl mx-auto text-center">
        <p className="text-xs font-semibold uppercase tracking-widest text-[#b5aca4] mb-2">Simple, honest pricing</p>
        <h2 className="text-3xl font-bold text-[#2d2926] mb-4">One plan. Everything included.</h2>
        <p className="text-[#7a6f65] mb-12 max-w-lg mx-auto">
          No tiers, no feature gating. Every family gets the full experience for one flat annual fee.
        </p>

        <div className="flex flex-col sm:flex-row gap-5 justify-center items-stretch">
          {/* Founding Family */}
          <div className="flex-1 max-w-xs mx-auto relative bg-gradient-to-br from-[#e8f5ea] to-[#d4ead6] border-2 border-[#5c7f63] rounded-3xl p-8 text-center shadow-md">
            <div className="absolute -top-3.5 left-1/2 -translate-x-1/2 bg-[#c4956a] text-white text-xs font-bold px-4 py-1 rounded-full whitespace-nowrap">
              🌱 Founding Family
            </div>
            <p className="text-sm font-semibold text-[#5c7f63] mb-2 mt-2">Limited Offer</p>
            <div className="flex items-end justify-center gap-1 mb-1">
              <span className="text-5xl font-bold text-[#2d2926]">$39</span>
              <span className="text-lg font-semibold text-[#5c7f63] mb-1">.99</span>
              <span className="text-sm text-[#7a6f65] mb-1.5">/year</span>
            </div>
            <p className="text-xs text-[#8b6f47] mb-6 font-medium">Lock in this price forever · First 200 families</p>
            <ul className="text-sm text-left space-y-2 mb-7">
              {[
                "Unlimited children",
                "All 5 app sections",
                "Printable reports",
                "Streaks & insights",
                "Priority support",
                "Lifetime founding price 🎁",
              ].map((f) => (
                <li key={f} className="flex items-start gap-2 text-[#2d2926]">
                  <span className="text-[#5c7f63] mt-0.5 shrink-0">✓</span>
                  {f}
                </li>
              ))}
            </ul>
            <Link
              href="/signup"
              className="block w-full bg-[#5c7f63] hover:bg-[#3d5c42] text-white font-semibold py-3.5 rounded-xl transition-colors"
            >
              Claim Founding Price
            </Link>
          </div>

          {/* Regular */}
          <div className="flex-1 max-w-xs mx-auto bg-[#fefcf9] border border-[#e8e2d9] rounded-3xl p-8 text-center">
            <p className="text-sm font-semibold text-[#b5aca4] mb-2 mt-2">Standard</p>
            <div className="flex items-end justify-center gap-1 mb-1">
              <span className="text-5xl font-bold text-[#2d2926]">$59</span>
              <span className="text-lg font-semibold text-[#7a6f65] mb-1">.99</span>
              <span className="text-sm text-[#b5aca4] mb-1.5">/year</span>
            </div>
            <p className="text-xs text-[#b5aca4] mb-6 font-medium">After founding period ends</p>
            <ul className="text-sm text-left space-y-2 mb-7">
              {[
                "Unlimited children",
                "All 5 app sections",
                "Printable reports",
                "Streaks & insights",
                "Standard support",
              ].map((f) => (
                <li key={f} className="flex items-start gap-2 text-[#7a6f65]">
                  <span className="text-[#b5aca4] mt-0.5 shrink-0">✓</span>
                  {f}
                </li>
              ))}
            </ul>
            <Link
              href="/signup"
              className="block w-full border-2 border-[#5c7f63] text-[#5c7f63] hover:bg-[#e8f0e9] font-semibold py-3.5 rounded-xl transition-colors"
            >
              Start Free Trial
            </Link>
          </div>
        </div>

        <p className="text-xs text-[#b5aca4] mt-8">
          Try it free. No credit card needed to get started.
        </p>
      </section>

      {/* ── Email Waitlist ─────────────────────────────────── */}
      <section className="px-6 pb-20">
        <div className="max-w-2xl mx-auto bg-gradient-to-br from-[#e8f5ea] to-[#d4ead6] border border-[#b8d9bc] rounded-3xl p-10 text-center">
          <div className="text-4xl mb-4">📬</div>
          <h2 className="text-2xl font-bold text-[#2d2926] mb-3">
            Get founding family pricing
          </h2>
          <p className="text-[#7a6f65] mb-7 leading-relaxed max-w-sm mx-auto">
            Join the waitlist to lock in <strong>$39.99/year</strong> before founding spots run out.
            We&apos;ll email you the moment it&apos;s live.
          </p>
          <WaitlistForm />
          <p className="text-xs text-[#7a6f65] mt-4 opacity-70">
            No spam. Unsubscribe anytime. We promise.
          </p>
        </div>
      </section>

      {/* ── Social proof / quote ───────────────────────────── */}
      <section className="px-6 pb-20 max-w-3xl mx-auto text-center">
        <div className="bg-[#fefcf9] border border-[#e8e2d9] rounded-3xl p-10">
          <p className="text-2xl font-serif italic text-[#5c7f63] leading-relaxed mb-5">
            &ldquo;Education is not the filling of a pail, but the lighting of a fire.&rdquo;
          </p>
          <p className="text-sm text-[#b5aca4]">— W.B. Yeats</p>
        </div>
      </section>

      {/* ── Footer ─────────────────────────────────────────── */}
      <footer className="border-t border-[#e8e2d9] py-8 px-6">
        <div className="max-w-5xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-4 text-sm text-[#b5aca4]">
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 rounded-md bg-[#5c7f63] flex items-center justify-center text-xs">🌿</div>
            <span className="font-medium text-[#7a6f65]">Rooted Homeschool</span>
          </div>
          <p>© {new Date().getFullYear()} Rooted Homeschool — Made with care for learning families</p>
          <div className="flex gap-4">
            <Link href="/login"  className="hover:text-[#5c7f63] transition-colors">Log In</Link>
            <Link href="/signup" className="hover:text-[#5c7f63] transition-colors">Sign Up</Link>
          </div>
        </div>
      </footer>
    </main>
  );
}
