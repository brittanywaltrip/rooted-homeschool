"use client";

import Link from "next/link";
import HashRedirect from "./components/HashRedirect";
import { useState, useEffect } from "react";
import { supabase } from "@/lib/supabase";

// ─── App mockup components (unchanged) ───────────────────────────────────────

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
            <p className="text-[10px] text-[#b5aca4] uppercase tracking-widest">Emma&apos;s Progress Report</p>
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

// ─── Waitlist form (Supabase logic unchanged) ─────────────────────────────────

function WaitlistForm() {
  const [email,     setEmail]     = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [loading,   setLoading]   = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim()) return;
    setLoading(true);
    try {
      await supabase.from("app_events").insert({
        type: "waitlist_signup",
        payload: { email: email.trim(), timestamp: new Date().toISOString() },
      });
    } catch {
      // Silently continue — confirmation still shown to user
    }
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
        className="bg-[#5c7f63] hover:bg-[#3d5c42] disabled:opacity-60 text-white font-semibold px-6 py-3 rounded-xl transition-colors text-sm whitespace-nowrap shadow-sm"
      >
        {loading ? "Saving…" : "Join Waitlist"}
      </button>
    </form>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function Home() {
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 10);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <main className="min-h-screen bg-[#f8f7f4] text-[#2d2926] overflow-x-hidden">

      {/* ── Inline animations & utilities ──────────────────────────────────── */}
      <style>{`
        html { scroll-behavior: smooth; }

        @keyframes fadeInUp {
          from { opacity: 0; transform: translateY(24px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        @keyframes fadeIn {
          from { opacity: 0; }
          to   { opacity: 1; }
        }
        @keyframes scrollBounce {
          0%, 100% { transform: translateX(-50%) translateY(0); }
          50%       { transform: translateX(-50%) translateY(8px); }
        }
        @keyframes badgeShimmer {
          0%   { background-position: -200% center; }
          100% { background-position:  200% center; }
        }

        .anim-fade-in-up { animation: fadeInUp 0.75s cubic-bezier(0.2, 0.6, 0.3, 1) both; }
        .anim-fade-in    { animation: fadeIn   0.75s ease-out both; }
        .delay-0   { animation-delay:   0ms; }
        .delay-150 { animation-delay: 150ms; }
        .delay-300 { animation-delay: 300ms; }
        .delay-450 { animation-delay: 450ms; }
        .delay-600 { animation-delay: 600ms; }
        .delay-750 { animation-delay: 750ms; }

        .scroll-bounce {
          animation: scrollBounce 1.8s ease-in-out infinite;
        }
        .founding-shimmer-badge {
          background: linear-gradient(90deg, #b8823a 0%, #e8b87a 35%, #d4a050 65%, #b8823a 100%);
          background-size: 200% auto;
          animation: badgeShimmer 2.8s linear infinite;
        }
        .founding-glow {
          box-shadow:
            0 0 0 2px #5c7f63,
            0 16px 48px rgba(92, 127, 99, 0.18),
            0 0 80px rgba(92, 127, 99, 0.08);
        }
        .mockup-card:hover .mockup-inner {
          transform: scale(1.025);
          box-shadow: 0 25px 60px rgba(0,0,0,0.12);
        }
        .mockup-inner {
          transition: transform 0.3s ease, box-shadow 0.3s ease;
        }
      `}</style>

      <HashRedirect />

      {/* ── 1. NAVBAR ──────────────────────────────────────────────────────── */}
      <header
        className={`sticky top-0 z-50 backdrop-blur-md border-b border-[#e8e2d9] transition-all duration-300 ${
          scrolled ? "shadow-md shadow-black/[0.06]" : "shadow-none"
        }`}
        style={{ backgroundColor: "rgba(248, 247, 244, 0.94)" }}
      >
        <nav className="max-w-6xl mx-auto px-5 sm:px-8 py-4 flex items-center justify-between">
          {/* Logo */}
          <Link href="/" className="flex items-center gap-2.5 group shrink-0">
            <div className="w-8 h-8 rounded-xl bg-[#5c7f63] group-hover:bg-[#3d5c42] flex items-center justify-center text-base shadow-sm transition-colors">
              🌿
            </div>
            <div className="leading-none">
              <span
                className="text-sm font-bold text-[#2d2926] block"
                style={{ fontFamily: "var(--font-display)" }}
              >
                Rooted
              </span>
              <span className="text-[10px] text-[#7a6f65] block tracking-wide leading-tight">
                Homeschool
              </span>
            </div>
          </Link>

          {/* Right side */}
          <div className="flex items-center gap-2">
            <Link
              href="/login"
              className="hidden sm:inline-flex text-sm font-medium text-[#7a6f65] hover:text-[#2d2926] transition-colors px-3 py-2 rounded-lg hover:bg-[#f0ede8]"
            >
              Log In
            </Link>
            <Link
              href="/signup"
              className="inline-flex items-center gap-1.5 text-sm font-semibold bg-[#5c7f63] hover:bg-[#3d5c42] text-white px-5 py-2.5 rounded-xl transition-colors shadow-sm"
            >
              Start Free
              <svg width="11" height="11" viewBox="0 0 11 11" fill="none" aria-hidden="true">
                <path d="M1.5 5.5h8M5.5 1.5l4 4-4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </Link>
          </div>
        </nav>
      </header>

      {/* ── 2. HERO ────────────────────────────────────────────────────────── */}
      <section
        className="relative flex flex-col items-center justify-center text-center text-white px-6 py-28 min-h-[92vh]"
        style={{
          backgroundImage: [
            "linear-gradient(to bottom, rgba(0,0,0,0.52) 0%, rgba(10,28,14,0.40) 55%, rgba(15,35,18,0.52) 100%)",
            "url('https://images.unsplash.com/photo-1448375240586-882707db888b?w=1920&q=80')",
          ].join(", "),
          backgroundSize: "cover",
          backgroundPosition: "center center",
          backgroundAttachment: "fixed",
        }}
      >
        {/* Vignette edges */}
        <div
          className="absolute inset-0 pointer-events-none"
          style={{ background: "radial-gradient(ellipse at center, transparent 40%, rgba(0,0,0,0.25) 100%)" }}
          aria-hidden="true"
        />

        <div className="relative z-10 flex flex-col items-center max-w-3xl">
          {/* Beta badge */}
          <div className="anim-fade-in-up delay-0 inline-flex items-center gap-2 bg-white/12 backdrop-blur-sm border border-white/20 text-white/90 text-[11px] font-semibold px-4 py-1.5 rounded-full mb-8 tracking-widest uppercase">
            <span className="w-1.5 h-1.5 rounded-full bg-[#7ec46a] inline-block shrink-0" />
            Now in Beta · Join Free
          </div>

          {/* H1 */}
          <h1
            className="anim-fade-in-up delay-150 text-5xl sm:text-6xl lg:text-[5rem] font-bold leading-[1.08] mb-6"
            style={{
              fontFamily: "var(--font-display)",
              textShadow: "0 2px 24px rgba(0,0,0,0.35)",
            }}
          >
            Stay Rooted.{" "}
            <em className="not-italic" style={{ color: "#a8d8a0" }}>Teach with</em>{" "}
            Intention.
          </h1>

          {/* Subhead */}
          <p
            className="anim-fade-in-up delay-300 text-lg sm:text-xl text-white/82 mb-10 leading-relaxed max-w-[34rem]"
            style={{ textShadow: "0 1px 10px rgba(0,0,0,0.30)" }}
          >
            The calm, all-in-one companion for homeschool families. Plan lessons,
            celebrate growth, and generate compliance reports — without the overwhelm.
          </p>

          {/* CTAs */}
          <div className="anim-fade-in-up delay-450 flex flex-col sm:flex-row gap-3 mb-8 w-full sm:w-auto">
            <Link
              href="/signup"
              className="inline-flex items-center justify-center gap-2 bg-white text-[#3d5c42] hover:bg-[#f0f9f1] font-bold px-8 py-4 rounded-xl transition-all shadow-lg shadow-black/25 text-base"
            >
              Start Free — It&apos;s Free →
            </Link>
            <a
              href="#features"
              className="inline-flex items-center justify-center gap-2 border-2 border-white/55 text-white hover:bg-white/12 font-semibold px-8 py-4 rounded-xl transition-all text-base backdrop-blur-sm"
            >
              See How It Works
            </a>
          </div>

          {/* Social proof */}
          <p className="anim-fade-in delay-600 text-white/65 text-sm flex items-center gap-2">
            <span>🌱</span>
            Join 200+ families already growing
          </p>
        </div>

        {/* Scroll indicator */}
        <div
          className="scroll-bounce absolute bottom-8 left-1/2 text-white/40"
          aria-hidden="true"
        >
          <svg width="22" height="22" viewBox="0 0 22 22" fill="none">
            <path d="M11 4v14M4 12l7 7 7-7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </div>
      </section>

      {/* ── 3. SOCIAL PROOF STRIP ──────────────────────────────────────────── */}
      <section className="bg-[#fefcf9] border-b border-[#e8e2d9]">
        <div className="max-w-5xl mx-auto">
          <div className="grid grid-cols-2 sm:grid-cols-4 divide-x divide-y sm:divide-y-0 divide-[#e8e2d9]">
            {[
              { number: "200+",    label: "Families Growing",    icon: "🌱" },
              { number: "5",       label: "Sections, All-in-One", icon: "✨" },
              { number: "Free",    label: "To Start, No Card",   icon: "🎁" },
              { number: "1-Click", label: "State-Ready Reports",  icon: "📋" },
            ].map(({ number, label, icon }) => (
              <div key={label} className="py-9 px-4 text-center">
                <div className="text-xl mb-2">{icon}</div>
                <div
                  className="text-2xl sm:text-3xl font-bold text-[#2d2926] mb-1 leading-none"
                  style={{ fontFamily: "var(--font-display)" }}
                >
                  {number}
                </div>
                <div className="text-xs text-[#7a6f65] leading-snug mt-1">{label}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── 4. APP PREVIEW ─────────────────────────────────────────────────── */}
      <section id="features" className="px-6 sm:px-8 py-20 max-w-5xl mx-auto">
        <div className="text-center mb-14">
          <p className="text-xs font-semibold uppercase tracking-widest text-[#b5aca4] mb-3">
            See it in action
          </p>
          <h2
            className="text-3xl sm:text-4xl font-bold text-[#2d2926]"
            style={{ fontFamily: "var(--font-display)" }}
          >
            Built for how you actually homeschool
          </h2>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-8 sm:gap-6">
          {[
            {
              mockup: <TodayMockup />,
              title: "Daily Lesson Tracking",
              desc: "See today's lessons at a glance. Log completions and watch the growth tree fill with leaves in real time.",
            },
            {
              mockup: <GardenMockup />,
              title: "The Family Garden",
              desc: "Every lesson earns a leaf. Each child's tree blooms through five stages — from Seed all the way to Thriving.",
            },
            {
              mockup: <ReportMockup />,
              title: "Print-Ready Reports",
              desc: "Generate clean, professional progress reports for state compliance. Configure, preview, and print in one click.",
            },
          ].map(({ mockup, title, desc }) => (
            <div key={title} className="mockup-card flex flex-col gap-5 cursor-default">
              <div className="mockup-inner rounded-2xl">{mockup}</div>
              <div className="text-center px-2">
                <h3
                  className="text-sm font-bold text-[#2d2926] mb-1.5"
                  style={{ fontFamily: "var(--font-display)" }}
                >
                  {title}
                </h3>
                <p className="text-xs text-[#7a6f65] leading-relaxed">{desc}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* ── 5. FEATURES (FIVE PILLARS) ──────────────────────────────────────── */}
      <section className="bg-[#fefcf9] border-y border-[#e8e2d9]">
        <div className="max-w-5xl mx-auto px-6 sm:px-8 py-20">
          <div className="text-center mb-12">
            <p className="text-xs font-semibold uppercase tracking-widest text-[#b5aca4] mb-3">
              Everything you need
            </p>
            <h2
              className="text-3xl sm:text-4xl font-bold text-[#2d2926]"
              style={{ fontFamily: "var(--font-display)" }}
            >
              Five pillars of a peaceful homeschool
            </h2>
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
                desc: "Educator discounts, virtual field trips, free printables, science projects, and state requirements — all in one curated tab.",
              },
              {
                emoji: "📸",
                title: "Capture Memories",
                color: "#fef3e0",
                border: "#f0d090",
                desc: "Log photos, projects, and books as they happen. Build a living record of your family's learning story over the years.",
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
                desc: "See your learning streaks, most active days, and how this week compares to last. Celebrate consistency with data that motivates.",
              },
            ].map((f) => (
              <div
                key={f.title}
                className="rounded-2xl p-6 border transition-all duration-200 hover:shadow-lg hover:scale-[1.02] cursor-default"
                style={{ backgroundColor: f.color, borderColor: f.border }}
              >
                <div className="text-3xl mb-3">{f.emoji}</div>
                <h3
                  className="font-bold text-[#2d2926] mb-2 text-base"
                  style={{ fontFamily: "var(--font-display)" }}
                >
                  {f.title}
                </h3>
                <p className="text-sm text-[#7a6f65] leading-relaxed">{f.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── 6. HOW IT WORKS ────────────────────────────────────────────────── */}
      <section className="px-6 sm:px-8 py-20 max-w-5xl mx-auto">
        <div className="text-center mb-16">
          <p className="text-xs font-semibold uppercase tracking-widest text-[#b5aca4] mb-3">
            Getting started
          </p>
          <h2
            className="text-3xl sm:text-4xl font-bold text-[#2d2926]"
            style={{ fontFamily: "var(--font-display)" }}
          >
            Up and running in minutes
          </h2>
        </div>

        <div className="relative grid md:grid-cols-3 gap-14 md:gap-8">
          {/* Dashed connector — desktop only */}
          <div
            className="hidden md:block absolute inset-x-16 pointer-events-none"
            style={{ top: "1.9rem", borderTop: "2px dashed rgba(92,127,99,0.28)" }}
            aria-hidden="true"
          />

          {[
            {
              num: "1",
              emoji: "🌱",
              title: "Create your family profile",
              desc: "Add children with a name and a color. Customize your family name. Takes 60 seconds — no tutorials required.",
            },
            {
              num: "2",
              emoji: "📚",
              title: "Log lessons as you go",
              desc: "Check off lessons throughout your day. Watch the growth tree grow leaf by leaf, in real time, with every completion.",
            },
            {
              num: "3",
              emoji: "📋",
              title: "Print your compliance report",
              desc: "When it's time, generate a professional PDF progress report in one click. State-ready, beautifully formatted.",
            },
          ].map((step) => (
            <div key={step.num} className="flex flex-col items-center text-center">
              {/* Numbered circle — bg covers dashed line */}
              <div className="relative z-10 w-16 h-16 rounded-full bg-[#fefcf9] border-2 border-[#5c7f63]/35 flex items-center justify-center mb-5 shadow-sm">
                <span
                  className="text-[1.6rem] font-bold text-[#5c7f63] leading-none"
                  style={{ fontFamily: "var(--font-display)" }}
                >
                  {step.num}
                </span>
              </div>
              <div className="text-3xl mb-3">{step.emoji}</div>
              <h3
                className="font-bold text-[#2d2926] text-base mb-2"
                style={{ fontFamily: "var(--font-display)" }}
              >
                {step.title}
              </h3>
              <p className="text-sm text-[#7a6f65] leading-relaxed max-w-[16rem]">{step.desc}</p>
            </div>
          ))}
        </div>

        <div className="text-center mt-14">
          <Link
            href="/signup"
            className="inline-flex items-center gap-2 bg-[#5c7f63] hover:bg-[#3d5c42] text-white font-semibold px-9 py-4 rounded-xl transition-colors shadow-sm text-sm"
          >
            Get Started Free →
          </Link>
        </div>
      </section>

      {/* ── 7. TESTIMONIALS ────────────────────────────────────────────────── */}
      <section className="bg-[#fefcf9] border-y border-[#e8e2d9]">
        <div className="max-w-5xl mx-auto px-6 sm:px-8 py-20">
          <div className="text-center mb-12">
            <p className="text-xs font-semibold uppercase tracking-widest text-[#b5aca4] mb-3">
              Loved by families
            </p>
            <h2
              className="text-3xl sm:text-4xl font-bold text-[#2d2926]"
              style={{ fontFamily: "var(--font-display)" }}
            >
              What homeschool families are saying
            </h2>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {[
              {
                quote: "Finally, a homeschool app that gets it. No clutter, no confusion — just our family, growing together.",
                name: "Sarah M.",
                role: "Homeschool mom of 3",
                initial: "S",
                color: "#5c7f63",
              },
              {
                quote: "The growth tree is my kids' favorite part. They race to finish lessons just so they can see it grow.",
                name: "Jennifer K.",
                role: "2 children, homeschooling since 2021",
                initial: "J",
                color: "#4a7a8a",
              },
              {
                quote: "I've tried 4 homeschool apps. Rooted is the only one I've stuck with. It just makes sense.",
                name: "Michelle T.",
                role: "Homeschool mom of 4",
                initial: "M",
                color: "#8b6f47",
              },
            ].map((t) => (
              <div
                key={t.name}
                className="bg-white border border-[#e8e2d9] rounded-2xl p-7 flex flex-col gap-3 hover:shadow-md transition-shadow"
              >
                {/* Large opening quote */}
                <div
                  className="text-[3.5rem] leading-none select-none"
                  style={{ fontFamily: "var(--font-display)", color: "#d4ead6", lineHeight: 0.85 }}
                  aria-hidden="true"
                >
                  &ldquo;
                </div>
                <p
                  className="text-[#2d2926] leading-relaxed text-[15px] flex-1 italic"
                  style={{ fontFamily: "var(--font-display)" }}
                >
                  {t.quote}
                </p>
                <div className="flex items-center gap-3 pt-4 border-t border-[#f0ede8]">
                  <div
                    className="w-9 h-9 rounded-full flex items-center justify-center text-white text-sm font-bold shrink-0"
                    style={{ backgroundColor: t.color }}
                  >
                    {t.initial}
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-[#2d2926]">{t.name}</p>
                    <p className="text-xs text-[#7a6f65]">{t.role}</p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── 8. PRICING ─────────────────────────────────────────────────────── */}
      <section className="px-6 sm:px-8 py-20 max-w-4xl mx-auto">
        <div className="text-center mb-12">
          <p className="text-xs font-semibold uppercase tracking-widest text-[#b5aca4] mb-3">
            Simple, honest pricing
          </p>
          <h2
            className="text-3xl sm:text-4xl font-bold text-[#2d2926] mb-4"
            style={{ fontFamily: "var(--font-display)" }}
          >
            Start free. Grow with Rooted.
          </h2>
          <p className="text-[#7a6f65] max-w-lg mx-auto">
            Try everything free with one child. Upgrade when you&apos;re ready — lock in
            the founding price before it&apos;s gone.
          </p>
        </div>

        {/* Plan cards */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-5 mb-12 mt-8 items-start">

          {/* Free */}
          <div className="bg-[#fefcf9] border border-[#e8e2d9] rounded-2xl p-6 text-center flex flex-col">
            <p className="text-xs font-bold uppercase tracking-widest text-[#b5aca4] mb-3">Free Forever</p>
            <div className="flex items-end justify-center gap-1 mb-1">
              <span
                className="text-4xl font-bold text-[#2d2926]"
                style={{ fontFamily: "var(--font-display)" }}
              >
                $0
              </span>
            </div>
            <p className="text-xs text-[#b5aca4] mb-6">No credit card needed</p>
            <ul className="text-sm text-left space-y-2.5 mb-7 flex-1">
              {[
                "1 child profile",
                "Daily lesson tracking",
                "Basic progress view",
                "Garden (limited stages)",
              ].map((f) => (
                <li key={f} className="flex items-start gap-2 text-[#7a6f65]">
                  <span className="text-[#c8bfb5] mt-0.5 shrink-0 text-xs">✓</span>
                  {f}
                </li>
              ))}
            </ul>
            <Link
              href="/signup"
              className="block w-full border border-[#e8e2d9] text-[#7a6f65] hover:bg-[#f0ede8] font-medium py-3 rounded-xl transition-colors text-sm"
            >
              Start Free
            </Link>
          </div>

          {/* Founding Family */}
          <div className="relative bg-gradient-to-br from-[#eaf6ec] via-[#d6ecd9] to-[#c4e2ca] rounded-2xl p-6 text-center flex flex-col founding-glow">
            {/* Shimmer badge */}
            <div className="absolute -top-4 left-1/2 -translate-x-1/2 whitespace-nowrap founding-shimmer-badge text-white text-[11px] font-bold px-5 py-1.5 rounded-full shadow-md">
              🌱 Best Value — First 200 Families
            </div>
            <p className="text-xs font-bold uppercase tracking-widest text-[#5c7f63] mb-3 mt-2">
              Founding Family
            </p>
            <div className="flex items-end justify-center gap-1 mb-1">
              <span
                className="text-4xl font-bold text-[#2d2926]"
                style={{ fontFamily: "var(--font-display)" }}
              >
                $39
              </span>
              <span className="text-base font-semibold text-[#5c7f63] mb-0.5">.99</span>
              <span className="text-sm text-[#7a6f65] mb-1">/year</span>
            </div>
            <p className="text-xs text-[#8b6f47] font-semibold mb-6">
              Lock in forever · ~$3.33/month
            </p>
            <ul className="text-sm text-left space-y-2.5 mb-7 flex-1">
              {[
                "Unlimited children",
                "All 6 app sections",
                "Printable compliance reports",
                "Streaks & insights",
                "Memories & photo log",
                "Priority support",
                "Lifetime founding price 🎁",
              ].map((f) => (
                <li key={f} className="flex items-start gap-2 text-[#2d2926]">
                  <span className="text-[#5c7f63] mt-0.5 shrink-0 text-xs font-bold">✓</span>
                  {f}
                </li>
              ))}
            </ul>
            <Link
              href="/signup"
              className="block w-full bg-[#5c7f63] hover:bg-[#3d5c42] text-white font-bold py-3.5 rounded-xl transition-colors text-sm shadow-sm"
            >
              Claim Founding Price →
            </Link>
          </div>

          {/* Standard */}
          <div className="bg-[#fefcf9] border border-[#e8e2d9] rounded-2xl p-6 text-center flex flex-col">
            <p className="text-xs font-bold uppercase tracking-widest text-[#b5aca4] mb-3">Standard</p>
            <div className="flex items-end justify-center gap-1 mb-1">
              <span
                className="text-4xl font-bold text-[#2d2926]"
                style={{ fontFamily: "var(--font-display)" }}
              >
                $59
              </span>
              <span className="text-base font-semibold text-[#7a6f65] mb-0.5">.99</span>
              <span className="text-sm text-[#b5aca4] mb-1">/year</span>
            </div>
            <p className="text-xs text-[#b5aca4] mb-6">After founding period ends</p>
            <ul className="text-sm text-left space-y-2.5 mb-7 flex-1">
              {[
                "Unlimited children",
                "All 6 app sections",
                "Printable compliance reports",
                "Streaks & insights",
                "Memories & photo log",
                "Standard support",
              ].map((f) => (
                <li key={f} className="flex items-start gap-2 text-[#7a6f65]">
                  <span className="text-[#c8bfb5] mt-0.5 shrink-0 text-xs">✓</span>
                  {f}
                </li>
              ))}
            </ul>
            <Link
              href="/signup"
              className="block w-full border-2 border-[#5c7f63] text-[#5c7f63] hover:bg-[#e8f0e9] font-semibold py-3 rounded-xl transition-colors text-sm"
            >
              Start Free Trial
            </Link>
          </div>
        </div>

        {/* Feature comparison table */}
        <div className="overflow-x-auto rounded-2xl border border-[#e8e2d9]">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-[#f8f7f4] border-b border-[#e8e2d9]">
                <th className="text-left px-4 py-3 font-semibold text-[#7a6f65]">Feature</th>
                <th className="text-center px-4 py-3 font-semibold text-[#b5aca4]">Free</th>
                <th className="text-center px-4 py-3 font-bold text-[#5c7f63] bg-[#f0f7f0]">Founding</th>
                <th className="text-center px-4 py-3 font-semibold text-[#7a6f65]">Standard</th>
              </tr>
            </thead>
            <tbody>
              {[
                { feature: "Children",               free: "1",     founding: "Unlimited",  standard: "Unlimited" },
                { feature: "Lesson tracking",        free: "✓",     founding: "✓",          standard: "✓"         },
                { feature: "Garden & growth tree",   free: "Basic", founding: "Full",       standard: "Full"      },
                { feature: "Memories log",           free: "—",     founding: "✓",          standard: "✓"         },
                { feature: "Curated resources",      free: "—",     founding: "✓",          standard: "✓"         },
                { feature: "Streaks & insights",     free: "—",     founding: "✓",          standard: "✓"         },
                { feature: "Compliance reports",     free: "—",     founding: "✓",          standard: "✓"         },
                { feature: "Partner/co-parent view", free: "—",     founding: "✓",          standard: "✓"         },
                { feature: "Priority support",       free: "—",     founding: "✓",          standard: "—"         },
                { feature: "Founding price locked",  free: "—",     founding: "Forever 🎁", standard: "—"         },
              ].map((row, i) => (
                <tr
                  key={row.feature}
                  className={`border-b border-[#f0ede8] ${i % 2 === 0 ? "bg-white" : "bg-[#fefcf9]"}`}
                >
                  <td className="px-4 py-3 text-[#2d2926] font-medium">{row.feature}</td>
                  <td className="px-4 py-3 text-center text-[#b5aca4]">{row.free}</td>
                  <td className="px-4 py-3 text-center text-[#3d5c42] font-medium bg-[#f0f7f0]">{row.founding}</td>
                  <td className="px-4 py-3 text-center text-[#7a6f65]">{row.standard}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <p className="text-xs text-[#b5aca4] mt-6 text-center">
          Try it free. No credit card needed to get started.
        </p>
      </section>

      {/* ── 9. WAITLIST CTA ────────────────────────────────────────────────── */}
      <section className="px-6 sm:px-8 pb-24">
        <div
          className="max-w-2xl mx-auto rounded-3xl px-8 py-14 sm:px-14 text-center relative overflow-hidden"
          style={{
            background: "linear-gradient(135deg, #d0ebd4 0%, #e0f2e4 35%, #c8e8cf 70%, #b8dfc0 100%)",
            border: "1px solid #aed4b5",
          }}
        >
          {/* Decorative leaves */}
          <span
            className="absolute top-5 left-5 text-[5rem] opacity-[0.10] select-none pointer-events-none leading-none"
            aria-hidden="true"
          >
            🌿
          </span>
          <span
            className="absolute bottom-5 right-6 text-[4.5rem] opacity-[0.10] select-none pointer-events-none leading-none"
            style={{ transform: "scaleX(-1) rotate(20deg)" }}
            aria-hidden="true"
          >
            🌿
          </span>
          <span
            className="absolute top-1/2 right-5 -translate-y-1/2 text-4xl opacity-[0.07] select-none pointer-events-none leading-none"
            style={{ transform: "translateY(-50%) rotate(-15deg)" }}
            aria-hidden="true"
          >
            🍃
          </span>
          <span
            className="absolute top-1/2 left-5 -translate-y-1/2 text-3xl opacity-[0.07] select-none pointer-events-none leading-none"
            style={{ transform: "translateY(-50%) rotate(15deg)" }}
            aria-hidden="true"
          >
            🍃
          </span>

          <div className="relative z-10">
            <div className="text-5xl mb-5">🌱</div>
            <h2
              className="text-2xl sm:text-3xl font-bold text-[#2d2926] mb-3"
              style={{ fontFamily: "var(--font-display)" }}
            >
              Get Early Access — Free
            </h2>
            <p className="text-[#3d5c42] font-medium mb-8 leading-relaxed max-w-sm mx-auto">
              Join 200+ families on the waitlist. Lock in founding pricing before
              it&apos;s gone.
            </p>
            <WaitlistForm />
            <p className="text-xs text-[#5c7f63] mt-5 opacity-60">
              No spam. Unsubscribe anytime. We promise.
            </p>
          </div>
        </div>
      </section>

      {/* ── 10. FOOTER ─────────────────────────────────────────────────────── */}
      <footer className="bg-[#fefcf9] border-t border-[#e8e2d9]">
        <div className="max-w-5xl mx-auto px-6 sm:px-8 py-12">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-8 items-start">

            {/* Logo + tagline */}
            <div className="flex flex-col items-center sm:items-start gap-2">
              <div className="flex items-center gap-2">
                <div className="w-7 h-7 rounded-lg bg-[#5c7f63] flex items-center justify-center text-sm">
                  🌿
                </div>
                <span
                  className="font-bold text-[#2d2926] text-base"
                  style={{ fontFamily: "var(--font-display)" }}
                >
                  Rooted Homeschool
                </span>
              </div>
              <p className="text-xs text-[#b5aca4] leading-relaxed">
                A calm companion for intentional families.
              </p>
              <p className="text-[11px] text-[#c8bfb5]">rootedhomeschoolapp.com</p>
            </div>

            {/* Links */}
            <div className="flex items-center justify-center gap-5 flex-wrap">
              <Link href="/login"   className="text-sm text-[#7a6f65] hover:text-[#5c7f63] transition-colors">Log In</Link>
              <Link href="/signup"  className="text-sm text-[#7a6f65] hover:text-[#5c7f63] transition-colors">Sign Up</Link>
              <Link href="/privacy" className="text-sm text-[#7a6f65] hover:text-[#5c7f63] transition-colors">Privacy</Link>
              <Link href="/terms"   className="text-sm text-[#7a6f65] hover:text-[#5c7f63] transition-colors">Terms</Link>
            </div>

            {/* Copyright */}
            <div className="text-center sm:text-right space-y-1">
              <p className="text-xs text-[#b5aca4]">
                © {new Date().getFullYear()} Rooted Homeschool
              </p>
              <p className="text-xs text-[#c8bfb5]">Made with care for learning families</p>
            </div>
          </div>

          <div className="mt-10 pt-6 border-t border-[#f0ede8] text-center">
            <p className="text-[11px] text-[#c8bfb5]">
              Rooted Homeschool is in active beta. Features may evolve as we grow with our community.
            </p>
          </div>
        </div>
      </footer>
    </main>
  );
}
