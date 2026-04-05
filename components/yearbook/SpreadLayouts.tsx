"use client";

import type { YearbookSpread, YearbookMemory } from "@/lib/yearbook-layout-engine";

// ─── Shared helpers ──────────────────────────────────────────────────────────

function safeDateStr(d: string | null | undefined): string {
  if (!d) return "";
  const dt = new Date(d.slice(0, 10) + "T12:00:00");
  if (isNaN(dt.getTime())) return "";
  return dt.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
}

function shortDate(d: string | null | undefined): string {
  if (!d) return "";
  const dt = new Date(d.slice(0, 10) + "T12:00:00");
  if (isNaN(dt.getTime())) return "";
  return dt.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function Photo({ src, className = "", style }: { src: string; className?: string; style?: React.CSSProperties }) {
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={src} alt="" className={`object-cover ${className}`} style={style} />;
}

// ─── Shell (matches yearbook page dimensions) ────────────────────────────────

function Shell({ children, bg = "#FAFAF7" }: { children: React.ReactNode; bg?: string }) {
  return (
    <div className="w-full h-full overflow-hidden" style={{ background: bg }}>
      <div className="h-full overflow-hidden px-7 py-2 flex flex-col justify-center">
        {children}
      </div>
    </div>
  );
}

// ─── Hero: 1 full-bleed photo ────────────────────────────────────────────────

function HeroLayout({ spread }: { spread: YearbookSpread }) {
  const m = spread.memories[0];
  if (!m?.photo_url) return null;
  return (
    <Shell>
      <div className="w-full rounded-md overflow-hidden bg-[#f5f0e8] flex-1 min-h-0">
        <Photo src={m.photo_url} className="w-full h-full" />
      </div>
      {m.title && (
        <p className="text-[9px] italic text-[#5a5048] mt-2 text-center line-clamp-2" style={{ fontFamily: "Georgia, serif" }}>
          {m.title}
        </p>
      )}
      <p className="text-[8px] text-[#9a8f85] text-center mt-0.5">{safeDateStr(m.created_at)}</p>
    </Shell>
  );
}

// ─── Side by Side: 2 photos ──────────────────────────────────────────────────

function SideBySideLayout({ spread }: { spread: YearbookSpread }) {
  return (
    <Shell>
      <div className="grid grid-cols-2 gap-2 flex-1 min-h-0">
        {spread.memories.slice(0, 2).map((m) => (
          <div key={m.id} className="rounded-md overflow-hidden bg-[#f5f0e8]">
            {m.photo_url && <Photo src={m.photo_url} className="w-full h-full" />}
          </div>
        ))}
      </div>
      <p className="text-[8px] text-[#9a8f85] text-center mt-1.5">{safeDateStr(spread.memories[0]?.created_at)}</p>
    </Shell>
  );
}

// ─── Editorial: 1 large + 2 small ───────────────────────────────────────────

function EditorialLayout({ spread }: { spread: YearbookSpread }) {
  const [hero, ...rest] = spread.memories;
  return (
    <Shell>
      <div className="grid grid-cols-2 gap-2 flex-1 min-h-0">
        <div className="row-span-2 rounded-md overflow-hidden bg-[#f5f0e8]">
          {hero?.photo_url && <Photo src={hero.photo_url} className="w-full h-full" />}
        </div>
        <div className="flex flex-col gap-2">
          {rest.slice(0, 2).map((m) => (
            <div key={m.id} className="flex-1 rounded-md overflow-hidden bg-[#f5f0e8]">
              {m.photo_url && <Photo src={m.photo_url} className="w-full h-full" />}
            </div>
          ))}
        </div>
      </div>
      <p className="text-[8px] text-[#9a8f85] text-center mt-1.5">{safeDateStr(spread.memories[0]?.created_at)}</p>
    </Shell>
  );
}

// ─── Grid: 2x2 ──────────────────────────────────────────────────────────────

function GridLayout({ spread }: { spread: YearbookSpread }) {
  return (
    <Shell>
      <div className="grid grid-cols-2 gap-1.5 flex-1 min-h-0">
        {spread.memories.slice(0, 4).map((m) => (
          <div key={m.id} className="rounded overflow-hidden bg-[#f5f0e8]">
            {m.photo_url && <Photo src={m.photo_url} className="w-full h-full" />}
          </div>
        ))}
      </div>
      <p className="text-[8px] text-[#9a8f85] text-center mt-1.5">{safeDateStr(spread.memories[0]?.created_at)}</p>
    </Shell>
  );
}

// ─── Milestone: win/quote without photo ──────────────────────────────────────

function MilestoneLayout({ spread }: { spread: YearbookSpread }) {
  const m = spread.memories[0];
  if (!m) return null;
  const isQuote = m.type === "quote";
  return (
    <Shell>
      <div className="flex-1 flex flex-col items-center justify-center text-center px-6">
        <span className="text-[40px] mb-3">{isQuote ? "💬" : "⭐"}</span>
        {isQuote && <span className="text-[36px] font-serif text-[#c4b0e0] leading-none">&ldquo;</span>}
        <p
          className={`${isQuote ? "italic" : ""} text-[13px] text-[#2d2926] leading-relaxed max-w-[260px] line-clamp-6`}
          style={{ fontFamily: "Georgia, serif" }}
        >
          {m.title}
        </p>
        {isQuote && <span className="text-[36px] font-serif text-[#c4b0e0] leading-none">&rdquo;</span>}
        {m.child_name && (
          <p className="text-[10px] text-[#9a8f85] mt-3">— {m.child_name}</p>
        )}
        <p className="text-[8px] text-[#b5aca4] mt-1">{safeDateStr(m.created_at)}</p>
      </div>
    </Shell>
  );
}

// ─── Milestone with photo: photo left, text right ────────────────────────────

function MilestoneWithPhotoLayout({ spread }: { spread: YearbookSpread }) {
  const m = spread.memories[0];
  if (!m) return null;
  const isQuote = m.type === "quote";
  return (
    <div className="w-full h-full flex overflow-hidden" style={{ background: "#FAFAF7" }}>
      {/* Photo half */}
      <div className="w-1/2 h-full bg-[#f5f0e8]">
        {m.photo_url && <Photo src={m.photo_url} className="w-full h-full" />}
      </div>
      {/* Text half */}
      <div className="w-1/2 h-full flex flex-col items-center justify-center px-5 text-center">
        <span className="text-[28px] mb-2">{isQuote ? "💬" : "⭐"}</span>
        <div className="bg-[#f0ede5] rounded-xl p-4 border-l-2 border-[#8cba8e] max-w-[220px]">
          {isQuote && <span className="text-[24px] font-serif text-[#c4b0e0] leading-none">&ldquo;</span>}
          <p
            className={`${isQuote ? "italic" : ""} text-[11px] text-[#2d2926] leading-relaxed line-clamp-5`}
            style={{ fontFamily: "Georgia, serif" }}
          >
            {m.title}
          </p>
        </div>
        {m.child_name && (
          <p className="text-[9px] text-[#9a8f85] mt-2">— {m.child_name}</p>
        )}
        <p className="text-[8px] text-[#b5aca4] mt-1">{safeDateStr(m.created_at)}</p>
      </div>
    </div>
  );
}

// ─── Books: list of books read ───────────────────────────────────────────────

function BooksLeftPage({ spread }: { spread: YearbookSpread }) {
  const childName = spread.metadata?.childName ?? "";
  return (
    <Shell>
      <div className="shrink-0">
        <p className="text-[9px] text-[#8cba8e]">Reading list</p>
        <h2 className="text-[14px] font-bold text-[#2d2926] mt-0.5" style={{ fontFamily: "var(--font-display)" }}>
          Books {childName} read this year
        </h2>
        <div className="h-px bg-[#ddd5c0] my-2" style={{ height: 0.5 }} />
      </div>
      <div className="flex-1 min-h-0 overflow-hidden space-y-2">
        {spread.memories.map((m) => (
          <div key={m.id} className="flex items-start gap-2">
            <span className="text-[12px] shrink-0 mt-0.5">📖</span>
            <div>
              <p className="text-[10px] text-[#2d2926] line-clamp-1" style={{ fontFamily: "Georgia, serif" }}>
                {m.title ?? "Untitled"}
              </p>
              <p className="text-[8px] text-[#9a8f85]">{shortDate(m.created_at)}</p>
            </div>
          </div>
        ))}
      </div>
    </Shell>
  );
}

function BooksRightPage({ spread }: { spread: YearbookSpread }) {
  return (
    <Shell>
      <div className="flex-1 flex flex-col items-center justify-center text-center px-6">
        <p className="text-[48px] font-bold text-[#3d5c42]" style={{ fontFamily: "Georgia, serif" }}>
          {spread.memories.length}
        </p>
        <p className="text-[11px] text-[#9a8f85] mt-1">books read this year</p>
        <div className="w-9 h-px bg-[#ddd5c0] my-4" />
        <p className="italic text-[10px] text-[#5a5048] leading-relaxed max-w-[200px]" style={{ fontFamily: "Georgia, serif" }}>
          Every book is a window into a new world.
        </p>
      </div>
    </Shell>
  );
}

// ─── Year in Numbers ─────────────────────────────────────────────────────────

function YearInNumbersLeftPage({ spread }: { spread: YearbookSpread }) {
  const md = spread.metadata!;
  const stats = [
    { value: md.totalMemories ?? 0, label: "Memories captured", emoji: "📸" },
    { value: md.totalPhotos ?? 0, label: "Photos", emoji: "🖼️" },
    { value: md.totalWins ?? 0, label: "Wins celebrated", emoji: "⭐" },
    { value: md.totalBooks ?? 0, label: "Books read", emoji: "📖" },
    { value: md.totalFieldTrips ?? 0, label: "Field trips", emoji: "🗺️" },
    { value: md.activeDays ?? 0, label: "Active days", emoji: "📅" },
  ];
  return (
    <Shell>
      <div className="shrink-0 mb-3">
        <h2 className="text-[16px] font-bold text-[#2d2926]" style={{ fontFamily: "Georgia, serif" }}>
          Our year in numbers
        </h2>
        <p className="text-[9px] text-[#9a8f85] mt-0.5">{md.familyName}</p>
        <div className="h-px bg-[#ddd5c0] my-2" style={{ height: 0.5 }} />
      </div>
      <div className="grid grid-cols-2 gap-3 flex-1 min-h-0">
        {stats.map((s) => (
          <div key={s.label} className="bg-[#eeeade] rounded-lg p-3 flex flex-col items-center justify-center text-center">
            <span className="text-[14px] mb-1">{s.emoji}</span>
            <p className="text-[28px] font-bold text-[#3d5c42] leading-none" style={{ fontFamily: "Georgia, serif" }}>
              {s.value}
            </p>
            <p className="text-[8px] text-[#9a8f85] mt-1">{s.label}</p>
          </div>
        ))}
      </div>
    </Shell>
  );
}

function YearInNumbersRightPage({ spread }: { spread: YearbookSpread }) {
  const md = spread.metadata!;
  return (
    <Shell>
      <div className="flex-1 flex flex-col items-center justify-center text-center px-6 relative">
        {/* Botanical decorations */}
        <span className="absolute top-4 right-2 text-[60px] opacity-[0.06] select-none pointer-events-none" style={{ transform: "rotate(-15deg)" }}>🌿</span>
        <span className="absolute bottom-6 left-2 text-[48px] opacity-[0.05] select-none pointer-events-none" style={{ transform: "rotate(20deg)" }}>🍃</span>
        <span className="absolute top-1/4 left-1/3 text-[36px] opacity-[0.04] select-none pointer-events-none">🌱</span>

        <div className="relative z-10">
          <div className="w-9 h-px bg-[#ddd5c0] mx-auto mb-4" />
          <p className="text-[18px] font-bold text-[#2d2926]" style={{ fontFamily: "Georgia, serif" }}>
            {md.yearLabel}
          </p>
          <div className="w-9 h-px bg-[#ddd5c0] mx-auto my-4" />
          <p className="italic text-[10px] text-[#5a5048] leading-relaxed max-w-[200px]" style={{ fontFamily: "Georgia, serif" }}>
            Every lesson. Every memory.<br />Every milestone.
          </p>
          <div className="w-9 h-px bg-[#ddd5c0] mx-auto mt-4" />
        </div>
      </div>
    </Shell>
  );
}

// ─── Mixed: fallback layout ──────────────────────────────────────────────────

function MixedLayout({ spread }: { spread: YearbookSpread }) {
  return (
    <Shell>
      <div className="space-y-2 flex-1 min-h-0 overflow-hidden">
        {spread.memories.map((m) => (
          <div key={m.id} className="bg-[#f0ede5] rounded-lg p-2 border-l-2 border-[#8cba8e]">
            <p className="text-[7px] uppercase tracking-wider text-[#5c7f63] mb-0.5">
              {m.type === "field_trip" ? "🗺️ Trip" : m.type === "project" ? "🎨 Project" : "📝 Memory"}
            </p>
            <p className="text-[9px] text-[#2d2926] line-clamp-2" style={{ fontFamily: "Georgia, serif" }}>{m.title}</p>
            <p className="text-[8px] text-[#9a8f85] mt-0.5">{shortDate(m.created_at)}</p>
          </div>
        ))}
      </div>
    </Shell>
  );
}

// ─── Main Renderer ───────────────────────────────────────────────────────────

export function SpreadLeftPage({ spread }: { spread: YearbookSpread }) {
  switch (spread.layoutType) {
    case "hero":
      return <HeroLayout spread={spread} />;
    case "side_by_side":
      return <SideBySideLayout spread={spread} />;
    case "editorial":
      return <EditorialLayout spread={spread} />;
    case "grid":
      return <GridLayout spread={spread} />;
    case "milestone":
      return <MilestoneLayout spread={spread} />;
    case "milestone_with_photo":
      return <MilestoneWithPhotoLayout spread={spread} />;
    case "books":
      return <BooksLeftPage spread={spread} />;
    case "year_in_numbers":
      return <YearInNumbersLeftPage spread={spread} />;
    case "mixed":
      return <MixedLayout spread={spread} />;
    default:
      return <MixedLayout spread={spread} />;
  }
}

export function SpreadRightPage({ spread }: { spread: YearbookSpread }) {
  switch (spread.layoutType) {
    case "books":
      return <BooksRightPage spread={spread} />;
    case "year_in_numbers":
      return <YearInNumbersRightPage spread={spread} />;
    default:
      // Single-page layouts get a minimal right page with date context
      return (
        <Shell>
          <div className="flex-1 flex flex-col items-center justify-center text-center px-6">
            <div className="w-9 h-px bg-[#ddd5c0] mb-4" />
            {spread.memories[0]?.created_at && (
              <p className="text-[9px] text-[#9a8f85]">{safeDateStr(spread.memories[0].created_at)}</p>
            )}
            {spread.memories[0]?.child_name && (
              <p className="text-[9px] text-[#b5aca4] mt-1">{spread.memories[0].child_name}</p>
            )}
            <div className="w-9 h-px bg-[#ddd5c0] mt-4" />
          </div>
        </Shell>
      );
  }
}
