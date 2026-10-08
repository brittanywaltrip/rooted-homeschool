"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { Check } from "lucide-react";
import { useIsNativeApp } from "@/lib/platform";
import { GROWTH_STAGES, getGrowthStage } from "@/app/lib/garden-stages";
import { TOUR_FEATURES as FEATURES, type FeatureId } from "./features";

// These are illustrative examples, not screenshots or connected family data.
function MockupShell({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <figure className="bg-[var(--background)] rounded-2xl overflow-hidden shadow-xl border border-[var(--color-warm-border)] text-left">
      <div className="bg-[var(--color-warm-card)] border-b border-[var(--color-warm-border)] px-4 py-3 flex items-center gap-2">
        <div className="w-2 h-2 rounded-full bg-[var(--g-accent)]" aria-hidden="true" />
        <span className="text-sm font-medium text-[var(--foreground)]">{title}</span>
      </div>
      <div className="p-4 sm:p-5 space-y-3">{children}</div>
      <figcaption className="border-t border-[var(--color-warm-border)] px-4 py-3 text-xs text-[var(--color-text-muted)]">
        Illustrative preview with fictional details. The app layout may differ.
      </figcaption>
    </figure>
  );
}

function PreviewCard({ title, detail, emoji }: { title: string; detail: string; emoji: string }) {
  return (
    <div className="bg-[var(--color-warm-card)] border border-[var(--color-warm-border)] rounded-xl flex items-start gap-3 px-3 py-3">
      <span className="text-xl shrink-0" aria-hidden="true">{emoji}</span>
      <div className="min-w-0">
        <p className="text-sm font-medium text-[var(--foreground)]">{title}</p>
        <p className="text-xs text-[var(--color-text-muted)] mt-1 leading-relaxed">{detail}</p>
      </div>
    </div>
  );
}

function TodayMockup() {
  return (
    <MockupShell title="Today">
      <p className="text-sm text-[var(--color-text-muted)]">Tuesday, October 6 · Emma&apos;s day</p>
      <PreviewCard emoji="✓" title="Math · Lesson 18" detail="Completed · 30 minutes recorded" />
      <PreviewCard emoji="📖" title="Reading · Chapter 5" detail="Ready when you are" />
      <div className="rounded-xl bg-[#e8f0e9] p-4">
        <p className="text-sm font-medium text-[var(--g-brand)]">How long did you spend?</p>
        <div className="flex flex-wrap gap-2 mt-3" aria-label="Example minute choices">
          {[15, 30, 45, 60].map((minutes) => (
            <span key={minutes} className={`rounded-lg px-3 py-2 text-xs ${minutes === 30 ? "bg-[var(--g-accent)] text-white" : "bg-white text-[#5c5248]"}`}>{minutes} min</span>
          ))}
        </div>
        <p className="text-xs text-[#5c5248] mt-3">Confirm the time that fits your lesson.</p>
      </div>
    </MockupShell>
  );
}

function PlanMockup() {
  return (
    <MockupShell title="Plan">
      <p className="text-sm font-medium text-[var(--foreground)]">Schedule builder · Math</p>
      <dl className="grid grid-cols-2 gap-3 text-sm rounded-xl bg-white border border-[var(--color-warm-border)] p-3">
        {[
          ["School days", "Mon, Wed, Fri"],
          ["Lessons a day", "1"],
          ["Total lessons", "120"],
          ["Next lesson", "18"],
        ].map(([label, value]) => (
          <div key={label}><dt className="text-xs text-[var(--color-text-muted)]">{label}</dt><dd className="mt-1 text-[var(--foreground)]">{value}</dd></div>
        ))}
      </dl>
      <PreviewCard emoji="📅" title="Plan this week" detail="Choose your own lessons and the days to do them." />
      <PreviewCard emoji="🌿" title="A change of plans" detail="Move a lesson, add a break, or shift unfinished manually planned days." />
    </MockupShell>
  );
}

