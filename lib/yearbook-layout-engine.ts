// ─── Yearbook Layout Engine ──────────────────────────────────────────────────
// Pure TypeScript — no React dependencies.
// Groups memories into spreads with layout hints for the renderer.

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

function monthKey(iso: string): string {
  return iso.slice(0, 7); // "2025-09"
}

function monthName(iso: string): string {
  const dt = new Date(iso.slice(0, 10) + "T12:00:00");
  return dt.toLocaleDateString("en-US", { month: "long" });
}

function monthYear(iso: string): string {
  const dt = new Date(iso.slice(0, 10) + "T12:00:00");
  return dt.toLocaleDateString("en-US", { year: "numeric" });
}

function groupByDate(memories: YearbookMemory[]): Map<string, YearbookMemory[]> {
  const groups = new Map<string, YearbookMemory[]>();
  for (const m of memories) {
    const d = dateOnly(m.created_at);
    const arr = groups.get(d) ?? [];
    arr.push(m);
    groups.set(d, arr);
  }
  return groups;
}

function groupByMonth(memories: YearbookMemory[]): Map<string, YearbookMemory[]> {
  const groups = new Map<string, YearbookMemory[]>();
  for (const m of memories) {
    const mk = monthKey(m.created_at);
    const arr = groups.get(mk) ?? [];
    arr.push(m);
    groups.set(mk, arr);
  }
  return groups;
}

function isPhoto(m: YearbookMemory): boolean {
  return m.type === "photo" || m.type === "drawing" || !!m.photo_url;
}

function isMilestone(m: YearbookMemory): boolean {
  return m.type === "win" || m.type === "quote";
}

// ─── Photo spread assignment ─────────────────────────────────────────────────

function photoSpreads(photos: YearbookMemory[]): YearbookSpread[] {
  if (photos.length === 0) return [];

  const result: YearbookSpread[] = [];
  let remaining = [...photos];

  while (remaining.length > 0) {
    if (remaining.length === 1) {
      result.push({ layoutType: "hero", memories: [remaining[0]] });
      remaining = [];
    } else if (remaining.length === 2) {
      result.push({ layoutType: "side_by_side", memories: remaining.slice(0, 2) });
      remaining = [];
    } else if (remaining.length === 3) {
      result.push({ layoutType: "editorial", memories: remaining.slice(0, 3) });
      remaining = [];
    } else {
      // 4+ → grid of 4, remainder continues
      result.push({ layoutType: "grid", memories: remaining.slice(0, 4) });
      remaining = remaining.slice(4);
    }
  }

  return result;
}

// ─── Milestone spread assignment ─────────────────────────────────────────────

function milestoneSpreads(milestones: YearbookMemory[], allMilestonesInMonth: YearbookMemory[]): YearbookSpread[] {
  return milestones.map((m) => {
    // Find other wins/quotes in the same month (excluding this one)
    const alsoThisMonth = allMilestonesInMonth.filter((o) => o.id !== m.id);
    return {
      layoutType: (m.photo_url ? "milestone_with_photo" : "milestone") as SpreadLayoutType,
      memories: [m],
      metadata: {
        alsoThisMonth: alsoThisMonth.length > 0 ? alsoThisMonth : undefined,
        childName: m.child_name ?? undefined,
      },
    };
  });
}

// ─── Build spreads for a single date group ───────────────────────────────────

function buildDateGroupSpreads(
  group: YearbookMemory[],
  allMilestonesInMonth: YearbookMemory[],
): YearbookSpread[] {
  const spreads: YearbookSpread[] = [];
  const photos = group.filter((m) => isPhoto(m) && !isMilestone(m));
  const milestones = group.filter((m) => isMilestone(m));
  const others = group.filter((m) => !isPhoto(m) && !isMilestone(m) && m.type !== "book");

  spreads.push(...photoSpreads(photos));
  spreads.push(...milestoneSpreads(milestones, allMilestonesInMonth));

  if (others.length > 0) {
    spreads.push({ layoutType: "mixed", memories: others });
  }

  return spreads;
}

// ─── Main export ─────────────────────────────────────────────────────────────

export function buildYearbookSpreads(memories: YearbookMemory[]): YearbookSpread[] {
  const monthGroups = groupByMonth(memories);
  const sortedMonths = Array.from(monthGroups.keys()).sort();
  const multipleMonths = sortedMonths.length > 1;

  const spreads: YearbookSpread[] = [];

  for (const mk of sortedMonths) {
    const monthMems = monthGroups.get(mk)!;
    const allMilestonesInMonth = monthMems.filter((m) => isMilestone(m));

    // Insert month divider if spanning multiple months
    if (multipleMonths) {
      const firstMem = monthMems[0];
      const mName = monthName(firstMem.created_at);
      const mYear = monthYear(firstMem.created_at);

      // Build the first spread of this month to use as the right page of the divider
      const dateGroups = groupByDate(monthMems);
      const sortedDates = Array.from(dateGroups.keys()).sort();
      const firstDateGroup = dateGroups.get(sortedDates[0])!;
      const firstDateSpreads = buildDateGroupSpreads(firstDateGroup, allMilestonesInMonth);
      const firstSpreadMemories = firstDateSpreads.length > 0 ? firstDateSpreads[0].memories : [];

      spreads.push({
        layoutType: "month_divider",
        memories: firstSpreadMemories,
        metadata: {
          monthName: mName,
          monthYear: mYear,
        },
      });

      // Add remaining spreads from first date (skip the one used in divider)
      for (let i = 1; i < firstDateSpreads.length; i++) {
        spreads.push(firstDateSpreads[i]);
      }

      // Process remaining dates in this month
      for (let di = 1; di < sortedDates.length; di++) {
        const group = dateGroups.get(sortedDates[di])!;
        spreads.push(...buildDateGroupSpreads(group, allMilestonesInMonth));
      }
    } else {
      // Single month — no divider needed
      const dateGroups = groupByDate(monthMems);
      const sortedDates = Array.from(dateGroups.keys()).sort();

      for (const date of sortedDates) {
        const group = dateGroups.get(date)!;
        spreads.push(...buildDateGroupSpreads(group, allMilestonesInMonth));
      }
    }
  }

  return spreads;
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
