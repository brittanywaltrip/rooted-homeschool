"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { useParams, useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { ChevronLeft, ChevronRight, X } from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────

type Child = {
  id: string;
  name: string;
  color: string | null;
  created_at: string;
  graduated_at: string | null;
};

type YearData = {
  label: string;
  startYear: number;
  lessons: number;
  books: string[];
  photoUrls: string[];
};

type SlideType =
  | { kind: "title"; child: Child; yearsCount: number }
  | { kind: "stats"; lessons: number; books: number; photos: number }
  | { kind: "year"; data: YearData; index: number; total: number }
  | { kind: "photos"; urls: string[] }
  | { kind: "narrative"; text: string | null; loading: boolean }
  | { kind: "final"; child: Child };

// ─── Helpers ──────────────────────────────────────────────────────────────────

function schoolYearLabel(dateStr: string): string {
  const d = new Date(dateStr + "T12:00:00");
  const y = d.getFullYear();
  const m = d.getMonth();
  return m >= 7 ? `${y}–${y + 1}` : `${y - 1}–${y}`;
}

function schoolYearStartYear(dateStr: string): number {
  const d = new Date(dateStr + "T12:00:00");
  const y = d.getFullYear();
  const m = d.getMonth();
  return m >= 7 ? y : y - 1;
}

// ─── Confetti ─────────────────────────────────────────────────────────────────

const CONFETTI_COLORS = ["#c9a84c", "#e8c97e", "#f0d99b", "#7aaa78", "#4a8a6a", "#ffffff", "#f5e6c8"];

function Confetti() {
  const pieces = useRef(
    Array.from({ length: 48 }, (_, i) => ({
      id: i,
      left: Math.random() * 100,
      delay: Math.random() * 3,
      duration: 3 + Math.random() * 3,
      color: CONFETTI_COLORS[Math.floor(Math.random() * CONFETTI_COLORS.length)],
      size: 6 + Math.random() * 8,
      rotate: Math.random() * 360,
    }))
  ).current;

  return (
    <div className="absolute inset-0 overflow-hidden pointer-events-none">
      {pieces.map((p) => (
        <div
          key={p.id}
          className="absolute top-0 rounded-sm opacity-0"
          style={{
            left: `${p.left}%`,
            width: p.size,
            height: p.size * 0.5,
            backgroundColor: p.color,
            transform: `rotate(${p.rotate}deg)`,
            animation: `confettiFall ${p.duration}s ${p.delay}s ease-in infinite`,
          }}
        />
      ))}
      <style>{`
        @keyframes confettiFall {
          0%   { transform: translateY(-20px) rotate(0deg);   opacity: 1; }
          100% { transform: translateY(100vh) rotate(720deg); opacity: 0; }
        }
      `}</style>
    </div>
  );
}

// ─── Individual Slides ────────────────────────────────────────────────────────

function TitleSlide({ slide }: { slide: Extract<SlideType, { kind: "title" }> }) {
  const { child, yearsCount } = slide;
  const color = child.color ?? "#c9a84c";
  return (
    <div className="flex flex-col items-center justify-center h-full text-center px-8 select-none">
      {/* Decorative ring */}
      <div
        className="w-28 h-28 rounded-full flex items-center justify-center mb-8 text-4xl font-bold text-white shadow-2xl"
        style={{ background: `radial-gradient(circle at 35% 35%, ${color}cc, ${color}66)`, border: `2px solid ${color}88` }}
      >
        {child.name.charAt(0).toUpperCase()}
      </div>

      <p className="text-xs font-semibold tracking-[0.3em] uppercase text-[#c9a84c] mb-3">
        A Homeschool Journey
      </p>
      <h1 className="text-5xl sm:text-7xl font-bold text-white mb-4" style={{ fontFamily: "Georgia, serif" }}>
        {child.name}
      </h1>
      <div className="w-24 h-px bg-gradient-to-r from-transparent via-[#c9a84c] to-transparent my-4" />
      <p className="text-lg text-[#c8bfad] mt-2" style={{ fontFamily: "Georgia, serif" }}>
        {yearsCount} {yearsCount === 1 ? "year" : "years"} of learning, growing & becoming
      </p>

      {/* Decorative dots */}
      <div className="flex gap-2 mt-12 opacity-30">
        {Array.from({ length: 7 }).map((_, i) => (
          <div key={i} className="w-1 h-1 rounded-full bg-[#c9a84c]" />
        ))}
      </div>
    </div>
  );
}