function GardenMockup() {
  const leaves = 31;
  const stage = getGrowthStage(leaves);
  return (
    <MockupShell title="Garden">
      <div className="text-center rounded-xl py-5 bg-gradient-to-b from-[#e8f4fc] to-[#d4ead6]">
        <span className="text-5xl" aria-hidden="true">{stage.emoji}</span>
        <p className="text-sm font-medium text-[var(--g-brand)] mt-3">Emma · {stage.name}</p>
        <p className="text-xs text-[#5c5248] mt-1">{leaves} leaves this school year</p>
      </div>
      <ol className="grid grid-cols-2 gap-2">
        {GROWTH_STAGES.map((growth) => (
          <li key={growth.name} className="rounded-lg bg-white px-2.5 py-2 text-xs text-[#5c5248]">
            <span aria-hidden="true">{growth.emoji}</span> {growth.name} · {growth.min}
          </li>
        ))}
      </ol>
    </MockupShell>
  );
}

function MemoriesMockup() {
  return (
    <MockupShell title="Memories">
      <div className="rounded-xl overflow-hidden border border-[var(--color-warm-border)] bg-white">
        <div className="h-28 flex items-center justify-center text-4xl bg-gradient-to-br from-[#c8e8d0] to-[#a8d4b8]" aria-hidden="true">🦋</div>
        <div className="px-3 py-3">
          <p className="text-sm font-medium text-[var(--foreground)]">Backyard butterfly watching</p>
          <p className="text-xs text-[var(--color-text-muted)] mt-1">Emma · October 6</p>
        </div>
      </div>
      <div className="bg-[#fef9f0] border border-[#f0d090] rounded-xl p-3">
        <p className="text-xs text-[#8b6f47] mb-2">A little thing she said</p>
        <p className="text-sm text-[var(--foreground)] italic">&ldquo;Do butterflies remember being caterpillars?&rdquo;</p>
      </div>
      <PreviewCard emoji="📖" title="Charlotte's Web" detail="A finished book to remember" />
    </MockupShell>
  );
}

function PrintablesMockup() {
  return (
    <MockupShell title="Printables">
      <div className="rounded-xl border-4 border-double border-[#c2dbc5] bg-[var(--color-warm-card)] p-5 text-center">
        <span className="text-3xl" aria-hidden="true">🌿</span>
        <p className="text-lg text-[var(--g-brand)] mt-2" style={{ fontFamily: "var(--font-display)" }}>Reading achievement</p>
        <p className="text-sm text-[#5c5248] mt-2">Celebrating Emma&apos;s love of books</p>
      </div>
      <PreviewCard emoji="🪪" title="Homeschool ID cards" detail="Add a photo for your parent or student card." />
      <PreviewCard emoji="🗓️" title="Year planner & photo frames" detail="Make room for the year's plans and favorite moments." />
    </MockupShell>
  );
}

function YearbookMockup() {
  return (
    <MockupShell title="Yearbook reader">
      <div className="rounded-xl bg-[var(--g-brand)] px-5 py-6 text-center">
        <p className="text-xl text-white" style={{ fontFamily: "var(--font-display)" }}>The Parker family</p>
        <p className="text-sm text-white/80 mt-2">2026-2027</p>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div className="rounded-xl border border-[var(--color-warm-border)] bg-[var(--color-warm-card)] p-3">
          <p className="text-sm text-[var(--g-brand)]" style={{ fontFamily: "var(--font-display)" }}>A letter from home</p>
          <p className="text-xs text-[var(--color-text-muted)] mt-3 leading-relaxed">This year, we learned to slow down and notice the little things.</p>
        </div>
        <div className="rounded-xl border border-[var(--color-warm-border)] bg-[var(--color-warm-card)] p-3">
          <p className="text-sm text-[var(--g-brand)]" style={{ fontFamily: "var(--font-display)" }}>Emma&apos;s year</p>
          <div className="rounded-lg bg-[#e8f0e9] py-4 mt-3 text-center text-3xl" aria-hidden="true">🦋</div>
          <p className="text-xs text-[var(--color-text-muted)] mt-2">Backyard butterflies · October 6</p>
        </div>
      </div>
      <p className="text-xs text-[var(--color-text-muted)]">Personalize the cover and sections in Customize.</p>
    </MockupShell>
  );
}

