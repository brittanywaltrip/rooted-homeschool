"use client";

import { useEffect, useState, useCallback, useRef, useMemo, ReactNode } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useSwipeable } from "react-swipeable";
import { supabase } from "@/lib/supabase";
import { usePartner } from "@/lib/partner-context";
import { capitalizeChildNames } from "@/lib/utils";
import { getUserAccess } from "@/lib/user-access";
import { useIsNativeApp } from "@/lib/platform";
import PreviewWatermark from "@/app/components/PreviewWatermark";
import Link from "next/link";
import {
  buildYearInNumbersSpread,
  buildBooksSpread,
  buildFavoriteThingsSpread,
  type YearbookMemory,
} from "@/lib/yearbook-layout-engine";
import { buildChapterPhotoUnits, keepInBook, planChapterPhotos, photoAspect, type MosaicPage, type PlacedCell, type PhotoItem, type ChapterPhotoUnit } from "@/lib/yearbook-photo-pages";
import { focalObjectPosition } from "@/lib/focal-point";
import { orderPhotos } from "@/lib/photo-order";
import { featureCaptionText } from "@/lib/photo-caption";
import { SpreadLeftPage, SpreadRightPage } from "@/components/yearbook/SpreadLayouts";
import SignedImage from "@/components/SignedImage";
import { posthog } from "@/lib/posthog";

function safeParseDateStr(d: string | null | undefined): Date | null {
  if (!d) return null;
  const iso = d.slice(0, 10);
  const dt = new Date(iso + "T12:00:00");
  return isNaN(dt.getTime()) ? null : dt;
}

// Strips bucket prefix off both /object/public/memory-photos/<path> and
// /object/sign/memory-photos/<path>?token=... shapes.
function extractMemoryPhotoPath(url: string): string | null {
  const markers = [
    "/object/public/memory-photos/",
    "/object/sign/memory-photos/",
  ];
  for (const m of markers) {
    const i = url.indexOf(m);
    if (i !== -1) {
      const rest = url.slice(i + m.length);
      const q = rest.indexOf("?");
      return q === -1 ? rest : rest.slice(0, q);
    }
  }
  return null;
}

function decodeBase64Url(s: string): string {
  let out = s.replace(/-/g, "+").replace(/_/g, "/");
  while (out.length % 4) out += "=";
  return atob(out);
}