function StatsSlide({ slide }: { slide: Extract<SlideType, { kind: "stats" }> }) {
  const stats = [
    { label: "Lessons\nCompleted", value: slide.lessons, icon: "📚" },
    { label: "Books\nRead",        value: slide.books,   icon: "📖" },
    { label: "Memories\nCaptured", value: slide.photos,  icon: "📸" },
  ];
  return (
    <div className="flex flex-col items-center justify-center h-full px-8 select-none">
      <p className="text-xs font-semibold tracking-[0.3em] uppercase text-[#c9a84c] mb-3">The Numbers</p>
      <h2 className="text-4xl font-bold text-white mb-12" style={{ fontFamily: "Georgia, serif" }}>
        A Journey in Review
      </h2>
      <div className="grid grid-cols-3 gap-6 w-full max-w-2xl">
        {stats.map((s) => (
          <div
            key={s.label}
            className="flex flex-col items-center justify-center rounded-2xl p-6 text-center"
            style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(201,168,76,0.25)" }}
          >
            <span className="text-3xl mb-3">{s.icon}</span>
            <span className="text-4xl font-bold text-white mb-2" style={{ fontFamily: "Georgia, serif" }}>
              {s.value.toLocaleString()}
            </span>
            <span className="text-xs text-[#8a8070] whitespace-pre-line leading-tight uppercase tracking-wider">
              {s.label}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function YearSlide({ slide }: { slide: Extract<SlideType, { kind: "year" }> }) {
  const { data, index, total } = slide;
  return (
    <div className="flex flex-col items-center justify-center h-full px-8 select-none">
      <p className="text-xs font-semibold tracking-[0.3em] uppercase text-[#c9a84c] mb-3">
        Year {index + 1} of {total}
      </p>
      <h2 className="text-5xl font-bold text-white mb-2" style={{ fontFamily: "Georgia, serif" }}>
        {data.label}
      </h2>
      <div className="w-24 h-px bg-gradient-to-r from-transparent via-[#c9a84c] to-transparent my-6" />

      <div className="grid grid-cols-2 gap-4 w-full max-w-lg mb-8">
        <div
          className="rounded-2xl p-5 text-center"
          style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(201,168,76,0.2)" }}
        >
          <div className="text-3xl font-bold text-white mb-1" style={{ fontFamily: "Georgia, serif" }}>
            {data.lessons}
          </div>
          <div className="text-xs uppercase tracking-widest text-[#8a8070]">Lessons</div>
        </div>
        <div
          className="rounded-2xl p-5 text-center"
          style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(201,168,76,0.2)" }}
        >
          <div className="text-3xl font-bold text-white mb-1" style={{ fontFamily: "Georgia, serif" }}>
            {data.books.length}
          </div>
          <div className="text-xs uppercase tracking-widest text-[#8a8070]">Books Read</div>
        </div>
      </div>

      {data.books.length > 0 && (
        <div className="w-full max-w-lg">
          <p className="text-xs uppercase tracking-widest text-[#c9a84c] mb-3 text-center">Books This Year</p>
          <div className="flex flex-wrap gap-2 justify-center">
            {data.books.slice(0, 8).map((b, i) => (
              <span
                key={i}
                className="px-3 py-1 rounded-full text-xs text-[#d4c9b4]"
                style={{ background: "rgba(201,168,76,0.1)", border: "1px solid rgba(201,168,76,0.2)" }}
              >
                {b}
              </span>
            ))}
            {data.books.length > 8 && (
              <span className="px-3 py-1 text-xs text-[#8a8070]">+{data.books.length - 8} more</span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function PhotosSlide({ slide }: { slide: Extract<SlideType, { kind: "photos" }> }) {
  const photos = slide.urls.slice(0, 12);
  if (photos.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full px-8 select-none">
        <p className="text-xs font-semibold tracking-[0.3em] uppercase text-[#c9a84c] mb-4">Photo Memories</p>
        <p className="text-[#8a8070] text-lg" style={{ fontFamily: "Georgia, serif" }}>
          Every moment lived — even the ones not photographed.
        </p>
      </div>
    );
  }
  return (
    <div className="flex flex-col items-center justify-center h-full px-6 select-none">
      <p className="text-xs font-semibold tracking-[0.3em] uppercase text-[#c9a84c] mb-2">Photo Memories</p>
      <h2 className="text-3xl font-bold text-white mb-8" style={{ fontFamily: "Georgia, serif" }}>
        Moments Along the Way
      </h2>
      <div className="grid grid-cols-3 sm:grid-cols-4 gap-2 w-full max-w-2xl">
        {photos.map((url, i) => (
          <div
            key={i}
            className="aspect-square rounded-xl overflow-hidden"
            style={{ border: "1px solid rgba(201,168,76,0.2)" }}
          >
            <img src={url} alt="" className="w-full h-full object-cover" />
          </div>
        ))}
      </div>
    </div>
  );
}

function NarrativeSlide({ slide }: { slide: Extract<SlideType, { kind: "narrative" }> }) {
  return (
    <div className="flex flex-col items-center justify-center h-full px-8 select-none">
      <p className="text-xs font-semibold tracking-[0.3em] uppercase text-[#c9a84c] mb-3">A Letter for You</p>
      {slide.loading ? (
        <div className="flex flex-col items-center gap-4">
          <div className="w-8 h-8 rounded-full border-2 border-[#c9a84c] border-t-transparent animate-spin" />
          <p className="text-[#8a8070] text-sm">Writing your letter…</p>
        </div>
      ) : (
        <div className="max-w-xl text-center">
          <div
            className="text-6xl text-[#c9a84c] opacity-30 leading-none mb-4"
            style={{ fontFamily: "Georgia, serif" }}
          >
            &ldquo;
          </div>
          <p
            className="text-[#e8e0d4] leading-relaxed text-base sm:text-lg"
            style={{ fontFamily: "Georgia, serif" }}
          >
            {slide.text}
          </p>
          <p className="text-[11px] text-[#8a8070] italic mt-6">Narrative generated by AI · Review before sharing</p>
        </div>
      )}
    </div>
  );
}

function FinalSlide({ slide }: { slide: Extract<SlideType, { kind: "final" }> }) {
  return (
    <div className="relative flex flex-col items-center justify-center h-full px-8 select-none overflow-hidden">
      <Confetti />
      <div className="relative z-10 flex flex-col items-center">
        <div className="text-5xl mb-6">🎓</div>
        <p className="text-xs font-semibold tracking-[0.3em] uppercase text-[#c9a84c] mb-4">
          With Love &amp; Pride
        </p>
        <h1
          className="text-5xl sm:text-6xl font-bold text-white mb-6 text-center"
          style={{ fontFamily: "Georgia, serif" }}
        >
          Congratulations,
          <br />
          <span style={{ color: "#c9a84c" }}>{slide.child.name}</span>
        </h1>
        <div className="w-32 h-px bg-gradient-to-r from-transparent via-[#c9a84c] to-transparent my-4" />
        <p
          className="text-[#c8bfad] text-lg text-center max-w-sm"
          style={{ fontFamily: "Georgia, serif" }}
        >
          Your homeschool journey has shaped you into exactly who you were meant to be.
        </p>
      </div>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function GraduationPage() {
  const params  = useParams();
  const router  = useRouter();
  const childId = params.childId as string;

  const [slides,       setSlides]       = useState<SlideType[]>([]);
  const [current,      setCurrent]      = useState(0);
  const [loading,      setLoading]      = useState(true);
  const [transitioning, setTransitioning] = useState(false);
  const narrativeFetched = useRef(false);

  // ── Load all data ──────────────────────────────────────────────────────────

  const load = useCallback(async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { router.push("/login"); return; }

    // Child info
    const { data: child } = await supabase
      .from("children")
      .select("id, name, color, created_at, graduated_at")
      .eq("id", childId)
      .single();

    if (!child) { router.push("/dashboard"); return; }

    // Lessons for this child
    const { data: lessons } = await supabase
      .from("lessons")
      .select("date, scheduled_date")
      .eq("child_id", childId)
      .eq("completed", true)
      .not("date", "is", null);

    // Books for this child
    const { data: bookEvents } = await supabase
      .from("app_events")
      .select("payload, created_at")
      .eq("user_id", user.id)
      .eq("type", "book_read");

    const childBooks = (bookEvents ?? []).filter(
      (e) => e.payload?.child_id === childId || !e.payload?.child_id
    );

    // Photos for this child
    const { data: photoEvents } = await supabase
      .from("app_events")
      .select("payload, created_at")
      .eq("user_id", user.id)
      .eq("type", "memory_photo");

    const childPhotos = (photoEvents ?? []).filter(
      (e) => e.payload?.child_id === childId || !e.payload?.child_id
    );

    // ── Group by school year ───────────────────────────────────────────────

    const yearMap = new Map<number, YearData>();

    const ensureYear = (startYear: number) => {
      if (!yearMap.has(startYear)) {
        yearMap.set(startYear, {
          label: `${startYear}–${startYear + 1}`,
          startYear,
          lessons: 0,
          books: [],
          photoUrls: [],
        });
      }
      return yearMap.get(startYear)!;
    };

    for (const l of lessons ?? []) {
      const d = l.date ?? l.scheduled_date;
      if (!d) continue;
      ensureYear(schoolYearStartYear(d)).lessons++;
    }

    for (const b of childBooks) {
      const d = b.payload?.date ?? b.created_at;
      if (!d || !b.payload?.title) continue;
      ensureYear(schoolYearStartYear(d)).books.push(b.payload.title);
    }

    for (const p of childPhotos) {
      const d = p.payload?.date ?? p.created_at;
      if (!d || !p.payload?.photo_url) continue;
      ensureYear(schoolYearStartYear(d)).photoUrls.push(p.payload.photo_url);
    }

    const years = Array.from(yearMap.values()).sort((a, b) => a.startYear - b.startYear);

    // ── Compute totals ─────────────────────────────────────────────────────

    const totalLessons = (lessons ?? []).length;
    const totalBooks   = childBooks.length;
    const allPhotos    = childPhotos.map((p) => p.payload?.photo_url).filter(Boolean) as string[];

    // Years homeschooled: from child.created_at to graduated_at or today
    const start = new Date(child.created_at);
    const end   = child.graduated_at ? new Date(child.graduated_at) : new Date();
    const yearsCount = Math.max(1, Math.round((end.getTime() - start.getTime()) / (365.25 * 24 * 3600 * 1000)));

    // ── Build slides ───────────────────────────────────────────────────────

    const built: SlideType[] = [
      { kind: "title", child, yearsCount },
      { kind: "stats", lessons: totalLessons, books: totalBooks, photos: allPhotos.length },
      ...years.map((data, i): SlideType => ({ kind: "year", data, index: i, total: years.length })),
    ];

    if (allPhotos.length > 0) {
      built.push({ kind: "photos", urls: allPhotos });
    }

    built.push({ kind: "narrative", text: null, loading: true });
    built.push({ kind: "final", child });

    setSlides(built);
    setLoading(false);

    // Store metadata for narrative generation
    narrativeMetaRef.current = {
      childName:        child.name,
      yearsHomeschooled: yearsCount,
      totalLessons,
      totalBooks,
      totalPhotos:      allPhotos.length,
      yearSummaries:    years.map((y) => ({ label: y.label, lessons: y.lessons, books: y.books.length })),
      token:            (await supabase.auth.getSession()).data.session?.access_token ?? "",
      narrativeSlideIndex: built.findIndex((s) => s.kind === "narrative"),
    };
  }, [childId, router]);

  const narrativeMetaRef = useRef<{
    childName: string;
    yearsHomeschooled: number;
    totalLessons: number;
    totalBooks: number;
    totalPhotos: number;
    yearSummaries: { label: string; lessons: number; books: number }[];
    token: string;
    narrativeSlideIndex: number;
  } | null>(null);

  useEffect(() => { load(); }, [load]);

  // ── Fetch narrative when near that slide ──────────────────────────────────

  useEffect(() => {
    const meta = narrativeMetaRef.current;
    if (!meta || narrativeFetched.current) return;
    if (current < meta.narrativeSlideIndex - 1) return;

    narrativeFetched.current = true;

    fetch("/api/graduation/narrative", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${meta.token}`,
      },
      body: JSON.stringify({
        childName:         meta.childName,
        yearsHomeschooled: meta.yearsHomeschooled,
        totalLessons:      meta.totalLessons,
        totalBooks:        meta.totalBooks,
        totalPhotos:       meta.totalPhotos,
        yearSummaries:     meta.yearSummaries,
      }),
    })
      .then((r) => r.json())
      .then(({ narrative }) => {
        setSlides((prev) =>
          prev.map((s) =>
            s.kind === "narrative" ? { ...s, text: narrative, loading: false } : s
          )
        );
      })
      .catch(() => {
        setSlides((prev) =>
          prev.map((s) =>
            s.kind === "narrative"
              ? { ...s, text: "Your journey has been a testament to curiosity, perseverance, and love of learning.", loading: false }
              : s
          )
        );
      });
  }, [current]);

  // ── Keyboard navigation ───────────────────────────────────────────────────

  const goTo = useCallback((idx: number) => {
    if (transitioning || idx < 0 || idx >= slides.length) return;
    setTransitioning(true);
    setTimeout(() => {
      setCurrent(idx);
      setTransitioning(false);
    }, 200);
  }, [slides.length, transitioning]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight" || e.key === "ArrowDown") goTo(current + 1);
      if (e.key === "ArrowLeft"  || e.key === "ArrowUp")   goTo(current - 1);
      if (e.key === "Escape") router.push("/dashboard/settings");
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [current, goTo, router]);

  // ─────────────────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="fixed inset-0 flex items-center justify-center" style={{ background: "#08101e" }}>
        <div className="flex flex-col items-center gap-4">
          <div className="w-10 h-10 rounded-full border-2 border-[#c9a84c] border-t-transparent animate-spin" />
          <p className="text-[#8a8070] text-sm tracking-widest uppercase">Preparing your journey…</p>
        </div>
      </div>
    );
  }

  const slide = slides[current];

  return (
    <div
      className="fixed inset-0 flex flex-col"
      style={{ background: "#08101e" }}
    >
      {/* Top bar */}
      <div className="flex items-center justify-between px-6 py-4 z-20" style={{ borderBottom: "1px solid rgba(201,168,76,0.1)" }}>
        <div className="flex items-center gap-2">
          <div
            className="w-2 h-2 rounded-full"
            style={{ backgroundColor: "#c9a84c" }}
          />
          <span className="text-xs uppercase tracking-[0.2em] text-[#8a8070]">
            Rooted · Graduation
          </span>
        </div>
        <button
          onClick={() => router.push("/dashboard/settings")}
          className="w-8 h-8 rounded-full flex items-center justify-center text-[#8a8070] hover:text-white transition-colors"
          style={{ background: "rgba(255,255,255,0.05)" }}
        >
          <X size={14} />
        </button>
      </div>

      {/* Slide area */}
      <div
        className="flex-1 relative overflow-hidden"
        onClick={() => goTo(current + 1)}
        style={{ cursor: current < slides.length - 1 ? "pointer" : "default" }}
      >
        <div
          className="absolute inset-0 transition-opacity duration-300"
          style={{ opacity: transitioning ? 0 : 1 }}
        >
          {slide.kind === "title"     && <TitleSlide     slide={slide} />}
          {slide.kind === "stats"     && <StatsSlide     slide={slide} />}
          {slide.kind === "year"      && <YearSlide      slide={slide} />}
          {slide.kind === "photos"    && <PhotosSlide    slide={slide} />}
          {slide.kind === "narrative" && <NarrativeSlide slide={slide} />}
          {slide.kind === "final"     && <FinalSlide     slide={slide} />}
        </div>
      </div>

      {/* Bottom nav */}
      <div
        className="flex items-center justify-between px-6 py-4 z-20"
        style={{ borderTop: "1px solid rgba(201,168,76,0.1)" }}
      >
        {/* Prev */}
        <button
          onClick={(e) => { e.stopPropagation(); goTo(current - 1); }}
          disabled={current === 0}
          className="w-9 h-9 rounded-full flex items-center justify-center text-[#8a8070] hover:text-white disabled:opacity-20 transition-colors"
          style={{ background: "rgba(255,255,255,0.05)" }}
        >
          <ChevronLeft size={16} />
        </button>

        {/* Progress dots */}
        <div className="flex items-center gap-1.5">
          {slides.map((_, i) => (
            <button
              key={i}
              onClick={(e) => { e.stopPropagation(); goTo(i); }}
              className="rounded-full transition-all"
              style={{
                width:           i === current ? 20 : 6,
                height:          6,
                backgroundColor: i === current ? "#c9a84c" : "rgba(201,168,76,0.25)",
              }}
            />
          ))}
        </div>

        {/* Next */}
        <button
          onClick={(e) => { e.stopPropagation(); goTo(current + 1); }}
          disabled={current === slides.length - 1}
          className="w-9 h-9 rounded-full flex items-center justify-center text-[#8a8070] hover:text-white disabled:opacity-20 transition-colors"
          style={{ background: "rgba(255,255,255,0.05)" }}
        >
          <ChevronRight size={16} />
        </button>
      </div>
    </div>
  );
}