function ReportMockup() {
  return (
    <MockupShell title="Reports">
      <p className="text-sm font-medium text-[var(--foreground)]">Hours &amp; Attendance Log</p>
      <p className="text-xs text-[var(--color-text-muted)]">Emma · October 6, 2026</p>
      <div className="grid grid-cols-2 gap-2">
        {[{ label: "Recorded hours", value: "1h 15m" }, { label: "Days of learning", value: "1" }].map((item) => (
          <div key={item.label} className="rounded-xl bg-[#e8f0e9] p-3">
            <p className="text-lg font-medium text-[var(--g-brand)]">{item.value}</p>
            <p className="text-xs text-[#5c5248]">{item.label}</p>
          </div>
        ))}
      </div>
      <PreviewCard emoji="✓" title="Math · Lesson 18" detail="30 minutes" />
      <PreviewCard emoji="✓" title="Reading · Chapter 5" detail="45 minutes" />
      <PreviewCard emoji="📖" title="Reading Log" detail="Charlotte's Web · Finished October 6" />
    </MockupShell>
  );
}

function TranscriptsMockup() {
  return (
    <MockupShell title="Transcripts">
      <p className="text-sm font-medium text-[var(--foreground)]">Alex · High school transcript</p>
      <p className="text-xs text-[var(--color-text-muted)]">2025-2026 · Graded courses</p>
      <PreviewCard emoji="📐" title="Algebra I" detail="1.0 credit · A" />
      <PreviewCard emoji="📚" title="English I" detail="1.0 credit · B" />
      <div className="flex flex-wrap justify-between gap-2 rounded-xl bg-[#e8f0e9] p-3 text-sm text-[var(--g-brand)]">
        <span>Credits: 2.0</span><span>Unweighted GPA: 3.50</span>
      </div>
      <p className="text-xs text-[var(--color-text-muted)]">Add grades and credits, then review before exporting.</p>
    </MockupShell>
  );
}

function YearsMockup() {
  return (
    <MockupShell title="Years">
      <PreviewCard emoji="🌱" title="2026-2027 · Current year" detail="August 1, 2026 to May 31, 2027" />
      <PreviewCard emoji="🌸" title="2025-2026 · Closed year" detail="Revisit the year's keepsake and finished trees." />
      <PreviewCard emoji="🗂️" title="Add a past year" detail="Bring earlier homeschooling into your records." />
    </MockupShell>
  );
}

function ResourcesMockup() {
  return (
    <MockupShell title="Resources">
      <PreviewCard emoji="🌿" title="Today's Easy Win" detail="An idea for a little learning together." />
      <PreviewCard emoji="📚" title="Free Picks & categories" detail="Browse curriculum, activities, field trips, and more." />
      <PreviewCard emoji="🔖" title="Saved resources" detail="Keep the finds you'd like to revisit." />
      <PreviewCard emoji="🗺️" title="By State" detail="A separate place to start learning about your state's requirements." />
    </MockupShell>
  );
}

const MOCKUPS: Record<FeatureId, () => React.JSX.Element> = {
  today: TodayMockup,
  plan: PlanMockup,
  garden: GardenMockup,
  reports: ReportMockup,
  memories: MemoriesMockup,
  printables: PrintablesMockup,
  resources: ResourcesMockup,
  yearbook: YearbookMockup,
  transcripts: TranscriptsMockup,
  years: YearsMockup,
};

// ─── Page ────────────────────────────────────────────────────────────────────

