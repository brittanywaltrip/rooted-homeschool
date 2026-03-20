"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { Check } from "lucide-react";
import { STAGE_INFO, LEAF_THRESHOLDS, getStageFromLeaves } from "@/components/GardenScene";

// Helper: get the display emoji for a leaf count
function treeEmoji(leaves: number): string {
  const stage = getStageFromLeaves(leaves);
  const map: Record<number, string> = { 1:"🌱", 2:"🌿", 3:"🪴", 4:"🌳", 5:"🌲", 6:"🌸", 7:"🍃", 8:"🌳", 9:"🍂", 10:"🌳" };
  return map[stage] ?? "🌱";
}

// ─── Types & Feature Data ─────────────────────────────────────────────────────

type FeatureId = "today" | "plan" | "garden" | "reports" | "memories" | "resources" | "insights";

const FEATURES: {
  id: FeatureId;
  label: string;
  emoji: string;
  headline: string;
  sub: string;
  bullets: string[];
  note: string;
}[] = [
  {
    id: "memories",
    label: "Memories",
    emoji: "📸",
    headline: "Capture every learning moment",
    sub: "The years go by so fast. Rooted helps you hold onto them — photos, quotes, books, and moments you'd otherwise forget.",
    bullets: [
      "Save photos, field trip moments, and little things they said — it takes 10 seconds",
      "Build a book log as you go — a record of everything they've ever read",
      "Generate a warm AI-written Family Update to share with grandparents — no app needed",
    ],
    note: "Shareable link, no app download needed 🔗",
  },
  {
    id: "today",
    label: "Today",
    emoji: "☀️",
    headline: "Your daily command center",
    sub: "Know exactly what to teach each morning — no guessing, no planning stress.",
    bullets: [
      "See exactly what's planned for today — lesson by lesson, in order",
      "Check off lessons with one tap — each one grows your child's garden tree",
      "Smart Finish Line shows if you're on track to finish your curriculum on time",
    ],
    note: "Every lesson earns a leaf 🍃",
  },
  {
    id: "plan",
    label: "Plan",
    emoji: "📅",
    headline: "Curriculum that plans itself",
    sub: "Tell Rooted your goal date and school days — it builds the whole schedule.",
    bullets: [
      "Auto-schedules your entire curriculum — just enter your lessons and goal date",
      "Pick your school days: any combination Mon–Sun that fits your family",
      "Reschedule instantly if you get ahead or fall behind — one tap to recalculate",
    ],
    note: "Lessons auto-schedule to your school days 📆",
  },
  {
    id: "garden",
    label: "Garden",
    emoji: "🌳",
    headline: "A living reward for every lesson",
    sub: "The most motivating progress tracker your kids will actually care about.",
    bullets: [
      "Every completed lesson earns your child a leaf toward their growing tree",
      "Watch their tree grow: Seed → Sprout → Sapling → Growing → Thriving",
      "Kids race to finish lessons just to see their tree grow — it actually works",
    ],
    note: "200+ lessons to reach Thriving 🌳",
  },
  {
    id: "reports",
    label: "Reports",
    emoji: "📋",
    headline: "State compliance in one click",
    sub: "Print-ready progress reports without the paperwork headache.",
    bullets: [
      "One-click printable progress reports formatted for state compliance",
      "Rooted knows your state's requirements automatically — just select your state",
      "Filter by child, date range, and subject — then download as a PDF",
    ],
    note: "Works for all 50 states 🗺️",
  },
  {
    id: "resources",
    label: "Resources",
    emoji: "📚",
    headline: "Curated resources, just for you",
    sub: "Free picks filtered for your state, updated every week — zero prep required.",
    bullets: [
      "Free picks updated every week — textbooks, activities, and virtual field trips",
      "Filtered for your state's requirements automatically",
      "Field trips, printables, and zero-prep activities ready to use today",
    ],
    note: "Works for all 50 states — always free 🗺️",
  },
  {
    id: "insights",
    label: "Insights",
    emoji: "📊",
    headline: "See your family's momentum",
    sub: "Celebrate consistency — not perfection. Rooted shows you the whole picture.",
    bullets: [
      "See your learning streak, most active days, and total hours logged this month",
      "Week-over-week comparison shows whether your family's momentum is growing",
      "Celebrate consistency — not perfection. Every streak is worth celebrating",
    ],
    note: "Streaks reset weekly — low pressure, real progress 🔥",
  },
];

// ─── Shared Mockup Helpers ────────────────────────────────────────────────────

function MockupShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-2xl overflow-hidden border border-[#e8e2d9] shadow-xl bg-[#f8f7f4]">
      {/* Browser chrome */}
      <div className="bg-[#e8e2d9] px-3 py-2 flex items-center gap-1.5">
        <div className="w-2.5 h-2.5 rounded-full bg-[#c4956a] opacity-80" />
        <div className="w-2.5 h-2.5 rounded-full bg-[#c4c47a] opacity-80" />
        <div className="w-2.5 h-2.5 rounded-full bg-[#7aaa78] opacity-80" />
        <div className="flex-1 mx-3">
          <div className="bg-white/60 rounded px-2 py-0.5 text-[10px] text-[#7a6f65] text-center">
            rootedhomeschoolapp.com/dashboard
          </div>
        </div>
      </div>
      <div className="min-h-[400px]">{children}</div>
    </div>
  );
}

