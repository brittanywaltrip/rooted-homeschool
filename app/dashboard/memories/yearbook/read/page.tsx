"use client";

import { useEffect, useState, useCallback, useRef, ReactNode } from "react";
import { supabase } from "@/lib/supabase";
import { usePartner } from "@/lib/partner-context";
import Link from "next/link";

// ─── Types ────────────────────────────────────────────────────────────────────

type Child = { id: string; name: string; color: string | null };

type MemoryRow = {
  id: string;
  child_id: string | null;
  date: string;
  type: string;
  title: string | null;
  caption: string | null;
  photo_url: string | null;
  include_in_book: boolean;
};

type YearbookContentRow = {
  content_type: string;
  child_id: string | null;
  question_key: string | null;
  content: string;
};

interface SpreadDef {
  id: string;
  label: string;
  leftContent: ReactNode;
  rightContent: ReactNode;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const INTERVIEW_QUESTIONS = [
  { key: "q_loved_learning", label: "What did you love learning about this year?" },
  { key: "q_favorite_book", label: "What book did you love most?" },
  { key: "q_got_easier", label: "What got easier this year?" },
  { key: "q_learn_next_year", label: "What do you want to learn next year?" },
  { key: "q_favorite_adventure", label: "What was your favorite adventure?" },
  { key: "q_surprised_you", label: "What surprised you this year?" },
] as const;

// ─── Spine Component ──────────────────────────────────────────────────────────

function Spine() {
  return (
    <div
      className="w-[3px] shrink-0"
      style={{
        background: "#2d2522",
        backgroundImage: "repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(255,255,255,0.04) 2px, rgba(255,255,255,0.04) 4px)",
      }}
    />
  );
}

// ─── Page Wrapper ─────────────────────────────────────────────────────────────

function PageShell({ children, bg = "#faf6f0", pageNum, align = "left" }: {
  children: ReactNode;
  bg?: string;
  pageNum?: number;
  align?: "left" | "right";
}) {
  return (
    <div className="relative flex flex-col w-full h-full overflow-hidden" style={{ background: bg }}>
      {align === "left" && <Spine />}
      <div className="flex-1 overflow-y-auto px-10 py-4 flex flex-col justify-center">
        {children}
      </div>
      {pageNum !== undefined && (
        <span className={`absolute bottom-2 text-[9px] text-[#b5aca4] ${align === "left" ? "left-10" : "right-10"}`}>
          {pageNum}
        </span>
      )}
    </div>
  );
}

// ─── Photo Grid — adaptive layout based on count ─────────────────────────────

function PhotoGrid({ photos }: { photos: MemoryRow[] }) {
  if (photos.length === 0) return null;

  if (photos.length === 1) {
    return (
      <div className="w-full rounded-md overflow-hidden" style={{ aspectRatio: "4/3" }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={photos[0].photo_url!} alt="" className="w-full h-full object-cover" />
      </div>
    );
  }

  if (photos.length === 2) {
    return (
      <div className="grid grid-cols-2 gap-1.5">
        {photos.map((p) => (
          <div key={p.id} className="aspect-square rounded overflow-hidden">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={p.photo_url!} alt="" className="w-full h-full object-cover" />
          </div>
        ))}
      </div>
    );
  }

  if (photos.length === 3) {
    return (
      <div className="space-y-1.5">
        <div className="w-full rounded-md overflow-hidden" style={{ aspectRatio: "16/9" }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={photos[0].photo_url!} alt="" className="w-full h-full object-cover" />
        </div>
        <div className="grid grid-cols-2 gap-1.5">
          {photos.slice(1).map((p) => (
            <div key={p.id} className="aspect-square rounded overflow-hidden">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={p.photo_url!} alt="" className="w-full h-full object-cover" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  // 4+: 2×2 grid
  return (
    <div className="grid grid-cols-2 gap-1.5">
      {photos.slice(0, 4).map((p) => (
        <div key={p.id} className="aspect-square rounded overflow-hidden">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={p.photo_url!} alt="" className="w-full h-full object-cover" />
        </div>
      ))}
    </div>
  );
}

// ─── Page Component ───────────────────────────────────────────────────────────

export default function YearbookReadPage() {
  const { effectiveUserId } = usePartner();
  const [loading, setLoading] = useState(true);
  const [memories, setMemories] = useState<MemoryRow[]>([]);
  const [children, setChildren] = useState<Child[]>([]);
  const [contentMap, setContentMap] = useState<Record<string, string>>({});
  const [profile, setProfile] = useState<{ display_name?: string; yearbook_opened_at?: string; yearbook_closed_at?: string }>({});
  const [yearbookKey, setYearbookKey] = useState("");
  const [currentPage, setCurrentPage] = useState(0);
  const touchStartRef = useRef(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const [swipeHintVisible, setSwipeHintVisible] = useState(true);

  // ── Content key helper ──────────────────────────────────────────────────────

  function ck(contentType: string, childId?: string | null, questionKey?: string | null) {
    return `${contentType}:${childId ?? "null"}:${questionKey ?? "null"}`;
  }

  // ── Load data ───────────────────────────────────────────────────────────────

  useEffect(() => {
    if (!effectiveUserId) return;
    (async () => {
      const { data: prof } = await supabase
        .from("profiles")
        .select("display_name, yearbook_opened_at, yearbook_closed_at")
        .eq("id", effectiveUserId)
        .single();

      let openedAt = prof?.yearbook_opened_at;
      if (!openedAt) {
        // Fall back to school year start
        const now = new Date();
        const schoolYearStartMonth = 7;
        const sy = now.getMonth() >= schoolYearStartMonth ? now.getFullYear() : now.getFullYear() - 1;
        openedAt = new Date(sy, schoolYearStartMonth, 1).toISOString();
      }

      setProfile(prof ?? {});
      // Use UTC to avoid timezone shift (e.g. "2025-08-01" → July 31 in US timezones)
      const m = new Date(openedAt).getUTCMonth();
      const y = new Date(openedAt).getUTCFullYear();
      const startYear = m >= 7 ? y : y - 1;
      const key = `${startYear}-${String(startYear + 1).slice(2)}`;
      setYearbookKey(key);

      let memsQuery = supabase
        .from("memories")
        .select("id, child_id, date, type, title, caption, photo_url, include_in_book")
        .eq("user_id", effectiveUserId)
        .eq("include_in_book", true)
        .gte("date", openedAt.slice(0, 10))
        .order("date", { ascending: true });

      if (prof?.yearbook_closed_at) {
        memsQuery = memsQuery.lte("date", prof.yearbook_closed_at.slice(0, 10));
      }

      const [{ data: mems }, { data: kids }, { data: ybRows }] = await Promise.all([
        memsQuery,
        supabase.from("children").select("id, name, color")
          .eq("user_id", effectiveUserId).eq("archived", false).order("sort_order"),
        supabase.from("yearbook_content").select("content_type, child_id, question_key, content")
          .eq("user_id", effectiveUserId).eq("yearbook_key", key),
      ]);

      setMemories((mems ?? []) as MemoryRow[]);
      setChildren((kids ?? []) as Child[]);

      const cMap: Record<string, string> = {};
      for (const r of (ybRows ?? []) as YearbookContentRow[]) {
        cMap[ck(r.content_type, r.child_id, r.question_key)] = r.content;
      }
      setContentMap(cMap);
      setLoading(false);
    })();
  }, [effectiveUserId]);

  // ── Keyboard navigation ─────────────────────────────────────────────────────

  const maxPageRef = useRef(0);
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === "ArrowRight") setCurrentPage((p) => Math.min(p + 1, maxPageRef.current));
      if (e.key === "ArrowLeft") setCurrentPage((p) => Math.max(0, p - 1));
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, []);

  // ── Build spreads ───────────────────────────────────────────────────────────

  const familyName = profile.display_name ?? "Our Family";
  const yearLabel = yearbookKey
    ? `${yearbookKey.split("-")[0]}\u201320${yearbookKey.split("-")[1]}`
    : "";
  const photoCount = memories.filter((m) => m.type === "photo" || m.type === "drawing").length;
  const bookCount = memories.filter((m) => m.type === "book").length;
  const winCount = memories.filter((m) => m.type === "win").length;
  const quoteCount = memories.filter((m) => m.type === "quote").length;

  const letterText = contentMap[ck("letter_from_home")] ?? "";
  const favMemId = contentMap[ck("letter_favorite_memory_id")] ?? "";
  const favCaption = contentMap[ck("letter_favorite_caption")] ?? "";
  const favQuoteVal = contentMap[ck("letter_favorite_quote")] ?? "";
  const favMemory = favMemId ? memories.find((m) => m.id === favMemId) : null;
  const favQuoteMemory = favQuoteVal && !favQuoteVal.startsWith("text:") ? memories.find((m) => m.id === favQuoteVal) : null;
  const favQuoteText = favQuoteVal.startsWith("text:") ? favQuoteVal.slice(5) : (favQuoteMemory?.title ?? "");

  const familyMemories = memories.filter((m) => !m.child_id);

  // Compute child page numbers
  let pageCounter = 4; // cover left, cover right (TOC), letter left, letter right
  const childPageMap: Record<string, number> = {};
  for (const c of children) {
    childPageMap[c.id] = pageCounter + 1; // 1-indexed for display
    pageCounter += 2; // one spread per child
  }
  const familyPageNum = pageCounter + 1;
  const villagePageNum = familyPageNum + 2;

  const spreads: SpreadDef[] = [];

  // 1. COVER SPREAD
  spreads.push({
    id: "cover",
    label: "Cover",
    leftContent: (
      <div className="relative flex flex-col w-full h-full overflow-hidden" style={{ background: "#3d5c42" }}>
        {/* Layered botanical watermarks */}
        <span className="absolute top-6 right-4 text-[120px] opacity-[0.06] select-none pointer-events-none" style={{ transform: "rotate(-15deg)" }}>🌿</span>
        <span className="absolute bottom-10 left-3 text-[100px] opacity-[0.05] select-none pointer-events-none" style={{ transform: "rotate(20deg)" }}>🍃</span>
        <span className="absolute top-1/3 left-1/2 -translate-x-1/2 text-[160px] opacity-[0.03] select-none pointer-events-none">🌱</span>

        <div className="flex-1 flex flex-col items-center justify-center p-6 relative z-10 text-center">
          <div className="w-12 h-px bg-[#8cba8e]/40 mb-5" />

          <p className="text-[10px] font-semibold tracking-[0.2em] uppercase text-[#8cba8e] mb-3">
            {yearLabel}
          </p>

          <h1 className="text-[28px] leading-snug text-[#fefcf9]" style={{ fontFamily: "Georgia, serif" }}>
            The {familyName}<br />Yearbook
          </h1>

          <div className="w-9 h-px bg-[#8cba8e]/30 my-5" />

          <p className="text-[11px] text-white/45 italic max-w-[220px]" style={{ fontFamily: "Georgia, serif" }}>
            A year of learning, growing,{"\n"}and making memories
          </p>

          <Link
            href="/dashboard/memories/yearbook/edit"
            className="mt-6 inline-flex items-center gap-1.5 bg-white/10 text-[11px] text-[#c8e6c4] font-medium px-4 py-2 rounded-lg transition-colors active:bg-white/15"
          >
            ✚ Add a cover photo
          </Link>
        </div>

        <div className="flex justify-between items-center px-5 pb-4 relative z-10">
          <span className="text-[9px] tracking-[0.18em] text-[#8cba8e]/60">ROOTED</span>
          <span className="bg-white/10 text-[9px] text-[#c8e6c4] px-3 py-1 rounded-full">
            {memories.length} memories
          </span>
        </div>
      </div>
    ),
    rightContent: (
      <PageShell pageNum={1} align="right">
        <div className="flex-1 flex flex-col items-center justify-center text-center px-4">
          <span className="text-[48px] font-serif text-[#8cba8e] leading-none">&ldquo;</span>
          <p className="italic text-[11px] text-[#5a5048] leading-relaxed max-w-[200px] mt-1" style={{ fontFamily: "Georgia, serif" }}>
            Every lesson, every photo, every little moment — Rooted holds onto it all.
          </p>
          <div className="w-9 h-px bg-[#ddd5c0] my-4" />
          <div className="space-y-1 text-[10px] text-[#9a8f85]" style={{ lineHeight: 2.0 }}>
            <p>A letter from home · p. 2</p>
            {children.map((c) => (
              <p key={c.id}>{c.name}&apos;s chapter · p. {childPageMap[c.id] ?? "–"}</p>
            ))}
            <p>Our family · p. {familyPageNum}</p>
            <p>From the village · p. {villagePageNum}</p>
          </div>
        </div>
      </PageShell>
    ),
  });

  // 2. LETTER FROM HOME SPREAD
  spreads.push({
    id: "letter",
    label: "Letter from home",
    leftContent: (
      <PageShell pageNum={2} align="left">
        <div className="relative">
          <Link href="/dashboard/memories/yearbook/edit" className="absolute top-0 right-0 text-[#c4b89a] hover:text-[#3d5c42] transition-colors">
            <span className="text-sm">✏️</span>
          </Link>
          <p className="text-[9px] font-semibold uppercase tracking-[0.1em] text-[#8cba8e]">Written for our family</p>
          <h2 className="text-[16px] font-bold text-[#2d2926] mt-1" style={{ fontFamily: "var(--font-display)" }}>A letter from home</h2>
          <p className="text-[9px] text-[#b5aca4] mt-0.5">A message from the heart</p>
          <div className="h-px bg-[#ddd5c0] my-3" style={{ height: 0.5 }} />
        </div>
        <div className="flex-1 flex flex-col">
          {letterText.trim() ? (
            <>
              <p className="text-[10px] italic text-[#4a4540] leading-relaxed whitespace-pre-wrap" style={{ fontFamily: "Georgia, serif" }}>
                {letterText}
              </p>
              <p className="italic text-[11px] text-[#5c7f63] mt-3" style={{ fontFamily: "Georgia, serif" }}>With love</p>
            </>
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center text-center px-2">
              <span className="text-[36px] mb-3 opacity-50">✉️</span>
              <p className="text-[12px] italic text-[#c4b89a] leading-relaxed" style={{ fontFamily: "Georgia, serif" }}>
                Your letter will go here —<br />a message to your family, from the heart.
              </p>
              <Link href="/dashboard/memories/yearbook/edit" className="mt-3 text-[10px] text-[#8cba8e] font-medium">
                Write your letter →
              </Link>
            </div>
          )}
        </div>
        <div>
          <div className="h-px bg-[#ddd5c0] my-3" style={{ height: 0.5 }} />
          <p className="text-[8px] uppercase tracking-wider text-[#9a8f85] mb-2">Our year</p>
          <div className="flex gap-2">
            {[
              { n: photoCount, l: "photos" },
              { n: winCount, l: "wins" },
              { n: bookCount, l: "books" },
              { n: quoteCount, l: "quotes" },
            ].map((s) => (
              <div key={s.l} className="bg-[#eeeade] rounded px-2 py-1 text-center flex-1">
                <p className="text-[15px] font-bold text-[#3d5c42]">{s.n}</p>
                <p className="text-[7px] text-[#9a8f85]">{s.l}</p>
              </div>
            ))}
          </div>
        </div>
      </PageShell>
    ),
    rightContent: (
      <PageShell pageNum={3} align="right">
        <div className="relative shrink-0">
          <Link href="/dashboard/memories/yearbook/edit" className="absolute top-0 right-0 text-[#c4b89a] hover:text-[#3d5c42] transition-colors">
            <span className="text-sm">✏️</span>
          </Link>
        </div>
        {/* Favorite moment */}
        <div className="mb-4">
          <p className="text-[8px] uppercase tracking-wider text-[#9a8f85] mb-2">Favorite moment</p>
          {favMemory ? (
            <div>
              {favMemory.photo_url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={favMemory.photo_url} alt="" className="w-full rounded-md object-cover" style={{ aspectRatio: "4/3" }} />
              ) : (
                <div className="w-full rounded-md bg-[#eaf3de] flex items-center justify-center p-4" style={{ aspectRatio: "4/3" }}>
                  <p className="text-sm font-medium text-[#3d5c42] text-center">{favMemory.title}</p>
                </div>
              )}
              <p className="text-[8px] text-[#9a8f85] mt-1">
                {new Date(favMemory.date + "T12:00:00").toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}
              </p>
              {favCaption && (
                <p className="italic text-[9px] text-[#4a4540] mt-1" style={{ fontFamily: "Georgia, serif" }}>{favCaption}</p>
              )}
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center text-center py-6">
              <span className="text-[32px] mb-2 opacity-40">📷</span>
              <p className="text-[10px] italic text-[#c4b89a]" style={{ fontFamily: "Georgia, serif" }}>
                Your favorite moment will shine here
              </p>
              <Link href="/dashboard/memories/yearbook/edit" className="mt-2 text-[9px] text-[#8cba8e] font-medium">
                Choose in editor →
              </Link>
            </div>
          )}
        </div>

        <div className="h-px bg-[#ddd5c0] my-3" style={{ height: 0.5 }} />

        {/* Favorite quote */}
        <div>
          {favQuoteText ? (
            <div>
              <span className="text-[28px] font-serif text-[#c4b0e0] leading-none">&ldquo;</span>
              <p className="italic text-[9px] text-[#2d2926]" style={{ fontFamily: "Georgia, serif" }}>{favQuoteText}</p>
              {favQuoteMemory?.child_id && (
                <p className="text-[8px] text-[#9a8f85] mt-1">
                  — {children.find((c) => c.id === favQuoteMemory.child_id)?.name ?? ""}
                </p>
              )}
            </div>
          ) : (
            <div className="text-center py-3">
              <span className="text-[28px] font-serif text-[#c4b0e0]/30 leading-none">&ldquo;</span>
              <p className="italic text-[10px] text-[#c4b89a]" style={{ fontFamily: "Georgia, serif" }}>
                A favorite quote will live here
              </p>
            </div>
          )}
        </div>
      </PageShell>
    ),
  });

  // 3. PER-CHILD SPREADS
  children.forEach((child, ci) => {
    const childMems = memories.filter((m) => m.child_id === child.id);
    const childPhotos = childMems.filter((m) => m.photo_url);
    const childQuotes = childMems.filter((m) => m.type === "quote");
    const childWins = childMems.filter((m) => m.type === "win");
    const latestQuote = childQuotes[childQuotes.length - 1];
    const latestWin = childWins[childWins.length - 1];
    const pageBase = (childPageMap[child.id] ?? 5);

    spreads.push({
      id: `child-${child.id}`,
      label: `${child.name}'s chapter`,
      leftContent: (
        <PageShell pageNum={pageBase} align="left">
          <div>
            <p className="text-[9px] text-[#8cba8e]">Chapter {ci + 1}</p>
            <h2 className="text-[16px] font-bold text-[#2d2926] mt-0.5" style={{ fontFamily: "var(--font-display)" }}>
              {child.name}&apos;s year
            </h2>
            <p className="text-[9px] text-[#b5aca4] mt-0.5">
              {childMems.length} memories
            </p>
            <div className="h-px bg-[#ddd5c0] my-2" style={{ height: 0.5 }} />
          </div>

          {/* Featured quote */}
          {latestQuote && (
            <div className="mb-3">
              <span className="text-[24px] font-serif text-[#c4b0e0] leading-none">&ldquo;</span>
              <p className="italic text-[9px] text-[#2d2926]" style={{ fontFamily: "Georgia, serif" }}>{latestQuote.title}</p>
              <p className="text-[8px] text-[#9a8f85] mt-0.5">
                {new Date(latestQuote.date + "T12:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" })}
              </p>
            </div>
          )}

          {/* Photo grid — adaptive layout */}
          {childPhotos.length > 0 && (
            <div className="mb-3">
              <PhotoGrid photos={childPhotos.slice(0, 4)} />
            </div>
          )}

          {/* Win card */}
          {latestWin && (
            <div className="bg-[#f0ede5] rounded-lg p-2 border-l-2 border-[#8cba8e] mb-2">
              <p className="text-[7px] uppercase tracking-wider text-[#5c7f63] mb-0.5">Win</p>
              <p className="text-[9px] text-[#2d2926]" style={{ fontFamily: "Georgia, serif" }}>{latestWin.title}</p>
            </div>
          )}

          {/* Stats */}
          <div className="flex gap-2 mt-auto">
            {[
              { n: childWins.length, l: "wins" },
              { n: childMems.filter((m) => m.type === "book").length, l: "books" },
            ].map((s) => (
              <div key={s.l} className="bg-[#eeeade] rounded px-2 py-1 text-center flex-1">
                <p className="text-[13px] font-bold text-[#3d5c42]">{s.n}</p>
                <p className="text-[7px] text-[#9a8f85]">{s.l}</p>
              </div>
            ))}
          </div>
        </PageShell>
      ),
      rightContent: (
        <PageShell pageNum={pageBase + 1} align="right">
          <div className="relative">
            <Link href="/dashboard/memories/yearbook/edit" className="absolute top-0 right-0 text-[#c4b89a] hover:text-[#3d5c42] transition-colors">
              <span className="text-sm">✏️</span>
            </Link>
            <p className="text-[9px] text-[#8cba8e]">{child.name} in their own words</p>
            <h3 className="text-[14px] font-bold text-[#2d2926] mt-0.5" style={{ fontFamily: "var(--font-display)" }}>
              Year-end interview
            </h3>
            <div className="h-px bg-[#ddd5c0] my-2" style={{ height: 0.5 }} />
          </div>

          <div className="space-y-2.5">
            {INTERVIEW_QUESTIONS.slice(0, 4).map((q) => {
              const answer = contentMap[ck("child_interview", child.id, q.key)] ?? "";
              return (
                <div key={q.key}>
                  <p className="italic text-[8px] text-[#9a8f85]">{q.label}</p>
                  {answer.trim() ? (
                    <p className="text-[9px] text-[#2d2926] leading-relaxed" style={{ fontFamily: "Georgia, serif" }}>{answer}</p>
                  ) : (
                    <p className="italic text-[9px] text-[#c4b89a] leading-relaxed">—</p>
                  )}
                </div>
              );
            })}
          </div>

          <div className="h-px bg-[#ddd5c0] my-2" style={{ height: 0.5 }} />

          {/* Future note — always visible within page bounds */}
          {(() => {
            const note = contentMap[ck("child_future_note", child.id)] ?? "";
            return (
              <div className="bg-[#faf6ec] border-l-2 border-[#e8c44a] rounded-r-lg p-2 shrink-0">
                <p className="text-[7px] uppercase tracking-wider text-[#ba9a2e] font-semibold mb-0.5">
                  A note to future {child.name}
                </p>
                {note.trim() ? (
                  <>
                    <p className="italic text-[9px] text-[#2d2926] line-clamp-3" style={{ fontFamily: "Georgia, serif" }}>{note}</p>
                    <p className="text-[8px] text-[#9a8f85] mt-1">{child.name}</p>
                  </>
                ) : (
                  <p className="italic text-[9px] text-[#c4b89a]">
                    Ask {child.name} to write a note to their future self
                  </p>
                )}
              </div>
            );
          })()}
        </PageShell>
      ),
    });
  });

  // 4. FAMILY MEMORIES SPREAD
  const famPhotos = familyMemories.filter((m) => m.photo_url);
  const famWins = familyMemories.filter((m) => m.type === "win" || m.type === "field_trip");

  spreads.push({
    id: "family",
    label: "Our family",
    leftContent: (
      <PageShell pageNum={familyPageNum} align="left">
        <p className="text-[9px] text-[#8cba8e]">Together</p>
        <h2 className="text-[16px] font-bold text-[#2d2926] mt-0.5" style={{ fontFamily: "var(--font-display)" }}>Our family</h2>
        <p className="text-[9px] text-[#b5aca4] mt-0.5">{familyMemories.length} shared memories</p>
        <div className="h-px bg-[#ddd5c0] my-2" style={{ height: 0.5 }} />

        {familyMemories.length > 0 ? (
          <div className="space-y-2">
            {famPhotos.length > 0 && (
              <>
                <PhotoGrid photos={famPhotos.slice(0, 3)} />
                <p className="text-[8px] italic text-[#9a8f85]" style={{ fontFamily: "Georgia, serif" }}>
                  {new Date(famPhotos[0].date + "T12:00:00").toLocaleDateString("en-US", { month: "long", day: "numeric" })}
                </p>
              </>
            )}
            {famWins.map((w) => (
              <div key={w.id} className="bg-[#f0ede5] rounded-lg p-2 border-l-2 border-[#8cba8e]">
                <p className="text-[7px] uppercase tracking-wider text-[#5c7f63]">{w.type === "field_trip" ? "Trip" : "Win"}</p>
                <p className="text-[9px] text-[#2d2926]" style={{ fontFamily: "Georgia, serif" }}>{w.title}</p>
              </div>
            ))}
          </div>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center text-center px-4">
            <span className="text-[36px] mb-3 opacity-40">👨‍👩‍👧‍👦</span>
            <p className="text-[11px] italic text-[#c4b89a] leading-relaxed" style={{ fontFamily: "Georgia, serif" }}>
              Family memories will fill these pages —<br />add memories without choosing a specific child.
            </p>
          </div>
        )}
      </PageShell>
    ),
    rightContent: (
      <PageShell pageNum={familyPageNum + 1} align="right">
        {famPhotos.length > 3 ? (
          <div className="flex-1 flex flex-col justify-center">
            <PhotoGrid photos={famPhotos.slice(3, 7)} />
          </div>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center text-center px-4">
            <div className="w-9 h-px bg-[#ddd5c0] mb-4" />
            <p className="italic text-[10px] text-[#c4b89a] leading-relaxed" style={{ fontFamily: "Georgia, serif" }}>
              More family photos will appear here as you add them.
            </p>
            <div className="w-9 h-px bg-[#ddd5c0] mt-4" />
          </div>
        )}
      </PageShell>
    ),
  });

  // 5. FROM THE VILLAGE SPREAD
  spreads.push({
    id: "village",
    label: "From the village",
    leftContent: (
      <PageShell pageNum={villagePageNum} align="left">
        <p className="text-[9px] text-[#8cba8e]">The people who love you</p>
        <h2 className="text-[16px] font-bold text-[#2d2926] mt-0.5" style={{ fontFamily: "var(--font-display)" }}>From the village</h2>
        <p className="text-[9px] text-[#b5aca4] mt-0.5">0 messages</p>
        <div className="h-px bg-[#ddd5c0] my-2" style={{ height: 0.5 }} />

        <div className="flex-1 flex flex-col items-center justify-center text-center px-2">
          <p className="italic text-[10px] text-[#9a8f85] leading-relaxed" style={{ fontFamily: "Georgia, serif" }}>
            Messages from family will appear here once family members sign your yearbook.
          </p>
          <Link
            href="/dashboard/settings"
            className="mt-4 inline-flex items-center gap-1 text-[11px] text-[#3d5c42] font-medium border border-[#c0dd97] rounded-lg px-3 py-2 hover:bg-[#eaf3de] transition-colors"
          >
            Invite family to sign →
          </Link>
        </div>
      </PageShell>
    ),
    rightContent: (
      <PageShell pageNum={villagePageNum + 1} align="right">
        <div className="flex-1 flex flex-col items-center justify-center text-center">
          <p className="italic text-[9px] text-[#9a8f85]" style={{ fontFamily: "Georgia, serif" }}>
            Have something to say?
          </p>
          <Link
            href="/dashboard/settings"
            className="mt-3 bg-[#3d5c42] text-[#eaf3de] text-[9px] rounded-lg px-3 py-2"
          >
            Add your message →
          </Link>
        </div>
      </PageShell>
    ),
  });

  // 6. BACK COVER SPREAD
  spreads.push({
    id: "back",
    label: "Back cover",
    leftContent: (
      <PageShell bg="#faf6f0">
        <div className="flex-1 flex flex-col items-center justify-center text-center px-4">
          <p className="text-[9px] text-[#9a8f85] tracking-wider uppercase">{yearLabel}</p>
          <div className="w-9 h-px bg-[#ddd5c0] my-3" />
          <p className="italic text-[10px] text-[#5a5048] leading-relaxed" style={{ fontFamily: "Georgia, serif" }}>
            {letterText.trim() ? letterText.slice(0, 80) + (letterText.length > 80 ? "…" : "") : "Our story, beautifully kept."}
          </p>
          <div className="w-9 h-px bg-[#ddd5c0] my-3" />
          <p className="text-[8px] text-[#b5aca4]">
            {memories.length} memories · {bookCount} books · {winCount} wins
          </p>
        </div>
      </PageShell>
    ),
    rightContent: (
      <div className="relative flex flex-col w-full h-full overflow-hidden items-center justify-center" style={{ background: "#2a3e2c" }}>
        <span className="absolute top-2 right-3 text-[72px] opacity-[0.06] select-none pointer-events-none">🌿</span>
        <span className="absolute -bottom-2 left-2 text-[56px] opacity-[0.05] select-none pointer-events-none">🌱</span>
        <div className="text-center relative z-10">
          <p className="text-[22px] text-[#8cba8e] font-bold" style={{ fontFamily: "var(--font-display)" }}>Rooted</p>
          <p className="text-[8px] text-[#5a7a45] tracking-[0.18em] uppercase mt-1">Homeschool · Memory Keeping</p>
        </div>
      </div>
    ),
  });

  // ── Flatten spreads to pages ────────────────────────────────────────────────

  const pages = spreads.flatMap((s) => [
    { content: s.leftContent, spreadLabel: s.label, spreadId: s.id },
    { content: s.rightContent, spreadLabel: s.label, spreadId: s.id },
  ]);

  // Clamp current page
  const maxPage = pages.length - 1;
  maxPageRef.current = maxPage;
  const safePage = Math.min(currentPage, maxPage);

  const goNext = useCallback(() => setCurrentPage((p) => Math.min(p + 1, maxPage)), [maxPage]);
  const goPrev = useCallback(() => setCurrentPage((p) => Math.max(0, p - 1)), []);

  const spreadIndex = Math.floor(safePage / 2);
  const spreadLabel = pages[safePage]?.spreadLabel ?? "";

  // ── Touch handlers ──────────────────────────────────────────────────────────

  function handleTouchStart(e: React.TouchEvent) {
    touchStartRef.current = e.touches[0].clientX;
  }

  function handleTouchEnd(e: React.TouchEvent) {
    const diff = touchStartRef.current - e.changedTouches[0].clientX;
    if (Math.abs(diff) > 50) {
      if (diff > 0) goNext();
      else goPrev();
    }
  }

  // ── Loading state ───────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="fixed inset-0 flex items-center justify-center" style={{ background: "#1a1a1a" }}>
        <div className="text-center">
          <span className="text-3xl animate-pulse block">📖</span>
          <p className="text-[12px] text-[#9a8f85] mt-3">Opening your yearbook…</p>
        </div>
      </div>
    );
  }

  // ── Empty state ─────────────────────────────────────────────────────────────

  if (memories.length === 0) {
    return (
      <div className="fixed inset-0 flex items-center justify-center" style={{ background: "#1a1a1a" }}>
        <div className="text-center px-6">
          <span className="text-[64px] block">📖</span>
          <p className="italic text-[16px] text-[#9a8f85] mt-4" style={{ fontFamily: "Georgia, serif" }}>
            Your yearbook is empty
          </p>
          <p className="text-[12px] text-[#7a6f65] mt-2">
            Add memories to your yearbook to see them here.
          </p>
          <Link
            href="/dashboard/memories"
            className="inline-block mt-6 bg-[#3d5c42] text-[#eaf3de] px-6 py-3 rounded-xl font-semibold text-sm"
          >
            Browse memories →
          </Link>
        </div>
      </div>
    );
  }

  // ── Dot navigation ──────────────────────────────────────────────────────────

  function DotNav({ isMobile = false }: { isMobile?: boolean }) {
    const totalDots = pages.length;
    const maxVisible = 7;
    let startDot = 0;
    let endDot = totalDots;
    if (totalDots > maxVisible) {
      startDot = Math.max(0, safePage - Math.floor(maxVisible / 2));
      endDot = Math.min(totalDots, startDot + maxVisible);
      if (endDot - startDot < maxVisible) startDot = Math.max(0, endDot - maxVisible);
    }

    return (
      <div className="flex flex-col items-center gap-1.5">
        <div className="flex items-center gap-1">
          {Array.from({ length: endDot - startDot }, (_, i) => {
            const idx = startDot + i;
            return (
              <button
                key={idx}
                onClick={() => setCurrentPage(idx)}
                className={`rounded-full transition-all ${
                  idx === safePage
                    ? (isMobile ? "w-4 h-2 bg-[#c8e6c4]" : "w-4 h-2 bg-[#c8e6c4]")
                    : (isMobile ? "w-2 h-2 bg-[#4d453f]" : "w-2 h-2 bg-[#4d453f]")
                }`}
              />
            );
          })}
        </div>
        <p className="text-[10px] text-[#9a8f85]">
          {spreadLabel} · {isMobile ? `${safePage + 1} of ${pages.length}` : `spread ${spreadIndex + 1} of ${spreads.length}`}
        </p>
      </div>
    );
  }

  // ── Mobile view ─────────────────────────────────────────────────────────────

  return (
    <>
      {/* Mobile view */}
      <div className="md:hidden fixed inset-0 flex flex-col" style={{ background: "#1a1a1a" }}>
        {/* Back button */}
        <div className="h-10 shrink-0 flex items-center px-3 z-30" style={{ background: "rgba(26,26,26,0.95)" }}>
          <Link href="/dashboard/memories/yearbook" className="text-[12px] text-[#9a8f85] hover:text-white transition-colors">
            ← Yearbook
          </Link>
        </div>

        {/* Page content */}
        <div
          ref={containerRef}
          className="flex-1 relative overflow-hidden"
          onTouchStart={handleTouchStart}
          onTouchEnd={(e) => {
            handleTouchEnd(e);
            if (swipeHintVisible) setSwipeHintVisible(false);
          }}
        >
          {/* Half-screen tap zones — full left/right halves for page turning */}
          <button
            className="absolute top-0 left-0 w-1/2 h-full z-10"
            onClick={() => { goPrev(); if (swipeHintVisible) setSwipeHintVisible(false); }}
            aria-label="Previous page"
          />
          <button
            className="absolute top-0 right-0 w-1/2 h-full z-10"
            onClick={() => { goNext(); if (swipeHintVisible) setSwipeHintVisible(false); }}
            aria-label="Next page"
          />

          {/* Visible arrow buttons — positioned at ~37% from top to clear bottom UI chrome */}
          {safePage > 0 && (
            <button
              onClick={() => { goPrev(); if (swipeHintVisible) setSwipeHintVisible(false); }}
              className="absolute left-2 z-20 w-11 h-11 rounded-full flex items-center justify-center text-white/70 active:text-white"
              style={{ top: "37%", background: "rgba(0,0,0,0.35)", backdropFilter: "blur(4px)", minWidth: 44, minHeight: 44 }}
              aria-label="Previous page"
            >
              <span className="text-lg">‹</span>
            </button>
          )}
          {safePage < maxPage && (
            <button
              onClick={() => { goNext(); if (swipeHintVisible) setSwipeHintVisible(false); }}
              className="absolute right-2 z-20 w-11 h-11 rounded-full flex items-center justify-center text-white/70 active:text-white"
              style={{ top: "37%", background: "rgba(0,0,0,0.35)", backdropFilter: "blur(4px)", minWidth: 44, minHeight: 44 }}
              aria-label="Next page"
            >
              <span className="text-lg">›</span>
            </button>
          )}

          {/* Swipe hint — cover page only */}
          {safePage === 0 && swipeHintVisible && (
            <div className="absolute bottom-4 left-0 right-0 z-20 flex justify-center pointer-events-none">
              <span className="text-[11px] text-white/50 bg-black/40 rounded-full px-3 py-1.5" style={{ backdropFilter: "blur(4px)" }}>
                Swipe or tap arrows to turn pages →
              </span>
            </div>
          )}

          <div
            className="absolute inset-0 flex transition-transform duration-300 ease-out"
            style={{ transform: `translateX(-${safePage * 100}%)` }}
          >
            {pages.map((page, i) => (
              <div key={i} className="w-full h-full shrink-0 flex">
                <div className="w-full h-full flex">
                  {page.content}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Bottom nav */}
        <div className="py-2 px-4 flex items-center justify-between" style={{ background: "rgba(26,26,26,0.95)", backdropFilter: "blur(8px)" }}>
          <button
            onClick={goPrev}
            disabled={safePage === 0}
            className="w-9 h-9 flex items-center justify-center text-[#c8e6c4] disabled:opacity-30"
          >
            ←
          </button>
          <DotNav isMobile />
          <button
            onClick={goNext}
            disabled={safePage >= maxPage}
            className="w-9 h-9 flex items-center justify-center text-[#c8e6c4] disabled:opacity-30"
          >
            →
          </button>
        </div>
      </div>

      {/* Desktop view */}
      <div className="hidden md:flex fixed inset-0 flex-col items-center justify-center" style={{ background: "#2d2926" }}>
        {/* Back button */}
        <div className="absolute top-4 left-6 z-30">
          <Link href="/dashboard/memories/yearbook" className="text-sm text-[#9a8f85] hover:text-white transition-colors">
            ← Yearbook
          </Link>
        </div>

        <div className="flex items-center gap-4">
          {/* Left arrow */}
          <button
            onClick={goPrev}
            disabled={spreadIndex === 0}
            className="w-12 h-12 rounded-full flex items-center justify-center text-[#c4b89a] hover:bg-[#4d453f] disabled:opacity-30 transition-colors"
            style={{ background: "#3d3530" }}
          >
            ←
          </button>

          {/* Two-page spread */}
          <div className="flex max-w-4xl shadow-2xl rounded-lg overflow-hidden" style={{ width: "800px", height: "560px" }}>
            <div className="w-1/2 h-full">
              {spreads[spreadIndex]?.leftContent}
            </div>
            <Spine />
            <div className="w-1/2 h-full">
              {spreads[spreadIndex]?.rightContent}
            </div>
          </div>

          {/* Right arrow */}
          <button
            onClick={() => setCurrentPage(Math.min((spreadIndex + 1) * 2, maxPage))}
            disabled={spreadIndex >= spreads.length - 1}
            className="w-12 h-12 rounded-full flex items-center justify-center text-[#c4b89a] hover:bg-[#4d453f] disabled:opacity-30 transition-colors"
            style={{ background: "#3d3530" }}
          >
            →
          </button>
        </div>

        {/* Dots below */}
        <div className="mt-4">
          <DotNav />
        </div>
      </div>
    </>
  );
}
