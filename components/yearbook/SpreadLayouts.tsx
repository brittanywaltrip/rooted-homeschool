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

// ─── Milestone: win/quote without photo (upgraded) ───────────────────────────

function MilestoneLayout({ spread }: { spread: YearbookSpread }) {
  const m = spread.memories[0];
  if (!m) return null;
  const isQuote = m.type === "quote";
  return (
    <Shell bg="#FAF6EC">
      <div className="flex-1 flex flex-col items-center justify-center text-center px-5 relative">
        {/* Botanical watermarks */}
        <span className="absolute top-3 right-2 text-[50px] opacity-[0.04] select-none pointer-events-none" style={{ transform: "rotate(-15deg)" }}>🌿</span>
        <span className="absolute bottom-4 left-2 text-[36px] opacity-[0.03] select-none pointer-events-none" style={{ transform: "rotate(20deg)" }}>🍃</span>

        <div className="relative z-10 flex flex-col items-center">
          {/* Accent icon */}
          <span className="text-[16px] mb-1">{isQuote ? "💬" : "⭐"}</span>

          {/* Large decorative quote mark */}
          <span className="text-[56px] leading-none text-[#3d5c42] opacity-80" style={{ fontFamily: "Georgia, serif" }}>
            &ldquo;
          </span>

          {/* Win/quote title */}
          <p
            className={`${isQuote ? "italic" : ""} text-[18px] text-[#2d2926] leading-relaxed max-w-[240px] line-clamp-6 -mt-3`}
            style={{ fontFamily: "Georgia, serif" }}
          >
            {m.title}
          </p>

          {/* Botanical divider */}
          <div className="flex items-center gap-2 my-3">
            <div className="w-8 h-px bg-[#c4b89a]" />
            <span className="text-[10px] opacity-30">🌱</span>
            <div className="w-8 h-px bg-[#c4b89a]" />
          </div>

          {/* Attribution */}
          {m.child_name && (
            <p className="text-[9px] font-semibold uppercase tracking-[0.15em] text-[#9a8f85]">
              {m.child_name}
            </p>
          )}
          <p className="text-[8px] text-[#b5aca4] mt-0.5">{safeDateStr(m.created_at)}</p>
        </div>
      </div>
    </Shell>
  );
}

// ─── Milestone right page — "A moment worth remembering" ─────────────────────

