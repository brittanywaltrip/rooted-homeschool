"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { Check } from "lucide-react";

// ─── Feature Data (preserving best copy from original tour) ──────────────────

type FeatureId = "memories" | "today" | "plan" | "garden" | "reports" | "resources" | "insights" | "yearbook";

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
      "Share a private link with grandparents, aunts, uncles, and cousins — no app needed",
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
    headline: "See how far they've come",
    sub: "At the end of a homeschool year it's easy to wonder — did we do enough? Rooted answers that beautifully.",
    bullets: [
      "Every lesson logged becomes part of a beautiful record — print it, share it, or save it forever",
      "Share a PDF with grandparents showing exactly what your kids learned this year",
    ],
    note: "A keepsake and a progress record — all in one 🌿",
  },
  {
    id: "resources",
    label: "Resources",
    emoji: "📚",
    headline: "Curated resources, just for you",
    sub: "Free picks filtered for your state — zero prep required.",
    bullets: [
      "Free picks — textbooks, activities, and virtual field trips",
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
  {
    id: "yearbook",
    label: "Yearbook",
    emoji: "📖",
    headline: "Your family yearbook",
    sub: "Every win, quote, and book fills your yearbook automatically as you go. Add photos you love. At year-end, flip through a beautiful book — with your letter, each child\u2019s chapter and interview, and messages from family.",
    bullets: [
      "📖 Wins, quotes & books added automatically",
      "📸 Bookmark any photo to add it",
      "✍️ Each child gets their own chapter with interview Q&A",
      "💌 Family can leave messages — you approve what appears",
    ],
    note: "Builds itself all year — flip through it any time 📖",
  },
];

// ─── Mockup Components ───────────────────────────────────────────────────────

function MockupShell({ title, dot, children }: { title: string; dot: string; children: React.ReactNode }) {
  return (
    <div className="bg-[#f8f7f4] rounded-2xl overflow-hidden shadow-xl border border-[#e8e2d9] text-left select-none">
      <div className="bg-[#fefcf9] border-b border-[#e8e2d9] px-4 py-2.5 flex items-center gap-2">
        <div className="w-2 h-2 rounded-full" style={{ backgroundColor: dot }} />
        <span className="text-xs font-semibold text-[#2d2926]">{title}</span>
      </div>
      {children}
    </div>
  );
}

function TodayMockup() {
  return (
    <MockupShell title="Today" dot="#5c7f63">
      <div className="p-4 space-y-3">
        <div>
          <p className="text-[10px] text-[#b5aca4] uppercase tracking-widest">Tuesday, March 17</p>
          <p className="text-sm font-bold text-[#2d2926]">Good morning, Parker Family! 👋</p>
        </div>
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
    </MockupShell>
  );
}

function GardenMockup() {
  return (
    <MockupShell title="Garden" dot="#7a9e7e">
      <div className="relative overflow-hidden" style={{ background: "linear-gradient(180deg, #e8f4fc 0%, #93c9e8 35%, #72b8e0 65%, #c8e8d0 100%)", height: 130 }}>
        <div className="absolute top-2 right-3" style={{ width: 28, height: 28 }}>
          <div className="absolute inset-0 rounded-full" style={{ background: "#fef3c7", transform: "scale(1.8)", opacity: 0.5 }} />
          <div className="absolute inset-0 rounded-full" style={{ background: "#f9d77e" }} />
        </div>
        <span className="absolute text-sm" style={{ top: "35%", left: "42%" }}>🦋</span>
        <div className="absolute bottom-0 left-0 right-0" style={{ height: 40, background: "#a8c898", borderRadius: "60% 60% 0 0" }} />
        <div className="absolute bottom-0 left-0 right-0" style={{ height: 28, background: "#7aaa78", borderRadius: "50% 50% 0 0" }} />
        {[{ x: "28%", label: "Zoe" }, { x: "62%", label: "Emma" }].map((t) => (
          <div key={t.label} className="absolute text-center" style={{ bottom: "22%", left: t.x, transform: "translateX(-50%)" }}>
            <div style={{ fontSize: 28 }}>🌳</div>
            <span className="text-[9px] font-bold bg-white/80 px-1.5 py-0.5 rounded-full text-[#2d2926]">{t.label}</span>
          </div>
        ))}
      </div>
      <div className="p-3">
        <div className="flex items-center justify-between bg-[#e8f5ea] rounded-xl px-3 py-2">
          <div>
            <p className="text-[10px] text-[#5c7f63] font-bold uppercase tracking-widest">Parker Family · Thriving</p>
            <p className="text-xs text-[#2d2926]">200 leaves earned</p>
          </div>
          <div className="flex gap-1">
            {["⭐","🌱","🍃","🌳"].map((b) => (
              <span key={b} className="text-sm">{b}</span>
            ))}
          </div>
        </div>
      </div>
    </MockupShell>
  );
}

function ReportMockup() {
  return (
    <MockupShell title="Reports" dot="#8b6f47">
      <div className="p-4 space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-[10px] text-[#b5aca4] uppercase tracking-widest">Zoe&apos;s Progress Report</p>
            <p className="text-[10px] text-[#7a6f65]">Aug 1 – Mar 17, 2026</p>
          </div>
          <div className="flex items-center gap-1 text-[10px] bg-[#5c7f63] text-white px-2 py-1 rounded-lg">
            🖨️ Print
          </div>
        </div>
        <div className="grid grid-cols-4 gap-1.5">
          {[
            { label: "Lessons", value: "53" },
            { label: "Hours",   value: "26h" },
            { label: "Books",   value: "8" },
            { label: "Subjects",value: "4" },
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
    </MockupShell>
  );
}

function PlanMockup() {
  return (
    <MockupShell title="Plan" dot="#5c7f63">
      <div className="p-4 space-y-3">
        <div className="flex items-center justify-between">
          <p className="text-sm font-bold text-[#2d2926]">📅 Week of March 17–21</p>
          <span className="text-[10px] bg-[#e8f0e9] text-[var(--g-deep)] px-2 py-0.5 rounded-full font-semibold">Auto-scheduled ✓</span>
        </div>
        <div className="grid grid-cols-5 gap-1.5">
          {[
            { day: "Mon", items: [{ label: "Math", bg: "#e8f0e9", text: "var(--g-deep)" }, { label: "History", bg: "#fef0e4", text: "#7a4a1a" }] },
            { day: "Tue", items: [{ label: "Reading", bg: "#e4f0f4", text: "#1a4a5a" }, { label: "Science", bg: "#f0e8f4", text: "#4a2a5a" }] },
            { day: "Wed", items: [{ label: "Math", bg: "#e8f0e9", text: "var(--g-deep)" }, { label: "Writing", bg: "#fce8ec", text: "#7a2a36" }] },
            { day: "Thu", items: [{ label: "Reading", bg: "#e4f0f4", text: "#1a4a5a" }, { label: "History", bg: "#fef0e4", text: "#7a4a1a" }] },
            { day: "Fri", items: [{ label: "Math", bg: "#e8f0e9", text: "var(--g-deep)" }, { label: "Science", bg: "#f0e8f4", text: "#4a2a5a" }] },
          ].map((col) => (
            <div key={col.day} className="space-y-1.5">
              <div className="text-center text-[10px] font-bold text-[#7a6f65] uppercase tracking-wide">{col.day}</div>
              {col.items.map((item) => (
                <div key={item.label + col.day} className="rounded-lg px-1 py-2 text-[10px] font-semibold text-center leading-tight" style={{ backgroundColor: item.bg, color: item.text }}>
                  {item.label}
                </div>
              ))}
            </div>
          ))}
        </div>
        <div className="bg-[#fefcf9] border border-[#e8e2d9] rounded-xl p-3 space-y-2">
          <p className="text-[11px] font-semibold text-[#2d2926]">🌿 Finish Line — pacing this week</p>
          {[
            { label: "Math — Saxon 5/4", pct: 68 },
            { label: "All About Reading", pct: 55 },
          ].map((item) => (
            <div key={item.label} className="space-y-1">
              <span className="text-[11px] font-medium text-[#2d2926]">{item.label}</span>
              <div className="w-full bg-[#e8e2d9] rounded-full h-1.5">
                <div className="bg-[#5c7f63] h-1.5 rounded-full" style={{ width: `${item.pct}%` }} />
              </div>
            </div>
          ))}
        </div>
      </div>
    </MockupShell>
  );
}

function MemoriesMockup() {
  return (
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
        <div className="bg-[#f0f7f1] border border-[#c2dbc5] rounded-2xl px-3 py-2.5 flex items-center gap-3">
          <span className="text-xl">📖</span>
          <div>
            <p className="text-xs font-semibold text-[#2d2926]">Charlotte&apos;s Web</p>
            <p className="text-[10px] text-[#5c7f63]">Finished · March 15</p>
          </div>
        </div>
        <div className="text-center pt-1">
          <p className="text-[10px] text-[#5c7f63] font-semibold">🌿 24 memories this month</p>
        </div>
      </div>
    </div>
  );
}

function ResourcesMockup() {
  return (
    <MockupShell title="Resources" dot="#5c7f63">
      <div className="p-4 space-y-3">
        <div className="bg-[#5c7f63] rounded-xl px-3 py-2.5">
          <p className="text-[9px] font-bold text-white/70 uppercase tracking-widest mb-0.5">For Nevada Families</p>
          <p className="text-[11px] font-semibold text-white leading-tight">Resources picked for your state · Low regulation</p>
        </div>
        {[
          { name: "CK-12", desc: "Free digital textbooks", emoji: "📖" },
          { name: "Khan Academy", desc: "Free math & science", emoji: "🎓" },
          { name: "Google Arts & Culture", desc: "Virtual museum tours", emoji: "🏛️" },
        ].map((r) => (
          <div key={r.name} className="bg-[#fefcf9] border border-[#e8e2d9] rounded-xl flex items-center gap-2.5 px-3 py-2.5">
            <div className="w-8 h-8 rounded-lg bg-[#e8f0e9] flex items-center justify-center text-base shrink-0">{r.emoji}</div>
            <div className="flex-1 min-w-0">
              <p className="text-[11px] font-semibold text-[#2d2926]">{r.name}</p>
              <p className="text-[10px] text-[#7a6f65]">{r.desc}</p>
            </div>
          </div>
        ))}
      </div>
    </MockupShell>
  );
}

function InsightsMockup() {
  return (
    <MockupShell title="Insights" dot="#7a6f8a">
      <div className="p-4 space-y-3">
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
        <div className="bg-[#fefcf9] border border-[#e8e2d9] rounded-xl p-3">
          <p className="text-[11px] font-semibold text-[#2d2926] mb-3">Hours by day — this week</p>
          <div style={{ display: "flex", alignItems: "flex-end", gap: 6, height: 60 }}>
            {[
              { day: "Mon", h: 32 }, { day: "Tue", h: 42 }, { day: "Wed", h: 0 },
              { day: "Thu", h: 52 }, { day: "Fri", h: 32 }, { day: "Sat", h: 12 }, { day: "Sun", h: 0 },
            ].map(({ day, h }) => (
              <div key={day} style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "flex-end", flex: 1, height: "100%" }}>
                {h > 0 && <div style={{ width: 24, height: h, backgroundColor: "var(--g-brand)", borderRadius: "3px 3px 0 0" }} />}
                <span style={{ fontSize: 8, color: "#7a6f65", marginTop: 3 }}>{day}</span>
              </div>
            ))}
          </div>
        </div>
        <div className="bg-gradient-to-r from-[#fef9e8] to-[#fef6d8] border border-[#f0e4b0] rounded-xl px-3 py-2 flex items-center gap-2">
          <span className="text-base">🌟</span>
          <p className="text-[10px] text-[#7a5a10] font-medium">5 out of 7 days — you&apos;re building a real rhythm!</p>
        </div>
      </div>
    </MockupShell>
  );
}

function YearbookMockup() {
  return (
    <MockupShell title="Family Yearbook" dot="var(--g-deep)">
      <div className="space-y-3">
        {/* Cover card */}
        <div className="rounded-xl overflow-hidden" style={{ background: "var(--g-deep)" }}>
          <div className="px-3 py-2.5 relative">
            <span className="absolute top-0 right-1 text-[28px] opacity-[0.08] select-none">🌿</span>
            <p className="text-[12px] font-bold text-white relative z-10" style={{ fontFamily: "var(--font-display)" }}>The Parker Family</p>
            <p className="text-[8px] text-[rgba(254, 252, 249, 0.55)] uppercase tracking-wider">2025-26 school year</p>
          </div>
          <div className="bg-[#faf6f0] px-3 py-2 flex justify-between text-center">
            {[
              { n: "12", l: "Photos" },
              { n: "5", l: "Books" },
              { n: "8", l: "Wins" },
              { n: "3", l: "Quotes" },
            ].map((s) => (
              <div key={s.l}>
                <p className="text-[13px] font-bold text-[var(--g-deep)]">{s.n}</p>
                <p className="text-[7px] text-[#9a8f85]">{s.l}</p>
              </div>
            ))}
          </div>
        </div>
        {/* Chapter preview */}
        <div className="bg-[#fefcf9] rounded-xl border border-[#e8e2d9] p-3">
          <div className="flex items-center gap-2 mb-2">
            <div className="w-4 h-4 rounded-full bg-[#e88da0]" />
            <p className="text-[11px] font-bold text-[#2d2926]">Emma&apos;s year</p>
            <span className="text-[8px] text-[#b5aca4]">8 memories</span>
          </div>
          <div className="grid grid-cols-3 gap-1">
            {["🏆", "📖", "📸"].map((e, i) => (
              <div key={i} className="aspect-square rounded bg-[#eaf3de] flex items-center justify-center text-lg">{e}</div>
            ))}
          </div>
        </div>
        {/* Progress */}
        <div>
          <div className="flex justify-between text-[8px] text-[#9a8f85] mb-1">
            <span>Pages filling up</span>
            <span>12 of 17 sections</span>
          </div>
          <div className="h-1 bg-[#e8e3dc] rounded-full overflow-hidden">
            <div className="h-full bg-[var(--g-deep)] rounded-full" style={{ width: "70%" }} />
          </div>
        </div>
      </div>
    </MockupShell>
  );
}

const MOCKUPS: Record<FeatureId, () => React.JSX.Element> = {
  today: TodayMockup,
  plan: PlanMockup,
  garden: GardenMockup,
  reports: ReportMockup,
  memories: () => <MemoriesMockup />,
  resources: ResourcesMockup,
  insights: InsightsMockup,
  yearbook: YearbookMockup,
};

// ─── Page ────────────────────────────────────────────────────────────────────

export default function TourPage() {
  const [scrolled, setScrolled] = useState(false);
  const [active, setActive] = useState(0);
  const [paused, setPaused] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 10);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    if (paused) return;
    const id = setInterval(() => setActive((i) => (i + 1) % FEATURES.length), 5000);
    return () => clearInterval(id);
  }, [paused]);

  const prev = () => setActive((i) => (i - 1 + FEATURES.length) % FEATURES.length);
  const next = () => setActive((i) => (i + 1) % FEATURES.length);

  const feature = FEATURES[active];
  const MockupComponent = MOCKUPS[feature.id];

  return (
    <main className="min-h-screen bg-[#f8f7f4] text-[#2d2926] overflow-x-hidden">

      {/* ── Animations ─────────────────────────────────────────────────────────── */}
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
        @keyframes carouselFade {
          from { opacity: 0; transform: translateY(10px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        .anim-fade-in-up { animation: fadeInUp 0.75s cubic-bezier(0.2, 0.6, 0.3, 1) both; }
        .anim-fade-in    { animation: fadeIn 0.75s ease-out both; }
        .delay-150 { animation-delay: 150ms; }
        .delay-300 { animation-delay: 300ms; }
        .delay-450 { animation-delay: 450ms; }
        .delay-600 { animation-delay: 600ms; }
        .scroll-bounce { animation: scrollBounce 1.8s ease-in-out infinite; }
        .carousel-slide { animation: carouselFade 0.35s ease-out; }
      `}</style>

      {/* ── Nav (matching homepage exactly) ────────────────────────────────────── */}
      <header
        className={`sticky top-0 z-50 backdrop-blur-md border-b border-[#e8e2d9] transition-all duration-300 ${
          scrolled ? "shadow-md shadow-black/[0.06]" : "shadow-none"
        }`}
        style={{ backgroundColor: "rgba(248, 247, 244, 0.94)" }}
      >
        <nav className="max-w-6xl mx-auto px-5 sm:px-8 py-4 flex items-center justify-between">
          <Link href="/" className="flex items-center shrink-0">
            <img src="/rooted-logo-nav.png" alt="Rooted" style={{ height: '36px', width: 'auto' }} />
          </Link>
          <div className="flex items-center gap-2">
            <Link href="/login" className="hidden sm:inline-flex text-sm font-medium text-[#7a6f65] hover:text-[#2d2926] transition-colors px-3 py-2 rounded-lg hover:bg-[#f0ede8]">
              Log In
            </Link>
            <Link href="/signup" className="inline-flex items-center gap-1.5 text-sm font-semibold bg-[#5c7f63] hover:bg-[var(--g-deep)] text-white px-5 py-2.5 rounded-xl transition-colors shadow-sm">
              Start Free Trial
              <svg width="11" height="11" viewBox="0 0 11 11" fill="none" aria-hidden="true">
                <path d="M1.5 5.5h8M5.5 1.5l4 4-4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </Link>
          </div>
        </nav>
      </header>

      {/* ── Hero (dark forest background matching homepage) ─────────────────── */}
      <section
        className="relative flex flex-col items-center justify-center text-center px-6 py-24 sm:py-28 min-h-[70vh] overflow-hidden"
        style={{ background: "linear-gradient(175deg, #0d2818 0%, #1a4a28 20%, #3d7a4a 45%, #4a8a55 65%, #2d5c35 85%, #1a3a22 100%)" }}
      >
        {/* Forest background elements */}
        <div className="absolute inset-0 overflow-hidden pointer-events-none" aria-hidden="true">
          {[
            { top: "15%", left: "8%", size: 2.5, delay: "0s" },
            { top: "25%", left: "18%", size: 1.5, delay: "0.5s" },
            { top: "10%", left: "35%", size: 2, delay: "1s" },
            { top: "20%", left: "55%", size: 1.5, delay: "0.3s" },
            { top: "12%", left: "72%", size: 2.5, delay: "0.8s" },
            { top: "30%", left: "88%", size: 1.5, delay: "0.2s" },
          ].map((s, i) => (
            <div key={i} className="absolute rounded-full bg-white" style={{ top: s.top, left: s.left, width: s.size, height: s.size, opacity: 0.25, animation: `pulse ${2 + i * 0.3}s ease-in-out infinite`, animationDelay: s.delay }} />
          ))}
          <svg className="absolute bottom-0 left-[-2%] h-[85%] w-auto opacity-40" viewBox="0 0 160 500" fill="none">
            <rect x="72" y="400" width="16" height="100" fill="#3d2010"/>
            <polygon points="80,20 20,180 140,180" fill="#1a4a20"/>
            <polygon points="80,80 15,240 145,240" fill="#1e5a25"/>
            <polygon points="80,150 10,300 150,300" fill="#245e2a"/>
            <polygon points="80,220 5,360 155,360" fill="#2a6830"/>
            <polygon points="80,300 0,420 160,420" fill="#306838"/>
          </svg>
          <svg className="absolute bottom-0 right-[-2%] h-[75%] w-auto opacity-35" viewBox="0 0 140 500" fill="none">
            <rect x="62" y="400" width="16" height="100" fill="#3d2010"/>
            <polygon points="70,30 18,170 122,170" fill="#0d2818"/>
            <polygon points="70,90 12,230 128,230" fill="#162a1e"/>
            <polygon points="70,160 8,285 132,285" fill="#1e3828"/>
            <polygon points="70,230 4,340 136,340" fill="#243e2e"/>
            <polygon points="70,305 0,400 140,400" fill="#2a4835"/>
          </svg>
          <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[600px] h-[400px] opacity-25 rounded-full" style={{ background: "radial-gradient(ellipse at center, rgba(180,220,160,0.5) 0%, transparent 70%)" }}/>
          <div className="absolute bottom-0 left-0 right-0 h-32" style={{ background: "linear-gradient(to top, rgba(45,100,50,0.4) 0%, transparent 100%)" }}/>
          <div className="absolute bottom-0 left-0 right-0 h-16" style={{ background: "linear-gradient(to top, #0d2010 0%, transparent 100%)" }}/>
        </div>
        <div className="absolute inset-0 pointer-events-none" style={{ background: "radial-gradient(ellipse at center, transparent 35%, rgba(0,0,0,0.35) 100%)" }} aria-hidden="true"/>

        <div className="relative z-10 flex flex-col items-center max-w-3xl">
          <h1 className="anim-fade-in-up delay-150 text-4xl sm:text-5xl lg:text-6xl font-bold leading-[1.08] mb-6 text-white" style={{ fontFamily: "var(--font-display)", textShadow: "0 2px 32px rgba(0,0,0,0.4)", letterSpacing: "-0.02em" }}>
            See Rooted{" "}
            <em className="not-italic" style={{ color: "#86c98a" }}>in Action</em>
          </h1>
          <p className="anim-fade-in-up delay-300 text-base sm:text-lg text-white/78 mb-10 leading-relaxed max-w-[36rem]" style={{ textShadow: "0 1px 12px rgba(0,0,0,0.3)" }}>
            Not a curriculum. A planning and memory tool that works alongside the one you already love.
            Plan your days, capture memories, and actually see how far your kids have come.
          </p>
          <div className="anim-fade-in-up delay-450 flex flex-col sm:flex-row gap-3 mb-8 w-full sm:w-auto">
            <Link href="/signup" className="inline-flex items-center justify-center gap-2 bg-white text-[var(--g-deep)] hover:bg-[#f0f9f1] font-bold px-8 py-4 rounded-xl transition-all text-base" style={{ boxShadow: "0 0 0 1px rgba(255,255,255,0.15), 0 8px 32px rgba(0,0,0,0.35)" }}>
              Start Your Free Trial →
            </Link>
            <a href="#walkthrough" className="inline-flex items-center justify-center gap-2 text-white hover:bg-white/12 font-semibold px-8 py-4 rounded-xl transition-all text-base" style={{ border: "1px solid rgba(255,255,255,0.35)", background: "rgba(255,255,255,0.06)" }}>
              Explore Features ↓
            </a>
          </div>
          <p className="anim-fade-in delay-600 text-white/65 text-sm flex items-center gap-2">
            <span>🌱</span> Built for homeschool families like yours
          </p>
        </div>

        <div className="scroll-bounce absolute bottom-8 left-1/2 text-white/40" aria-hidden="true">
          <svg width="22" height="22" viewBox="0 0 22 22" fill="none">
            <path d="M11 4v14M4 12l7 7 7-7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </div>
      </section>

      {/* ── Feature Walkthrough Carousel ───────────────────────────────────── */}
      <section id="walkthrough" className="px-6 sm:px-8 py-20 max-w-6xl mx-auto">
        <div className="text-center mb-14">
          <p className="text-xs font-semibold uppercase tracking-widest text-[#b5aca4] mb-3">
            Interactive Tour
          </p>
          <h2 className="text-3xl sm:text-4xl font-bold text-[#2d2926]" style={{ fontFamily: "var(--font-display)" }}>
            Built for how you actually homeschool
          </h2>
        </div>

        {/* Tab buttons */}
        <div className="flex flex-wrap items-center justify-center gap-2 mb-10">
          {FEATURES.map((f, i) => (
            <button
              key={f.id}
              onClick={() => { setActive(i); setPaused(true); }}
              className={`px-3.5 py-2 rounded-xl text-sm font-medium transition-all ${
                i === active
                  ? "bg-[#5c7f63] text-white shadow-sm"
                  : "bg-[#fefcf9] border border-[#e8e2d9] text-[#7a6f65] hover:border-[#5c7f63] hover:text-[#5c7f63]"
              }`}
            >
              {f.emoji} {f.label}
            </button>
          ))}
        </div>

        {/* Carousel */}
        <div
          onMouseEnter={() => setPaused(true)}
          onMouseLeave={() => setPaused(false)}
          className="relative"
        >
          <button onClick={prev} aria-label="Previous" className="hidden lg:flex absolute -left-14 top-1/2 -translate-y-1/2 w-11 h-11 items-center justify-center rounded-full bg-[#fefcf9] border border-[#e8e2d9] text-[#7a6f65] hover:border-[#5c7f63] hover:text-[#5c7f63] transition-colors shadow-sm z-10 text-2xl leading-none">
            ‹
          </button>

          <div key={active} className="carousel-slide grid grid-cols-1 lg:grid-cols-5 gap-8 lg:gap-10 items-start">
            {/* Mockup */}
            <div className="lg:col-span-3 order-2 lg:order-1">
              <MockupComponent />
            </div>

            {/* Description */}
            <div className="lg:col-span-2 order-1 lg:order-2 space-y-5">
              <div>
                <p className="text-xs font-semibold uppercase tracking-widest text-[#5c7f63] mb-1.5">
                  {feature.emoji} {feature.label}
                </p>
                <h2 className="text-2xl sm:text-3xl font-bold text-[#2d2926] leading-tight mb-2" style={{ fontFamily: "var(--font-display)" }}>
                  {feature.headline}
                </h2>
                <p className="text-[#7a6f65] leading-relaxed">{feature.sub}</p>
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

              <div className="bg-[#fefcf9] border border-[#e8e2d9] rounded-xl px-4 py-3 flex items-center gap-2.5">
                <span className="text-base shrink-0">💡</span>
                <p className="text-sm text-[#5c7f63] font-medium">{feature.note}</p>
              </div>

              {/* Curriculum tags in Plan tab */}
              {feature.id === "plan" && (
                <div className="flex flex-wrap gap-2">
                  {["Charlotte Mason", "The Good and the Beautiful", "Classical", "Sonlight", "Unit Studies", "Unschooling", "Any approach ✨"].map((c) => (
                    <span key={c} className="text-xs bg-[#e8f0e9] text-[#5c7f63] px-3 py-1.5 rounded-full border border-[#c2dbc5] font-medium">
                      {c}
                    </span>
                  ))}
                </div>
              )}

              <Link href="/signup" className="inline-flex items-center gap-2 bg-[#5c7f63] hover:bg-[var(--g-deep)] text-white text-sm font-semibold px-5 py-3 rounded-xl transition-colors shadow-sm">
                Try {feature.label} free →
              </Link>
            </div>
          </div>

          <button onClick={next} aria-label="Next" className="hidden lg:flex absolute -right-14 top-1/2 -translate-y-1/2 w-11 h-11 items-center justify-center rounded-full bg-[#fefcf9] border border-[#e8e2d9] text-[#7a6f65] hover:border-[#5c7f63] hover:text-[#5c7f63] transition-colors shadow-sm z-10 text-2xl leading-none">
            ›
          </button>

          {/* Mobile arrows */}
          <div className="flex lg:hidden items-center justify-center gap-6 mt-8">
            <button onClick={prev} aria-label="Previous" className="w-11 h-11 flex items-center justify-center rounded-full bg-[#fefcf9] border border-[#e8e2d9] text-[#7a6f65] hover:border-[#5c7f63] transition-colors text-2xl leading-none">‹</button>
            <span className="text-xs font-medium text-[#b5aca4]">{active + 1} / {FEATURES.length}</span>
            <button onClick={next} aria-label="Next" className="w-11 h-11 flex items-center justify-center rounded-full bg-[#fefcf9] border border-[#e8e2d9] text-[#7a6f65] hover:border-[#5c7f63] transition-colors text-2xl leading-none">›</button>
          </div>

          {/* Dot indicators */}
          <div className="flex items-center justify-center gap-2.5 mt-5">
            {FEATURES.map((f, i) => (
              <button key={f.id} onClick={() => setActive(i)} aria-label={`Go to ${f.label}`}
                className={`w-2.5 h-2.5 rounded-full transition-all duration-200 ${
                  i === active ? "bg-[#5c7f63] scale-110" : "bg-transparent border-2 border-[#c8bfb5] hover:border-[#5c7f63]"
                }`}
              />
            ))}
          </div>
        </div>
      </section>

      {/* ── Memories Deep-Dive ──────────────────────────────────────────────── */}
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
              <h2 className="text-3xl sm:text-4xl font-bold text-[#2d2926] mb-5 leading-snug" style={{ fontFamily: "var(--font-display)" }}>
                These years go by so fast.{" "}
                <em className="not-italic" style={{ color: "#5c7f63" }}>Hold onto them.</em>
              </h2>
              <p className="text-[#7a6f65] leading-relaxed mb-6 text-base">
                Between the lessons, the field trips, the little things they said that made you laugh — so much gets forgotten. Rooted gives you a beautiful, simple place to save it all. It takes 10 seconds.
              </p>
              <ul className="space-y-4 mb-8">
                {[
                  { emoji: "📸", title: "Photos from your day", desc: "Snap and save moments as they happen — field trips, projects, backyard science." },
                  { emoji: "✍️", title: "Little notes & quotes", desc: "Write down what they said, what clicked, what made them proud. You'll want these later." },
                  { emoji: "📖", title: "Books they loved", desc: "Build a reading log automatically as you go. A record of their whole reading life." },
                  { emoji: "🌿", title: "Look back and see it", desc: "Your whole homeschool journey, month by month. Proof you're doing something beautiful." },
                ].map((item) => (
                  <li key={item.title} className="flex gap-4 items-start">
                    <div className="w-9 h-9 rounded-xl bg-[#e8f0e9] flex items-center justify-center text-lg shrink-0 mt-0.5">{item.emoji}</div>
                    <div>
                      <p className="font-semibold text-[#2d2926] text-sm mb-0.5">{item.title}</p>
                      <p className="text-xs text-[#7a6f65] leading-relaxed">{item.desc}</p>
                    </div>
                  </li>
                ))}
              </ul>
              <Link href="/signup" className="inline-flex items-center gap-2 bg-[#5c7f63] hover:bg-[var(--g-deep)] text-white font-semibold px-7 py-3.5 rounded-xl transition-colors text-sm shadow-sm">
                Start capturing memories →
              </Link>
            </div>
            <div className="flex justify-center lg:justify-end">
              <MemoriesMockup />
            </div>
          </div>
        </div>
      </section>

      {/* ── Reports Deep-Dive ──────────────────────────────────────────────── */}
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
                </div>
              </div>
            </div>

            <div className="order-1 lg:order-2">
              <p className="text-xs font-semibold uppercase tracking-widest text-[#b5aca4] mb-3">
                Your family&apos;s story, beautifully documented
              </p>
              <h2 className="text-3xl sm:text-4xl font-bold text-[#2d2926] mb-5 leading-snug" style={{ fontFamily: "var(--font-display)" }}>
                See how far they&apos;ve come.
              </h2>
              <p className="text-[#7a6f65] leading-relaxed mb-6 text-base">
                At the end of a homeschool year it&apos;s easy to wonder — did we do enough? Rooted answers that question beautifully. Every lesson, every book, every subject — all in one place you can print, share, or save forever.
              </p>
              <ul className="space-y-4 mb-8">
                {[
                  { emoji: "📸", title: "A yearbook, not just a document", desc: "Every lesson, win, book, and photo becomes a page in your family yearbook — a living record of their whole learning life." },
                  { emoji: "👵", title: "Share with your whole family", desc: "Send a private link to grandparents, aunts, uncles — anyone you choose. No app download needed." },
                  { emoji: "📋", title: "Print or save as PDF", desc: "Clean, professional layout. One click to generate, one click to print or download." },
                ].map((item) => (
                  <li key={item.title} className="flex gap-4 items-start">
                    <div className="w-9 h-9 rounded-xl bg-[#f5ede0] flex items-center justify-center text-lg shrink-0 mt-0.5">{item.emoji}</div>
                    <div>
                      <p className="font-semibold text-[#2d2926] text-sm mb-0.5">{item.title}</p>
                      <p className="text-xs text-[#7a6f65] leading-relaxed">{item.desc}</p>
                    </div>
                  </li>
                ))}
              </ul>
              <Link href="/signup" className="inline-flex items-center gap-2 border-2 border-[#5c7f63] text-[#5c7f63] hover:bg-[#e8f0e9] font-semibold px-7 py-3.5 rounded-xl transition-colors text-sm">
                Try Everything Free for 30 Days →
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* ── Founder Quote ──────────────────────────────────────────────────── */}
      <section className="bg-[#fefcf9] border-y border-[#e8e2d9]">
        <div className="max-w-2xl mx-auto px-6 sm:px-8 py-20 text-center">
          <div className="w-12 h-12 rounded-2xl bg-[#5c7f63] flex items-center justify-center text-2xl mx-auto mb-8 shadow-sm" aria-hidden="true">
            🌿
          </div>
          <div className="text-[3.5rem] leading-none select-none text-[#d4ead6] mb-2" style={{ fontFamily: "var(--font-display)", lineHeight: 0.85 }} aria-hidden="true">
            &ldquo;
          </div>
          <p className="text-xl sm:text-2xl text-[#2d2926] leading-relaxed italic mb-8" style={{ fontFamily: "var(--font-display)" }}>
            I built Rooted for families like mine. I hope it brings your homeschool a little more calm and a lot more joy.
          </p>
          <p className="text-sm font-semibold text-[#5c7f63]">
            — Brittany W., homeschool mom of 2
          </p>
        </div>
      </section>

      {/* ── Final CTA ──────────────────────────────────────────────────────── */}
      <section className="px-6 sm:px-8 py-20">
        <div
          className="max-w-2xl mx-auto rounded-3xl px-8 py-14 sm:px-14 text-center relative overflow-hidden"
          style={{
            background: "linear-gradient(135deg, #d0ebd4 0%, #e0f2e4 35%, #c8e8cf 70%, #b8dfc0 100%)",
            border: "1px solid #aed4b5",
          }}
        >
          <span className="absolute top-5 left-5 text-[5rem] opacity-[0.10] select-none pointer-events-none leading-none" aria-hidden="true">🌿</span>
          <span className="absolute bottom-5 right-6 text-[4.5rem] opacity-[0.10] select-none pointer-events-none leading-none" style={{ transform: "scaleX(-1) rotate(20deg)" }} aria-hidden="true">🌿</span>
          <span className="absolute top-1/2 right-5 -translate-y-1/2 text-4xl opacity-[0.07] select-none pointer-events-none leading-none" style={{ transform: "translateY(-50%) rotate(-15deg)" }} aria-hidden="true">🍃</span>
          <span className="absolute top-1/2 left-5 -translate-y-1/2 text-3xl opacity-[0.07] select-none pointer-events-none leading-none" style={{ transform: "translateY(-50%) rotate(15deg)" }} aria-hidden="true">🍃</span>

          <div className="relative z-10">
            <div className="text-5xl mb-5">🌱</div>
            <h2 className="text-2xl sm:text-3xl font-bold text-[#2d2926] mb-3" style={{ fontFamily: "var(--font-display)" }}>
              Start your homeschool journey today
            </h2>
            <p className="text-[var(--g-deep)] font-medium mb-8 leading-relaxed max-w-sm mx-auto">
              Try everything free for 30 days. No credit card needed. Join families already using Rooted.
            </p>
            <Link href="/signup" className="inline-block bg-[#5c7f63] hover:bg-[#4a6b50] text-white font-semibold px-8 py-3 rounded-full transition-colors">
              Start Your Free Trial →
            </Link>
            <p className="mt-4">
              <Link href="/upgrade" className="text-sm text-[var(--g-deep)] hover:underline font-medium">
                View plans →
              </Link>
            </p>
          </div>
        </div>
      </section>

      {/* ── Footer (matching homepage) ─────────────────────────────────────── */}
      <footer className="bg-[#fefcf9] border-t border-[#e8e2d9]">
        <div className="max-w-5xl mx-auto px-6 sm:px-8 py-12">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-8 items-start">
            <div className="flex flex-col items-center sm:items-start gap-2">
              <div className="flex items-center gap-2">
                <div className="w-7 h-7 rounded-lg bg-[#5c7f63] flex items-center justify-center text-sm">🌿</div>
                <span className="font-bold text-[#2d2926] text-base" style={{ fontFamily: "var(--font-display)" }}>
                  Rooted
                </span>
              </div>
              <p className="text-xs text-[#b5aca4] leading-relaxed">A calm companion for intentional families.</p>
              <p className="text-[11px] text-[#c8bfb5]">rootedhomeschoolapp.com</p>
            </div>

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
              <a href="https://instagram.com/rootedhomeschool" target="_blank" rel="noopener noreferrer" className="text-xs text-[#7a6f65] hover:text-[#5c7f63] transition-colors flex items-center gap-1">
                📸 Instagram
              </a>
              <a href="https://facebook.com/rootedhomeschool" target="_blank" rel="noopener noreferrer" className="text-xs text-[#7a6f65] hover:text-[#5c7f63] transition-colors flex items-center gap-1">
                👥 Facebook
              </a>
              <a href="https://pinterest.com/hellorootedapp" target="_blank" rel="noopener noreferrer" className="text-xs text-[#7a6f65] hover:text-[#5c7f63] transition-colors flex items-center gap-1">
                📌 Pinterest
              </a>
            </div>

            <div className="text-center sm:text-right space-y-1">
              <p className="text-xs text-[#b5aca4]">© {new Date().getFullYear()} Rooted</p>
              <p className="text-xs text-[#c8bfb5]">Made with care for learning families</p>
            </div>
          </div>
        </div>
      </footer>

    </main>
  );
}