export default function TourPage() {
  const isNative = useIsNativeApp();
  const [scrolled, setScrolled] = useState(false);
  const [active, setActive] = useState(0);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 10);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  const prev = () => setActive((i) => (i - 1 + FEATURES.length) % FEATURES.length);
  const next = () => setActive((i) => (i + 1) % FEATURES.length);

  const feature = FEATURES[active];
  const MockupComponent = MOCKUPS[feature.id];

  return (
    <main className="min-h-screen bg-[var(--background)] text-[var(--foreground)] overflow-x-hidden">

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
        @media (prefers-reduced-motion: reduce) {
          html { scroll-behavior: auto; }
          .anim-fade-in-up, .anim-fade-in, .scroll-bounce, .carousel-slide { animation: none; }
          .tour-sparkle { animation: none !important; }
        }
      `}</style>

      {/* ── Nav (matching homepage exactly) ────────────────────────────────────── */}
      <header
        className={`sticky top-0 z-50 backdrop-blur-md border-b border-[var(--color-warm-border)] transition-all duration-300 ${
          scrolled ? "shadow-md shadow-black/[0.06]" : "shadow-none"
        }`}
        style={{ backgroundColor: "rgba(248, 247, 244, 0.94)" }}
      >
        <nav className="max-w-6xl mx-auto px-5 sm:px-8 py-4 flex flex-wrap items-center justify-between gap-3">
          <Link href="/" className="flex items-center shrink-0">
            <img src="/rooted-logo-nav.png" alt="Rooted" style={{ height: '36px', width: 'auto' }} />
          </Link>
          <div className="flex items-center gap-2">
            <Link href="/login" className="inline-flex text-sm font-medium text-[var(--color-text-muted)] hover:text-[var(--foreground)] transition-colors px-2 sm:px-3 py-2 rounded-lg hover:bg-[#f0ede8]">
              Log in
            </Link>
            <Link href="/signup" className="inline-flex items-center gap-1.5 text-sm font-medium bg-[var(--g-accent)] hover:bg-[var(--g-deep)] text-white px-3 sm:px-5 py-2.5 rounded-xl transition-colors shadow-sm">
              Start free trial
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
            <div key={i} className="tour-sparkle absolute rounded-full bg-white" style={{ top: s.top, left: s.left, width: s.size, height: s.size, opacity: 0.25, animation: `pulse ${2 + i * 0.3}s ease-in-out infinite`, animationDelay: s.delay }} />
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
          <h1 className="anim-fade-in-up delay-150 text-4xl sm:text-5xl lg:text-6xl font-medium leading-[1.08] mb-6 text-white" style={{ fontFamily: "var(--font-display)", textShadow: "0 2px 32px rgba(0,0,0,0.4)", letterSpacing: "-0.02em" }}>
            See Rooted{" "}
            <em className="not-italic" style={{ color: "#86c98a" }}>in action</em>
          </h1>
          <p className="anim-fade-in-up delay-300 text-base sm:text-lg text-white/78 mb-10 leading-relaxed max-w-[36rem]" style={{ textShadow: "0 1px 12px rgba(0,0,0,0.3)" }}>
            A home for your family’s memories, with a planner that works alongside the curriculum you already love.
            Plan your days, capture memories, and actually see how far your kids have come.
          </p>
          <div className="anim-fade-in-up delay-450 flex flex-col sm:flex-row gap-3 mb-8 w-full sm:w-auto">
            <Link href="/signup" className="inline-flex items-center justify-center gap-2 bg-white text-[var(--g-deep)] hover:bg-[#f0f9f1] font-medium px-8 py-4 rounded-xl transition-all text-base" style={{ boxShadow: "0 0 0 1px rgba(255,255,255,0.15), 0 8px 32px rgba(0,0,0,0.35)" }}>
              Start your free trial →
            </Link>
            <a href="#walkthrough" className="inline-flex items-center justify-center gap-2 text-white hover:bg-white/12 font-medium px-8 py-4 rounded-xl transition-all text-base" style={{ border: "1px solid rgba(255,255,255,0.35)", background: "rgba(255,255,255,0.06)" }}>
              Explore features ↓
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
          <p className="text-xs font-medium tracking-widest text-[#b5aca4] mb-3">
            Feature tour
          </p>
          <h2 className="text-3xl sm:text-4xl font-medium text-[var(--foreground)]" style={{ fontFamily: "var(--font-display)" }}>
            Built for how you actually homeschool
          </h2>
          <p className="max-w-2xl mx-auto mt-4 text-sm text-[var(--color-text-muted)] leading-relaxed">
            On your phone, start with Today, Plan, Garden, Memories, Printables, and More.
            Open More for Reports, Transcripts, Resources, and Years. On desktop, Reports,
            Transcripts, and Resources also have their own sidebar links.
          </p>
          <p className="mt-3 text-sm text-[var(--color-text-muted)]">Choose a feature below and explore at your own pace.</p>
        </div>

        {/* Feature buttons */}
        <div className="flex flex-wrap items-center justify-center gap-2 mb-10">
          {FEATURES.map((f, i) => (
            <button
              key={f.id}
              onClick={() => setActive(i)}
              aria-pressed={i === active}
              aria-controls="tour-feature"
              className={`px-3.5 py-2 rounded-xl text-sm font-medium transition-all ${
                i === active
                  ? "bg-[var(--g-accent)] text-white shadow-sm"
                  : "bg-[var(--color-warm-card)] border border-[var(--color-warm-border)] text-[var(--color-text-muted)] hover:border-[var(--g-accent)] hover:text-[var(--g-accent)]"
              }`}
            >
              {f.emoji} {f.label}
            </button>
          ))}
        </div>

        {/* Carousel */}
        <div className="relative" role="region" aria-label="Feature walkthrough">
          <button onClick={prev} aria-label="Previous" className="hidden xl:flex absolute -left-14 top-1/2 -translate-y-1/2 w-11 h-11 items-center justify-center rounded-full bg-[var(--color-warm-card)] border border-[var(--color-warm-border)] text-[var(--color-text-muted)] hover:border-[var(--g-accent)] hover:text-[var(--g-accent)] transition-colors shadow-sm z-10 text-2xl leading-none">
            ‹
          </button>

          <div id="tour-feature" aria-live="polite" aria-atomic="true" className="carousel-slide grid grid-cols-1 lg:grid-cols-5 gap-8 lg:gap-10 items-start">
            {/* Mockup */}
            <div className="lg:col-span-3 order-2 lg:order-1">
              <MockupComponent />
            </div>

            {/* Description */}
            <div className="lg:col-span-2 order-1 lg:order-2 space-y-5">
              <div>
                <p className="text-xs font-medium tracking-widest text-[var(--g-accent)] mb-1.5">
                  {feature.emoji} {feature.label}
                </p>
                <h2 className="text-2xl sm:text-3xl font-medium text-[var(--foreground)] leading-tight mb-2" style={{ fontFamily: "var(--font-display)" }}>
                  {feature.headline}
                </h2>
                <p className="text-[var(--color-text-muted)] leading-relaxed">{feature.sub}</p>
                <p className="text-xs text-[var(--g-accent)] leading-relaxed mt-3">Find it: {feature.location}</p>
              </div>

              <ul className="space-y-3">
                {feature.bullets.map((b) => (
                  <li key={b} className="flex items-start gap-3">
                    <div className="w-5 h-5 rounded-full bg-[#e8f0e9] flex items-center justify-center shrink-0 mt-0.5">
                      <Check size={11} className="text-[var(--g-accent)]" strokeWidth={3} />
                    </div>
                    <span className="text-sm text-[#5c5248] leading-relaxed">{b}</span>
                  </li>
                ))}
              </ul>

              <div className="bg-[var(--color-warm-card)] border border-[var(--color-warm-border)] rounded-xl px-4 py-3 flex items-center gap-2.5">
                <span className="text-base shrink-0">💡</span>
                <p className="text-sm text-[var(--g-accent)] font-medium">{feature.note}</p>
              </div>

              {/* Curriculum tags in Plan tab */}
              {feature.id === "plan" && (
                <div className="flex flex-wrap gap-2">
                  {["Charlotte Mason", "The Good and the Beautiful", "Classical", "Sonlight", "Unit Studies", "Unschooling", "Any approach ✨"].map((c) => (
                    <span key={c} className="text-xs bg-[#e8f0e9] text-[var(--g-accent)] px-3 py-1.5 rounded-full border border-[#c2dbc5] font-medium">
                      {c}
                    </span>
                  ))}
                </div>
              )}

              <Link href="/signup" className="inline-flex items-center gap-2 bg-[var(--g-accent)] hover:bg-[var(--g-deep)] text-white text-sm font-medium px-5 py-3 rounded-xl transition-colors shadow-sm">
                Start your free trial →
              </Link>
            </div>
          </div>

          <button onClick={next} aria-label="Next" className="hidden xl:flex absolute -right-14 top-1/2 -translate-y-1/2 w-11 h-11 items-center justify-center rounded-full bg-[var(--color-warm-card)] border border-[var(--color-warm-border)] text-[var(--color-text-muted)] hover:border-[var(--g-accent)] hover:text-[var(--g-accent)] transition-colors shadow-sm z-10 text-2xl leading-none">
            ›
          </button>

          {/* Mobile arrows */}
          <div className="flex xl:hidden items-center justify-center gap-6 mt-8">
            <button onClick={prev} aria-label="Previous" className="w-11 h-11 flex items-center justify-center rounded-full bg-[var(--color-warm-card)] border border-[var(--color-warm-border)] text-[var(--color-text-muted)] hover:border-[var(--g-accent)] transition-colors text-2xl leading-none">‹</button>
            <span className="text-xs font-medium text-[#b5aca4]">{active + 1} / {FEATURES.length}</span>
            <button onClick={next} aria-label="Next" className="w-11 h-11 flex items-center justify-center rounded-full bg-[var(--color-warm-card)] border border-[var(--color-warm-border)] text-[var(--color-text-muted)] hover:border-[var(--g-accent)] transition-colors text-2xl leading-none">›</button>
          </div>

          {/* Dot indicators */}
          <div className="flex items-center justify-center gap-2.5 mt-5">
            {FEATURES.map((f, i) => (
              <button key={f.id} onClick={() => setActive(i)} aria-label={`Go to ${f.label}`} aria-pressed={i === active} aria-controls="tour-feature"
                className={`w-2.5 h-2.5 rounded-full transition-all duration-200 ${
                  i === active ? "bg-[var(--g-accent)] scale-110" : "bg-transparent border-2 border-[#c8bfb5] hover:border-[var(--g-accent)]"
                }`}
              />
            ))}
          </div>
        </div>
      </section>

      {/* ── Memories Deep-Dive ──────────────────────────────────────────────── */}
      <section
        className="px-6 sm:px-8 py-24"
        style={{ background: "linear-gradient(160deg, #fef9f0 0%, var(--color-warm-card) 40%, #f0f7f1 100%)" }}
      >
        <div className="max-w-5xl mx-auto">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 items-center">
            <div>
              <p className="text-xs font-medium tracking-widest text-[#b5aca4] mb-3">
                The moments you’ll want to remember
              </p>
              <h2 className="text-3xl sm:text-4xl font-medium text-[var(--foreground)] mb-5 leading-snug" style={{ fontFamily: "var(--font-display)" }}>
                These years go by so fast.{" "}
                <em className="not-italic" style={{ color: "var(--g-accent)" }}>Hold onto them.</em>
              </h2>
              <p className="text-[var(--color-text-muted)] leading-relaxed mb-6 text-base">
                Between the lessons, the field trips, the little things they said that made you laugh, so much gets forgotten. Rooted gives you a beautiful, simple place to save it all. Save a little at a time, whenever you have a moment.
              </p>
              <ul className="space-y-4 mb-8">
                {[
                  { emoji: "📸", title: "Photos from your day", desc: "Snap and save moments as they happen, field trips, projects, backyard science." },
                  { emoji: "✍️", title: "Little notes & quotes", desc: "Write down what they said, what clicked, what made them proud. You'll want these later." },
                  { emoji: "📖", title: "Books they loved", desc: "Add books as you read together and keep a record to look back on." },
                  { emoji: "🌿", title: "Look back and see it", desc: "Your whole homeschool journey, month by month. Proof you're doing something beautiful." },
                ].map((item) => (
                  <li key={item.title} className="flex gap-4 items-start">
                    <div className="w-9 h-9 rounded-xl bg-[#e8f0e9] flex items-center justify-center text-lg shrink-0 mt-0.5">{item.emoji}</div>
                    <div>
                      <p className="font-medium text-[var(--foreground)] text-sm mb-0.5">{item.title}</p>
                      <p className="text-xs text-[var(--color-text-muted)] leading-relaxed">{item.desc}</p>
                    </div>
                  </li>
                ))}
              </ul>
              <Link href="/signup" className="inline-flex items-center gap-2 bg-[var(--g-accent)] hover:bg-[var(--g-deep)] text-white font-medium px-7 py-3.5 rounded-xl transition-colors text-sm shadow-sm">
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
      <section className="bg-[var(--color-warm-card)] border-y border-[var(--color-warm-border)] px-6 sm:px-8 py-20">
        <div className="max-w-5xl mx-auto">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 items-center">
            <div className="flex justify-center lg:justify-start order-2 lg:order-1">
              <div className="w-full max-w-sm"><ReportMockup /></div>
            </div>

            <div className="order-1 lg:order-2">
              <p className="text-xs font-medium tracking-widest text-[#b5aca4] mb-3">
                The learning you recorded, gathered together
              </p>
              <h2 className="text-3xl sm:text-4xl font-medium text-[var(--foreground)] mb-5 leading-snug" style={{ fontFamily: "var(--font-display)" }}>
                See how far they&apos;ve come.
              </h2>
              <p className="text-[var(--color-text-muted)] leading-relaxed mb-6 text-base">
                When you need to look back, start with the learning you recorded. Filter Reports by child and date to review hours, attendance, and reading, then print or save the records you need.
              </p>
              <ul className="space-y-4 mb-8">
                {[
                  { emoji: "🕒", title: "Hours & Attendance Log", desc: "Review completed lessons and learning time from memories and activities. Lessons without recorded minutes use an estimate." },
                  { emoji: "📖", title: "Reading Log", desc: "Keep the books you've added in a record you can filter by child and date." },
                  { emoji: "📋", title: "Print or save as PDF", desc: "Report downloads are included with Rooted+ or an active trial. Plan also has its own Download Progress Report option." },
                ].map((item) => (
                  <li key={item.title} className="flex gap-4 items-start">
                    <div className="w-9 h-9 rounded-xl bg-[#f5ede0] flex items-center justify-center text-lg shrink-0 mt-0.5">{item.emoji}</div>
                    <div>
                      <p className="font-medium text-[var(--foreground)] text-sm mb-0.5">{item.title}</p>
                      <p className="text-xs text-[var(--color-text-muted)] leading-relaxed">{item.desc}</p>
                    </div>
                  </li>
                ))}
              </ul>
              <Link href="/signup" className="inline-flex items-center gap-2 border-2 border-[var(--g-accent)] text-[var(--g-accent)] hover:bg-[#e8f0e9] font-medium px-7 py-3.5 rounded-xl transition-colors text-sm">
                Try everything free for 30 days →
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* ── Founder Quote ──────────────────────────────────────────────────── */}
      <section className="bg-[var(--color-warm-card)] border-y border-[var(--color-warm-border)]">
        <div className="max-w-2xl mx-auto px-6 sm:px-8 py-20 text-center">
          <div className="w-12 h-12 rounded-2xl bg-[var(--g-accent)] flex items-center justify-center text-2xl mx-auto mb-8 shadow-sm" aria-hidden="true">
            🌿
          </div>
          <div className="text-[3.5rem] leading-none select-none text-[#d4ead6] mb-2" style={{ fontFamily: "var(--font-display)", lineHeight: 0.85 }} aria-hidden="true">
            &ldquo;
          </div>
          <p className="text-xl sm:text-2xl text-[var(--foreground)] leading-relaxed italic mb-8" style={{ fontFamily: "var(--font-display)" }}>
            I built Rooted for families like mine. I hope it brings your homeschool a little more calm and a lot more joy.
          </p>
          <p className="text-sm font-medium text-[var(--g-accent)]">
            Brittany W., homeschool mom of 2
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
            <h2 className="text-2xl sm:text-3xl font-medium text-[var(--foreground)] mb-3" style={{ fontFamily: "var(--font-display)" }}>
              Start your homeschool journey today
            </h2>
            <p className="text-[var(--g-deep)] font-medium mb-8 leading-relaxed max-w-sm mx-auto">
              Try everything free for 30 days. No credit card needed. Join families already using Rooted.
            </p>
            <Link href="/signup" className="inline-block bg-[var(--g-accent)] hover:bg-[#4a6b50] text-white font-medium px-8 py-3 rounded-full transition-colors">
              Start your free trial →
            </Link>
            <p className="mt-4">
              {isNative ? (
                <span className="text-sm text-[var(--g-deep)] font-medium">
                  See plans at rootedhomeschoolapp.com
                </span>
              ) : (
                <Link href="/upgrade" className="text-sm text-[var(--g-deep)] hover:underline font-medium">
                  View plans →
                </Link>
              )}
            </p>
          </div>
        </div>
      </section>

      {/* ── Footer (matching homepage) ─────────────────────────────────────── */}
      <footer className="bg-[var(--color-warm-card)] border-t border-[var(--color-warm-border)]">
        <div className="max-w-5xl mx-auto px-6 sm:px-8 py-12">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-8 items-start">
            <div className="flex flex-col items-center sm:items-start gap-2">
              <div className="flex items-center gap-2">
                <div className="w-7 h-7 rounded-lg bg-[var(--g-accent)] flex items-center justify-center text-sm">🌿</div>
                <span className="font-medium text-[var(--foreground)] text-base" style={{ fontFamily: "var(--font-display)" }}>
                  Rooted
                </span>
              </div>
              <p className="text-xs text-[#b5aca4] leading-relaxed">A calm companion for intentional families.</p>
              <p className="text-[11px] text-[#c8bfb5]">rootedhomeschoolapp.com</p>
            </div>

            <div className="flex items-center justify-center gap-5 flex-wrap">
              <Link href="/login"   className="text-sm text-[var(--color-text-muted)] hover:text-[var(--g-accent)] transition-colors">Log in</Link>
              <Link href="/signup"  className="text-sm text-[var(--color-text-muted)] hover:text-[var(--g-accent)] transition-colors">Sign up</Link>
              <Link href="/privacy" className="text-sm text-[var(--color-text-muted)] hover:text-[var(--g-accent)] transition-colors">Privacy</Link>
              <Link href="/terms"   className="text-sm text-[var(--color-text-muted)] hover:text-[var(--g-accent)] transition-colors">Terms</Link>
              <Link href="/faq"     className="text-sm text-[var(--color-text-muted)] hover:text-[var(--g-accent)] transition-colors">FAQ</Link>
              <Link href="/contact" className="text-sm text-[var(--color-text-muted)] hover:text-[var(--g-accent)] transition-colors">Contact</Link>
              <Link href="/partners" className="text-sm text-[var(--color-text-muted)] hover:text-[var(--g-accent)] transition-colors">Partners</Link>
            </div>
            <div className="flex items-center justify-center gap-4 mt-2">
              <a href="https://instagram.com/rootedhomeschool" target="_blank" rel="noopener noreferrer" className="text-xs text-[var(--color-text-muted)] hover:text-[var(--g-accent)] transition-colors flex items-center gap-1">
                📸 Instagram
              </a>
              <a href="https://facebook.com/rootedhomeschool" target="_blank" rel="noopener noreferrer" className="text-xs text-[var(--color-text-muted)] hover:text-[var(--g-accent)] transition-colors flex items-center gap-1">
                👥 Facebook
              </a>
              <a href="https://pinterest.com/hellorootedapp" target="_blank" rel="noopener noreferrer" className="text-xs text-[var(--color-text-muted)] hover:text-[var(--g-accent)] transition-colors flex items-center gap-1">
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
