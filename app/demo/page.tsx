"use client";

import { useState } from "react";
import Link from "next/link";
import GardenScene from "@/components/GardenScene";

// ─── Sample data ──────────────────────────────────────────────────────────────

const FAMILY = "Parker Family";
const CHILDREN = [
  { name: "Emma", color: "#4caf50", leaves: 200 },
  { name: "Joey", color: "#2196f3", leaves: 47 },
];

function todayFormatted() {
  return new Date().toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
  });
}

// ─── Demo banner ──────────────────────────────────────────────────────────────

function DemoBanner() {
  return (
    <div
      className="sticky top-0 z-50 flex items-center justify-between px-4 py-2.5"
      style={{ background: "#fff8e1" }}
    >
      <p className="text-sm font-medium" style={{ color: "#f57f17" }}>
        ✨ Preview — sample family shown
      </p>
      <Link
        href="/signup"
        className="text-sm font-semibold px-3 py-1 rounded-lg transition-colors"
        style={{ color: "#f57f17", background: "rgba(245,127,23,0.12)" }}
      >
        Start mine →
      </Link>
    </div>
  );
}

// ─── Bottom CTA ───────────────────────────────────────────────────────────────

function BottomCTA() {
  return (
    <div className="mx-4 mb-4 rounded-2xl p-6 text-center" style={{ background: "#2d5a3d" }}>
      <p className="text-xl font-bold text-white mb-2" style={{ fontFamily: "var(--font-display)" }}>
        This could be your family&apos;s story 🌱
      </p>
      <p className="text-sm text-white/60 mb-5">
        Free to start · Takes 3 minutes · No credit card
      </p>
      <Link
        href="/signup"
        className="inline-flex items-center justify-center px-8 py-3.5 rounded-xl bg-white text-[#2d5a3d] font-semibold text-base hover:bg-[#f0f9f1] transition-all shadow-lg"
      >
        Start my family&apos;s story →
      </Link>
    </div>
  );
}

// ─── Tab: Today ───────────────────────────────────────────────────────────────