function LessonRow({ done, label, mins }: { done: boolean; label: string; mins?: string }) {
  return (
    <div className="flex items-center gap-2.5 py-2.5 border-b border-[#f0ede8] last:border-0">
      <div
        className={`w-5 h-5 rounded-md shrink-0 flex items-center justify-center ${
          done ? "bg-[#5c7f63]" : "border-2 border-[#d4cfc9] bg-white"
        }`}
      >
        {done && <Check size={11} className="text-white" strokeWidth={3} />}
      </div>
      <span className={`text-xs flex-1 ${done ? "line-through text-[#b5aca4]" : "text-[#2d2926] font-medium"}`}>
        {label}
      </span>
      {mins && <span className="text-[10px] text-[#b5aca4] shrink-0">{mins}</span>}
    </div>
  );
}

function ProgressBar({ label, pct, remaining }: { label: string; pct: number; remaining: number }) {
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-medium text-[#2d2926]">{label}</span>
        <span className="text-[10px] text-[#7a6f65]">{remaining} left</span>
      </div>
      <div className="w-full bg-[#e8e2d9] rounded-full h-1.5">
        <div className="bg-[#5c7f63] h-1.5 rounded-full" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

// ─── Mockup: Today ────────────────────────────────────────────────────────────

function TodayMockup() {
  return (
    <MockupShell>
      <div className="flex h-full min-h-[400px]">
        {/* Slim sidebar strip */}
        <div className="w-9 bg-[#fefcf9] border-r border-[#e8e2d9] flex flex-col items-center py-3 gap-2.5 shrink-0">
          <div className="w-6 h-6 rounded-lg bg-[#5c7f63] flex items-center justify-center text-[10px]">🌿</div>
          <div className="w-6 h-6 rounded-lg bg-[#e8f0e9] flex items-center justify-center text-[10px]">☀️</div>
          {["📅", "🌳", "📚", "📸", "📋"].map((e, i) => (
            <div key={i} className="w-6 h-6 rounded-lg flex items-center justify-center text-[10px] opacity-30">{e}</div>
          ))}
        </div>
        {/* Main */}
        <div className="flex-1 p-3 sm:p-4 space-y-3 overflow-hidden">
          <div>
            <p className="text-[10px] text-[#b5aca4]">Wednesday, March 19</p>
            <h2 className="text-sm font-bold text-[#2d2926]">Good morning, Parker Family! ☀️</h2>
          </div>

          {/* Lesson checklist */}
          <div className="bg-[#fefcf9] border border-[#e8e2d9] rounded-xl overflow-hidden">
            <div className="px-3 py-2 border-b border-[#f0ede8] flex items-center justify-between">
              <span className="text-[11px] font-semibold text-[#2d2926]">Today's Lessons</span>
              <span className="text-[10px] text-[#5c7f63] font-semibold bg-[#e8f0e9] px-1.5 py-0.5 rounded-full">2 of 5</span>
            </div>
            <div className="px-3">
              <LessonRow done label="Math — Fractions (Ch. 12)" mins="45 min" />
              <LessonRow done label="Reading — Charlotte's Web" mins="30 min" />
              <LessonRow done={false} label="History — American Revolution" />
              <LessonRow done={false} label="Science — Plant Cells" />
              <LessonRow done={false} label="Writing — Journal Entry" />
            </div>
          </div>

          {/* Finish Line */}
          <div className="bg-[#fefcf9] border border-[#e8e2d9] rounded-xl p-3 space-y-2">
            <span className="text-[11px] font-semibold text-[#2d2926]">🎯 Finish Line</span>
            <div className="bg-gradient-to-br from-[#e8f5ea] to-[#f0f8ee] border border-[#b8d9bc] rounded-lg px-2.5 py-2 space-y-1.5">
              <div className="flex items-center justify-between">
                <p className="text-[11px] font-semibold text-[#2d2926]">Math — Saxon 5/4 · Zoe</p>
                <span className="text-[9px] bg-[#e8f0e9] text-[#3d5c42] px-1.5 py-0.5 rounded-full font-bold shrink-0">🟢 On track</span>
              </div>
              <p className="text-[10px] text-[#3d5c42] leading-snug">
                🌿 At your current pace, Zoe will finish by May 30 — right on time!
              </p>
              <div className="w-full bg-[#d4ead6] rounded-full h-1.5">
                <div className="bg-[#5c7f63] h-1.5 rounded-full" style={{ width: "40%" }} />
              </div>
              <p className="text-[9px] text-[#7a6f65]">40% complete · 18 lessons remaining</p>
            </div>
          </div>

          {/* Garden preview card */}
          <div className="bg-gradient-to-r from-[#e8f5ea] to-[#d4ead6] border border-[#b8d9bc] rounded-xl px-3 py-2.5 flex items-center gap-3">
            <span style={{ fontSize: 48, lineHeight: 1 }} aria-hidden>🪴</span>
            <div className="flex-1 min-w-0 space-y-1">
              <p className="text-[11px] font-bold text-[#2d2926] leading-tight">Sprout · Growing roots</p>
              <p className="text-[10px] text-[#5c7f63]">15 leaves · 5 more to Sapling</p>
              <div className="w-full bg-[#b8d9bc] rounded-full h-1">
                <div className="bg-[#3d5c42] h-1 rounded-full" style={{ width: "75%" }} />
              </div>
            </div>
          </div>
        </div>
      </div>
    </MockupShell>
  );
}

// ─── Mockup: Plan ─────────────────────────────────────────────────────────────

function PlanMockup() {
  const days = ["Mon", "Tue", "Wed", "Thu", "Fri"] as const;
  const cols: Record<string, { label: string; bg: string; text: string }[]> = {
    Mon: [
      { label: "Math", bg: "#e8f0e9", text: "#3d5c42" },
      { label: "History", bg: "#fef0e4", text: "#7a4a1a" },
    ],
    Tue: [
      { label: "Reading", bg: "#e4f0f4", text: "#1a4a5a" },
      { label: "Science", bg: "#f0e8f4", text: "#4a2a5a" },
    ],
    Wed: [
      { label: "Math", bg: "#e8f0e9", text: "#3d5c42" },
      { label: "Writing", bg: "#fce8ec", text: "#7a2a36" },
    ],
    Thu: [
      { label: "Reading", bg: "#e4f0f4", text: "#1a4a5a" },
      { label: "History", bg: "#fef0e4", text: "#7a4a1a" },
    ],
    Fri: [
      { label: "Math", bg: "#e8f0e9", text: "#3d5c42" },
      { label: "Science", bg: "#f0e8f4", text: "#4a2a5a" },
    ],
  };

  return (
    <MockupShell>
      <div className="p-3 sm:p-4 space-y-3 min-h-[400px]">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-bold text-[#2d2926]">📅 Week of March 17–21</h2>
          <span className="text-[10px] bg-[#e8f0e9] text-[#3d5c42] px-2 py-0.5 rounded-full font-semibold">
            Auto-scheduled ✓
          </span>
        </div>

        {/* Calendar grid */}
        <div className="grid grid-cols-5 gap-1.5">
          {days.map((day) => (
            <div key={day} className="space-y-1.5">
              <div className="text-center text-[10px] font-bold text-[#7a6f65] uppercase tracking-wide">{day}</div>
              {cols[day].map((item) => (
                <div
                  key={item.label}
                  className="rounded-lg px-1 py-2 text-[10px] font-semibold text-center leading-tight"
                  style={{ backgroundColor: item.bg, color: item.text }}
                >
                  {item.label}
                </div>
              ))}
            </div>
          ))}
        </div>

        {/* Progress bars */}
        <div className="bg-[#fefcf9] border border-[#e8e2d9] rounded-xl p-3 space-y-2.5">
          <p className="text-[11px] font-semibold text-[#2d2926]">🌿 Finish Line — pacing this week</p>
          <ProgressBar label="Math — Saxon 5/4" pct={68} remaining={12} />
          <ProgressBar label="All About Reading" pct={55} remaining={18} />
          <ProgressBar label="Story of the World" pct={44} remaining={22} />
        </div>

        {/* School days selector */}
        <div className="bg-[#fefcf9] border border-[#e8e2d9] rounded-xl p-3">
          <p className="text-[11px] font-semibold text-[#2d2926] mb-2">School days</p>
          <div className="flex gap-1">
            {["M", "T", "W", "T", "F", "S", "S"].map((d, i) => (
              <div
                key={i}
                className={`flex-1 h-7 rounded-full text-[10px] font-bold flex items-center justify-center ${
                  i < 5
                    ? "bg-[#5c7f63] text-white"
                    : "bg-[#f0ede8] text-[#c8bfb5]"
                }`}
              >
                {d}
              </div>
            ))}
          </div>
        </div>
      </div>
    </MockupShell>
  );
}

// ─── Mockup: Garden ───────────────────────────────────────────────────────────

function GardenMockup() {
  const children = [
    { name: "Emma", leaves: 2,  color: "#5c7f63" }, // 🌱 Seed stage
    { name: "Zoe",  leaves: 55, color: "#c4697a" }, // 🌸 Blooming stage
    { name: "Liam", leaves: 25, color: "#4a7a8a" }, // 🌳 Sapling stage
  ];
  // Show a sample of stages (1, 3, 5, 7, 10)
  const sampleStages = [0, 2, 4, 6, 9].map((i) => ({ label: STAGE_INFO[i].name, leaves: LEAF_THRESHOLDS[i] }));

  return (
    <MockupShell>
      <div className="p-3 sm:p-4 space-y-3 min-h-[400px]">
        <h2 className="text-sm font-bold text-[#2d2926]">🌳 The Garden</h2>

        {/* Garden scene */}
        <div
          className="rounded-xl relative overflow-hidden"
          style={{
            background: "linear-gradient(180deg, #87ceeb 0%, #b0d8f0 40%, #cce4f5 70%, #e4f0e4 85%, #7ab87a 100%)",
            height: 170,
          }}
        >
          {/* Trees sit above the ground — rendered first so ground SVG overlaps the base */}
          <div className="absolute bottom-0 left-0 right-0 flex items-end justify-around px-6" style={{ paddingBottom: 28 }}>
            {children.map((child, i) => (
              <div key={child.name} className="flex flex-col items-center gap-0.5">
                <span
                  className={i % 2 === 0 ? "garden-sway" : "garden-sway-alt"}
                  style={{
                    fontSize: 52,
                    lineHeight: 1,
                    display: "block",
                    filter: "drop-shadow(0 4px 12px rgba(0,0,0,0.25))",
                    transformOrigin: "center bottom",
                    animationDelay: `${i * 0.8}s`,
                    userSelect: "none",
                  }}
                  aria-hidden
                >
                  {treeEmoji(child.leaves)}
                </span>
                <span
                  className="text-[10px] font-bold px-1.5 py-0.5 rounded-full"
                  style={{ background: "rgba(255,255,255,0.85)", color: child.color, lineHeight: 1.4 }}
                >
                  {child.name}
                </span>
              </div>
            ))}
          </div>

          {/* Ground SVG — on top of tree bases to look planted */}
          <div className="absolute bottom-0 left-0 right-0 pointer-events-none" style={{ height: 36 }}>
            <svg viewBox="0 0 400 36" preserveAspectRatio="none" className="w-full h-full">
              <path d="M0 10 Q100 2 200 8 Q300 14 400 6 L400 36 L0 36 Z" fill="#5c8a47" />
              <path d="M0 18 Q100 12 200 16 Q300 20 400 14 L400 36 L0 36 Z" fill="#3d6030" />
            </svg>
          </div>
        </div>

        {/* Growth stages key */}
        <div className="bg-[#fefcf9] border border-[#e8e2d9] rounded-xl p-3">
          <p className="text-[10px] font-semibold text-[#7a6f65] uppercase tracking-wide mb-2">10 growth stages</p>
          <div className="flex items-end gap-1">
            {sampleStages.map((s) => (
              <div key={s.label} className="flex-1 flex flex-col items-center gap-0.5">
                <span style={{ fontSize: 22, lineHeight: 1, userSelect: "none" }} aria-hidden>
                  {treeEmoji(s.leaves)}
                </span>
                <span className="text-[7px] text-[#7a6f65] text-center leading-tight">{s.label}</span>
              </div>
            ))}
          </div>
          <div className="relative mt-3 mx-1">
            <div className="w-full h-1.5 bg-[#e8e2d9] rounded-full">
              <div className="h-1.5 bg-gradient-to-r from-[#7aaa78] to-[#5c7f63] rounded-full" style={{ width: "43%" }} />
            </div>
            <p className="text-[9px] text-[#7a6f65] mt-1 text-center">Emma · 87 leaves · Young Tree stage</p>
          </div>
        </div>

        {/* Leaf counts */}
        <div className="grid grid-cols-3 gap-2">
          {children.map((child) => (
            <div key={child.name} className="bg-[#fefcf9] border border-[#e8e2d9] rounded-xl p-2.5 text-center">
              <p className="text-lg">🍃</p>
              <p className="text-sm font-bold" style={{ color: child.color }}>{child.leaves}</p>
              <p className="text-[9px] text-[#7a6f65]">{child.name}</p>
            </div>
          ))}
        </div>
      </div>
    </MockupShell>
  );
}

// ─── Mockup: Reports ─────────────────────────────────────────────────────────

function ReportsMockup() {
  const subjects = [
    { name: "Math",          lessons: 32, hours: "24h" },
    { name: "Language Arts", lessons: 28, hours: "18h" },
    { name: "Science",       lessons: 22, hours: "16h" },
    { name: "History",       lessons: 18, hours: "14h" },
    { name: "Art",           lessons: 12, hours: "8h"  },
    { name: "Reading",       lessons: 15, hours: "4.5h" },
  ];

  return (
    <MockupShell>
      <div className="p-3 sm:p-4 space-y-3 min-h-[400px]">
        <h2 className="text-sm font-bold text-[#2d2926]">📋 Progress Reports</h2>

        {/* Document preview — styled like a printed PDF */}
        <div
          className="bg-white rounded-xl overflow-hidden"
          style={{ boxShadow: "0 2px 8px rgba(0,0,0,0.10), 0 0 0 1px rgba(0,0,0,0.06)" }}
        >
          {/* Green branded header */}
          <div className="bg-[#5c7f63] px-3 py-2.5 flex items-center gap-2.5">
            <span className="text-white text-base leading-none">🌿</span>
            <div>
              <p className="text-[11px] font-bold text-white leading-tight tracking-tight">Rooted Homeschool</p>
              <p className="text-[9px] text-white/70 leading-tight">Home Education Progress Report</p>
            </div>
          </div>

          {/* Student info block */}
          <div className="px-3 pt-2.5 pb-2 border-b border-[#f0ede8]">
            <p className="text-[12px] font-bold text-[#2d2926] leading-tight">Emma Parker</p>
            <div className="flex items-center gap-2 mt-0.5 flex-wrap">
              <span className="text-[9px] text-[#7a6f65]">School Year: 2025–2026</span>
              <span className="text-[9px] text-[#d4cfc9]">·</span>
              <span className="text-[9px] text-[#7a6f65]">State: Nevada</span>
              <span className="text-[9px] text-[#d4cfc9]">·</span>
              <span className="text-[9px] text-[#7a6f65]">Aug 1 – Mar 19, 2026</span>
            </div>
          </div>

          {/* Stats row */}
          <div className="grid grid-cols-3 divide-x divide-[#f0ede8] border-b border-[#f0ede8]">
            {[["127", "Lessons"], ["84.5h", "Hours"], ["18", "Books Read"]].map(([val, lbl]) => (
              <div key={lbl} className="py-2 text-center">
                <p className="text-[12px] font-bold text-[#2d2926] leading-tight">{val}</p>
                <p className="text-[8px] text-[#7a6f65]">{lbl}</p>
              </div>
            ))}
          </div>

          {/* Subject table */}
          <div className="px-3 pt-2 pb-1">
            <table className="w-full" style={{ borderCollapse: "collapse" }}>
              <thead>
                <tr className="border-b border-[#f0ede8]">
                  <th className="text-left text-[8px] font-semibold text-[#b5aca4] uppercase tracking-wide pb-1">Subject</th>
                  <th className="text-right text-[8px] font-semibold text-[#b5aca4] uppercase tracking-wide pb-1">Lessons</th>
                  <th className="text-right text-[8px] font-semibold text-[#b5aca4] uppercase tracking-wide pb-1">Hours</th>
                </tr>
              </thead>
              <tbody>
                {subjects.map((s, i) => (
                  <tr key={s.name} style={{ background: i % 2 === 1 ? "#faf8f5" : "transparent" }}>
                    <td className="text-[10px] text-[#2d2926] py-[3px] pr-2">{s.name}</td>
                    <td className="text-[10px] text-[#2d2926] text-right py-[3px] pr-2 tabular-nums">{s.lessons}</td>
                    <td className="text-[10px] text-[#7a6f65] text-right py-[3px] tabular-nums">{s.hours}</td>
                  </tr>
                ))}
                <tr className="border-t border-[#e8e2d9]">
                  <td className="text-[10px] font-bold text-[#2d2926] pt-1.5 pb-1">Total</td>
                  <td className="text-[10px] font-bold text-[#2d2926] text-right pt-1.5 pb-1 pr-2 tabular-nums">127</td>
                  <td className="text-[10px] font-bold text-[#5c7f63] text-right pt-1.5 pb-1 tabular-nums">84.5h</td>
                </tr>
              </tbody>
            </table>
          </div>

          {/* Footer */}
          <div className="px-3 py-2 bg-[#f8f5f0] flex items-center justify-between">
            <p className="text-[8px] text-[#b5aca4] italic">
              Generated by Rooted Homeschool · Nevada home education requirements
            </p>
            <p className="text-[9px] text-[#7a6f65] font-medium shrink-0">📄 PDF Ready · Print or Save</p>
          </div>
        </div>
      </div>
    </MockupShell>
  );
}

// ─── Mockup: Memories ─────────────────────────────────────────────────────────

function MemoriesMockup() {
  const entries = [
    { type: "📸", title: "Volcano experiment — it actually erupted!", date: "Mar 18", tag: "Science" },
    { type: "📚", title: "Finished Charlotte's Web", date: "Mar 15", tag: "Reading" },
    { type: "🎨", title: "Watercolor nature journal entry", date: "Mar 12", tag: "Art" },
  ];

  return (
    <MockupShell>
      <div className="p-3 sm:p-4 space-y-3 min-h-[400px]">
        <h2 className="text-sm font-bold text-[#2d2926]">📸 Memories</h2>

        {/* Graduation letter — FIRST: most emotionally powerful */}
        <div className="bg-gradient-to-br from-[#fffbf0] to-[#fef8e4] border border-[#e8d9a8] rounded-xl p-3 space-y-2">
          <div className="flex items-start gap-2.5">
            <span className="text-2xl leading-none shrink-0">🎓</span>
            <div className="flex-1 min-w-0">
              <p className="text-[11px] font-bold text-[#2d2926] leading-tight">Emma&apos;s Kindergarten Graduation</p>
              <p className="text-[9px] text-[#b5aca4] mt-0.5">School Year 2025–2026</p>
            </div>
          </div>
          <div className="bg-white/70 rounded-lg px-2.5 py-2 border border-[#e8d9a8]/60">
            <p className="text-[10px] text-[#5c5248] leading-relaxed italic">
              &ldquo;Dear Emma, What an extraordinary year of learning and growth you&apos;ve had.
              From mastering addition to reading chapter books on your own, your curiosity and
              joy have made every lesson an adventure...&rdquo;
            </p>
          </div>
        </div>

        {/* Log options — static, non-interactive */}
        <div className="grid grid-cols-3 gap-1.5">
          {[["📸", "Photo"], ["📚", "Book"], ["🎨", "Project"]].map(([e, lbl]) => (
            <div key={lbl} className="bg-[#fefcf9] border border-[#e8e2d9] rounded-xl py-2.5 flex flex-col items-center gap-1">
              <span className="text-lg">{e}</span>
              <span className="text-[10px] font-medium text-[#7a6f65]">{lbl}</span>
            </div>
          ))}
        </div>

        {/* Memory entries */}
        <div className="space-y-1.5">
          {entries.map((m) => (
            <div key={m.title} className="bg-[#fefcf9] border border-[#e8e2d9] rounded-xl flex items-center gap-2.5 px-3 py-2.5">
              <span className="text-lg shrink-0">{m.type}</span>
              <div className="flex-1 min-w-0">
                <p className="text-[11px] font-medium text-[#2d2926] truncate">{m.title}</p>
                <p className="text-[10px] text-[#b5aca4]">{m.date}</p>
              </div>
              <span className="text-[9px] bg-[#e8f0e9] text-[#5c7f63] px-1.5 py-0.5 rounded-full font-semibold shrink-0">
                {m.tag}
              </span>
            </div>
          ))}
        </div>

        {/* AI update — already written, static */}
        <div className="bg-gradient-to-br from-[#e8f5ea] to-[#f0f8ee] border border-[#b8d9bc] rounded-xl p-3 space-y-2">
          <p className="text-[10px] font-bold text-[#3d5c42]">✨ This Week&apos;s Family Update</p>
          <p className="text-[10px] text-[#5c5248] leading-relaxed italic">
            &ldquo;What a week for the Parker family! Emma dove deep into her science unit with a spectacular
            volcano experiment, while Zoe tackled fractions with surprising enthusiasm. Charlotte&apos;s Web
            came to a tearful but beautiful end, and the whole family celebrated with a movie night. 🎉&rdquo;
          </p>
          <span style={{ fontSize: 12, color: "#2d5a3d" }}>🔗 Share with family &amp; friends →</span>
        </div>
      </div>
    </MockupShell>
  );
}

// ─── Mockup: Resources ────────────────────────────────────────────────────────

function ResourcesMockup() {
  const resources = [
    { name: "CK-12", desc: "Free digital textbooks", tag: "Textbooks", emoji: "📖" },
    { name: "Khan Academy", desc: "Free math & science", tag: "Math · Science", emoji: "🎓" },
    { name: "Google Arts & Culture", desc: "Virtual museum tours", tag: "Art · History", emoji: "🏛️" },
  ];

  return (
    <MockupShell>
      <div className="p-3 sm:p-4 space-y-3 min-h-[400px]">
        <h2 className="text-sm font-bold text-[#2d2926]">📚 Resources</h2>

        {/* State banner */}
        <div className="bg-[#5c7f63] rounded-xl px-3 py-2.5">
          <p className="text-[9px] font-bold text-white/70 uppercase tracking-widest mb-0.5">For Nevada Families</p>
          <p className="text-[11px] font-semibold text-white leading-tight">
            Resources picked for Nevada homeschool families · Low regulation
          </p>
        </div>

        {/* Resource cards */}
        <div className="space-y-1.5">
          {resources.map((r) => (
            <div key={r.name} className="bg-[#fefcf9] border border-[#e8e2d9] rounded-xl flex items-center gap-2.5 px-3 py-2.5">
              <div className="w-8 h-8 rounded-lg bg-[#e8f0e9] flex items-center justify-center text-base shrink-0">
                {r.emoji}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-[11px] font-semibold text-[#2d2926] leading-tight">{r.name}</p>
                <p className="text-[10px] text-[#7a6f65]">{r.desc}</p>
              </div>
              <span className="text-[8px] bg-[#e8f0e9] text-[#5c7f63] px-1.5 py-0.5 rounded-full font-semibold shrink-0 text-center leading-tight">
                {r.tag}
              </span>
            </div>
          ))}
        </div>

        {/* Easy Win Today */}
        <div className="bg-[#fefcf9] border border-[#e8e2d9] rounded-xl p-3 space-y-2">
          <p className="text-[10px] font-bold text-[#2d2926] uppercase tracking-wide">⚡ Easy Win Today</p>
          <div className="bg-gradient-to-br from-[#e8f5ea] to-[#f0f8ee] border border-[#b8d9bc] rounded-lg px-3 py-2.5 space-y-1.5">
            <p className="text-[11px] font-bold text-[#2d2926] leading-tight">Nature Alphabet Hunt</p>
            <p className="text-[10px] text-[#5c5248] leading-relaxed">
              Go outside and find something in nature for each letter of the alphabet.
            </p>
            <div className="flex items-center gap-2">
              <span className="text-[9px] bg-white border border-[#d4cfc9] text-[#7a6f65] px-1.5 py-0.5 rounded-full font-medium">⏱ 15 min</span>
              <span className="text-[9px] bg-white border border-[#d4cfc9] text-[#7a6f65] px-1.5 py-0.5 rounded-full font-medium">K–5</span>
            </div>
          </div>
        </div>
      </div>
    </MockupShell>
  );
}

// ─── Mockup: Insights ─────────────────────────────────────────────────────────

function InsightsMockup() {
  // Hours: Mon=1.5, Tue=2, Wed=0, Thu=2.5, Fri=1.5, Sat=0.5, Sun=0
  // Bar heights in px (max bar area = 52px for Thu=2.5h)
  const bars = [
    { day: "Mon", hrs: 1.5, barPx: 31 },
    { day: "Tue", hrs: 2,   barPx: 42 },
    { day: "Wed", hrs: 0,   barPx: 0  },
    { day: "Thu", hrs: 2.5, barPx: 52 },
    { day: "Fri", hrs: 1.5, barPx: 31 },
    { day: "Sat", hrs: 0.5, barPx: 10 },
    { day: "Sun", hrs: 0,   barPx: 0  },
  ];

  return (
    <MockupShell>
      <div className="p-3 sm:p-4 space-y-3 min-h-[400px]">
        <h2 className="text-sm font-bold text-[#2d2926]">📊 Insights</h2>

        {/* Stats row */}
        <div className="grid grid-cols-3 gap-2">
          {[
            { emoji: "🔥", value: "12", label: "Day streak" },
            { emoji: "⏱️", value: "47.5h", label: "This month" },
            { emoji: "⭐", value: "Tue", label: "Best day" },
          ].map((s) => (
            <div key={s.label} className="bg-[#fefcf9] border border-[#e8e2d9] rounded-xl p-2.5 text-center">
              <p className="text-lg">{s.emoji}</p>
              <p className="text-sm font-bold text-[#2d2926]">{s.value}</p>
              <p className="text-[9px] text-[#7a6f65]">{s.label}</p>
            </div>
          ))}
        </div>

        {/* Bar chart — static inline bars, explicit px heights */}
        <div className="bg-[#fefcf9] border border-[#e8e2d9] rounded-xl p-3">
          <p className="text-[11px] font-semibold text-[#2d2926] mb-3">Hours by day — this week</p>
          <div style={{ display: "flex", alignItems: "flex-end", gap: 6, height: 70 }}>
            {[
              { day: "Mon", h: 32 },
              { day: "Tue", h: 42 },
              { day: "Wed", h: 0  },
              { day: "Thu", h: 52 },
              { day: "Fri", h: 32 },
              { day: "Sat", h: 12 },
              { day: "Sun", h: 0  },
            ].map(({ day, h }) => (
              <div key={day} style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "flex-end", flex: 1, height: "100%" }}>
                {h > 0 && (
                  <div style={{ width: 28, height: h, backgroundColor: "#2d5a3d", borderRadius: "3px 3px 0 0" }} />
                )}
                <span style={{ fontSize: 8, color: "#7a6f65", marginTop: 3 }}>{day}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Week comparison */}
        <div className="bg-[#fefcf9] border border-[#e8e2d9] rounded-xl p-3">
          <p className="text-[11px] font-semibold text-[#2d2926] mb-2">Week over week</p>
          <div className="flex items-end gap-4">
            <div>
              <p className="text-[10px] text-[#7a6f65]">Last week</p>
              <p className="text-xl font-bold text-[#b5aca4]">10.0 <span className="text-xs font-normal">hrs</span></p>
            </div>
            <div className="flex-1 text-center">
              <div className="bg-[#e8f5ea] text-[#3d5c42] text-xs font-bold px-2 py-1 rounded-lg inline-block">
                ↑ +2.5 hrs
              </div>
            </div>
            <div className="text-right">
              <p className="text-[10px] text-[#7a6f65]">This week</p>
              <p className="text-xl font-bold text-[#2d2926]">12.5 <span className="text-xs font-normal">hrs</span></p>
            </div>
          </div>
        </div>

        {/* Consistency note */}
        <div className="bg-gradient-to-r from-[#fef9e8] to-[#fef6d8] border border-[#f0e4b0] rounded-xl px-3 py-2 flex items-center gap-2">
          <span className="text-base">🌟</span>
          <p className="text-[10px] text-[#7a5a10] font-medium">
            5 out of 7 days this week — you&apos;re building a real rhythm!
          </p>
        </div>
      </div>
    </MockupShell>
  );
}

// ─── Mockup registry ──────────────────────────────────────────────────────────

const MOCKUPS: Record<FeatureId, () => React.JSX.Element> = {
  today: TodayMockup,
  plan: PlanMockup,
  garden: GardenMockup,
  reports: ReportsMockup,
  memories: MemoriesMockup,
  resources: ResourcesMockup,
  insights: InsightsMockup,
};

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function TourPage() {
  const [active, setActive] = useState(0);
  const [paused, setPaused] = useState(false);

  const prev = () => setActive((i) => (i - 1 + FEATURES.length) % FEATURES.length);
  const next = () => setActive((i) => (i + 1) % FEATURES.length);

  useEffect(() => {
    if (paused) return;
    const id = setInterval(() => setActive((i) => (i + 1) % FEATURES.length), 5000);
    return () => clearInterval(id);
  }, [paused]);

  const feature = FEATURES[active];
  const MockupComponent = MOCKUPS[feature.id];

  return (
    <main className="min-h-screen bg-[#f8f7f4]">

      {/* ── Nav ──────────────────────────────────────────────────────────────── */}
      <nav className="bg-[#fefcf9] border-b border-[#e8e2d9] px-6 py-3 flex items-center justify-between sticky top-0 z-40">
        <Link href="/" className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-lg bg-[#5c7f63] flex items-center justify-center text-sm">🌿</div>
          <span className="font-bold text-[#2d2926] text-sm">Rooted Homeschool</span>
        </Link>
        <div className="flex items-center gap-3">
          <Link href="/login" className="text-sm text-[#7a6f65] hover:text-[#5c7f63] transition-colors hidden sm:block">
            Log In
          </Link>
          <Link
            href="/signup"
            className="text-sm font-semibold bg-[#5c7f63] hover:bg-[#3d5c42] text-white px-4 py-2 rounded-xl transition-colors"
          >
            Start Free →
          </Link>
        </div>
      </nav>

      <div className="max-w-5xl mx-auto px-5 sm:px-8 py-10 sm:py-14">

        {/* ── Header ───────────────────────────────────────────────────────────── */}
        <div className="text-center mb-10 sm:mb-12">
          <p className="text-xs font-semibold uppercase tracking-widest text-[#5c7f63] mb-2">
            Interactive Tour
          </p>
          <h1 className="text-3xl sm:text-4xl font-bold text-[#2d2926] mb-3">
            See Rooted in Action
          </h1>
          <p className="text-[#7a6f65] text-base sm:text-lg max-w-2xl mx-auto leading-relaxed">
            Not a curriculum — a calm companion that works alongside the one you already love. Plan your days, capture memories, and actually see how far your kids have come.
          </p>
        </div>

        {/* ── Carousel ─────────────────────────────────────────────────────────── */}
        <style>{`
          @keyframes carousel-fade {
            from { opacity: 0; transform: translateY(10px); }
            to   { opacity: 1; transform: translateY(0); }
          }
          .carousel-slide { animation: carousel-fade 0.35s ease-out; }
        `}</style>

        <div
          className="relative mb-10"
          onMouseEnter={() => setPaused(true)}
          onMouseLeave={() => setPaused(false)}
        >
          {/* Left arrow — desktop */}
          <button
            onClick={prev}
            aria-label="Previous feature"
            className="hidden lg:flex absolute -left-14 top-1/2 -translate-y-1/2 w-11 h-11 items-center justify-center rounded-full bg-[#fefcf9] border border-[#e8e2d9] text-[#7a6f65] hover:border-[#5c7f63] hover:text-[#5c7f63] transition-colors shadow-sm z-10 text-2xl leading-none"
          >
            ‹
          </button>

          {/* Slide */}
          <div
            key={active}
            className="carousel-slide grid grid-cols-1 lg:grid-cols-5 gap-8 lg:gap-10 items-start"
          >
            {/* Mockup — left 3 cols */}
            <div className="lg:col-span-3 order-2 lg:order-1">
              <MockupComponent />
            </div>

            {/* Description — right 2 cols */}
            <div className="lg:col-span-2 order-1 lg:order-2 space-y-5">
              <div>
                <p className="text-xs font-semibold uppercase tracking-widest text-[#5c7f63] mb-1.5">
                  {feature.emoji} {feature.label}
                </p>
                <h2 className="text-2xl sm:text-3xl font-bold text-[#2d2926] leading-tight mb-2">
                  {feature.headline}
                </h2>
                <p className="text-[#7a6f65] leading-relaxed">
                  {feature.sub}
                </p>
              </div>

              <ul className="space-y-3">
                {feature.bullets.map((b) => (
                  <li key={b} className="flex items-start gap-3">
                    <div className="w-5 h-5 rounded-full bg-[#e8f0e9] flex items-center justify-center shrink-0 mt-0.5">
                      <Check size={11} className="text-[#5c7f63]" strokeWidth={3} />
                    </div>
                    <span className="text-sm text-[#5c5248] leading-relaxed">{b}</span>
                  </li>
                ))}
              </ul>

              {/* Detail note */}
              <div className="bg-[#fefcf9] border border-[#e8e2d9] rounded-xl px-4 py-3 flex items-center gap-2.5">
                <span className="text-base shrink-0">💡</span>
                <p className="text-sm text-[#5c7f63] font-medium">{feature.note}</p>
              </div>

              {/* Feature CTA */}
              <Link
                href="/signup"
                className="inline-flex items-center gap-2 bg-[#5c7f63] hover:bg-[#3d5c42] text-white text-sm font-semibold px-5 py-3 rounded-xl transition-colors shadow-sm"
              >
                Try {feature.label} free →
              </Link>
            </div>
          </div>

          {/* Right arrow — desktop */}
          <button
            onClick={next}
            aria-label="Next feature"
            className="hidden lg:flex absolute -right-14 top-1/2 -translate-y-1/2 w-11 h-11 items-center justify-center rounded-full bg-[#fefcf9] border border-[#e8e2d9] text-[#7a6f65] hover:border-[#5c7f63] hover:text-[#5c7f63] transition-colors shadow-sm z-10 text-2xl leading-none"
          >
            ›
          </button>

          {/* Mobile arrows */}
          <div className="flex lg:hidden items-center justify-center gap-6 mt-8">
            <button
              onClick={prev}
              aria-label="Previous feature"
              className="w-11 h-11 flex items-center justify-center rounded-full bg-[#fefcf9] border border-[#e8e2d9] text-[#7a6f65] hover:border-[#5c7f63] hover:text-[#5c7f63] transition-colors shadow-sm text-2xl leading-none"
            >
              ‹
            </button>
            <span className="text-xs font-medium text-[#b5aca4]">
              {active + 1} / {FEATURES.length}
            </span>
            <button
              onClick={next}
              aria-label="Next feature"
              className="w-11 h-11 flex items-center justify-center rounded-full bg-[#fefcf9] border border-[#e8e2d9] text-[#7a6f65] hover:border-[#5c7f63] hover:text-[#5c7f63] transition-colors shadow-sm text-2xl leading-none"
            >
              ›
            </button>
          </div>

          {/* Dot indicators */}
          <div className="flex items-center justify-center gap-2.5 mt-5">
            {FEATURES.map((f, i) => (
              <button
                key={f.id}
                onClick={() => setActive(i)}
                aria-label={`Go to ${f.label}`}
                className={`w-2.5 h-2.5 rounded-full transition-all duration-200 ${
                  i === active
                    ? "bg-[#5c7f63] scale-110"
                    : "bg-transparent border-2 border-[#c8bfb5] hover:border-[#5c7f63]"
                }`}
              />
            ))}
          </div>
        </div>

        {/* ── CTA section ──────────────────────────────────────────────────────── */}
        <div className="border-t border-[#e8e2d9] pt-14 sm:pt-16 text-center space-y-6">
          <div>
            <h2 className="text-2xl sm:text-3xl font-bold text-[#2d2926] mb-2">
              Ready to start your free account?
            </h2>
            <p className="text-[#7a6f65] max-w-lg mx-auto leading-relaxed">
              Rooted is free to start — no credit card, no time limit. Upgrade to Pro when you&apos;re ready for AI features, unlimited children, and curriculum pacing.
            </p>
          </div>

          <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
            <Link
              href="/signup"
              className="flex items-center gap-2 bg-[#5c7f63] hover:bg-[#3d5c42] text-white font-bold px-8 py-4 rounded-2xl text-base transition-colors shadow-md shadow-[#5c7f63]/20"
            >
              🌱 Start your free account →
            </Link>
            <Link
              href="/upgrade"
              className="flex items-center gap-2 bg-[#fefcf9] border-2 border-[#e8e2d9] hover:border-[#5c7f63] text-[#7a6f65] hover:text-[#5c7f63] font-semibold px-6 py-4 rounded-2xl text-sm transition-colors"
            >
              View Pro plans ✨
            </Link>
          </div>

          {/* Pricing blurb */}
          <div className="flex flex-col sm:flex-row items-center justify-center gap-4 sm:gap-8 text-sm text-[#7a6f65]">
            <div className="flex items-center gap-2">
              <span className="font-bold text-[#2d2926]">Free Forever</span>
              <span>$0 · always</span>
            </div>
            <div className="hidden sm:block text-[#e8e2d9]">·</div>
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-bold bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded-full uppercase tracking-wide">
                Limited
              </span>
              <span className="font-bold text-[#2d2926]">Founding Family</span>
              <span>$39/yr — locked forever</span>
            </div>
            <div className="hidden sm:block text-[#e8e2d9]">·</div>
            <div className="flex items-center gap-2">
              <span className="font-bold text-[#2d2926]">Standard</span>
              <span>$59/yr</span>
            </div>
          </div>

          <p className="text-xs text-[#b5aca4]">
            Secure checkout via Stripe · Cancel anytime · No surprise charges
          </p>
        </div>

      </div>

      {/* ── Footer ───────────────────────────────────────────────────────────── */}
      <footer className="border-t border-[#e8e2d9] bg-[#fefcf9] mt-8">
        <div className="max-w-5xl mx-auto px-6 py-8 flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 rounded-lg bg-[#5c7f63] flex items-center justify-center text-xs">🌿</div>
            <span className="text-sm font-bold text-[#2d2926]">Rooted Homeschool</span>
          </div>
          <div className="flex items-center gap-5">
            {[
              { label: "Home", href: "/" },
              { label: "Sign Up", href: "/signup" },
              { label: "FAQ", href: "/faq" },
              { label: "Privacy", href: "/privacy" },
              { label: "Terms", href: "/terms" },
            ].map((l) => (
              <Link key={l.href} href={l.href} className="text-xs text-[#7a6f65] hover:text-[#5c7f63] transition-colors">
                {l.label}
              </Link>
            ))}
          </div>
          <p className="text-xs text-[#b5aca4]">© 2026 Rooted Homeschool</p>
        </div>
      </footer>

    </main>
  );
}
