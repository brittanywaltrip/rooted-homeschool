"use client";

import { useEffect, useState, useCallback, useRef, useMemo, ReactNode } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useSwipeable } from "react-swipeable";
import { supabase } from "@/lib/supabase";
import { usePartner } from "@/lib/partner-context";
import Link from "next/link";
import {
  buildYearInNumbersSpread,
  buildBooksSpread,
  buildFavoriteThingsSpread,
  type YearbookMemory,
} from "@/lib/yearbook-layout-engine";
import { SpreadLeftPage, SpreadRightPage } from "@/components/yearbook/SpreadLayouts";
import { posthog } from "@/lib/posthog";

function safeParseDateStr(d: string | null | undefined): Date | null {
  if (!d) return null;
  const iso = d.slice(0, 10);
  const dt = new Date(iso + "T12:00:00");
  return isNaN(dt.getTime()) ? null : dt;
}

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

// ─── Spine (desktop spread view only) ────────────────────────────────────────

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

// ─── Page Shell — fixed height, no scroll ────────────────────────────────────

function PageShell({ children, bg = "#FAFAF7" }: {
  children: ReactNode;
  bg?: string;
}) {
  return (
    <div className="w-full h-full overflow-hidden" style={{ background: bg }}>
      <div className="h-full overflow-hidden px-7 py-2 flex flex-col justify-center">
        {children}
      </div>
    </div>
  );
}

// ─── Photo Grid — adaptive layout ────────────────────────────────────────────

