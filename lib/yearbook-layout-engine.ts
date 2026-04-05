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
  };
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function dateOnly(iso: string): string {
  return iso.slice(0, 10);
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

function milestoneSpreads(milestones: YearbookMemory[]): YearbookSpread[] {
  return milestones.map((m) => ({
    layoutType: m.photo_url ? "milestone_with_photo" : "milestone",
    memories: [m],
  }));
}

// ─── Main export ─────────────────────────────────────────────────────────────

export function buildYearbookSpreads(memories: YearbookMemory[]): YearbookSpread[] {
  const dateGroups = groupByDate(memories);
  const spreads: YearbookSpread[] = [];

  // Process each date group in chronological order
  const sortedDates = Array.from(dateGroups.keys()).sort();

  for (const date of sortedDates) {
    const group = dateGroups.get(date)!;
    const photos = group.filter((m) => isPhoto(m) && !isMilestone(m));
    const milestones = group.filter((m) => isMilestone(m));
    const others = group.filter((m) => !isPhoto(m) && !isMilestone(m) && m.type !== "book");

    // Photos → hero/side_by_side/editorial/grid
    spreads.push(...photoSpreads(photos));

    // Wins/quotes → individual milestone spreads
    spreads.push(...milestoneSpreads(milestones));

    // Anything else → mixed
    if (others.length > 0) {
      spreads.push({ layoutType: "mixed", memories: others });
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