function MilestoneRightPage({ spread }: { spread: YearbookSpread }) {
  const m = spread.memories[0];
  const also = spread.metadata?.alsoThisMonth ?? [];
  return (
    <Shell>
      <div className="flex-1 flex flex-col justify-center px-4">
        {/* Header */}
        <p className="text-[8px] font-semibold uppercase tracking-[0.15em] text-[#8cba8e] mb-3">
          A moment worth remembering
        </p>
        <div className="h-px bg-[#ddd5c0] mb-4" style={{ height: 0.5 }} />

        {/* Child name large */}
        {m?.child_name && (
          <p className="text-[20px] text-[#2d2926] mb-1" style={{ fontFamily: "Georgia, serif" }}>
            {m.child_name}
          </p>
        )}
        <p className="text-[9px] text-[#9a8f85] mb-4">{safeDateStr(m?.created_at)}</p>

        {/* Also this month */}
        {also.length > 0 && (
          <div className="mt-auto">
            <p className="text-[8px] font-semibold uppercase tracking-[0.1em] text-[#9a8f85] mb-2">
              Also this month
            </p>
            <div className="space-y-1.5">
              {also.slice(0, 4).map((a) => (
                <div key={a.id} className="flex items-start gap-1.5">
                  <span className="text-[8px] text-[#8cba8e] mt-0.5">•</span>
                  <div>
                    <p className="text-[9px] text-[#2d2926] line-clamp-1" style={{ fontFamily: "Georgia, serif" }}>
                      {a.title}
                    </p>
                    <p className="text-[7px] text-[#b5aca4]">{shortDate(a.created_at)}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {also.length === 0 && (
          <div className="mt-auto">
            <div className="w-9 h-px bg-[#ddd5c0]" />
          </div>
        )}
      </div>
    </Shell>
  );
}

// ─── Milestone with photo (upgraded) ─────────────────────────────────────────

function MilestoneWithPhotoLayout({ spread }: { spread: YearbookSpread }) {
  const m = spread.memories[0];
  if (!m) return null;
  return (
    <Shell>
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Photo — top 60% */}
        {m.photo_url && (
          <div className="rounded-lg overflow-hidden bg-[#f5f0e8] shrink-0" style={{ height: "60%", boxShadow: "0 2px 12px rgba(0,0,0,0.08)" }}>
            <Photo src={m.photo_url} className="w-full h-full" />
          </div>
        )}
        {/* Win title + date below photo */}
        <div className="mt-3 px-1">
          <p className="text-[12px] text-[#2d2926] leading-relaxed line-clamp-3" style={{ fontFamily: "Georgia, serif" }}>
            {m.title}
          </p>
          <p className="text-[8px] text-[#9a8f85] mt-1">{safeDateStr(m.created_at)}</p>
        </div>
      </div>
    </Shell>
  );
}

// ─── Month Divider ───────────────────────────────────────────────────────────

function MonthDividerLeftPage({ spread }: { spread: YearbookSpread }) {
  const md = spread.metadata!;
  return (
    <div className="w-full h-full overflow-hidden relative" style={{ background: "#FAFAF7" }}>
      {/* Botanical watermarks */}
      <span className="absolute top-6 right-4 text-[80px] opacity-[0.04] select-none pointer-events-none" style={{ transform: "rotate(-20deg)" }}>🌿</span>
      <span className="absolute bottom-8 left-3 text-[60px] opacity-[0.03] select-none pointer-events-none" style={{ transform: "rotate(15deg)" }}>🍃</span>
      <span className="absolute top-1/3 left-1/4 text-[40px] opacity-[0.025] select-none pointer-events-none">🌱</span>

      <div className="h-full flex flex-col items-center justify-center text-center px-8 relative z-10">
        <div className="w-12 h-px bg-[#8cba8e]/40 mb-5" />
        <p className="text-[36px] font-bold text-[#2d2926]" style={{ fontFamily: "Georgia, serif" }}>
          {md.monthName}
        </p>
        <p className="text-[10px] text-[#9a8f85] mt-2 tracking-[0.15em] uppercase">
          {md.monthYear}
        </p>
        <div className="w-12 h-px bg-[#8cba8e]/40 mt-5" />
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

// ─── Favorite Things ─────────────────────────────────────────────────────────

const FAVORITE_PROMPTS = [
  { key: "fav_loved", prompt: "This year I loved..." },
  { key: "fav_book", prompt: "My favorite book was..." },
  { key: "fav_surprised", prompt: "Something I learned that surprised me..." },
  { key: "fav_next_year", prompt: "Next year I want to..." },
];

function FavoriteThingsLeftPage({ spread }: { spread: YearbookSpread }) {
  const md = spread.metadata!;
  const answers = md.favoriteAnswers ?? {};
  return (
    <Shell bg="#FAF6EC">
      <div className="flex-1 flex flex-col px-1">
        {/* Header */}
        <p className="text-[8px] font-semibold uppercase tracking-[0.18em] text-[#8cba8e] mb-4">
          {md.childName}&apos;s favorite things
        </p>

        {/* Prompts */}
        <div className="flex-1 flex flex-col justify-between">
          {FAVORITE_PROMPTS.map((p) => {
            const answer = answers[p.key]?.trim();
            return (
              <div key={p.key} className="mb-5">
                <p className="italic text-[11px] text-[#9a8f85] mb-2" style={{ fontFamily: "Georgia, serif" }}>
                  {p.prompt}
                </p>
                {answer ? (
                  <p className="text-[12px] text-[#2d2926] leading-relaxed" style={{ fontFamily: "Georgia, serif" }}>
                    {answer}
                  </p>
                ) : (
                  <div className="h-px bg-[#d4cfc8] mt-4" />
                )}
              </div>
            );
          })}
        </div>

        {/* Botanical divider at bottom */}
        <div className="flex items-center justify-center gap-2 mt-2 shrink-0">
          <div className="w-8 h-px bg-[#c4b89a]" />
          <span className="text-[10px] opacity-30">🍃</span>
          <div className="w-8 h-px bg-[#c4b89a]" />
        </div>
      </div>
    </Shell>
  );
}

function FavoriteThingsRightPage({ spread }: { spread: YearbookSpread }) {
  const md = spread.metadata!;
  const photoUrl = md.latestPhotoUrl;

  if (photoUrl) {
    return (
      <div className="w-full h-full overflow-hidden bg-[#f5f0e8]">
        <Photo src={photoUrl} className="w-full h-full" />
      </div>
    );
  }

  // No photo — elegant fallback
  return (
    <Shell bg="#FAF6EC">
      <div className="flex-1 flex flex-col items-center justify-center text-center px-6">
        <p className="text-[24px] text-[#2d2926] mb-2" style={{ fontFamily: "Georgia, serif" }}>
          {md.childName}
        </p>
        <div className="w-9 h-px bg-[#ddd5c0] my-3" />
        <p className="text-[9px] text-[#9a8f85] tracking-[0.1em] uppercase">
          {spread.memories[0]?.created_at
            ? new Date(spread.memories[0].created_at.slice(0, 10) + "T12:00:00").toLocaleDateString("en-US", { year: "numeric" })
            : ""}
        </p>
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
    case "month_divider":
      return <MonthDividerLeftPage spread={spread} />;
    case "favorite_things":
      return <FavoriteThingsLeftPage spread={spread} />;
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
    case "milestone":
    case "milestone_with_photo":
      return <MilestoneRightPage spread={spread} />;
    case "favorite_things":
      return <FavoriteThingsRightPage spread={spread} />;
    case "month_divider": {
      // Right page of month divider renders the first memory of the month
      // using the appropriate layout
      const m = spread.memories[0];
      if (!m) {
        return (
          <Shell>
            <div className="flex-1 flex items-center justify-center">
              <div className="w-9 h-px bg-[#ddd5c0]" />
            </div>
          </Shell>
        );
      }
      // Render as a mini hero
      if (m.photo_url) {
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
            <p className="text-[8px] text-[#9a8f85] text-center mt-0.5">{shortDate(m.created_at)}</p>
          </Shell>
        );
      }
      // Non-photo memory on right
      return (
        <Shell>
          <div className="flex-1 flex flex-col items-center justify-center text-center px-5">
            <span className="text-[24px] mb-2">{m.type === "win" ? "⭐" : m.type === "quote" ? "💬" : "📝"}</span>
            <p className="text-[11px] text-[#2d2926] leading-relaxed line-clamp-4" style={{ fontFamily: "Georgia, serif" }}>
              {m.title}
            </p>
            {m.child_name && <p className="text-[8px] text-[#9a8f85] mt-2">— {m.child_name}</p>}
            <p className="text-[8px] text-[#b5aca4] mt-0.5">{shortDate(m.created_at)}</p>
          </div>
        </Shell>
      );
    }
    default:
      // Generic right page with date context
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
