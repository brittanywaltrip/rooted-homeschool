"use client";

import Link from "next/link";
import HashRedirect from "./components/HashRedirect";
import { useState, useEffect } from "react";
import { supabase } from "@/lib/supabase";

// ─── App mockup components ──────────────────────────────────────────────────

{/* MOCKUP: swap with real screenshot when available */}
function MemoriesMockup() {
  const tiles = [
    { bg: "linear-gradient(135deg, #c8e8d0, #a8d4b8)", text: "Rainbow butterfly 🎨", date: "Mar 21", color: "#1a3d1e" },
    { bg: "linear-gradient(135deg, #e8c8a0, #d4a878)", text: "Nature walk with Dad 🌲", date: "Mar 25", color: "#5a3818" },
    { bg: "linear-gradient(135deg, #fde8a0, #f5c842)", text: "Zoe\u2019s first chapter book! 🏆", date: "Mar 28", color: "#4a3200" },
    { bg: "linear-gradient(135deg, #d8c0f0, #c0a0e0)", text: "Butterfly lifecycle \u2014 backyard science! 🦋", date: "Mar 14", color: "#3d1f5c" },
    { bg: "linear-gradient(135deg, #b8d8c8, #98c8b0)", text: "Baking fractions 🧁", date: "Mar 16", color: "#1a3d1e" },
    { bg: "linear-gradient(135deg, #c8e8d0, #a8d4b8)", text: "Library trip 📚", date: "Mar 19", color: "#1a3d1e" },
  ];
  return (
    <div className="bg-[#f8f7f4] rounded-2xl overflow-hidden shadow-xl border border-[#e8e2d9] text-left select-none">
      <div className="bg-[#2d5a3d] px-4 py-2.5">
        <p className="text-[8px] text-white/60 uppercase tracking-widest">Your family story</p>
        <p className="text-xs font-semibold text-white">Memories 📸</p>
      </div>
      <div className="grid grid-cols-3 gap-[2px] p-[2px]">
        {tiles.map((t, i) => (
          <div key={i} className="relative aspect-square overflow-hidden" style={{ background: t.bg }}>
            {t.text && <p className="absolute inset-0 flex items-center justify-center text-center text-[8px] font-semibold px-1.5 leading-tight" style={{ color: t.color }}>{t.text}</p>}
            <span className="absolute bottom-1 left-1 text-[7px] text-white/70">{t.date}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

{/* MOCKUP: swap with real screenshot when available */}
function TodayMockup() {
  return (
    <div className="bg-[#f8f7f4] rounded-2xl overflow-hidden shadow-xl border border-[#e8e2d9] text-left select-none">
      <div className="bg-[#2d5a3d] px-4 py-3 text-center">
        <p className="text-[8px] text-white/60 uppercase tracking-widest">The Meadows Family</p>
        <p className="text-sm font-semibold text-white">Good morning! 🌿</p>
        <p className="text-[10px] text-white/70 mt-0.5">Wednesday, April 2</p>
        <p className="text-[9px] text-white/50 mt-1">12 memories · 31 days active</p>
      </div>
      <div className="p-3 space-y-2">
        <p className="text-[9px] font-semibold text-[#7a6f65] uppercase tracking-widest">Today&apos;s lessons</p>
        <div className="flex gap-1.5 mb-1">
          <span className="text-[10px] font-bold text-[#5c7f63] bg-[#e8f0e9] px-2 py-0.5 rounded-full">Lily</span>
          <span className="text-[10px] text-[#b5aca4] px-2 py-0.5">James</span>
        </div>
        {[
          { done: false, title: "Charlotte\u2019s Web ch. 8", subject: "Reading" },
          { done: true,  title: "Fractions \u2014 lesson 4", subject: "Math" },
        ].map((l) => (
          <div key={l.title} className={`flex items-center gap-2 px-3 py-2 rounded-lg border text-xs ${l.done ? "bg-[#f0f7f1] border-[#c2dbc5]" : "bg-white border-[#e8e2d9]"}`}>
            <div className={`w-3.5 h-3.5 rounded-full border-2 flex items-center justify-center shrink-0 ${l.done ? "bg-[#5c7f63] border-[#5c7f63]" : "border-[#c8bfb5]"}`}>
              {l.done && <span className="text-[6px] text-white font-bold">\u2713</span>}
            </div>
            <span className={`font-medium truncate ${l.done ? "line-through text-[#7a9e7e]" : "text-[#2d2926]"}`}>{l.title}</span>
            <span className="ml-auto text-[#b5aca4] shrink-0">{l.subject}</span>
          </div>
        ))}
        <p className="text-[9px] text-[#5c7f63] font-medium text-center mt-1">Today: 45 min logged</p>
      </div>
    </div>
  );
}

{/* MOCKUP: swap with real screenshot when available */}
function YearbookMockup() {
  return (
    <div className="bg-[#f8f7f4] rounded-2xl overflow-hidden shadow-xl border border-[#e8e2d9] text-left select-none">
      <div className="flex" style={{ minHeight: 200 }}>
        {/* Left page - cover */}
        <div className="flex-1 bg-[#fefcf9] flex flex-col border-r border-[#e8e2d9]">
          <div className="rounded-xl overflow-hidden m-2 mb-0" style={{ height: "60%" }}>
            <img src="https://gvkbegvvmhcrmxdorctk.supabase.co/storage/v1/object/public/family-photos/d18ca881-a776-4e82-b145-832adc88a88a/family.jpeg" alt="Family" className="w-full h-full object-cover" />
          </div>
          <div className="flex-1 flex flex-col items-center justify-center p-2 text-center">
            <p className="text-[9px] font-bold text-[#2d5a3d]">The Waltrip Family Academy</p>
            <p className="text-[8px] text-[#5c7f63] mt-0.5">2025–2026</p>
          </div>
        </div>
        {/* Right page - chapter */}
        <div className="flex-1 bg-white p-3">
          <p className="text-[9px] font-semibold text-[#5c7f63] mb-2">🌿 Lily&apos;s Year</p>
          <div className="space-y-1.5">
            <div className="h-10 rounded-lg" style={{ background: "linear-gradient(135deg, #c8e8d0, #a8d4b8)" }} />
            <div className="bg-[#fef9f0] border border-[#f0d090] rounded-lg p-1.5">
              <p className="text-[7px] font-bold text-[#8b6f47]">🏆 WIN</p>
              <p className="text-[7px] text-[#2d2926]">First chapter book!</p>
            </div>
            <div className="bg-[#f0f4ff] border border-[#c8d0f0] rounded-lg p-1.5 flex items-center gap-1.5">
              <span className="text-sm">📖</span>
              <p className="text-[7px] text-[#2d2926]">Charlotte&apos;s Web</p>
            </div>
          </div>
        </div>
      </div>
      <div className="px-3 py-2 bg-[#fefcf9] border-t border-[#e8e2d9]">
        <div className="flex items-center gap-2">
          <div className="flex-1 h-1 bg-[#e8e2d9] rounded-full overflow-hidden">
            <div className="h-full w-2/3 bg-[#5c7f63] rounded-full" />
          </div>
          <p className="text-[8px] text-[#b5aca4] shrink-0">14 memories bookmarked</p>
        </div>
      </div>
    </div>
  );
}

{/* MOCKUP: swap with real screenshot when available */}
function PrintablesMockup() {
  return (
    <div className="bg-[#f8f7f4] rounded-2xl overflow-hidden shadow-xl border border-[#e8e2d9] text-left select-none p-4 flex items-center justify-center">
      {/* Garden-style certificate */}
      <div className="w-full max-w-[240px] aspect-[8.5/11] rounded-lg overflow-hidden" style={{ background: "#F7F3E9", border: "2px solid #2D5016", position: "relative" }}>
        <div style={{ position: "absolute", inset: 6, border: "0.5px solid #C4962A" }} />
        <div className="flex flex-col items-center justify-center h-full px-4 text-center" style={{ position: "relative", zIndex: 1 }}>
          <p className="text-[7px] text-[#C4962A] uppercase tracking-widest mb-1">The Meadows Family Academy</p>
          {/* divider */}
          <div className="flex items-center gap-1 mb-2 w-20">
            <div className="flex-1 h-px bg-[#C4962A]" />
            <div className="w-1 h-1 rounded-full bg-[#C4962A]" />
            <div className="flex-1 h-px bg-[#C4962A]" />
          </div>
          <p className="text-[8px] font-bold text-[#2D5016] uppercase tracking-wider mb-3">Reading Achievement</p>
          <p className="text-[7px] text-[#7a6f65] italic mb-1">This certifies that</p>
          <p className="text-lg font-bold italic text-[#1a1008] mb-1" style={{ fontFamily: "Georgia, serif" }}>Lily</p>
          <div className="w-16 h-px bg-[#C4962A] mb-2" />
          <p className="text-[7px] text-[#3a3028] leading-relaxed mb-2">has completed her first book: Charlotte&apos;s Web</p>
          <p className="text-[6px] text-[#8a7558]">✦ 2025–2026 ✦</p>
          <p className="text-[5px] text-[#c8b898] mt-2">Made with Rooted</p>
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
        @keyframes pulse {
          0%, 100% { opacity: 0.2; transform: scale(1); }
          50% { opacity: 0.6; transform: scale(1.3); }
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
      <section className="relative flex flex-col items-center justify-center text-center px-6 py-28 min-h-[92vh] overflow-hidden" style={{ background: "linear-gradient(175deg, #0d2818 0%, #1a4a28 20%, #3d7a4a 45%, #4a8a55 65%, #2d5c35 85%, #1a3a22 100%)" }}>

        {/* Animated forest background elements */}
        <div className="absolute inset-0 overflow-hidden pointer-events-none" aria-hidden="true">
          {/* Stars/fireflies */}
          {[
            { top: "15%", left: "8%", size: 2.5, delay: "0s" },
            { top: "25%", left: "18%", size: 1.5, delay: "0.5s" },
            { top: "10%", left: "35%", size: 2, delay: "1s" },
            { top: "20%", left: "55%", size: 1.5, delay: "0.3s" },
            { top: "12%", left: "72%", size: 2.5, delay: "0.8s" },
            { top: "30%", left: "88%", size: 1.5, delay: "0.2s" },
            { top: "8%", left: "92%", size: 2, delay: "1.2s" },
          ].map((s, i) => (
            <div key={i} className="absolute rounded-full bg-white" style={{ top: s.top, left: s.left, width: s.size, height: s.size, opacity: 0.25, animation: `pulse ${2 + i * 0.3}s ease-in-out infinite`, animationDelay: s.delay }} />
          ))}

          {/* Left large pine tree */}
          <svg className="absolute bottom-0 left-[-2%] h-[90%] w-auto opacity-40" viewBox="0 0 160 500" fill="none">
            <rect x="72" y="400" width="16" height="100" fill="#3d2010"/>
            <polygon points="80,20 20,180 140,180" fill="#1a4a20"/>
            <polygon points="80,80 15,240 145,240" fill="#1e5a25"/>
            <polygon points="80,150 10,300 150,300" fill="#245e2a"/>
            <polygon points="80,220 5,360 155,360" fill="#2a6830"/>
            <polygon points="80,300 0,420 160,420" fill="#306838"/>
          </svg>

          {/* Right large pine tree */}
          <svg className="absolute bottom-0 right-[-2%] h-[80%] w-auto opacity-35" viewBox="0 0 140 500" fill="none">
            <rect x="62" y="400" width="16" height="100" fill="#3d2010"/>
            <polygon points="70,30 18,170 122,170" fill="#0d2818"/>
            <polygon points="70,90 12,230 128,230" fill="#162a1e"/>
            <polygon points="70,160 8,285 132,285" fill="#1e3828"/>
            <polygon points="70,230 4,340 136,340" fill="#243e2e"/>
            <polygon points="70,305 0,400 140,400" fill="#2a4835"/>
          </svg>

          {/* Left mid pine */}
          <svg className="absolute bottom-0 left-[12%] h-[60%] w-auto opacity-30" viewBox="0 0 100 400" fill="none">
            <rect x="45" y="320" width="10" height="80" fill="#3d2010"/>
            <polygon points="50,30 10,150 90,150" fill="#1a4a20"/>
            <polygon points="50,90 5,200 95,200" fill="#1e5225"/>
            <polygon points="50,155 0,265 100,265" fill="#245228"/>
            <polygon points="50,225 0,330 100,330" fill="#2a5c2e"/>
          </svg>

          {/* Right mid pine */}
          <svg className="absolute bottom-0 right-[14%] h-[55%] w-auto opacity-25" viewBox="0 0 100 400" fill="none">
            <rect x="45" y="320" width="10" height="80" fill="#3d2010"/>
            <polygon points="50,40 12,155 88,155" fill="#122038"/>
            <polygon points="50,100 8,210 92,210" fill="#162840"/>
            <polygon points="50,165 4,270 96,270" fill="#1a3048"/>
            <polygon points="50,235 0,335 100,335" fill="#1e3850"/>
          </svg>

          {/* Moonlight glow */}
          <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[600px] h-[400px] opacity-25 rounded-full" style={{ background: "radial-gradient(ellipse at center, rgba(180,220,160,0.5) 0%, transparent 70%)" }}/>

          {/* Ground fog/mist */}
          <div className="absolute bottom-0 left-0 right-0 h-32" style={{ background: "linear-gradient(to top, rgba(45,100,50,0.4) 0%, transparent 100%)" }}/>

          {/* Forest floor */}
          <div className="absolute bottom-0 left-0 right-0 h-16" style={{ background: "linear-gradient(to top, #0d2010 0%, transparent 100%)" }}/>
        </div>

        {/* Vignette */}
        <div className="absolute inset-0 pointer-events-none" style={{ background: "radial-gradient(ellipse at center, transparent 35%, rgba(0,0,0,0.35) 100%)" }} aria-hidden="true"/>

        {/* Content */}
        <div className="relative z-10 flex flex-col items-center max-w-3xl">
          <h1 className="anim-fade-in-up delay-150 leading-[1.08] mb-6 text-white" style={{ fontFamily: "var(--font-display)", textShadow: "0 2px 32px rgba(0,0,0,0.4)", letterSpacing: "-0.02em" }}>
            <span className="block text-3xl sm:text-4xl lg:text-5xl font-bold text-white/80">The homeschool years go fast.</span>
            <span className="block text-4xl sm:text-5xl lg:text-[5rem] font-bold mt-2" style={{ color: "#86c98a" }}>Rooted helps you hold on to it all.</span>
          </h1>

          <p className="anim-fade-in-up delay-300 text-lg sm:text-xl text-white/78 mb-10 leading-relaxed max-w-[34rem]" style={{ textShadow: "0 1px 12px rgba(0,0,0,0.3)", letterSpacing: "0.01em" }}>
            Capture every moment. Plan your days with ease. Build a family yearbook you&apos;ll treasure forever.
          </p>

          <div className="anim-fade-in-up delay-450 flex flex-col sm:flex-row gap-3 mb-8 w-full sm:w-auto">
            <Link href="/signup" className="inline-flex items-center justify-center gap-2 bg-white text-[#3d5c42] hover:bg-[#f0f9f1] font-bold px-8 py-4 rounded-xl transition-all text-base" style={{ boxShadow: "0 0 0 1px rgba(255,255,255,0.15), 0 8px 32px rgba(0,0,0,0.35), 0 0 48px rgba(134,201,138,0.12)" }}>
              Get Started Free →
            </Link>
            <Link href="/tour" className="inline-flex items-center justify-center gap-2 text-white hover:bg-white/12 font-semibold px-8 py-4 rounded-xl transition-all text-base" style={{ border: "1px solid rgba(255,255,255,0.35)", backdropFilter: "blur(12px)", background: "rgba(255,255,255,0.06)" }}>
              See Inside →
            </Link>
          </div>

          <p className="anim-fade-in delay-600 text-white/65 text-sm flex items-center gap-2">
            <span>🌿</span> Trusted by 300+ homeschool families
          </p>
        </div>

        {/* Scroll indicator */}
        <div className="scroll-bounce absolute bottom-8 left-1/2 text-white/40" aria-hidden="true">
          <svg width="22" height="22" viewBox="0 0 22 22" fill="none">
            <path d="M11 4v14M4 12l7 7 7-7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </div>
      </section>

      {/* ── 3. SOCIAL PROOF STRIP ──────────────────────────────────────────── */}
      <section className="bg-[#fefcf9] border-b border-[#e8e2d9]">
        <div className="max-w-5xl mx-auto">
          <div className="grid grid-cols-2 sm:grid-cols-4 divide-x divide-y sm:divide-y-0 divide-[#e8e2d9]">
            {[
              { number: "300+",    label: "Families Growing with Rooted", icon: "🌱" },
              { number: "6",       label: "Features, Everything in One Place", icon: "🎨" },
              { number: "Free",    label: "To Start, No Card",   icon: "🎁" },
              { number: "No Canva", label: "Beautiful Printables",  icon: "🖨️" },
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

      {/* ── 3b. CURRICULUM CLARIFIER ─────────────────────────────────────────── */}
      <section className="bg-[#fefcf9] border-b border-[#e8e2d9] py-6 px-6">
        <div className="max-w-3xl mx-auto text-center">
          <p className="text-sm sm:text-base text-[#7a6f65] leading-relaxed">
            <span className="font-semibold text-[#2d2926]">Rooted isn&apos;t a curriculum</span>
            {" "}— it&apos;s the joyful companion that works{" "}
            <em className="not-italic font-semibold text-[#5c7f63]">alongside</em>
            {" "}the one you already love. 🌿
          </p>
          <div className="flex flex-wrap items-center justify-center gap-2 mt-4">
            {[
              "Charlotte Mason",
              "The Good and the Beautiful",
              "Classical",
              "Sonlight",
              "Unit Studies",
              "Unschooling",
              "Any approach ✨",
            ].map((c) => (
              <span
                key={c}
                className="text-xs bg-[#e8f0e9] text-[#5c7f63] px-3 py-1.5 rounded-full border border-[#c2dbc5] font-medium"
              >
                {c}
              </span>
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

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-8 sm:gap-6">
          {[
            {
              mockup: <MemoriesMockup />,
              title: "Capture Every Moment",
              desc: "Photos, wins, books, field trips \u2014 all in one beautiful timeline your family will treasure forever.",
            },
            {
              mockup: <TodayMockup />,
              title: "Plan Your Days with Ease",
              desc: "See today\u2019s lessons, check them off as you go, and watch your family\u2019s learning tree grow leaf by leaf.",
            },
            {
              mockup: <YearbookMockup />,
              title: "A Book Worth Printing",
              desc: "Every memory, every win, every book \u2014 automatically organized into a beautiful family yearbook. Ready when you are.",
            },
            {
              mockup: <PrintablesMockup />,
              title: "No Canva Needed",
              desc: "Beautiful certificates, ID cards, and awards \u2014 made automatically from your family\u2019s real data. Print in one click.",
            },
          ].map(({ mockup, title, desc }) => (
            <div key={title} className="mockup-card flex flex-col gap-5 cursor-default bg-white rounded-xl shadow-sm hover:shadow-md transition-shadow">
              <div className="mockup-inner rounded-t-xl overflow-hidden">{mockup}</div>
              <div className="text-center px-4 pb-5">
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
              Everything you need to homeschool with confidence
            </h2>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
            {[
              {
                emoji: "📸",
                title: "Capture Memories",
                color: "#fef3e0",
                border: "#f0d090",
                desc: "Photos, little quotes, field trips, books they loved \u2014 saved as it happens. Build a memory book your family will treasure forever.",
              },
              {
                emoji: "🗓️",
                title: "Plan Your Days",
                color: "#e8f0e9",
                border: "#b8d9bc",
                desc: "Schedule lessons, see what\u2019s up today, and keep the whole family on track.",
              },
              {
                emoji: "🌱",
                title: "Watch Them Grow",
                color: "#f0f7e0",
                border: "#c8d8a0",
                desc: "Every lesson earns a leaf. Watch each child\u2019s tree bloom through the garden stages.",
              },
              {
                emoji: "📋",
                title: "Progress Reports",
                color: "#f5ede0",
                border: "#d4b896",
                desc: "See exactly how much your kids have learned \u2014 then print it, share it with family, or save it forever.",
              },
              {
                emoji: "📖",
                title: "Your Family Yearbook",
                color: "#f5f0fa",
                border: "#d9bee8",
                desc: "Wins, quotes, and books fill it automatically all year. Add photos you love. At year-end: a beautiful book with your letter, each child\u2019s chapter, and messages from family.",
              },
              {
                emoji: "📚",
                title: "Curated Resources",
                color: "#e8f4f8",
                border: "#a8d0e0",
                desc: "Discounts, field trips, printables, science projects, and state homeschool information \u2014 curated for you.",
              },
              {
                emoji: "🖨️",
                title: "Printables",
                color: "#fef9f0",
                border: "#e8d4b0",
                desc: "Certificates, ID cards, and awards built from your family\u2019s real data. No design skills needed. Just click and print.",
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

      {/* ── 6. MEMORIES ───────────────────────────────────────────────────────── */}
      <section
        className="px-6 sm:px-8 py-24"
        style={{ background: "linear-gradient(160deg, #fef9f0 0%, #fefcf9 40%, #f0f7f1 100%)" }}
      >
        <div className="max-w-5xl mx-auto">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 items-center">
            <div>
              <p className="text-xs font-semibold uppercase tracking-widest text-[#b5aca4] mb-3">
                The part moms love most
              </p>
              <h2
                className="text-3xl sm:text-4xl font-bold text-[#2d2926] mb-5 leading-snug"
                style={{ fontFamily: "var(--font-display)" }}
              >
                These years go by so fast.{" "}
                <em className="not-italic" style={{ color: "#5c7f63" }}>Hold on to every bit of it.</em>
              </h2>
              <p className="text-[#7a6f65] leading-relaxed mb-6 text-base">
                Between the lessons, the field trips, the little things they said that made you laugh — so much gets forgotten. Rooted gives you a beautiful, simple place to save it all.
              </p>
              <ul className="space-y-4 mb-8">
                {[
                  { emoji: "📸", title: "Photos from your day", desc: "Snap and save moments as they happen — field trips, projects, backyard science." },
                  { emoji: "✍️", title: "Little notes & quotes", desc: "Write down what they said, what clicked, what made them proud. You'll want these later." },
                  { emoji: "📖", title: "Books they loved", desc: "Build a reading log automatically as you go. A record of their whole reading life." },
                  { emoji: "🌿", title: "Look back and see it", desc: "Your whole homeschool journey, month by month. Proof you're doing something beautiful." },
                ].map((item) => (
                  <li key={item.title} className="flex gap-4 items-start">
                    <div className="w-9 h-9 rounded-xl bg-[#e8f0e9] flex items-center justify-center text-lg shrink-0 mt-0.5">
                      {item.emoji}
                    </div>
                    <div>
                      <p className="font-semibold text-[#2d2926] text-sm mb-0.5">{item.title}</p>
                      <p className="text-xs text-[#7a6f65] leading-relaxed">{item.desc}</p>
                    </div>
                  </li>
                ))}
              </ul>
              <Link href="/signup" className="inline-flex items-center gap-2 bg-[#5c7f63] hover:bg-[#3d5c42] text-white font-semibold px-7 py-3.5 rounded-xl transition-colors text-sm shadow-sm">
                Start capturing memories →
              </Link>
            </div>

            <div className="flex justify-center lg:justify-end">
              <div
                className="bg-white rounded-3xl shadow-2xl border border-[#e8e2d9] overflow-hidden w-full max-w-sm select-none"
                style={{ boxShadow: "0 24px 60px rgba(92, 127, 99, 0.12), 0 4px 16px rgba(0,0,0,0.06)" }}
              >
                <div className="bg-[#fefcf9] border-b border-[#e8e2d9] px-4 py-3 flex items-center gap-2">
                  <div className="w-2 h-2 rounded-full bg-[#d4956a]" />
                  <span className="text-xs font-semibold text-[#2d2926]">Memories</span>
                  <span className="ml-auto text-[10px] text-[#b5aca4]">March 2026</span>
                </div>
                <div className="p-4 space-y-3">
                  <div className="rounded-2xl overflow-hidden border border-[#e8e2d9]">
                    <div className="h-28 flex items-center justify-center text-4xl" style={{ background: "linear-gradient(135deg, #c8e8d0 0%, #a8d4b8 100%)" }}>
                      🦋
                    </div>
                    <div className="bg-white px-3 py-2.5">
                      <p className="text-xs font-semibold text-[#2d2926]">Butterfly lifecycle — backyard science!</p>
                      <p className="text-[10px] text-[#b5aca4] mt-0.5">March 14 · Science</p>
                    </div>
                  </div>
                  <div className="bg-[#fef9f0] border border-[#f0d090] rounded-2xl p-3">
                    <p className="text-[10px] font-bold text-[#8b6f47] uppercase tracking-widest mb-1.5">✍️ She said...</p>
                    <p className="text-xs text-[#2d2926] italic leading-relaxed">&ldquo;Mom, I think I actually love fractions now.&rdquo;</p>
                    <p className="text-[10px] text-[#b5aca4] mt-2">Emma · March 17</p>
                  </div>
                  <div className="bg-[#f0f4ff] border border-[#c8d0f0] rounded-2xl px-3 py-2.5 flex items-center gap-3">
                    <div className="text-2xl">📖</div>
                    <div>
                      <p className="text-xs font-semibold text-[#2d2926]">Finished Charlotte&apos;s Web</p>
                      <p className="text-[10px] text-[#b5aca4]">Zoe · March 15 · Book #8 this year</p>
                    </div>
                  </div>
                </div>
                <div className="px-4 pb-4">
                  <div className="bg-[#e8f0e9] rounded-xl px-3 py-2 text-center">
                    <p className="text-[10px] text-[#5c7f63] font-semibold">🌿 24 memories this month</p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── 6b. PRINTABLES & REPORTS ──────────────────────────────────────────── */}
      <section className="bg-[#fefcf9] border-y border-[#e8e2d9] px-6 sm:px-8 py-20">
        <div className="max-w-5xl mx-auto">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 items-center">

            <div className="flex justify-center lg:justify-start order-2 lg:order-1">
              <div
                className="bg-white rounded-3xl shadow-xl border border-[#e8e2d9] overflow-hidden w-full max-w-sm select-none"
                style={{ boxShadow: "0 16px 48px rgba(139, 111, 71, 0.10), 0 2px 8px rgba(0,0,0,0.05)" }}
              >
                <div className="bg-[#fefcf9] border-b border-[#e8e2d9] px-4 py-3 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div className="w-2 h-2 rounded-full bg-[#8b6f47]" />
                    <span className="text-xs font-semibold text-[#2d2926]">Progress Report</span>
                  </div>
                  <div className="flex items-center gap-1.5 bg-[#5c7f63] text-white text-[10px] font-bold px-2.5 py-1 rounded-lg">
                    🖨️ Print
                  </div>
                </div>
                <div className="p-5 space-y-4">
                  <div>
                    <p className="text-[10px] text-[#b5aca4] uppercase tracking-widest">Zoe Parker · 2025–2026</p>
                    <p className="text-sm font-bold text-[#2d2926] mt-0.5">Annual Progress Report</p>
                  </div>
                  <div className="grid grid-cols-4 gap-2">
                    {[
                      { label: "Lessons", value: "53" },
                      { label: "Hours", value: "26h" },
                      { label: "Books", value: "8" },
                      { label: "Subjects", value: "4" },
                    ].map(({ label, value }) => (
                      <div key={label} className="text-center bg-[#f8f5f0] rounded-xl py-2.5">
                        <p className="text-sm font-bold text-[#2d2926]">{value}</p>
                        <p className="text-[8px] text-[#7a6f65]">{label}</p>
                      </div>
                    ))}
                  </div>
                  <div className="space-y-2">
                    {[
                      { subject: "Math", pct: 90, color: "#5c7f63" },
                      { subject: "Reading", pct: 78, color: "#4a7a8a" },
                      { subject: "Science", pct: 60, color: "#8b6f47" },
                      { subject: "History", pct: 45, color: "#7a6f8a" },
                    ].map((s) => (
                      <div key={s.subject} className="flex items-center gap-3">
                        <span className="text-[9px] w-14 text-[#7a6f65] shrink-0">{s.subject}</span>
                        <div className="flex-1 h-1.5 bg-[#f0ede8] rounded-full overflow-hidden">
                          <div className="h-full rounded-full" style={{ width: `${s.pct}%`, backgroundColor: s.color }} />
                        </div>
                        <span className="text-[9px] text-[#b5aca4] w-6 text-right">{s.pct}%</span>
                      </div>
                    ))}
                  </div>
                  <div className="bg-[#e8f0e9] rounded-xl px-3 py-2 text-center">
                    <p className="text-[10px] text-[#5c7f63] font-semibold">✓ Print, share, or save forever</p>
                  </div>
                </div>
              </div>
            </div>

            <div className="order-1 lg:order-2">
              <p className="text-xs font-semibold uppercase tracking-widest text-[#b5aca4] mb-3">
                Your family&apos;s story, beautifully documented
              </p>
              <h2
                className="text-3xl sm:text-4xl font-bold text-[#2d2926] mb-5 leading-snug"
                style={{ fontFamily: "var(--font-display)" }}
              >
                See how far they&apos;ve come.
              </h2>
              <p className="text-[#7a6f65] leading-relaxed mb-6 text-base">
                At the end of a homeschool year it&apos;s easy to wonder — did we do enough? Rooted answers that question beautifully. Every lesson, every book, every subject — all in one place you can print, share, or save forever.
              </p>
              <ul className="space-y-4 mb-8">
                {[
                  { emoji: "📸", title: "A yearbook, not just a document", desc: "Every lesson, win, book, and photo becomes a page in your family yearbook — a living record of their whole learning life." },
                  { emoji: "👵", title: "Share with your whole family", desc: "Send a private link to grandparents, aunts, uncles — anyone you choose. They can view memories and leave messages for the kids. No app download needed." },
                  { emoji: "📋", title: "Print or save as PDF", desc: "Clean, professional layout. One click to generate, one click to print or download." },
                ].map((item) => (
                  <li key={item.title} className="flex gap-4 items-start">
                    <div className="w-9 h-9 rounded-xl bg-[#f5ede0] flex items-center justify-center text-lg shrink-0 mt-0.5">
                      {item.emoji}
                    </div>
                    <div>
                      <p className="font-semibold text-[#2d2926] text-sm mb-0.5">{item.title}</p>
                      <p className="text-xs text-[#7a6f65] leading-relaxed">{item.desc}</p>
                    </div>
                  </li>
                ))}
              </ul>
              <Link href="/signup" className="inline-flex items-center gap-2 border-2 border-[#5c7f63] text-[#5c7f63] hover:bg-[#e8f0e9] font-semibold px-7 py-3.5 rounded-xl transition-colors text-sm">
                Try it free →
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* ── 7. FOUNDER QUOTE ───────────────────────────────────────────────── */}
      <section className="bg-[#fefcf9] border-y border-[#e8e2d9]">
        <div className="max-w-2xl mx-auto px-6 sm:px-8 py-20 text-center">
          <div
            className="w-12 h-12 rounded-2xl bg-[#5c7f63] flex items-center justify-center text-2xl mx-auto mb-8 shadow-sm"
            aria-hidden="true"
          >
            🌿
          </div>
          <div
            className="text-[3.5rem] leading-none select-none text-[#d4ead6] mb-2"
            style={{ fontFamily: "var(--font-display)", lineHeight: 0.85 }}
            aria-hidden="true"
          >
            &ldquo;
          </div>
          <p
            className="text-xl sm:text-2xl text-[#2d2926] leading-relaxed italic mb-8"
            style={{ fontFamily: "var(--font-display)" }}
          >
            I built Rooted for families like mine. I hope it makes you feel less alone in this beautiful, hard, joyful thing you&apos;re doing every day.
          </p>
          <p className="text-sm font-semibold text-[#5c7f63]">
            — Brittany W., homeschool mom of 2
          </p>
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
            Start free — no credit card needed. Upgrade when you&apos;re ready — lock in
            the founding price before it&apos;s gone.
          </p>
        </div>

        {/* Plan cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5 mb-12 mt-8 items-start">

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
                "Unlimited children",
                "Daily lesson tracking",
                "Garden & growth tree",
                "50 photos",
                "Memories — last 30 days",
                "1 AI Year in Review / year",
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
              🌱 Best Value — Founding Price
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
              <span className="text-sm text-[#7a6f65] mb-1">/year</span>
            </div>
            <p className="text-xs text-[#8b6f47] font-semibold mb-6">
              Lock in forever · ~$3.33/month
            </p>
            <ul className="text-sm text-left space-y-2.5 mb-7 flex-1">
              {[
                "Unlimited children",
                "Unlimited photos",
                "Full memory history — all time",
                "Unlimited AI Year in Review",
                "Printable progress reports",
                "Finish Line curriculum pacing",
                "AI Family Update",
                "Family Yearbook — full year, shareable book",
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
            <p className="text-[11px] text-[#8b6f47] font-semibold mt-3">
              🌱 Founding Family pricing ends April 30 — {(() => {
                const diff = Math.max(0, Math.ceil((new Date("2026-04-30").getTime() - Date.now()) / 86400000));
                return `${diff} day${diff !== 1 ? "s" : ""} left`;
              })()}
            </p>
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
              <span className="text-sm text-[#b5aca4] mb-1">/year</span>
            </div>
            <p className="text-xs text-[#b5aca4] mb-6">After founding period ends</p>
            <ul className="text-sm text-left space-y-2.5 mb-7 flex-1">
              {[
                "Unlimited children",
                "Unlimited photos",
                "Full memory history — all time",
                "Unlimited AI Year in Review",
                "Printable progress reports",
                "Finish Line curriculum pacing",
                "AI Family Update",
                "Family Yearbook — full year, shareable book",
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

          {/* Monthly */}
          <div className="bg-[#fefcf9] border border-[#e8e2d9] rounded-2xl p-6 text-center flex flex-col">
            <p className="text-xs font-bold uppercase tracking-widest text-[#b5aca4] mb-3">Monthly</p>
            <div className="flex items-end justify-center gap-1 mb-1">
              <span
                className="text-4xl font-bold text-[#2d2926]"
                style={{ fontFamily: "var(--font-display)" }}
              >
                $6.99
              </span>
              <span className="text-sm text-[#b5aca4] mb-1">/mo</span>
            </div>
            <p className="text-xs text-[#b5aca4] mb-6">Pay as you go · ≈ $83.88/year</p>
            <ul className="text-sm text-left space-y-2.5 mb-7 flex-1">
              {[
                "Unlimited children",
                "Unlimited photos",
                "Full memory history — all time",
                "Unlimited AI Year in Review",
                "Printable progress reports",
                "Finish Line curriculum pacing",
                "AI Family Update",
                "Family Yearbook — full year, shareable book",
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
              Start Monthly →
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
                { feature: "Children",               free: "Unlimited", founding: "Unlimited",  standard: "Unlimited" },
                { feature: "Lesson tracking",        free: "✓",     founding: "✓",          standard: "✓"         },
                { feature: "Garden & growth tree",   free: "✓",     founding: "✓",          standard: "✓"         },
                { feature: "Photo memories & book log", free: "50 photos · 30 days", founding: "✓ Unlimited", standard: "✓ Unlimited" },
                { feature: "Full memory history",    free: "—",     founding: "✓",          standard: "✓"         },
                { feature: "AI Year in Review",      free: "1 / year", founding: "✓ Unlimited", standard: "✓ Unlimited" },
                { feature: "Memories log",           free: "30 days", founding: "✓ All time",  standard: "✓ All time" },
                { feature: "Progress reports",     free: "—",     founding: "✓",          standard: "✓"         },
                { feature: "Finish Line pacing",     free: "—",     founding: "✓",          standard: "✓"         },
                { feature: "AI Family Update",       free: "—",     founding: "✓",          standard: "✓"         },
                { feature: "Family Yearbook",        free: "30 days", founding: "✓ Full year", standard: "✓ Full year" },
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

      {/* ── 8b. FOUNDER STORY ──────────────────────────────────────────── */}
      <section className="px-6 sm:px-8 py-16 max-w-3xl mx-auto">
        <div className="bg-[#fefcf9] border border-[#e8e2d9] rounded-3xl p-8 sm:p-12 flex flex-col sm:flex-row gap-8 items-center">
          <div className="shrink-0">
            <img
              src="https://gvkbegvvmhcrmxdorctk.supabase.co/storage/v1/object/public/family-photos/f30ede7e-ad40-42a9-a134-8fd70932ba0f/family.jpg"
              alt="Brittany and her family"
              className="w-28 h-28 rounded-full object-cover shadow-lg border-4 border-white"
              style={{ boxShadow: "0 4px 24px rgba(92, 127, 99, 0.25)" }}
            />
          </div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-widest text-[#b5aca4] mb-3">From the founder</p>
            <h2 className="text-xl font-bold text-[#2d2926] mb-3" style={{ fontFamily: "var(--font-display)" }}>
              Built by a homeschool mom, for homeschool families.
            </h2>
            <p className="text-[#7a6f65] leading-relaxed text-sm mb-4">
              Hi, I&apos;m Brittany — homeschool mom and creator of the Rooted App. I built Rooted because I always felt unorganized and was constantly wondering if we were falling behind. Rooted helps you plan your days, track learning, capture memories, and see your child&apos;s growth — and honestly, it does so much more than that. I didn&apos;t want something complicated. I just wanted to feel organized and on track. So I made it. From our family to yours — we hope you join our Rooted family.
            </p>
            <p className="text-sm font-semibold text-[#5c7f63]">— Brittany, founder &amp; homeschool mom 🌱</p>
          </div>
        </div>
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
              Start your homeschool journey today
            </h2>
            <p className="text-[#3d5c42] font-medium mb-8 leading-relaxed max-w-sm mx-auto">
              Free to start. No credit card needed. Join families already using Rooted.
            </p>
            <Link
              href="/signup"
              className="inline-block bg-[#5c7f63] hover:bg-[#4a6b50] text-white font-semibold px-8 py-3 rounded-full transition-colors"
            >
              Get Started Free →
            </Link>
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
                  Rooted
                </span>
              </div>
              <p className="text-xs text-[#b5aca4] leading-relaxed">
                Built for the way homeschool actually happens.
              </p>
              <p className="text-[11px] text-[#c8bfb5]">rootedhomeschoolapp.com</p>
            </div>

            {/* Links */}
            <div className="flex items-center justify-center gap-5 flex-wrap">
              <Link href="/login"   className="text-sm text-[#7a6f65] hover:text-[#5c7f63] transition-colors">Log In</Link>
              <Link href="/signup"  className="text-sm text-[#7a6f65] hover:text-[#5c7f63] transition-colors">Sign Up</Link>
              <Link href="/privacy" className="text-sm text-[#7a6f65] hover:text-[#5c7f63] transition-colors">Privacy</Link>
              <Link href="/terms"   className="text-sm text-[#7a6f65] hover:text-[#5c7f63] transition-colors">Terms</Link>
              <Link href="/faq"     className="text-sm text-[#7a6f65] hover:text-[#5c7f63] transition-colors">FAQ</Link>
              <Link href="/contact" className="text-sm text-[#7a6f65] hover:text-[#5c7f63] transition-colors">Contact</Link>
              <Link href="/partners" className="text-sm text-[#7a6f65] hover:text-[#5c7f63] transition-colors">Partners</Link>
            </div>
            <div className="flex items-center justify-center gap-4 mt-2">
              <a href="https://instagram.com/rootedhomeschool" target="_blank" rel="noopener noreferrer"
                className="text-xs text-[#7a6f65] hover:text-[#5c7f63] transition-colors flex items-center gap-1">
                📸 Instagram
              </a>
              <a href="https://facebook.com/rootedhomeschool" target="_blank" rel="noopener noreferrer"
                className="text-xs text-[#7a6f65] hover:text-[#5c7f63] transition-colors flex items-center gap-1">
                👥 Facebook
              </a>
              <a href="https://pinterest.com/hellorootedapp" target="_blank" rel="noopener noreferrer"
                className="text-xs text-[#7a6f65] hover:text-[#5c7f63] transition-colors flex items-center gap-1">
                📌 Pinterest
              </a>
            </div>

            {/* Copyright */}
            <div className="text-center sm:text-right space-y-1">
              <p className="text-xs text-[#b5aca4]">
                © {new Date().getFullYear()} Rooted
              </p>
              <p className="text-xs text-[#c8bfb5]">Made with care for learning families</p>
            </div>
          </div>

        </div>
      </footer>
    </main>
  );
}