// Old public URLs no longer resolve (bucket is private). Signed URLs are
// usually 1h. Either case needs a fresh sign before <img> can render.
function needsResign(url: string): boolean {
  if (url.includes("/object/public/memory-photos/")) return true;
  if (url.includes("/object/sign/memory-photos/")) {
    const tokenMatch = url.match(/[?&]token=([^&]+)/);
    if (!tokenMatch) return true;
    try {
      const parts = tokenMatch[1].split(".");
      if (parts.length < 2) return true;
      const payload = JSON.parse(decodeBase64Url(parts[1]));
      const exp = typeof payload.exp === "number" ? payload.exp : 0;
      // 60s grace so we don't hand out a URL that expires mid-render.
      return Date.now() / 1000 >= exp - 60;
    } catch {
      return true;
    }
  }
  return false;
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
  photo_width: number | null;
  photo_height: number | null;
  focal_x: number | null;
  focal_y: number | null;
  page_order: number | null;
  created_at: string | null;
  featured: boolean | null;
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

// A true section break: a small centered eucalyptus sprig (brand leaf motif),
// used instead of a mechanical 1px rule.
function Sprig({ className = "my-2.5" }: { className?: string }) {
  return (
    <div className={`flex justify-center select-none ${className}`} aria-hidden>
      <span className="text-[13px] opacity-45">🌿</span>
    </div>
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

// Wraps a page's content with a discreet book folio (page number) in the muted
// brand tone, sitting in the bottom margin. The mid-tone reads on both cream
// pages and the dark scrim of a full-bleed feature page. Cover/back pass no
// number. Rendered identically by the reader (mobile + desktop) and the print
// path because it wraps the shared page content.
function PageWithNumber({ n, children }: { n: number; children: ReactNode }) {
  return (
    <div className="relative w-full h-full">
      {children}
      <span
        className="absolute bottom-[3px] left-1/2 -translate-x-1/2 text-[8px] tracking-[0.1em] text-[#b3a596] select-none pointer-events-none z-20"
        style={{ fontVariantNumeric: "tabular-nums" }}
        aria-hidden
      >
        {n}
      </span>
    </div>
  );
}

// ─── Smart mosaic collage ────────────────────────────────────────────────────
// buildMosaicPages tiles each page with a curated template (chosen by photo
// count) and assigns photos to cells to minimize cropping — portraits into tall
// cells, landscapes into wide cells. Each cell is filled object-cover with a
// focal object-position (portraits biased toward the top so heads/faces aren't
// cut), so the page fills edge to edge with small uniform gutters: no gaps, no
// empty space, no head/feet chopping. Templates + assignment are deterministic
// and rendered in pure CSS grid, so the reader and the PDF print path match.

const GUTTER_PX = 4;

// One photo, filling its box with a focal-aware cover crop (no gaps, no mat).
// A stored focal point (focalX/focalY, normalized 0..1) aims what shows; with
// none set it falls back to the orientation heuristic (portraits bias up).
function FocalPhoto({
  src,
  aspect,
  focalX,
  focalY,
  className = "",
}: {
  src: string | null;
  aspect: number;
  focalX?: number | null;
  focalY?: number | null;
  className?: string;
}) {
  if (!src) return <div className={`w-full h-full bg-[#efeae0] ${className}`} />;
  return (
    <SignedImage
      src={src}
      bucket="memory-photos"
      className={`block w-full h-full object-cover ${className}`}
      style={{ objectPosition: focalObjectPosition(focalX, focalY, aspect) }}
    />
  );
}

function MosaicCell({ cell }: { cell: PlacedCell }) {
  return (
    <div
      className="overflow-hidden rounded-[3px]"
      style={{ gridColumn: `${cell.c + 1} / span ${cell.cs}`, gridRow: `${cell.r + 1} / span ${cell.rs}` }}
    >
      <FocalPhoto
        src={cell.photo.photo_url}
        aspect={photoAspect(cell.photo)}
        focalX={cell.photo.focal_x}
        focalY={cell.photo.focal_y}
      />
    </div>
  );
}

function CollagePage({ page }: { page: MosaicPage }) {
  if (!page || page.cells.length === 0) return <FillerPage />;
  return (
    <div
      className="w-full h-full overflow-hidden grid p-3"
      style={{
        background: "#FAFAF7",
        gap: GUTTER_PX,
        gridTemplateColumns: `repeat(${page.cols}, 1fr)`,
        gridTemplateRows: `repeat(${page.rows}, 1fr)`,
      }}
    >
      {page.cells.map((cell) => (
        <MosaicCell key={cell.photo.id} cell={cell} />
      ))}
    </div>
  );
}

// Soft breather page that faces a lone collage feature (the only case a chapter
// has an odd collage page count). A single brand sprig on the warm background —
// no mechanical rules.
function FillerPage() {
  return (
    <div
      className="w-full h-full overflow-hidden flex items-center justify-center"
      style={{ background: "#FAFAF7" }}
    >
      <span className="text-[34px] opacity-25 select-none" aria-hidden>🌿</span>
    </div>
  );
}

function toPhotoItem(m: MemoryRow): PhotoItem {
  return {
    id: m.id,
    photo_url: m.photo_url,
    photo_width: m.photo_width,
    photo_height: m.photo_height,
    focal_x: m.focal_x,
    focal_y: m.focal_y,
    featured: m.featured,
    include_in_book: m.include_in_book,
    caption: m.caption,
    title: m.title,
    date: m.date,
  };
}

// A featured photo on its own full-bleed page — like a chapter divider, but no
// title overlay. A small caption (caption, else title) sits at the bottom over a
// soft scrim, with the date beneath it; the date always shows, the caption only
// when there's real text. Positioned low so it never covers faces. Focal-aware
// cover fill, identical in reader and print.
function FeaturePhotoPage({ photo }: { photo: PhotoItem }) {
  const caption = featureCaptionText(photo);
  const dateLabel = safeParseDateStr(photo.date)?.toLocaleDateString("en-US", {
    month: "long", day: "numeric", year: "numeric",
  }) ?? "";
  return (
    <div className="relative w-full h-full overflow-hidden" style={{ background: "#FAFAF7" }}>
      <FocalPhoto
        src={photo.photo_url}
        aspect={photoAspect(photo)}
        focalX={photo.focal_x}
        focalY={photo.focal_y}
      />
      {(caption || dateLabel) && (
        <div
          className="absolute inset-x-0 bottom-0 px-6 pt-14 pb-5"
          style={{ background: "linear-gradient(to top, rgba(22,32,24,0.7), rgba(22,32,24,0))" }}
        >
          {caption && (
            <p className="italic text-[12px] text-white/90 leading-snug line-clamp-2" style={{ fontFamily: "Georgia, serif" }}>
              {caption}
            </p>
          )}
          {dateLabel && <p className="text-[9px] text-white/70 mt-1">{dateLabel}</p>}
        </div>
      )}
    </div>
  );
}

function renderChapterUnit(u: ChapterPhotoUnit): ReactNode {
  return u.kind === "feature" ? <FeaturePhotoPage photo={u.photo} /> : <CollagePage page={u.page} />;
}

// Pair a chapter's ordered page units (mosaic pages + solo feature pages) into
// book spreads, 2 pages each, with a quiet filler on a trailing odd page.
function chapterUnitsToSpreads(units: ChapterPhotoUnit[], idPrefix: string, label: string): SpreadDef[] {
  const out: SpreadDef[] = [];
  for (let i = 0; i < units.length; i += 2) {
    const left = units[i];
    const right = units[i + 1];
    out.push({
      id: `${idPrefix}-${i / 2}`,
      label,
      leftContent: renderChapterUnit(left),
      rightContent: right ? renderChapterUnit(right) : <FillerPage />,
    });
  }
  return out;
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
    if (spreadId.includes("-photos")) return [`${name}\u2019S CHAPTER`, `${name}\u2019S CHAPTER`];
    if (spreadId.includes("-spread-")) return [`${name}\u2019S CHAPTER`, `${name}\u2019S CHAPTER`];
    return [`${name}\u2019S CHAPTER`, "IN THEIR OWN WORDS"];
  }
  if (spreadId.startsWith("family-photos")) return ["TOGETHER", "TOGETHER"];
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
  const isNative = useIsNativeApp();
  const [loading, setLoading] = useState(true);
  const [memories, setMemories] = useState<MemoryRow[]>([]);
  const [children, setChildren] = useState<Child[]>([]);
  const [contentMap, setContentMap] = useState<Record<string, string>>({});
  const [profile, setProfile] = useState<{ display_name?: string; yearbook_opened_at?: string; yearbook_closed_at?: string; family_photo_url?: string | null; plan_type?: string | null; is_pro?: boolean | null; trial_started_at?: string | null }>({});
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

  useEffect(() => { localStorage.setItem("rooted_visited_yearbook", "1"); posthog.capture('page_viewed', { page: 'yearbook' }); }, []);

  // ── Load data ───────────────────────────────────────────────────────────────

  useEffect(() => {
    if (!effectiveUserId) return;
    (async () => {
      const { data: prof } = await supabase
        .from("profiles")
        .select("display_name, yearbook_opened_at, yearbook_closed_at, family_photo_url, yearbook_settings, plan_type, is_pro, trial_started_at")
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
        .select("id, child_id, date, type, title, caption, photo_url, include_in_book, photo_width, photo_height, focal_x, focal_y, page_order, created_at, featured")
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

      const rawMems = (mems ?? []) as MemoryRow[];
      const stalePaths: string[] = [];
      const staleByMemId = new Map<string, string>();
      for (const m of rawMems) {
        if (m.photo_url && needsResign(m.photo_url)) {
          const path = extractMemoryPhotoPath(m.photo_url);
          if (path) {
            stalePaths.push(path);
            staleByMemId.set(m.id, path);
          }
        }
      }
      let refreshedMems = rawMems;
      if (stalePaths.length > 0) {
        const { data: signed } = await supabase
          .storage
          .from("memory-photos")
          .createSignedUrls(Array.from(new Set(stalePaths)), 3600);
        if (signed) {
          const byPath = new Map<string, string>();
          for (const row of signed) {
            if (row.path && row.signedUrl) byPath.set(row.path, row.signedUrl);
          }
          refreshedMems = rawMems.map((m) => {
            const p = staleByMemId.get(m.id);
            if (!p) return m;
            const fresh = byPath.get(p);
            return fresh ? { ...m, photo_url: fresh } : m;
          });
        }
      }

      setMemories(refreshedMems);
      setChildren(capitalizeChildNames((kids ?? []) as Child[]));

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
  // Cover focal point lives in the yearbook content (the cover photo isn't a
  // memory row). Stored as "x,y"; absent → centered crop (current default).
  const [coverFocalX, coverFocalY] = ((): [number | null, number | null] => {
    const parts = (contentMap[ck("cover_photo_focal")] ?? "").split(",");
    if (parts.length !== 2) return [null, null];
    const x = parseFloat(parts[0]);
    const y = parseFloat(parts[1]);
    return [Number.isFinite(x) ? x : null, Number.isFinite(y) ? y : null];
  })();
  const letterText = contentMap[ck("letter_from_home")] ?? "";
  const favMemId = contentMap[ck("letter_favorite_memory_id")] ?? "";
  const favCaption = contentMap[ck("letter_favorite_caption")] ?? "";
  const favQuoteVal = contentMap[ck("letter_favorite_quote")] ?? "";
  const favMemory = favMemId ? memories.find((m) => m.id === favMemId) : null;
  const favQuoteMemory = favQuoteVal && !favQuoteVal.startsWith("text:") ? memories.find((m) => m.id === favQuoteVal) : null;
  const favQuoteText = favQuoteVal.startsWith("text:") ? favQuoteVal.slice(5) : (favQuoteMemory?.title ?? "");

  const familyMemories = memories.filter((m) => !m.child_id);

  // De-dup: a photo shown in a chapter's collage is never reused for that
  // chapter's "favorite things" slot or the letter's "favorite moment". Those
  // slots reserve their photo here (and per-child below) so the collages
  // exclude it — every photo appears exactly once.
  const reservedPhotoIds = new Set<string>();
  if (favMemory?.photo_url) reservedPhotoIds.add(favMemory.id);

  const spreads: SpreadDef[] = [];

  // COVER SPREAD — built as a function and prepended LAST (after the body
  // spreads exist) so its table of contents can cite true page numbers
  // (option a). The body spreads are pushed below; pageNumberForId is derived
  // from their real positions, then the cover is unshift()ed to the front.
  const buildCoverSpread = (pageNumberForId: (id: string) => number | null): SpreadDef => ({
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
            <SignedImage
              src={coverPhotoUrl}
              bucket={coverPhotoUrl.includes("/yearbook-covers/") ? "yearbook-covers" : "family-photos"}
              className="w-full h-full object-cover"
              style={{ objectPosition: focalObjectPosition(coverFocalX, coverFocalY, 1.5) }}
            />
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
          <p className="text-[10px] font-semibold tracking-[0.2em] uppercase text-[#c8e6c4] mb-4">
            {yearLabel}
          </p>
          <h1 className="text-[28px] leading-snug text-[#fefcf9]" style={{ fontFamily: "Georgia, serif" }}>
            {coverTitle}<br />Yearbook
          </h1>
          <span className="text-[22px] mt-5 mb-4 opacity-70 select-none" aria-hidden>🌿</span>
          <p className="text-[11px] text-white/60 italic max-w-[220px] line-clamp-2" style={{ fontFamily: "Georgia, serif" }}>
            A year of learning, growing, and making memories
          </p>
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
          <span className="text-[44px] font-serif text-[#b9c4ad] leading-none">&ldquo;</span>
          <p className="italic text-[12px] text-[#4a4540] leading-relaxed max-w-[210px] mt-1" style={{ fontFamily: "Georgia, serif" }}>
            Every lesson, every photo, every little moment. Rooted holds onto it all.
          </p>
          <Sprig className="my-4" />
          <div className="space-y-1.5 text-[11px] text-[#6f655c]" style={{ lineHeight: 1.8 }}>
            <p>A letter from home · p. {pageNumberForId("letter") ?? "–"}</p>
            {children.map((c) => (
              <p key={c.id}>{c.name}&apos;s chapter · p. {pageNumberForId(`child-${c.id}`) ?? "–"}</p>
            ))}
            <p>Our family · p. {pageNumberForId("family") ?? "–"}</p>
            <p>From the village · p. {pageNumberForId("village") ?? "–"}</p>
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
          <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-[#5c7f63]">Written for our family</p>
          <h2 className="text-[17px] font-bold text-[#2d2926] mt-1.5" style={{ fontFamily: "var(--font-display)" }}>A letter from home</h2>
          <p className="text-[10px] text-[#7a6f65] mt-1">A message from the heart</p>
        </div>
        <div className="flex-1 min-h-0 flex flex-col overflow-hidden mt-3">
          {letterText.trim() ? (
            <>
              <p className="text-[11.5px] italic text-[#3a352f] leading-relaxed whitespace-pre-wrap line-clamp-[11]" style={{ fontFamily: "Georgia, serif" }}>
                {letterText}
              </p>
              <p className="italic text-[12px] text-[#5c7f63] mt-3 shrink-0" style={{ fontFamily: "Georgia, serif" }}>— {familyName}</p>
            </>
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center text-center px-3">
              <span className="text-[40px] mb-3 opacity-60">✉️</span>
              <p className="text-[13px] italic text-[#8a7d70] leading-relaxed" style={{ fontFamily: "Georgia, serif" }}>
                A letter to your family,<br />from the heart.
              </p>
            </div>
          )}
        </div>
        <div className="shrink-0 mt-3">
          <p className="text-[9px] uppercase tracking-[0.12em] text-[#7a6f65] mb-1.5 font-semibold">Our year</p>
          <div className="flex gap-2">
            {[
              { n: photoCount, l: "photos" },
              { n: winCount, l: "wins" },
              { n: bookCount, l: "books" },
              { n: quoteCount, l: "quotes" },
            ].map((s) => (
              <div key={s.l} className="bg-[#eeeade] rounded px-2 py-1.5 text-center flex-1">
                <p className="text-[15px] font-bold text-[var(--g-deep)]">{s.n}</p>
                <p className="text-[8px] text-[#7a6f65]">{s.l}</p>
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
          <p className="text-[9px] uppercase tracking-[0.12em] text-[#7a6f65] font-semibold mb-2">Favorite moment</p>
          {favMemory?.photo_url ? (
            // A real favorite moment — photo, with its date and caption beneath.
            <div>
              <div className="w-full rounded-md overflow-hidden" style={{ aspectRatio: "4/3" }}>
                <FocalPhoto src={favMemory.photo_url} aspect={photoAspect(toPhotoItem(favMemory))} focalX={favMemory.focal_x} focalY={favMemory.focal_y} />
              </div>
              <p className="text-[9px] text-[#7a6f65] mt-1.5">
                {safeParseDateStr(favMemory.date)?.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" }) ?? ""}
              </p>
              {favCaption && (
                <p className="italic text-[11px] text-[#3a352f] mt-1 line-clamp-2" style={{ fontFamily: "Georgia, serif" }}>{favCaption}</p>
              )}
            </div>
          ) : (
            // No photo to show — a clean designed panel, never an empty image
            // slot with an orphaned date/caption hanging beneath it.
            <div className="w-full rounded-md bg-[#eef3e6] flex items-center justify-center px-5 py-8" style={{ aspectRatio: "4/3" }}>
              <p className="text-[14px] italic text-[#5c7f63] text-center leading-relaxed line-clamp-3" style={{ fontFamily: "Georgia, serif" }}>
                {favMemory?.title ? favMemory.title : <>A moment worth<br />remembering.</>}
              </p>
            </div>
          )}
        </div>

        {/* Favorite quote */}
        {favQuoteText && (
          <div>
            <Sprig className="mb-3 mt-1" />
            <span className="text-[30px] font-serif text-[#b9a8d6] leading-none">&ldquo;</span>
            <p className="italic text-[12px] text-[#2d2926] line-clamp-4 leading-relaxed" style={{ fontFamily: "Georgia, serif" }}>{favQuoteText}</p>
            {favQuoteMemory?.child_id && (
              <p className="text-[10px] text-[#7a6f65] mt-1.5">
                — {children.find((c) => c.id === favQuoteMemory.child_id)?.name ?? ""}
              </p>
            )}
          </div>
        )}
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
    // Photos flow through the chapter in the family's chosen order (page_order),
    // falling back to date when un-ordered. Hidden photos are excluded; the
    // mosaic builder consumes this sequence, so reordering changes grouping.
    const childPhotos = orderPhotos(keepInBook(childMems.filter((m) => m.photo_url)));
    // Allocate this chapter's still-unused photos across the feature divider,
    // the "favorite things" slot, and the collage WITHOUT starving the collage:
    // planChapterPhotos guarantees the collage is left at 0 or ≥2 photos (never
    // a lonely 1 that would leave a blank facing page), prefers the designed
    // title-panel divider on photo-poor chapters, and only spends a full-bleed
    // photo divider when there's one to spare. Most-recent photos fill the
    // prominent slots; the rest flow to the collage. No photo is shown twice.
    const available = childPhotos.filter((m) => !reservedPhotoIds.has(m.id));
    // Featured photos get their own full-bleed pages and are NOT eligible for
    // the divider opener or the favorites slot; the divider/favorites are
    // planned from the non-featured photos so the collage still fills.
    const nonFeatured = available.filter((m) => !m.featured);
    const plan = planChapterPhotos(nonFeatured.length, ybSettings.show_favorite_things);
    const byRecent = [...nonFeatured].reverse();
    let pick = 0;
    const featurePhoto = plan.useFeaturePhoto ? byRecent[pick++] : null;
    const favThingsPhoto = plan.useFavPhoto ? byRecent[pick++] : null;
    if (featurePhoto) reservedPhotoIds.add(featurePhoto.id);
    if (favThingsPhoto) reservedPhotoIds.add(favThingsPhoto.id);
    // Chapter body in order: featured photos stay (→ solo pages), the rest mosaic.
    const bodyChildPhotos = available.filter(
      (m) => m.id !== featurePhoto?.id && m.id !== favThingsPhoto?.id,
    );

    spreads.push({
      id: `child-${child.id}`,
      label: `${child.name}'s chapter`,
      // Chapter divider — a real yearbook section opener: a full-bleed feature
      // photo with the chapter title set over a soft scrim. No photo → a
      // designed title panel on the brand color (never empty cream).
      leftContent: featurePhoto?.photo_url ? (
        <div className="relative w-full h-full overflow-hidden" style={{ background: "#FAFAF7" }}>
          <FocalPhoto src={featurePhoto.photo_url} aspect={photoAspect(toPhotoItem(featurePhoto))} focalX={featurePhoto.focal_x} focalY={featurePhoto.focal_y} />
          <div
            className="absolute inset-x-0 bottom-0 px-6 pt-16 pb-7"
            style={{ background: "linear-gradient(to top, rgba(22,32,24,0.82), rgba(22,32,24,0))" }}
          >
            <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-[#cfe3c9]">Chapter {ci + 1}</p>
            <h2 className="text-[26px] font-bold text-white leading-tight mt-1" style={{ fontFamily: "var(--font-display)" }}>
              {child.name}&apos;s year
            </h2>
            <p className="text-[10px] text-white/75 mt-1">{childMems.length} memories</p>
            {featurePhoto.date && (
              <p className="text-[9px] text-white/60 mt-0.5">
                {safeParseDateStr(featurePhoto.date)?.toLocaleDateString("en-US", { month: "long", year: "numeric" }) ?? ""}
              </p>
            )}
          </div>
        </div>
      ) : (
        <div
          className="relative w-full h-full overflow-hidden flex flex-col items-center justify-center text-center px-7"
          style={{ background: "var(--g-brand)" }}
        >
          <span className="absolute top-6 right-5 text-[120px] opacity-[0.06] select-none pointer-events-none" style={{ transform: "rotate(-12deg)" }}>🌿</span>
          <span className="absolute bottom-8 left-4 text-[96px] opacity-[0.05] select-none pointer-events-none" style={{ transform: "rotate(18deg)" }}>🍃</span>
          <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-[#cfe3c9] relative z-10">Chapter {ci + 1}</p>
          <h2 className="text-[27px] font-bold text-[#fefcf9] leading-tight mt-2 relative z-10" style={{ fontFamily: "var(--font-display)" }}>
            {child.name}&apos;s year
          </h2>
          <span className="text-[20px] my-4 opacity-70 select-none relative z-10" aria-hidden>🌿</span>
          <p className="text-[10px] text-white/70 relative z-10">{childMems.length} memories</p>
        </div>
      ),
      rightContent: (
        <PageShell>
          <div className="shrink-0">
            <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-[#5c7f63]">{child.name} in their own words</p>
            <h3 className="text-[16px] font-bold text-[#2d2926] mt-1" style={{ fontFamily: "var(--font-display)" }}>
              Year-end interview
            </h3>
          </div>

          <div className="space-y-3 flex-1 min-h-0 overflow-hidden mt-3">
            {INTERVIEW_QUESTIONS.slice(0, 4).map((q) => {
              const answer = contentMap[ck("child_interview", child.id, q.key)] ?? "";
              return (
                <div key={q.key}>
                  <p className="italic text-[10px] text-[#7a6f65] leading-snug">{q.label}</p>
                  {answer.trim() ? (
                    <p className="text-[11.5px] text-[#2d2926] leading-relaxed line-clamp-3 mt-0.5" style={{ fontFamily: "Georgia, serif" }}>{answer}</p>
                  ) : (
                    <p className="italic text-[11px] text-[#a99f93] leading-relaxed mt-0.5">Not answered yet</p>
                  )}
                </div>
              );
            })}
          </div>

          {(() => {
            const note = contentMap[ck("child_future_note", child.id)] ?? "";
            if (!note.trim()) return null;
            return (
              <div className="bg-[#faf6ec] border-l-2 border-[#e8c44a] rounded-r-lg p-2.5 shrink-0 mt-3">
                <p className="text-[8px] uppercase tracking-[0.1em] text-[#b08e1e] font-semibold mb-1">
                  A note to future {child.name}
                </p>
                <p className="italic text-[11px] text-[#2d2926] line-clamp-3 leading-relaxed" style={{ fontFamily: "Georgia, serif" }}>{note}</p>
                <p className="text-[9px] text-[#7a6f65] mt-1">{child.name}</p>
              </div>
            );
          })()}
        </PageShell>
      ),
    });

    // 3a. PHOTO COLLAGE SPREADS — the chapter's photos (minus the one reserved
    // for "favorite things"), tiled into full-page mosaics across both pages of
    // each spread.
    for (const sp of chapterUnitsToSpreads(
      buildChapterPhotoUnits(bodyChildPhotos.map(toPhotoItem)),
      `child-${child.id}-photos`,
      `${child.name}'s chapter`,
    )) {
      spreads.push(sp);
    }

    // 3b. FAVORITE THINGS SPREAD
    if (ybSettings.show_favorite_things) {
      // Only the reserved photo feeds the favorites page (so it's never a
      // collage repeat); if the chapter has no spare photo, the page is the
      // text-only prompts treatment.
      const favMemories: YearbookMemory[] = favThingsPhoto
        ? [{
            id: favThingsPhoto.id,
            type: (favThingsPhoto.type as YearbookMemory["type"]) ?? "photo",
            title: favThingsPhoto.title,
            photo_url: favThingsPhoto.photo_url,
            created_at: favThingsPhoto.date,
            child_name: child.name,
          }]
        : [];
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
  const famPhotos = orderPhotos(keepInBook(familyMemories.filter((m) => m.photo_url)));
  const famWins = familyMemories.filter((m) => m.type === "win" || m.type === "field_trip");

  if (ybSettings.show_family_chapter) spreads.push({
    id: "family",
    label: "Our family",
    leftContent: (
      <PageShell>
        <div className="shrink-0">
          <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-[#5c7f63]">Together</p>
          <h2 className="text-[18px] font-bold text-[#2d2926] mt-1" style={{ fontFamily: "var(--font-display)" }}>Our family</h2>
          <p className="text-[10px] text-[#7a6f65] mt-0.5">{familyMemories.length} shared memories</p>
        </div>

        {familyMemories.length > 0 ? (
          <div className="space-y-2.5 mt-4">
            {/* Family photos flow to the collage spreads below (all of them). */}
            {famWins.map((w) => (
              <div key={w.id} className="bg-[#f0ede5] rounded-lg p-2.5 border-l-2 border-[#cdd9bf]">
                <p className="text-[8px] uppercase tracking-[0.1em] text-[#5c7f63] font-semibold flex items-center gap-1 mb-1">
                  <span>{w.type === "field_trip" ? "🗺️" : "⭐"}</span>
                  <span>{w.type === "field_trip" ? "Trip" : "Win"}</span>
                  {w.date && (
                    <span className="text-[#7a6f65] font-normal normal-case tracking-normal ml-auto">
                      {safeParseDateStr(w.date)?.toLocaleDateString("en-US", { month: "short", year: "numeric" }) ?? ""}
                    </span>
                  )}
                </p>
                <p className="text-[11px] text-[#2d2926] line-clamp-2 leading-relaxed" style={{ fontFamily: "Georgia, serif" }}>{w.title}</p>
              </div>
            ))}
          </div>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center text-center px-4">
            <span className="text-[40px] mb-3 opacity-60">👨‍👩‍👧‍👦</span>
            <p className="text-[13px] italic text-[#8a7d70] leading-relaxed" style={{ fontFamily: "Georgia, serif" }}>
              The moments we shared,<br />all together.
            </p>
          </div>
        )}
      </PageShell>
    ),
    rightContent: (
      <PageShell>
        <div className="flex-1 flex flex-col items-center justify-center text-center px-6">
          <Sprig className="mb-5" />
          <p className="text-[24px] italic text-[#2d4a35] leading-snug" style={{ fontFamily: "Georgia, serif" }}>
            Our days,<br />together.
          </p>
          <Sprig className="mt-5" />
        </div>
      </PageShell>
    ),
  });

  // 4a. FAMILY PHOTO COLLAGE SPREADS — all family photos (minus any reserved for
  // the letter's favorite moment), tiled into mosaics.
  const collageFamPhotos = famPhotos.filter((m) => !reservedPhotoIds.has(m.id));
  if (ybSettings.show_family_chapter) {
    for (const sp of chapterUnitsToSpreads(buildChapterPhotoUnits(collageFamPhotos.map(toPhotoItem)), "family-photos", "Our family")) {
      spreads.push(sp);
    }
  }

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

  // 5. FROM THE VILLAGE SPREAD — a keepsake signing page (warm write-on lines)
  // for family to handwrite in. No in-app CTAs are printed into the book.
  const SigningLines = ({ count }: { count: number }) => (
    <div className="flex-1 flex flex-col justify-center gap-[26px]">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="border-b border-[#e2d9c7]" />
      ))}
    </div>
  );
  if (ybSettings.show_village) spreads.push({
    id: "village",
    label: "From the village",
    leftContent: (
      <PageShell>
        <div className="shrink-0">
          <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-[#5c7f63]">The people who love you</p>
          <h2 className="text-[18px] font-bold text-[#2d2926] mt-1" style={{ fontFamily: "var(--font-display)" }}>From the village</h2>
          <p className="italic text-[11px] text-[#7a6f65] mt-1.5" style={{ fontFamily: "Georgia, serif" }}>A page for the people who love you to sign.</p>
        </div>
        <SigningLines count={5} />
      </PageShell>
    ),
    rightContent: (
      <PageShell>
        <SigningLines count={7} />
      </PageShell>
    ),
  });

  // 6. BACK COVER SPREAD
  spreads.push({
    id: "back",
    label: "Back cover",
    leftContent: (
      <PageShell>
        <div className="flex flex-col items-center justify-center text-center px-5">
          <p className="text-[10px] text-[#7a6f65] tracking-[0.18em] uppercase">{yearLabel}</p>
          <Sprig className="my-3" />
          <p className="italic text-[13px] text-[#3a352f] leading-relaxed line-clamp-3" style={{ fontFamily: "Georgia, serif" }}>
            {letterText.trim() ? letterText.slice(0, 80) + (letterText.length > 80 ? "…" : "") : "Our story, beautifully kept."}
          </p>
          <Sprig className="my-3" />
          <p className="text-[9px] text-[#7a6f65]">
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

  // Prepend the cover now that every body spread exists, so its table of
  // contents cites real page numbers. A body spread at index i ends up at array
  // index i+1 after the unshift → human page number (i+1)*2 + 1.
  const pageNumberForId = (id: string): number | null => {
    const idx = spreads.findIndex((s) => s.id === id);
    return idx === -1 ? null : (idx + 1) * 2 + 1;
  };
  spreads.unshift(buildCoverSpread(pageNumberForId));

  // ── Stamp discreet page numbers on every content page ─────────────────────
  // Folios count the cover as pages 1-2 (so a body spread's left page is
  // si*2+1), which is exactly what the cover's table of contents cites via
  // pageNumberForId — the two always agree. The cover (si 0) and back cover
  // (last spread) are intentionally left unnumbered.
  spreads.forEach((s, si) => {
    if (si === 0 || si === spreads.length - 1) return;
    s.leftContent = <PageWithNumber n={si * 2 + 1}>{s.leftContent}</PageWithNumber>;
    s.rightContent = <PageWithNumber n={si * 2 + 2}>{s.rightContent}</PageWithNumber>;
  });

  // ── Build flat pages array with headers + edit links ──────────────────────

  function getEditHrefs(spreadId: string): [string | null, string | null] {
    const base = "/dashboard/memories/yearbook/edit";
    if (spreadId === "letter") return [`${base}#letter`, `${base}#favorites`];
    if (spreadId.startsWith("child-")) {
      // Extract actual child ID (child-<id>, child-<id>-photos-N, child-<id>-favorites, child-<id>-books)
      const childId = spreadId
        .replace("child-", "")
        .replace(/-spread-\d+$/, "")
        .replace(/-photos-\d+$/, "")
        .replace(/-favorites$/, "")
        .replace(/-books$/, "");
      if (spreadId.includes("-books") || spreadId.includes("-spread-") || spreadId.includes("-photos") || spreadId.includes("-favorites")) {
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

  const accessLevel = getUserAccess(profile);
  const FREE_SPREAD_LIMIT = 4;
  const displaySpreads = accessLevel === 'free' ? spreads.slice(0, FREE_SPREAD_LIMIT) : spreads;
  const displayPages = accessLevel === 'free' ? pages.slice(0, FREE_SPREAD_LIMIT * 2) : pages;
  const maxPage = displayPages.length - 1;
  maxPageRef.current = maxPage;
  const safePage = Math.min(currentPage, maxPage);
  const spreadIndex = Math.floor(safePage / 2);

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

  const canDownload = getUserAccess(profile) !== 'free';
  const handlePrint = () => {
    if (!canDownload) return;
    if (typeof window !== 'undefined') window.print();
  };

  return (
    <>
      {/* ── Mobile view ──────────────────────────────────────── */}
      {/* Nav bar is ~64px (py-3 + 40px avatar). Position reader below it. */}
      <div
        className="yearbook-screen-only md:hidden fixed left-0 right-0 z-50 flex flex-col"
        style={{ top: 64, height: "calc(100dvh - 64px)", overflow: "hidden", background: "#1a1a1a" }}
      >
        {/* Back button bar — points at Memories (parent tab) since the old
            /dashboard/memories/yearbook landing now redirects straight
            here, which would otherwise loop on every click. */}
        <div className="shrink-0 h-11 flex items-center justify-between px-4" style={{ background: "rgba(26,26,26,0.95)" }}>
          <Link href="/dashboard/memories" className="text-[12px] text-[#9a8f85] hover:text-white transition-colors">
            ← Memories
          </Link>
          <div className="flex items-center gap-2">
            {canDownload ? (
              <button
                onClick={handlePrint}
                className="px-3 py-1 rounded-md text-[11px] font-bold text-white shadow-sm hover:brightness-110 transition-all"
                style={{ background: "var(--g-gold)" }}
                title="Select 'Save as PDF' in the browser's print dialog"
                aria-label="Download yearbook as PDF"
              >
                Download PDF
              </button>
            ) : isNative ? (
              <span
                className="px-3 py-1 rounded-md text-[11px] font-medium text-[#9a8f85] border border-[#3d3530]"
                aria-label="PDF download available at rootedhomeschoolapp.com"
              >
                PDF at rootedhomeschoolapp.com
              </span>
            ) : (
              <Link
                href="/upgrade"
                className="px-3 py-1 rounded-md text-[11px] font-bold text-[#9a8f85] border border-[#3d3530] hover:text-white hover:border-white/40 transition-all"
                aria-label="Upgrade to unlock PDF download"
              >
                Download PDF (Founding Family)
              </Link>
            )}
            <Link
              href="/dashboard/memories/yearbook/edit"
              className="px-2.5 py-1 rounded-md text-[11px] font-medium text-[#9a8f85] border border-[#3d3530] hover:text-white hover:border-white/40 transition-all"
              aria-label="Edit yearbook memories"
            >
              Edit
            </Link>
          </div>
        </div>

        {/* Book page area */}
        <div className="flex-1 min-h-0 relative" {...swipeHandlers}>
          {getUserAccess(profile) === 'free' && <PreviewWatermark />}
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
                <p className="text-[9px] font-semibold tracking-[0.15em] uppercase text-[#9a8a7c]">
                  {displayPages[safePage]?.header}
                </p>
                {/* Edit shortcut */}
                {displayPages[safePage]?.editHref && (
                  <Link
                    href={displayPages[safePage].editHref!}
                    className="absolute top-3 right-3 w-[44px] h-[44px] flex items-center justify-center"
                    aria-label="Edit this page"
                  >
                    <span className="text-[20px] opacity-40 hover:opacity-70 transition-opacity">✏️</span>
                  </Link>
                )}
              </div>

              {/* Page content */}
              <div className="flex-1 min-h-0 overflow-hidden relative">
                {displayPages[safePage]?.content}
              </div>

              {/* Page progress */}
              <div className="shrink-0 pb-2 pt-0.5 text-center" style={{ background: isDark ? "transparent" : undefined }}>
                <p className={`text-[9px] ${isDark ? "text-white/35" : "text-[#b5aca4]"}`}>
                  {safePage + 1} / {displayPages.length}
                </p>
              </div>

              {accessLevel === 'free' && spreadIndex >= FREE_SPREAD_LIMIT - 1 && (
                <div className="shrink-0 pb-3 px-4 text-center">
                  <p className="text-xs text-[#9a8f85] mb-2">Previewing {FREE_SPREAD_LIMIT} of {spreads.length} spreads</p>
                  <a href="/dashboard/settings?tab=account" className="inline-block px-4 py-2 rounded-lg text-xs font-semibold text-white bg-[#2D5A3D] hover:opacity-90 transition-opacity">
                    Upgrade to see the full yearbook
                  </a>
                </div>
              )}
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
        className="yearbook-screen-only hidden md:flex fixed inset-0 flex-col items-center justify-center"
        style={{ background: "#2d2926", height: "100dvh", overflow: "hidden" }}
      >
        {/* Back button + settings. "← Memories" rather than "← Yearbook"
            because the old /dashboard/memories/yearbook landing now
            redirects here — clicking it would loop back to /read. */}
        <div className="absolute top-4 left-6 z-30">
          <Link href="/dashboard/memories" className="text-sm text-[#9a8f85] hover:text-white transition-colors">
            ← Memories
          </Link>
        </div>
        <div className="absolute top-4 right-6 z-30 flex items-start gap-3">
          {canDownload ? (
            <div className="flex flex-col items-end">
              <button
                onClick={handlePrint}
                className="px-4 py-2 rounded-lg text-[13px] font-bold text-white shadow-[0_2px_8px_rgba(196,150,42,0.3)] hover:-translate-y-0.5 transition-all"
                style={{ background: "var(--g-gold)" }}
                aria-label="Download yearbook as PDF"
              >
                ⬇ Download PDF
              </button>
              <p className="text-[10px] text-[#9a8f85] mt-1 max-w-[220px] text-right leading-tight">
                Select &ldquo;Save as PDF&rdquo; as the destination in your browser&apos;s print dialog.
              </p>
            </div>
          ) : isNative ? (
            <div className="flex flex-col items-end">
              <span
                className="px-4 py-2 rounded-lg text-[13px] font-medium text-[#c4b89a] border border-[#4d453f]"
                aria-label="PDF download available at rootedhomeschoolapp.com"
              >
                ⬇ PDF at rootedhomeschoolapp.com
              </span>
              <p className="text-[10px] text-[#9a8f85] mt-1 max-w-[240px] text-right leading-tight">
                PDF download for Founding Family, yours to save, print, or share at rootedhomeschoolapp.com.
              </p>
            </div>
          ) : (
            <div className="flex flex-col items-end">
              <Link
                href="/upgrade"
                className="px-4 py-2 rounded-lg text-[13px] font-bold text-[#c4b89a] border border-[#4d453f] hover:text-white hover:border-white/40 transition-all"
                aria-label="Upgrade to unlock PDF download"
              >
                ⬇ Download PDF (Founding Family)
              </Link>
              <p className="text-[10px] text-[#9a8f85] mt-1 max-w-[240px] text-right leading-tight">
                Unlock PDF download with Founding Family, yours to save, print, or share.
              </p>
            </div>
          )}
          {/* Secondary action — preserves the edit entry point that lived
              on the removed landing page. */}
          <Link
            href="/dashboard/memories/yearbook/edit"
            className="px-3 py-2 rounded-lg text-[12px] font-medium text-[#c4b89a] border border-[#4d453f] hover:text-white hover:border-white/40 transition-all"
            aria-label="Edit yearbook memories"
          >
            Edit Memories
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
              className="flex rounded-lg overflow-hidden relative"
              style={{ width: 800, height: 560, boxShadow: "0 4px 30px rgba(0,0,0,0.15)", background: "#FAFAF7" }}
            >
              {getUserAccess(profile) === 'free' && <PreviewWatermark />}
              <div className="w-1/2 h-full">{displaySpreads[spreadIndex]?.leftContent}</div>
              <Spine />
              <div className="w-1/2 h-full">{displaySpreads[spreadIndex]?.rightContent}</div>
            </motion.div>
          </AnimatePresence>

          <button
            onClick={() => {
              setDirection(1);
              setCurrentPage(Math.min((spreadIndex + 1) * 2, maxPage));
            }}
            disabled={spreadIndex >= displaySpreads.length - 1}
            className="w-12 h-12 rounded-full flex items-center justify-center text-[#c4b89a] hover:bg-[#4d453f] disabled:opacity-30 transition-colors"
            style={{ background: "#3d3530" }}
          >
            →
          </button>
        </div>

        {/* Desktop progress */}
        <div className="mt-4 text-center">
          <p className="text-[10px] text-[#9a8f85]">
            {spreadIndex + 1} / {displaySpreads.length}
          </p>
        </div>

        {accessLevel === 'free' && spreadIndex >= FREE_SPREAD_LIMIT - 1 && (
          <div className="mt-3 text-center">
            <p className="text-xs text-[#9a8f85] mb-2">Previewing {FREE_SPREAD_LIMIT} of {spreads.length} spreads</p>
            <a href="/dashboard/settings?tab=account" className="inline-block px-4 py-2 rounded-lg text-xs font-semibold text-white bg-[#2D5A3D] hover:opacity-90 transition-opacity">
              Upgrade to see the full yearbook
            </a>
          </div>
        )}
      </div>

      {/* ── Print-only stacked layout ─────────────────────────
         The on-screen reader shows one spread at a time via
         AnimatePresence, so window.print() can't capture the whole
         yearbook from that view. This sibling mounts every page in
         flat order with page-break-after on each spread. Gated to
         paying/trial users — a free user hitting Ctrl+P gets a single
         upgrade pitch page instead of the full yearbook. */}
      {canDownload ? (
        <div className="yearbook-print-only" aria-hidden>
          {pages.map((p, i) => (
            <div
              key={`print-${i}`}
              className="yearbook-print-spread"
              style={{ background: "#FAFAF7" }}
            >
              <div style={{ padding: "12px 16px", textAlign: "center" }}>
                <p style={{ fontSize: 10, letterSpacing: "0.15em", textTransform: "uppercase", color: "#7a6f65" }}>
                  {p.header}
                </p>
              </div>
              <div style={{ padding: "0 16px 16px" }}>{p.content}</div>
            </div>
          ))}
        </div>
      ) : (
        <div className="yearbook-print-only" aria-hidden>
          <div className="yearbook-print-spread" style={{ padding: "2in 0.5in", textAlign: "center" }}>
            <h1 style={{ fontSize: 28, color: "#2d2926", marginBottom: 12 }}>Your Rooted Yearbook</h1>
            <p style={{ fontSize: 14, color: "#7a6f65", lineHeight: 1.6, maxWidth: 420, margin: "0 auto" }}>
              PDF download is available to Founding Family members. Visit
              <span style={{ fontWeight: 600, color: "#2d2926" }}> rootedhomeschoolapp.com/upgrade </span>
              to unlock your yearbook to save, print, or share.
            </p>
          </div>
        </div>
      )}

    </>
  );
}