function TabToday() {
  const lessons = [
    { done: true, title: "Charlotte's Web — Ch. 5", child: "Emma", childColor: "#4caf50", subject: "Reading" },
    { done: true, title: "Saxon Math — Lesson 12", child: "Emma", childColor: "#4caf50", subject: "Math" },
    { done: false, title: "Leaf Classification", child: "Joey", childColor: "#2196f3", subject: "Science" },
  ];

  return (
    <div className="space-y-0">
      {/* Hero */}
      <div
        className="relative w-full rounded-b-[24px] px-6 pt-7 pb-8 overflow-hidden"
        style={{ background: "#2d5a3d" }}
      >
        <div
          className="absolute top-2 right-3 text-[100px] leading-none select-none pointer-events-none"
          style={{ opacity: 0.06 }}
          aria-hidden
        >
          🌿
        </div>
        <p className="text-[11px] font-semibold tracking-widest uppercase mb-1" style={{ color: "#8cba8e" }}>
          {todayFormatted()}
        </p>
        <h1
          className="text-[22px] sm:text-[26px] font-bold leading-tight text-[#fefcf9]"
          style={{ fontFamily: "var(--font-display)" }}
        >
          Good morning, {FAMILY} 🌿
        </h1>
        <div className="flex items-center gap-4 mt-3">
          <span className="text-xs text-white/60">🔥 12 day streak</span>
          <span className="text-xs text-white/60">📸 47 memories</span>
        </div>
      </div>

      <div className="px-4 pt-5 pb-4 space-y-5">
        {/* Memory moment card */}
        <div className="rounded-2xl overflow-hidden border border-[#e8e2d9] bg-white shadow-sm">
          <div className="relative">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="https://images.unsplash.com/photo-1503676260728-1c00da094a0b?w=400&q=80"
              alt="Emma reading"
              className="w-full h-48 object-cover"
            />
            <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/60 to-transparent p-3">
              <p className="text-white text-sm font-medium">Emma reading Charlotte&apos;s Web by the window 📖</p>
              <span
                className="inline-block mt-1 text-[10px] font-medium px-2 py-0.5 rounded-full text-white"
                style={{ backgroundColor: "#4caf50cc" }}
              >
                Emma
              </span>
            </div>
          </div>
        </div>

        {/* Lessons */}
        <div>
          <p className="text-xs font-semibold uppercase tracking-widest text-[#7a6f65] mb-3">
            Today&apos;s lessons
          </p>
          <div className="space-y-2">
            {lessons.map((l) => (
              <div
                key={l.title}
                className={`flex items-center gap-3 px-4 py-3 rounded-xl border text-sm ${
                  l.done
                    ? "bg-[#f0f7f1] border-[#c2dbc5]"
                    : "bg-white border-[#e8e2d9]"
                }`}
              >
                <div
                  className={`w-5 h-5 rounded-full border-2 flex items-center justify-center shrink-0 ${
                    l.done ? "bg-[#5c7f63] border-[#5c7f63]" : ""
                  }`}
                  style={l.done ? {} : { borderColor: l.childColor }}
                >
                  {l.done && <span className="text-[8px] text-white font-bold">✓</span>}
                </div>
                <div className="flex-1 min-w-0">
                  <p className={`font-medium truncate ${l.done ? "line-through text-[#7a9e7e]" : "text-[#2d2926]"}`}>
                    {l.title}
                  </p>
                  <div className="flex items-center gap-1.5 mt-0.5">
                    <span
                      className="w-2 h-2 rounded-full shrink-0"
                      style={{ backgroundColor: l.childColor }}
                    />
                    <span className="text-[11px] text-[#b5aca4]">{l.child} · {l.subject}</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Garden strip */}
        <div className="rounded-2xl p-4" style={{ background: "#2d5a3d" }}>
          <div className="flex items-center justify-between mb-2">
            {CHILDREN.map((c) => (
              <div key={c.name} className="flex items-center gap-2">
                <span className="text-2xl">{c.leaves >= 70 ? "🌳" : "🌿"}</span>
                <div>
                  <p className="text-xs font-semibold text-white">{c.name}</p>
                  <p className="text-[10px] text-white/50">{c.leaves} leaves</p>
                </div>
              </div>
            ))}
          </div>
          <p className="text-xs text-white/40 text-center mt-1">Your garden is growing →</p>
        </div>

        <BottomCTA />
      </div>
    </div>
  );
}

// ─── Tab: Memories ────────────────────────────────────────────────────────────

function TabMemories() {
  const filters = ["All", "Family", "Emma", "Joey", "Photos", "Books"];
  const [activeFilter, setActiveFilter] = useState("All");

  return (
    <div className="space-y-0">
      {/* Header */}
      <div
        className="relative w-full rounded-b-[24px] px-6 pt-7 pb-8 overflow-hidden"
        style={{ background: "#3d5c42" }}
      >
        <p className="text-[11px] font-semibold tracking-widest uppercase mb-1" style={{ color: "#8cba8e" }}>
          The {FAMILY}
        </p>
        <h1
          className="text-[22px] sm:text-[26px] font-bold leading-tight text-[#fefcf9]"
          style={{ fontFamily: "var(--font-display)" }}
        >
          Your Story 📖
        </h1>
        <div className="flex items-center gap-4 mt-3 flex-wrap">
          <span className="text-xs text-white/60">47 memories</span>
          <span className="text-xs text-white/60">12 photos</span>
          <span className="text-xs text-white/60">8 books</span>
          <span className="text-xs text-white/60">4 trips</span>
        </div>
      </div>

      <div className="px-4 pt-5 pb-4 space-y-5">
        {/* Filter bar */}
        <div className="flex gap-2 flex-wrap">
          {filters.map((f) => (
            <button
              key={f}
              onClick={() => setActiveFilter(f)}
              className={`px-3.5 py-1.5 rounded-full text-sm font-medium transition-colors ${
                activeFilter === f
                  ? "bg-[#5c7f63] text-white"
                  : "bg-[#fefcf9] border border-[#e8e2d9] text-[#7a6f65]"
              }`}
            >
              {f}
            </button>
          ))}
        </div>

        {/* Photo card — full bleed */}
        <div className="rounded-2xl overflow-hidden border border-[#e8e2d9] bg-white shadow-sm">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="https://images.unsplash.com/photo-1456513080510-7bf3a84b82f8?w=400&q=80"
            alt="Nature walk"
            className="w-full h-56 object-cover"
          />
          <div className="p-4">
            <p className="text-sm font-medium text-[#2d2926] mb-1">
              Nature walk — found 4 salamanders and named them all 🦎
            </p>
            <div className="flex items-center gap-2">
              <span
                className="text-[10px] font-medium px-2 py-0.5 rounded-full text-white"
                style={{ backgroundColor: "#4caf50" }}
              >
                Emma
              </span>
              <span className="text-[10px] text-[#b5aca4]">Mar 18</span>
            </div>
          </div>
        </div>

        {/* Book card */}
        <div className="bg-[#fefcf9] border border-[#e8e2d9] rounded-2xl p-4 flex gap-3">
          <div
            className="w-11 h-11 rounded-xl flex items-center justify-center text-lg shrink-0"
            style={{ backgroundColor: "#fef3e0" }}
          >
            📖
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-start justify-between gap-2">
              <p className="font-medium text-sm text-[#2d2926]">Finished Charlotte&apos;s Web</p>
              <span className="text-[10px] text-[#b5aca4] shrink-0">Mar 15</span>
            </div>
            <p className="text-xs text-[#7a6f65] mt-0.5 leading-relaxed">
              She cried at the end and said &ldquo;Mom, I think I understand what love means now.&rdquo; Best school day ever.
            </p>
            <div className="flex gap-1.5 mt-1.5">
              <span
                className="text-[10px] px-2 py-0.5 rounded-full text-white"
                style={{ backgroundColor: "#4caf50" }}
              >
                Emma
              </span>
              <span className="text-[10px] bg-[#f0ede8] text-[#7a6f65] px-2 py-0.5 rounded-full">
                Book #8 this year
              </span>
            </div>
          </div>
        </div>

        {/* Quote card */}
        <div className="bg-[#fefcf9] border border-[#e8e2d9] rounded-2xl p-4 flex gap-3">
          <div
            className="w-11 h-11 rounded-xl flex items-center justify-center text-lg shrink-0"
            style={{ backgroundColor: "#fce4ec" }}
          >
            ✍️
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-start justify-between gap-2">
              <p
                className="font-medium text-sm text-[#2d2926] italic"
                style={{ fontFamily: "var(--font-display)" }}
              >
                &ldquo;Mom, I think I actually love fractions now.&rdquo;
              </p>
              <span className="text-[10px] text-[#b5aca4] shrink-0">Mar 17</span>
            </div>
            <p className="text-xs text-[#7a6f65] mt-0.5 leading-relaxed">
              Said completely unprompted after math this morning. Writing this down forever.
            </p>
            <div className="flex gap-1.5 mt-1.5">
              <span
                className="text-[10px] px-2 py-0.5 rounded-full text-white"
                style={{ backgroundColor: "#4caf50" }}
              >
                Emma
              </span>
            </div>
          </div>
        </div>

        {/* Field trip card */}
        <div className="rounded-2xl overflow-hidden border border-[#e8e2d9] bg-white shadow-sm">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="https://images.unsplash.com/photo-1571019613454-1cb2f99b2d8b?w=400&q=80"
            alt="Science museum"
            className="w-full h-44 object-cover"
          />
          <div className="p-4">
            <p className="text-sm font-medium text-[#2d2926] mb-1">
              Science museum — she touched a real dinosaur fossil 🦕
            </p>
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-[#f0ede8] text-[#7a6f65]">
                👨‍👩‍👧‍👦 Family
              </span>
              <span className="text-[10px] text-[#b5aca4]">Mar 10</span>
            </div>
          </div>
        </div>

        <BottomCTA />
      </div>
    </div>
  );
}

// ─── Tab: Garden ──────────────────────────────────────────────────────────────

function TabGarden() {
  const badges = [
    { emoji: "⭐", label: "Founding\nMember", bg: "linear-gradient(135deg, #b8823a 0%, #e8b87a 50%, #b8823a 100%)", textColor: "#b8823a" },
    { emoji: "🌱", label: "First Leaf", bg: "#e8f0e9", textColor: "#3d5c42" },
  ];

  return (
    <div className="space-y-0">
      {/* Header */}
      <div
        className="relative w-full rounded-b-[24px] px-6 pt-7 pb-8 overflow-hidden"
        style={{ background: "#3d5c42" }}
      >
        <p className="text-[11px] font-semibold tracking-widest uppercase mb-1" style={{ color: "#8cba8e" }}>
          Your Family
        </p>
        <h1
          className="text-[22px] sm:text-[26px] font-bold leading-tight text-[#fefcf9]"
          style={{ fontFamily: "var(--font-display)" }}
        >
          Garden 🌱
        </h1>
      </div>

      <div className="px-4 pt-5 pb-4 space-y-5">
        {/* Garden scene */}
        <div className="rounded-3xl overflow-hidden shadow-md">
          <div className="relative" style={{ background: "linear-gradient(180deg, #87ceeb 0%, #b8dff0 40%, #d4eef4 65%, #c4e8c0 85%, #7ab87a 100%)", aspectRatio: "4/3", minHeight: 280 }}>
            {/* Sun */}
            <div className="absolute top-4 right-6" style={{ fontSize: 36, lineHeight: 1 }} aria-hidden>☀️</div>

            {/* Ground */}
            <div className="absolute bottom-0 left-0 right-0" style={{ height: "28%", background: "linear-gradient(180deg, #7ab87a 0%, #5c9a50 100%)", borderRadius: "50% 50% 0 0 / 20% 20% 0 0" }} />

            {/* Trees */}
            <div className="absolute flex flex-col items-center" style={{ bottom: "22%", left: "35%", transform: "translateX(-50%)" }}>
              <span style={{ fontSize: 88, lineHeight: 1, filter: "drop-shadow(0 4px 8px rgba(0,0,0,0.15))", userSelect: "none" }} aria-hidden>🌳</span>
              <div className="mt-1 flex items-center gap-0.5 shadow-sm" style={{ background: "#ffffff", borderRadius: 12, padding: "3px 8px" }}>
                <span style={{ fontSize: 11 }}>🍃</span>
                <span style={{ fontSize: 11, fontWeight: 700, color: "#2d5a3d" }}>200</span>
              </div>
              <div className="mt-1 text-center">
                <span className="font-semibold shadow-sm whitespace-nowrap" style={{ fontSize: 12, background: "rgba(0,0,0,0.3)", color: "#ffffff", borderRadius: 10, padding: "3px 10px" }}>Emma</span>
              </div>
            </div>

            <div className="absolute flex flex-col items-center" style={{ bottom: "22%", left: "65%", transform: "translateX(-50%)" }}>
              <span style={{ fontSize: 60, lineHeight: 1, filter: "drop-shadow(0 4px 8px rgba(0,0,0,0.15))", userSelect: "none" }} aria-hidden>🌲</span>
              <div className="mt-1 flex items-center gap-0.5 shadow-sm" style={{ background: "#ffffff", borderRadius: 12, padding: "3px 8px" }}>
                <span style={{ fontSize: 11 }}>🍃</span>
                <span style={{ fontSize: 11, fontWeight: 700, color: "#2d5a3d" }}>47</span>
              </div>
              <div className="mt-1 text-center">
                <span className="font-semibold shadow-sm whitespace-nowrap" style={{ fontSize: 12, background: "rgba(0,0,0,0.3)", color: "#ffffff", borderRadius: 10, padding: "3px 10px" }}>Joey</span>
              </div>
            </div>
          </div>
        </div>

        {/* Badges */}
        <div>
          <h2 className="text-sm font-semibold uppercase tracking-widest text-[#7a6f65] mb-3">
            Badges · 2 earned
          </h2>
          <div className="flex flex-wrap gap-2">
            {badges.map((b) => (
              <div key={b.label} className="flex flex-col items-center gap-1.5">
                <div
                  className="w-16 h-16 rounded-2xl flex items-center justify-center text-2xl shadow-sm"
                  style={{ background: b.bg }}
                >
                  {b.emoji}
                </div>
                <span
                  className="text-[10px] font-semibold text-center leading-tight whitespace-pre-line"
                  style={{ color: b.textColor }}
                >
                  {b.label}
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* Stats */}
        <div>
          <h2 className="text-sm font-semibold uppercase tracking-widest text-[#7a6f65] mb-3">Your Stats</h2>
          <div className="grid grid-cols-3 gap-3">
            <div className="bg-gradient-to-br from-[#fff8ed] to-[#fef3dc] border border-[#f5c97a]/40 rounded-2xl p-4 text-center">
              <div className="text-2xl mb-1">🔥</div>
              <p className="text-2xl font-bold text-[#c4956a]">12</p>
              <p className="text-xs font-medium text-[#8b6f47] mt-0.5">Current streak</p>
            </div>
            <div className="bg-gradient-to-br from-[#e8f5ea] to-[#d4ead6] border border-[#b8d9bc] rounded-2xl p-4 text-center">
              <div className="text-2xl mb-1">🏆</div>
              <p className="text-2xl font-bold text-[#3d5c42]">15</p>
              <p className="text-xs font-medium text-[#5c7f63] mt-0.5">Best streak</p>
            </div>
            <div className="bg-[#fefcf9] border border-[#e8e2d9] rounded-2xl p-4 text-center">
              <div className="text-2xl mb-1">📚</div>
              <p className="text-2xl font-bold text-[#2d2926]">200</p>
              <p className="text-xs font-medium text-[#7a6f65] mt-0.5">Lessons logged</p>
            </div>
          </div>
        </div>

        <BottomCTA />
      </div>
    </div>
  );
}

// ─── Main Demo Page ───────────────────────────────────────────────────────────

type DemoTab = "today" | "memories" | "garden";

export default function DemoPage() {
  const [tab, setTab] = useState<DemoTab>("today");

  const tabs: { id: DemoTab; label: string; emoji: string }[] = [
    { id: "today", label: "Today", emoji: "☀️" },
    { id: "memories", label: "Memories", emoji: "📸" },
    { id: "garden", label: "Garden", emoji: "🌱" },
  ];

  return (
    <div className="min-h-screen bg-[#faf8f4] flex flex-col">
      <DemoBanner />

      {/* Content */}
      <div className="flex-1 max-w-lg mx-auto w-full pb-20">
        {tab === "today" && <TabToday />}
        {tab === "memories" && <TabMemories />}
        {tab === "garden" && <TabGarden />}
      </div>

      {/* Bottom nav */}
      <nav className="fixed bottom-0 left-0 right-0 bg-[#fefcf9] border-t border-[#e8e2d9] z-40" style={{ paddingBottom: "env(safe-area-inset-bottom)" }}>
        <div className="max-w-lg mx-auto flex">
          {tabs.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`flex-1 flex flex-col items-center gap-0.5 py-2.5 text-xs font-medium transition-colors ${
                tab === t.id ? "text-[#5c7f63]" : "text-[#b5aca4]"
              }`}
            >
              <span className="text-lg">{t.emoji}</span>
              {t.label}
            </button>
          ))}
        </div>
      </nav>
    </div>
  );
}
