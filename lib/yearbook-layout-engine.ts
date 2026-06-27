// ─── Yearbook Layout Engine ──────────────────────────────────────────────────
// Pure TypeScript — no React dependencies.
//
// NOTE (2026-06): the day-by-day spread engine (buildYearbookSpreads,
// photoSpreads, the milestone + month-divider builders, and their date/month
// grouping helpers) was RETIRED. It was never wired into the reader — the
// reader lays its own photos out via `buildPhotoPages` in
// lib/yearbook-photo-pages.ts. What remains here are the shared types and the
// three spread builders the reader still uses (year-in-numbers, books,
// favorite-things), rendered by components/yearbook/SpreadLayouts.tsx.

export type YearbookMemoryType =
  | "photo"
  | "win"
  | "quote"
  | "book"
  | "field_trip"
  | "drawing"
  | "project";

export interface YearbookMemory {
  id: string;
  type: YearbookMemoryType;
  title: string | null;
  photo_url: string | null;
  created_at: string; // ISO date string
  child_name: string | null;
}

export type SpreadLayoutType =
  | "hero"
  | "side_by_side"
  | "editorial"
  | "grid"
  | "milestone"
  | "milestone_with_photo"
  | "books"
  | "year_in_numbers"
  | "month_divider"
  | "favorite_things"
  | "mixed";

export interface YearbookSpread {
  layoutType: SpreadLayoutType;
  memories: YearbookMemory[];
  metadata?: {
    familyName?: string;
    yearLabel?: string;
    totalMemories?: number;
    totalPhotos?: number;
    totalWins?: number;
    totalBooks?: number;
    totalFieldTrips?: number;
    activeDays?: number;
    childName?: string;
    // Month divider
    monthName?: string;
    monthYear?: string;
    // Milestone — other wins/quotes from the same month
    alsoThisMonth?: YearbookMemory[];
    // Favorite things
    favoriteAnswers?: Record<string, string>;
    latestPhotoUrl?: string | null;
  };
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function dateOnly(iso: string): string {
  return iso.slice(0, 10);
}

// ─── Year in Numbers spread builder ──────────────────────────────────────────

export function buildYearInNumbersSpread(
  memories: YearbookMemory[],
  familyName: string,
  yearLabel: string,
): YearbookSpread {
  const uniqueDates = new Set(memories.map((m) => dateOnly(m.created_at)));

  return {
    layoutType: "year_in_numbers",
    memories: [],
    metadata: {
      familyName,
      yearLabel,
      totalMemories: memories.length,
      totalPhotos: memories.filter((m) => m.type === "photo" || m.type === "drawing" || !!m.photo_url).length,
      totalWins: memories.filter((m) => m.type === "win").length,
      totalBooks: memories.filter((m) => m.type === "book").length,
      totalFieldTrips: memories.filter((m) => m.type === "field_trip").length,
      activeDays: uniqueDates.size,
    },
  };
}

// ─── Books spread builder ────────────────────────────────────────────────────

export function buildBooksSpread(
  bookMemories: YearbookMemory[],
  childName: string,
): YearbookSpread {
  return {
    layoutType: "books",
    memories: bookMemories,
    metadata: { childName },
  };
}

// ─── Favorite things spread builder ──────────────────────────────────────────

export function buildFavoriteThingsSpread(
  childMemories: YearbookMemory[],
  childName: string,
  favoriteAnswers: Record<string, string>,
): YearbookSpread {
  // Find the most recent photo for the right page
  const photosWithUrl = childMemories.filter((m) => m.photo_url);
  const latestPhoto = photosWithUrl.length > 0 ? photosWithUrl[photosWithUrl.length - 1] : null;

  return {
    layoutType: "favorite_things",
    memories: latestPhoto ? [latestPhoto] : [],
    metadata: {
      childName,
      favoriteAnswers,
      latestPhotoUrl: latestPhoto?.photo_url ?? null,
    },
  };
}