function PhotoGrid({ photos }: { photos: MemoryRow[] }) {
  if (photos.length === 0) return null;

  if (photos.length === 1) {
    return (
      <div className="w-full rounded-md overflow-hidden bg-[#f5f0e8]" style={{ aspectRatio: "4/3" }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={photos[0].photo_url!} alt="" className="w-full h-full object-contain" />
      </div>
    );
  }

  if (photos.length === 2) {
    return (
      <div className="grid grid-cols-2 gap-1.5">
        {photos.map((p) => (
          <div key={p.id} className="aspect-square rounded overflow-hidden bg-[#f5f0e8]">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={p.photo_url!} alt="" className="w-full h-full object-contain" />
          </div>
        ))}
      </div>
    );
  }

  if (photos.length === 3) {
    return (
      <div className="space-y-1.5">
        <div className="w-full rounded-md overflow-hidden bg-[#f5f0e8]" style={{ aspectRatio: "16/9" }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={photos[0].photo_url!} alt="" className="w-full h-full object-contain" />
        </div>
        <div className="grid grid-cols-2 gap-1.5">
          {photos.slice(1).map((p) => (
            <div key={p.id} className="aspect-square rounded overflow-hidden bg-[#f5f0e8]">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={p.photo_url!} alt="" className="w-full h-full object-contain" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-2 gap-1.5">
      {photos.slice(0, 4).map((p) => (
        <div key={p.id} className="aspect-square rounded overflow-hidden bg-[#f5f0e8]">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={p.photo_url!} alt="" className="w-full h-full object-contain" />
        </div>
      ))}
    </div>
  );
}

// ─── Page header mapping ─────────────────────────────────────────────────────

function getPageHeaders(spreadId: string, spreadLabel: string): [string, string] {
  if (spreadId === "cover") return ["ROOTED YEARBOOK", "TABLE OF CONTENTS"];
  if (spreadId === "letter") return ["A LETTER FROM HOME", "A LETTER FROM HOME"];
  if (spreadId === "year-in-numbers") return ["OUR YEAR IN NUMBERS", "OUR YEAR IN NUMBERS"];
  if (spreadId.startsWith("child-")) {
    const name = spreadLabel.replace(/'s chapter$/i, "").toUpperCase();
    if (spreadId.includes("-books")) return [`${name}\u2019S BOOKS`, `${name}\u2019S BOOKS`];
    if (spreadId.includes("-favorites")) return [`${name}\u2019S FAVORITES`, `${name}\u2019S FAVORITES`];
    if (spreadId.includes("-spread-")) return [`${name}\u2019S CHAPTER`, `${name}\u2019S CHAPTER`];
    return [`${name}\u2019S CHAPTER`, "IN THEIR OWN WORDS"];
  }
  if (spreadId === "family") return ["TOGETHER", "TOGETHER"];
  if (spreadId === "family-books") return ["OUR BOOKS", "OUR BOOKS"];
  if (spreadId === "village") return ["FROM THE VILLAGE", "FROM THE VILLAGE"];
  if (spreadId === "back") return ["ROOTED HOMESCHOOL", "ROOTED HOMESCHOOL"];
  return ["", ""];
}

// ─── Animation variants ──────────────────────────────────────────────────────

const pageVariants = {
  enter: (dir: number) => ({
    x: dir >= 0 ? "35%" : "-35%",
    opacity: 0,
  }),
  center: {
    x: 0,
    opacity: 1,
  },
  exit: (dir: number) => ({
    x: dir >= 0 ? "-35%" : "35%",
    opacity: 0,
  }),
};

const pageTransition = { duration: 0.3, ease: "easeInOut" as const };

// ─── Main Component ──────────────────────────────────────────────────────────

export default function YearbookReadPage() {
  const { effectiveUserId } = usePartner();
  const [loading, setLoading] = useState(true);
  const [memories, setMemories] = useState<MemoryRow[]>([]);
  const [children, setChildren] = useState<Child[]>([]);
  const [contentMap, setContentMap] = useState<Record<string, string>>({});
  const [profile, setProfile] = useState<{ display_name?: string; yearbook_opened_at?: string; yearbook_closed_at?: string; family_photo_url?: string | null; plan_type?: string | null }>({});
  const [yearbookKey, setYearbookKey] = useState("");
  const [currentPage, setCurrentPage] = useState(0);
  const [direction, setDirection] = useState(1);

  // Yearbook section settings
  type YearbookSettings = {
    show_letter: boolean;
    show_year_in_numbers: boolean;
    show_child_chapters: boolean;
    show_favorite_things: boolean;
    show_books_section: boolean;
    show_family_chapter: boolean;
    show_village: boolean;
  };
  const DEFAULT_YB_SETTINGS: YearbookSettings = {
    show_letter: true,
    show_year_in_numbers: true,
    show_child_chapters: true,
    show_favorite_things: true,
    show_books_section: true,
    show_family_chapter: true,
    show_village: true,
  };
  const [ybSettings, setYbSettings] = useState<YearbookSettings>(DEFAULT_YB_SETTINGS);

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
        .select("display_name, yearbook_opened_at, yearbook_closed_at, family_photo_url, yearbook_settings, plan_type")
        .eq("id", effectiveUserId)
        .single();

      let openedAt = prof?.yearbook_opened_at;
      if (!openedAt) {
        const now = new Date();
        const schoolYearStartMonth = 7;
        const sy = now.getMonth() >= schoolYearStartMonth ? now.getFullYear() : now.getFullYear() - 1;
        openedAt = new Date(sy, schoolYearStartMonth, 1).toISOString();
      }

      setProfile(prof ?? {});
      if ((prof as Record<string, unknown>)?.yearbook_settings) {
        setYbSettings({ ...DEFAULT_YB_SETTINGS, ...(prof as Record<string, unknown>).yearbook_settings as Partial<YearbookSettings> });
      }
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
      posthog.capture('yearbook_opened');
    })();
  }, [effectiveUserId]);

  // ── Yearbook settings toggle ─────────────────────────────────────────────────

  async function toggleYbSetting(key: keyof YearbookSettings) {
    const next = { ...ybSettings, [key]: !ybSettings[key] };
    setYbSettings(next);
    setCurrentPage(0); // reset to cover when toggling sections
    if (!effectiveUserId) return;
    await supabase.from("profiles").update({ yearbook_settings: next }).eq("id", effectiveUserId);
  }

  // ── Keyboard navigation ─────────────────────────────────────────────────────

  const maxPageRef = useRef(0);
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === "ArrowRight") {
        setDirection(1);
        setCurrentPage((p) => Math.min(p + 1, maxPageRef.current));
      }
      if (e.key === "ArrowLeft") {
        setDirection(-1);
        setCurrentPage((p) => Math.max(0, p - 1));
      }
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, []);

  // ── Build spreads (memoized to avoid recomputing on every page turn) ────────

  const { spreads, pages, familyName } = useMemo(() => {

  const familyName = profile.display_name ?? "Our Family";
  const coverTitle = /^the\s/i.test(familyName) ? familyName : `The ${familyName}`;
  const yearLabel = yearbookKey
    ? `${yearbookKey.split("-")[0]}\u201320${yearbookKey.split("-")[1]}`
    : "";
  const photoCount = memories.filter((m) => m.type === "photo" || m.type === "drawing").length;
  const bookCount = memories.filter((m) => m.type === "book").length;
  const winCount = memories.filter((m) => m.type === "win").length;
  const quoteCount = memories.filter((m) => m.type === "quote").length;

  const coverPhotoUrl = contentMap[ck("cover_photo")] || profile.family_photo_url || "";
  const letterText = contentMap[ck("letter_from_home")] ?? "";
  const favMemId = contentMap[ck("letter_favorite_memory_id")] ?? "";
  const favCaption = contentMap[ck("letter_favorite_caption")] ?? "";
  const favQuoteVal = contentMap[ck("letter_favorite_quote")] ?? "";
  const favMemory = favMemId ? memories.find((m) => m.id === favMemId) : null;
  const favQuoteMemory = favQuoteVal && !favQuoteVal.startsWith("text:") ? memories.find((m) => m.id === favQuoteVal) : null;
  const favQuoteText = favQuoteVal.startsWith("text:") ? favQuoteVal.slice(5) : (favQuoteMemory?.title ?? "");

  const familyMemories = memories.filter((m) => !m.child_id);

  let pageCounter = 4;
  const childPageMap: Record<string, number> = {};
  for (const c of children) {
    childPageMap[c.id] = pageCounter + 1;
    pageCounter += 2;
  }
  const familyPageNum = pageCounter + 1;
  const villagePageNum = familyPageNum + 2;

  const spreads: SpreadDef[] = [];

  // 1. COVER SPREAD
  spreads.push({
    id: "cover",
    label: "Cover",
    leftContent: coverPhotoUrl ? (
      <div className="relative flex flex-col w-full h-full overflow-hidden items-center justify-center" style={{ background: "var(--g-brand)" }}>
        {/* Botanical watermarks */}
        <span className="absolute top-4 right-3 text-[100px] opacity-[0.05] select-none pointer-events-none" style={{ transform: "rotate(-15deg)" }}>🌿</span>
        <span className="absolute bottom-8 left-2 text-[80px] opacity-[0.04] select-none pointer-events-none" style={{ transform: "rotate(20deg)" }}>🍃</span>

        <div className="flex flex-col items-center justify-center flex-1 w-full px-8 py-4 relative z-10">
          {/* Family name */}
          <h1 className="text-[20px] leading-snug text-[#fefcf9] text-center mb-3" style={{ fontFamily: "Georgia, serif" }}>
            {coverTitle} Yearbook
          </h1>

          {/* Contained photo card — portrait, white border like a printed photo */}
          <div
            className="rounded-sm overflow-hidden shrink-0"
            style={{ border: "4px solid rgba(255,255,255,0.85)", boxShadow: "0 4px 20px rgba(0,0,0,0.25)", width: "65%", aspectRatio: "3/4" }}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={coverPhotoUrl} alt="" className="w-full h-full object-cover" />
          </div>

          {/* Year label */}
          <p className="text-[9px] font-semibold tracking-[0.2em] uppercase text-[rgba(254, 252, 249, 0.55)] mt-4">
            {yearLabel}
          </p>
        </div>

        <div className="flex justify-between items-center w-full px-5 pb-3 relative z-10">
          <span className="text-[9px] tracking-[0.18em] text-[rgba(254, 252, 249, 0.55)]/50">ROOTED</span>
          <span className="bg-white/10 text-[9px] text-[#c8e6c4] px-3 py-1 rounded-full">
            {memories.length} memories
          </span>
        </div>
      </div>
    ) : (
      <div className="relative flex flex-col w-full h-full overflow-hidden" style={{ background: "var(--g-brand)" }}>
        <span className="absolute top-6 right-4 text-[120px] opacity-[0.06] select-none pointer-events-none" style={{ transform: "rotate(-15deg)" }}>🌿</span>
        <span className="absolute bottom-10 left-3 text-[100px] opacity-[0.05] select-none pointer-events-none" style={{ transform: "rotate(20deg)" }}>🍃</span>
        <span className="absolute top-1/3 left-1/2 -translate-x-1/2 text-[160px] opacity-[0.03] select-none pointer-events-none">🌱</span>

        <div className="flex-1 flex flex-col items-center justify-center p-6 relative z-10 text-center">
          <div className="w-12 h-px bg-[rgba(254, 252, 249, 0.55)]/40 mb-5" />
          <p className="text-[10px] font-semibold tracking-[0.2em] uppercase text-[rgba(254, 252, 249, 0.55)] mb-3">
            {yearLabel}
          </p>
          <h1 className="text-[28px] leading-snug text-[#fefcf9]" style={{ fontFamily: "Georgia, serif" }}>
            {coverTitle}<br />Yearbook
          </h1>
          <div className="w-9 h-px bg-[rgba(254, 252, 249, 0.55)]/30 my-5" />
          <p className="text-[11px] text-white/45 italic max-w-[220px] line-clamp-2" style={{ fontFamily: "Georgia, serif" }}>
            A year of learning, growing, and making memories
          </p>
          <Link
            href="/dashboard/memories/yearbook/edit"
            className="mt-6 inline-flex items-center gap-1.5 bg-white/10 text-[11px] text-[#c8e6c4] font-medium px-4 py-2 rounded-lg transition-colors active:bg-white/15"
          >
            ✚ Add a cover photo
          </Link>
        </div>

        <div className="flex justify-between items-center px-5 pb-4 relative z-10">
          <span className="text-[9px] tracking-[0.18em] text-[rgba(254, 252, 249, 0.55)]/60">ROOTED</span>
          <span className="bg-white/10 text-[9px] text-[#c8e6c4] px-3 py-1 rounded-full">
            {memories.length} memories
          </span>
        </div>
      </div>
    ),
    rightContent: (
      <PageShell>
        <div className="flex flex-col items-center justify-center text-center px-4">
          <span className="text-[48px] font-serif text-[rgba(254, 252, 249, 0.55)] leading-none">&ldquo;</span>
          <p className="italic text-[11px] text-[#5a5048] leading-relaxed max-w-[200px] mt-1 line-clamp-3" style={{ fontFamily: "Georgia, serif" }}>
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
  if (ybSettings.show_letter) spreads.push({
    id: "letter",
    label: "Letter from home",
    leftContent: (
      <PageShell>
        <div className="shrink-0">
          <p className="text-[9px] font-semibold uppercase tracking-[0.1em] text-[rgba(254, 252, 249, 0.55)]">Written for our family</p>
          <h2 className="text-[16px] font-bold text-[#2d2926] mt-1" style={{ fontFamily: "var(--font-display)" }}>A letter from home</h2>
          <p className="text-[9px] text-[#b5aca4] mt-0.5">A message from the heart</p>
          <div className="h-px bg-[#ddd5c0] my-2" style={{ height: 0.5 }} />
        </div>
        <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
          {letterText.trim() ? (
            <>
              <p className="text-[10px] italic text-[#4a4540] leading-relaxed whitespace-pre-wrap line-clamp-[10]" style={{ fontFamily: "Georgia, serif" }}>
                {letterText}
              </p>
              <p className="italic text-[11px] text-[#5c7f63] mt-2 shrink-0" style={{ fontFamily: "Georgia, serif" }}>With love</p>
            </>
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center text-center px-2">
              <span className="text-[36px] mb-3 opacity-50">✉️</span>
              <p className="text-[12px] italic text-[#c4b89a] leading-relaxed" style={{ fontFamily: "Georgia, serif" }}>
                Your letter will go here —<br />a message to your family, from the heart.
              </p>
              <Link href="/dashboard/memories/yearbook/edit" className="mt-3 text-[10px] text-[rgba(254, 252, 249, 0.55)] font-medium">
                Write your letter →
              </Link>
            </div>
          )}
        </div>
        <div className="shrink-0">
          <div className="h-px bg-[#ddd5c0] my-2" style={{ height: 0.5 }} />
          <p className="text-[8px] uppercase tracking-wider text-[#9a8f85] mb-1.5">Our year</p>
          <div className="flex gap-2">
            {[
              { n: photoCount, l: "photos" },
              { n: winCount, l: "wins" },
              { n: bookCount, l: "books" },
              { n: quoteCount, l: "quotes" },
            ].map((s) => (
              <div key={s.l} className="bg-[#eeeade] rounded px-2 py-1 text-center flex-1">
                <p className="text-[14px] font-bold text-[var(--g-deep)]">{s.n}</p>
                <p className="text-[7px] text-[#9a8f85]">{s.l}</p>
              </div>
            ))}
          </div>
        </div>
      </PageShell>
    ),
    rightContent: (
      <PageShell>
        {/* Favorite moment */}
        <div className="mb-3">
          <p className="text-[8px] uppercase tracking-wider text-[#9a8f85] mb-2">Favorite moment</p>
          {favMemory ? (
            <div>
              {favMemory.photo_url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={favMemory.photo_url} alt="" className="w-full rounded-md object-cover" style={{ aspectRatio: "4/3" }} />
              ) : (
                <div className="w-full rounded-md bg-[#eaf3de] flex items-center justify-center p-4" style={{ aspectRatio: "4/3" }}>
                  <p className="text-sm font-medium text-[var(--g-deep)] text-center line-clamp-2">{favMemory.title}</p>
                </div>
              )}
              <p className="text-[8px] text-[#9a8f85] mt-1">
                {safeParseDateStr(favMemory.date)?.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" }) ?? "Unknown date"}
              </p>
              {favCaption && (
                <p className="italic text-[9px] text-[#4a4540] mt-1 line-clamp-2" style={{ fontFamily: "Georgia, serif" }}>{favCaption}</p>
              )}
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center text-center py-4">
              <span className="text-[32px] mb-2 opacity-40">📷</span>
              <p className="text-[10px] italic text-[#c4b89a]" style={{ fontFamily: "Georgia, serif" }}>
                Your favorite moment will shine here
              </p>
              <Link href="/dashboard/memories/yearbook/edit" className="mt-2 text-[9px] text-[rgba(254, 252, 249, 0.55)] font-medium">
                Choose in editor →
              </Link>
            </div>
          )}
        </div>

        <div className="h-px bg-[#ddd5c0] my-2" style={{ height: 0.5 }} />

        {/* Favorite quote */}
        <div>
          {favQuoteText ? (
            <div>
              <span className="text-[28px] font-serif text-[#c4b0e0] leading-none">&ldquo;</span>
              <p className="italic text-[9px] text-[#2d2926] line-clamp-3" style={{ fontFamily: "Georgia, serif" }}>{favQuoteText}</p>
              {favQuoteMemory?.child_id && (
                <p className="text-[8px] text-[#9a8f85] mt-1">
                  — {children.find((c) => c.id === favQuoteMemory.child_id)?.name ?? ""}
                </p>
              )}
            </div>
          ) : (
            <div className="text-center py-2">
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

  // 2.5. YEAR IN NUMBERS SPREAD
  const allYearbookMemories: YearbookMemory[] = memories.map((m) => ({
    id: m.id,
    type: (m.type as YearbookMemory["type"]) ?? "photo",
    title: m.title,
    photo_url: m.photo_url,
    created_at: m.date,
    child_name: children.find((c) => c.id === m.child_id)?.name ?? null,
  }));
  const yearInNumbersSpread = buildYearInNumbersSpread(allYearbookMemories, familyName, yearLabel);
  if (ybSettings.show_year_in_numbers) spreads.push({
    id: "year-in-numbers",
    label: "Year in numbers",
    leftContent: <SpreadLeftPage spread={yearInNumbersSpread} />,
    rightContent: <SpreadRightPage spread={yearInNumbersSpread} />,
  });

  // 3. PER-CHILD SPREADS
  if (ybSettings.show_child_chapters) children.forEach((child, ci) => {
    const childMems = memories.filter((m) => m.child_id === child.id);
    const childPhotos = childMems.filter((m) => m.photo_url);
    const childQuotes = childMems.filter((m) => m.type === "quote");
    const childWins = childMems.filter((m) => m.type === "win");
    const latestQuote = childQuotes[childQuotes.length - 1];
    const latestWin = childWins[childWins.length - 1];

    spreads.push({
      id: `child-${child.id}`,
      label: `${child.name}'s chapter`,
      leftContent: (
        <PageShell>
          <div className="shrink-0">
            <p className="text-[9px] text-[rgba(254, 252, 249, 0.55)]">Chapter {ci + 1}</p>
            <h2 className="text-[16px] font-bold text-[#2d2926] mt-0.5" style={{ fontFamily: "var(--font-display)" }}>
              {child.name}&apos;s year
            </h2>
            <p className="text-[9px] text-[#b5aca4] mt-0.5">{childMems.length} memories</p>
            <div className="h-px bg-[#ddd5c0] my-2" style={{ height: 0.5 }} />
          </div>

          {latestQuote && (
            <div className="mb-2 shrink-0">
              <span className="text-[24px] font-serif text-[#c4b0e0] leading-none">&ldquo;</span>
              <p className="italic text-[9px] text-[#2d2926] line-clamp-3" style={{ fontFamily: "Georgia, serif" }}>{latestQuote.title}</p>
              <p className="text-[8px] text-[#9a8f85] mt-0.5">
                {safeParseDateStr(latestQuote.date)?.toLocaleDateString("en-US", { month: "short", day: "numeric" }) ?? ""}
              </p>
            </div>
          )}

          {childPhotos.length > 0 && (
            <div className="mb-2 shrink-0">
              <PhotoGrid photos={childPhotos.slice(0, 4)} />
            </div>
          )}

          {latestWin && (
            <div className="bg-[#f0ede5] rounded-lg p-2 border-l-2 border-[rgba(254, 252, 249, 0.55)] mb-2 shrink-0">
              <p className="text-[7px] uppercase tracking-wider text-[#5c7f63] mb-0.5 flex items-center gap-1">
                <span>⭐</span>
                <span>Win</span>
                {latestWin.date && (
                  <span className="text-[#9a8f85] font-normal normal-case tracking-normal ml-auto">
                    {safeParseDateStr(latestWin.date)?.toLocaleDateString("en-US", { month: "short", year: "numeric" }) ?? ""}
                  </span>
                )}
              </p>
              <p className="text-[9px] text-[#2d2926] line-clamp-2" style={{ fontFamily: "Georgia, serif" }}>{latestWin.title}</p>
            </div>
          )}

          <div className="flex gap-2 mt-auto shrink-0">
            {[
              { n: childWins.length, l: "wins" },
              { n: childMems.filter((m) => m.type === "book").length, l: "books" },
            ].map((s) => (
              <div key={s.l} className="bg-[#eeeade] rounded px-2 py-1 text-center flex-1">
                <p className="text-[13px] font-bold text-[var(--g-deep)]">{s.n}</p>
                <p className="text-[7px] text-[#9a8f85]">{s.l}</p>
              </div>
            ))}
          </div>
        </PageShell>
      ),
      rightContent: (
        <PageShell>
          <div className="shrink-0">
            <p className="text-[9px] text-[rgba(254, 252, 249, 0.55)]">{child.name} in their own words</p>
            <h3 className="text-[14px] font-bold text-[#2d2926] mt-0.5" style={{ fontFamily: "var(--font-display)" }}>
              Year-end interview
            </h3>
            <div className="h-px bg-[#ddd5c0] my-1.5" style={{ height: 0.5 }} />
          </div>

          <div className="space-y-2 flex-1 min-h-0 overflow-hidden">
            {INTERVIEW_QUESTIONS.slice(0, 4).map((q) => {
              const answer = contentMap[ck("child_interview", child.id, q.key)] ?? "";
              return (
                <div key={q.key}>
                  <p className="italic text-[8px] text-[#9a8f85]">{q.label}</p>
                  {answer.trim() ? (
                    <p className="text-[9px] text-[#2d2926] leading-relaxed line-clamp-3" style={{ fontFamily: "Georgia, serif" }}>{answer}</p>
                  ) : (
                    <p className="italic text-[9px] text-[#c4b89a] leading-relaxed">—</p>
                  )}
                </div>
              );
            })}
          </div>

          <div className="h-px bg-[#ddd5c0] my-1.5" style={{ height: 0.5 }} />

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

    // 3b. FAVORITE THINGS SPREAD
    if (ybSettings.show_favorite_things) {
      const favMemories: YearbookMemory[] = childMems.map((m) => ({
        id: m.id,
        type: (m.type as YearbookMemory["type"]) ?? "photo",
        title: m.title,
        photo_url: m.photo_url,
        created_at: m.date,
        child_name: child.name,
      }));
      const favAnswers: Record<string, string> = {
        fav_loved: contentMap[ck("child_interview", child.id, "q_loved_learning")] ?? "",
        fav_book: contentMap[ck("child_interview", child.id, "q_favorite_book")] ?? "",
        fav_surprised: contentMap[ck("child_interview", child.id, "q_surprised_you")] ?? "",
        fav_next_year: contentMap[ck("child_interview", child.id, "q_learn_next_year")] ?? "",
      };
      const favSpread = buildFavoriteThingsSpread(favMemories, child.name, favAnswers);
      spreads.push({
        id: `child-${child.id}-favorites`,
        label: `${child.name}'s chapter`,
        leftContent: <SpreadLeftPage spread={favSpread} />,
        rightContent: <SpreadRightPage spread={favSpread} />,
      });
    }

    // 3d. BOOKS SPREAD for this child
    const childBooks = childMems.filter((m) => m.type === "book");
    if (ybSettings.show_books_section && childBooks.length > 0) {
      const booksSpread = buildBooksSpread(
        childBooks.map((m) => ({
          id: m.id,
          type: "book" as const,
          title: m.title,
          photo_url: m.photo_url,
          created_at: m.date,
          child_name: child.name,
        })),
        child.name,
      );
      spreads.push({
        id: `child-${child.id}-books`,
        label: `${child.name}'s chapter`,
        leftContent: <SpreadLeftPage spread={booksSpread} />,
        rightContent: <SpreadRightPage spread={booksSpread} />,
      });
    }
  });

  // 4. FAMILY MEMORIES SPREAD
  const famPhotos = familyMemories.filter((m) => m.photo_url);
  const famWins = familyMemories.filter((m) => m.type === "win" || m.type === "field_trip");

  if (ybSettings.show_family_chapter) spreads.push({
    id: "family",
    label: "Our family",
    leftContent: (
      <PageShell>
        <div className="shrink-0">
          <p className="text-[9px] text-[rgba(254, 252, 249, 0.55)]">Together</p>
          <h2 className="text-[16px] font-bold text-[#2d2926] mt-0.5" style={{ fontFamily: "var(--font-display)" }}>Our family</h2>
          <p className="text-[9px] text-[#b5aca4] mt-0.5">{familyMemories.length} shared memories</p>
          <div className="h-px bg-[#ddd5c0] my-2" style={{ height: 0.5 }} />
        </div>

        {familyMemories.length > 0 ? (
          <div className="space-y-2">
            {famPhotos.length > 0 && (
              <>
                <PhotoGrid photos={famPhotos.slice(0, 3)} />
                <p className="text-[8px] italic text-[#9a8f85]" style={{ fontFamily: "Georgia, serif" }}>
                  {safeParseDateStr(famPhotos[0].date)?.toLocaleDateString("en-US", { month: "long", day: "numeric" }) ?? ""}
                </p>
              </>
            )}
            {famWins.map((w) => (
              <div key={w.id} className="bg-[#f0ede5] rounded-lg p-2 border-l-2 border-[rgba(254, 252, 249, 0.55)]">
                <p className="text-[7px] uppercase tracking-wider text-[#5c7f63] flex items-center gap-1">
                  <span>{w.type === "field_trip" ? "🗺️" : "⭐"}</span>
                  <span>{w.type === "field_trip" ? "Trip" : "Win"}</span>
                  {w.date && (
                    <span className="text-[#9a8f85] font-normal normal-case tracking-normal ml-auto">
                      {safeParseDateStr(w.date)?.toLocaleDateString("en-US", { month: "short", year: "numeric" }) ?? ""}
                    </span>
                  )}
                </p>
                <p className="text-[9px] text-[#2d2926] line-clamp-2" style={{ fontFamily: "Georgia, serif" }}>{w.title}</p>
              </div>
            ))}
          </div>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center text-center px-4">
            <span className="text-[36px] mb-3 opacity-40">👨‍👩‍👧‍👦</span>
            <p className="text-[11px] italic text-[#c4b89a] leading-relaxed line-clamp-3" style={{ fontFamily: "Georgia, serif" }}>
              Family memories will fill these pages — add memories without choosing a specific child.
            </p>
          </div>
        )}
      </PageShell>
    ),
    rightContent: (
      <PageShell>
        {famPhotos.length > 3 ? (
          <div className="flex flex-col justify-center">
            <PhotoGrid photos={famPhotos.slice(3, 7)} />
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center text-center px-4">
            <div className="w-9 h-px bg-[#ddd5c0] mb-4" />
            <p className="italic text-[10px] text-[#c4b89a] leading-relaxed line-clamp-3" style={{ fontFamily: "Georgia, serif" }}>
              More family photos will appear here as you add them.
            </p>
            <div className="w-9 h-px bg-[#ddd5c0] mt-4" />
          </div>
        )}
      </PageShell>
    ),
  });

  // 4b. FAMILY BOOKS SPREAD (books without a child_id)
  const familyBooks = familyMemories.filter((m) => m.type === "book");
  if (ybSettings.show_books_section && ybSettings.show_family_chapter && familyBooks.length > 0) {
    const famBooksSpread = buildBooksSpread(
      familyBooks.map((m) => ({
        id: m.id,
        type: "book" as const,
        title: m.title,
        photo_url: m.photo_url,
        created_at: m.date,
        child_name: null,
      })),
      familyName,
    );
    spreads.push({
      id: "family-books",
      label: "Our family",
      leftContent: <SpreadLeftPage spread={famBooksSpread} />,
      rightContent: <SpreadRightPage spread={famBooksSpread} />,
    });
  }

  // 5. FROM THE VILLAGE SPREAD
  if (ybSettings.show_village) spreads.push({
    id: "village",
    label: "From the village",
    leftContent: (
      <PageShell>
        <div className="shrink-0">
          <p className="text-[9px] text-[rgba(254, 252, 249, 0.55)]">The people who love you</p>
          <h2 className="text-[16px] font-bold text-[#2d2926] mt-0.5" style={{ fontFamily: "var(--font-display)" }}>From the village</h2>
          <p className="text-[9px] text-[#b5aca4] mt-0.5">0 messages</p>
          <div className="h-px bg-[#ddd5c0] my-2" style={{ height: 0.5 }} />
        </div>

        <div className="flex-1 flex flex-col items-center justify-center text-center px-2">
          <p className="italic text-[10px] text-[#9a8f85] leading-relaxed line-clamp-4" style={{ fontFamily: "Georgia, serif" }}>
            Messages from family will appear here once family members sign your yearbook.
          </p>
          <Link
            href="/dashboard/settings"
            className="mt-4 inline-flex items-center gap-1 text-[11px] text-[var(--g-deep)] font-medium border border-[#c0dd97] rounded-lg px-3 py-2 hover:bg-[#eaf3de] transition-colors"
          >
            Invite family to sign →
          </Link>
        </div>
      </PageShell>
    ),
    rightContent: (
      <PageShell>
        <div className="flex flex-col items-center justify-center text-center">
          <p className="italic text-[9px] text-[#9a8f85]" style={{ fontFamily: "Georgia, serif" }}>
            Have something to say?
          </p>
          <Link
            href="/dashboard/settings"
            className="mt-3 bg-[var(--g-deep)] text-[#eaf3de] text-[9px] rounded-lg px-3 py-2"
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
      <PageShell>
        <div className="flex flex-col items-center justify-center text-center px-4">
          <p className="text-[9px] text-[#9a8f85] tracking-wider uppercase">{yearLabel}</p>
          <div className="w-9 h-px bg-[#ddd5c0] my-3" />
          <p className="italic text-[10px] text-[#5a5048] leading-relaxed line-clamp-3" style={{ fontFamily: "Georgia, serif" }}>
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
          <p className="text-[22px] text-[rgba(254, 252, 249, 0.55)] font-bold" style={{ fontFamily: "var(--font-display)" }}>Rooted</p>
          <p className="text-[8px] text-[#5a7a45] tracking-[0.18em] uppercase mt-1">Homeschool · Memory Keeping</p>
        </div>
      </div>
    ),
  });

  // ── Build flat pages array with headers + edit links ──────────────────────

  function getEditHrefs(spreadId: string): [string | null, string | null] {
    const base = "/dashboard/memories/yearbook/edit";
    if (spreadId === "letter") return [`${base}#letter`, `${base}#favorites`];
    if (spreadId.startsWith("child-")) {
      // Extract actual child ID (format: child-<id>, child-<id>-spread-N, child-<id>-books)
      const childId = spreadId.replace("child-", "").replace(/-spread-\d+$/, "").replace(/-books$/, "");
      if (spreadId.includes("-books") || spreadId.includes("-spread-")) {
        return [`${base}#${childId}-photos`, null];
      }
      return [`${base}#${childId}-photos`, `${base}#${childId}-interview`];
    }
    if (spreadId === "family") return [`${base}#family`, null];
    // cover, year-in-numbers, village, back → no edit pencil
    return [null, null];
  }

  const pages = spreads.flatMap((s) => {
    const [lh, rh] = getPageHeaders(s.id, s.label);
    const [le, re] = getEditHrefs(s.id);
    return [
      { content: s.leftContent, header: lh, spreadId: s.id, editHref: le },
      { content: s.rightContent, header: rh, spreadId: s.id, editHref: re },
    ];
  });

  return { spreads, pages, familyName };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [memories, children, contentMap, profile, yearbookKey, ybSettings]);

  const maxPage = pages.length - 1;
  maxPageRef.current = maxPage;
  const safePage = Math.min(currentPage, maxPage);
  const spreadIndex = Math.floor(safePage / 2);

  // Free user preview: show first 4 spreads (cover + letter + year-in-numbers + first child chapter ≈ 25 memories)
  const FREE_PREVIEW_SPREADS = 4;
  const isFreeUser = !profile.plan_type || profile.plan_type === "free";
  const isGated = isFreeUser && spreadIndex >= FREE_PREVIEW_SPREADS;
  const isGatedMobile = isFreeUser && safePage >= FREE_PREVIEW_SPREADS * 2;

  // ── Navigation helpers ──────────────────────────────────────────────────────

  const goNext = useCallback(() => {
    setDirection(1);
    setCurrentPage((p) => Math.min(p + 1, maxPage));
  }, [maxPage]);

  const goPrev = useCallback(() => {
    setDirection(-1);
    setCurrentPage((p) => Math.max(0, p - 1));
  }, []);

  // ── Swipe gesture (react-swipeable) ─────────────────────────────────────────

  const swipeHandlers = useSwipeable({
    onSwipedLeft: goNext,
    onSwipedRight: goPrev,
    delta: 50,
    trackMouse: false,
    trackTouch: true,
    preventScrollOnSwipe: true,
  });

  // ── Loading state ───────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: "#1a1a1a", height: "100dvh" }}>
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
      <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: "#1a1a1a", height: "100dvh" }}>
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
            className="inline-block mt-6 bg-[var(--g-deep)] text-[#eaf3de] px-6 py-3 rounded-xl font-semibold text-sm"
          >
            Browse memories →
          </Link>
        </div>
      </div>
    );
  }

  // ── Determine if current page has dark background ───────────────────────────

  const isDark = safePage === 0 || safePage === pages.length - 1;

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <>
      {/* ── Mobile view ──────────────────────────────────────── */}
      {/* Nav bar is ~64px (py-3 + 40px avatar). Position reader below it. */}
      <div
        className="md:hidden fixed left-0 right-0 z-50 flex flex-col"
        style={{ top: 64, height: "calc(100dvh - 64px)", overflow: "hidden", background: "#1a1a1a" }}
      >
        {/* Back button bar */}
        <div className="shrink-0 h-11 flex items-center justify-between px-4" style={{ background: "rgba(26,26,26,0.95)" }}>
          <Link href="/dashboard/memories/yearbook" className="text-[12px] text-[#9a8f85] hover:text-white transition-colors">
            ← Yearbook
          </Link>
          <Link href="/dashboard/memories/yearbook/edit" className="text-[16px] opacity-60 hover:opacity-100 transition-opacity" aria-label="Customize yearbook">
            ⚙️
          </Link>
        </div>

        {/* Book page area */}
        <div className="flex-1 min-h-0 relative" {...swipeHandlers}>
          <AnimatePresence mode="wait" custom={direction} initial={false}>
            <motion.div
              key={safePage}
              custom={direction}
              variants={pageVariants}
              initial="enter"
              animate="center"
              exit="exit"
              transition={pageTransition}
              className="absolute inset-0 mx-3 my-2 flex flex-col rounded-lg overflow-hidden"
              style={{ background: "#FAFAF7", boxShadow: "0 2px 20px rgba(0,0,0,0.08)", borderRadius: 8 }}
            >
              {/* Page header */}
              <div className="shrink-0 pt-4 pb-1.5 text-center relative" style={{ background: isDark ? "transparent" : undefined }}>
                <p className="text-[8px] font-medium tracking-[0.15em] uppercase text-[rgba(254, 252, 249, 0.55)]">
                  {pages[safePage]?.header}
                </p>
                {/* Edit shortcut */}
                {pages[safePage]?.editHref && (
                  <Link
                    href={pages[safePage].editHref!}
                    className="absolute top-3 right-3 w-[44px] h-[44px] flex items-center justify-center"
                    aria-label="Edit this page"
                  >
                    <span className="text-[20px] opacity-40 hover:opacity-70 transition-opacity">✏️</span>
                  </Link>
                )}
              </div>

              {/* Page content */}
              <div className="flex-1 min-h-0 overflow-hidden relative">
                {isGatedMobile ? (
                  <>
                    <div className="absolute inset-0 blur-md opacity-40 pointer-events-none">
                      {pages[safePage]?.content}
                    </div>
                    <div className="absolute inset-0 flex flex-col items-center justify-center px-6 text-center z-10">
                      <div className="w-12 h-12 rounded-full bg-[var(--g-brand)]/10 flex items-center justify-center mb-4">
                        <span className="text-2xl">🌿</span>
                      </div>
                      <h3 className="text-lg font-bold text-[#2d2926] mb-2" style={{ fontFamily: "var(--font-display)" }}>
                        Unlock your full yearbook
                      </h3>
                      <p className="text-xs text-[#7a6f65] mb-5 max-w-xs">
                        You&apos;re previewing your yearbook. Upgrade to see every page.
                      </p>
                      <Link
                        href="/upgrade"
                        onClick={() => posthog.capture('upgrade_clicked', { source: 'yearbook_reader_gate' })}
                        className="inline-block bg-[var(--g-brand)] text-white font-semibold text-sm px-6 py-3 rounded-full hover:bg-[var(--g-deep)] transition-colors"
                      >
                        Unlock — $39/yr →
                      </Link>
                    </div>
                  </>
                ) : (
                  pages[safePage]?.content
                )}
              </div>

              {/* Page progress */}
              <div className="shrink-0 pb-2 pt-0.5 text-center" style={{ background: isDark ? "transparent" : undefined }}>
                <p className={`text-[9px] ${isDark ? "text-white/35" : "text-[#b5aca4]"}`}>
                  {safePage + 1} / {pages.length}
                </p>
              </div>
            </motion.div>
          </AnimatePresence>

          {/* Arrow buttons */}
          {safePage > 0 && (
            <button
              onClick={goPrev}
              className="absolute left-0 z-20 w-11 h-11 rounded-full flex items-center justify-center text-white/50 active:text-white"
              style={{ top: "37%", background: "rgba(0,0,0,0.2)", backdropFilter: "blur(4px)", minWidth: 44, minHeight: 44 }}
              aria-label="Previous page"
            >
              <span className="text-lg">‹</span>
            </button>
          )}
          {safePage < maxPage && (
            <button
              onClick={goNext}
              className="absolute right-0 z-20 w-11 h-11 rounded-full flex items-center justify-center text-white/50 active:text-white"
              style={{ top: "37%", background: "rgba(0,0,0,0.2)", backdropFilter: "blur(4px)", minWidth: 44, minHeight: 44 }}
              aria-label="Next page"
            >
              <span className="text-lg">›</span>
            </button>
          )}
        </div>
      </div>

      {/* ── Desktop view ─────────────────────────────────────── */}
      <div
        className="hidden md:flex fixed inset-0 flex-col items-center justify-center"
        style={{ background: "#2d2926", height: "100dvh", overflow: "hidden" }}
      >
        {/* Back button + settings */}
        <div className="absolute top-4 left-6 z-30">
          <Link href="/dashboard/memories/yearbook" className="text-sm text-[#9a8f85] hover:text-white transition-colors">
            ← Yearbook
          </Link>
        </div>
        <div className="absolute top-4 right-6 z-30">
          <Link href="/dashboard/memories/yearbook/edit" className="text-[18px] opacity-50 hover:opacity-100 transition-opacity" aria-label="Customize yearbook">
            ⚙️
          </Link>
        </div>

        <div className="flex items-center gap-4">
          <button
            onClick={goPrev}
            disabled={spreadIndex === 0}
            className="w-12 h-12 rounded-full flex items-center justify-center text-[#c4b89a] hover:bg-[#4d453f] disabled:opacity-30 transition-colors"
            style={{ background: "#3d3530" }}
          >
            ←
          </button>

          <AnimatePresence mode="wait" custom={direction} initial={false}>
            <motion.div
              key={spreadIndex}
              custom={direction}
              variants={pageVariants}
              initial="enter"
              animate="center"
              exit="exit"
              transition={pageTransition}
              className="flex rounded-lg overflow-hidden"
              style={{ width: 800, height: 560, boxShadow: "0 4px 30px rgba(0,0,0,0.15)", background: "#FAFAF7" }}
            >
              {isGated ? (
                <div className="relative w-full h-full flex">
                  <div className="w-1/2 h-full blur-md opacity-40 pointer-events-none">{spreads[spreadIndex]?.leftContent}</div>
                  <Spine />
                  <div className="w-1/2 h-full blur-md opacity-40 pointer-events-none">{spreads[spreadIndex]?.rightContent}</div>
                  <div className="absolute inset-0 flex flex-col items-center justify-center text-center z-10">
                    <div className="w-14 h-14 rounded-full bg-[var(--g-brand)]/10 flex items-center justify-center mb-4">
                      <span className="text-3xl">🌿</span>
                    </div>
                    <h3 className="text-xl font-bold text-[#2d2926] mb-2" style={{ fontFamily: "var(--font-display)" }}>
                      Unlock your full yearbook
                    </h3>
                    <p className="text-sm text-[#7a6f65] mb-5 max-w-sm">
                      You&apos;re previewing your yearbook. Upgrade to see every page.
                    </p>
                    <Link
                      href="/upgrade"
                      onClick={() => posthog.capture('upgrade_clicked', { source: 'yearbook_reader_gate' })}
                      className="inline-block bg-[var(--g-brand)] text-white font-semibold text-sm px-6 py-3 rounded-full hover:bg-[var(--g-deep)] transition-colors"
                    >
                      Unlock — $39/yr →
                    </Link>
                  </div>
                </div>
              ) : (
                <>
                  <div className="w-1/2 h-full">{spreads[spreadIndex]?.leftContent}</div>
                  <Spine />
                  <div className="w-1/2 h-full">{spreads[spreadIndex]?.rightContent}</div>
                </>
              )}
            </motion.div>
          </AnimatePresence>

          <button
            onClick={() => {
              setDirection(1);
              setCurrentPage(Math.min((spreadIndex + 1) * 2, maxPage));
            }}
            disabled={spreadIndex >= spreads.length - 1}
            className="w-12 h-12 rounded-full flex items-center justify-center text-[#c4b89a] hover:bg-[#4d453f] disabled:opacity-30 transition-colors"
            style={{ background: "#3d3530" }}
          >
            →
          </button>
        </div>

        {/* Desktop progress */}
        <div className="mt-4 text-center">
          <p className="text-[10px] text-[#9a8f85]">
            {spreadIndex + 1} / {spreads.length}
          </p>
        </div>
      </div>

    </>
  );
}
