// Activity badges: which ones a family has earned, from counts.
//
// Sentry ROOTED-HOMESCHOOL-19 flagged the old version as an N+1 on
// /dashboard/garden: it pulled every memory id for the family seven times
// over (all, photo, drawing, book, win, in-book, on-this-day) just to take
// .length, then ran three more reads one after another. A family with 900
// memories moved 6,300 ids across the wire to learn seven numbers. Everything
// here asks PostgREST for the number instead ({ count: "exact", head: true })
// and asks all of it in one wave.
//
// Pure of the app's Supabase singleton on purpose: the client is a parameter,
// so lib/badge-checks.test.ts can run the whole thing against in-memory rows
// and assert the badge set is the one the old logic produced. lib/badges.ts
// is the thin wrapper the app imports.

export type BadgeDef = {
  id: string;
  emoji: string;
  label: string;
  message: string;
};

export const ACTIVITY_BADGES: BadgeDef[] = [
  { id: "story_begun",       emoji: "🌱", label: "Story Begun",       message: "You saved your first memory. This is where your story starts." },
  { id: "first_leaf",        emoji: "🍃", label: "First Leaf",        message: "Your first lesson is complete. A leaf unfurls." },
  { id: "first_win",         emoji: "🏆", label: "First Win",         message: "Your first win is captured. Celebrate the small stuff." },
  { id: "bookworm_begins",   emoji: "📚", label: "Bookworm Begins",   message: "The first book is logged. A reader is growing." },
  { id: "shutter",           emoji: "📷", label: "Shutter",           message: "First photo or drawing saved. These moments matter." },
  { id: "showing_up",        emoji: "🔥", label: "Showing Up",        message: "5 active days this month. Consistency is everything." },
  { id: "gallery_wall",      emoji: "🖼️", label: "Gallery Wall",      message: "3 drawings saved. You're building a gallery." },
  { id: "author",            emoji: "✍️", label: "Author",            message: "5 books logged. You're raising a reader." },
  { id: "full_circle",       emoji: "🔄", label: "Full Circle",       message: "A memory from one year ago. Look how far you've come." },
  { id: "founding_family",   emoji: "⭐", label: "Rooted+ Founding Family",   message: "You believed in Rooted from the start. Thank you." },
  { id: "rooted",            emoji: "🌳", label: "Rooted",            message: "One full year. Your roots run deep now." },
];

/** The slice of a Supabase client this module uses. */
export type CountResult = { count: number | null; error: unknown };
export type RowsResult<T> = { data: T[] | null; error: unknown };
export type RowResult<T> = { data: T | null; error: unknown };
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type BadgeClient = { from(table: string): any };

export type BadgeSignals = {
  totalMemories: number;
  totalPhotosAndDrawings: number;
  totalDrawings: number;
  totalBooks: number;
  totalWins: number;
  totalLessons: number;
  /** Distinct days this month with a memory, a legacy event, or a completed lesson. */
  activeDays: number;
  /** Memories dated within three days either side of one year ago. */
  onThisDayCount: number;
  daysSinceSignup: number;
};

/** Badge ids the signals satisfy, in ACTIVITY_BADGES order. founding_family is separate. */
export function metBadgeIds(s: BadgeSignals): string[] {
  const checks: { id: string; met: boolean }[] = [
    { id: "story_begun",     met: s.totalMemories >= 1 },
    { id: "first_leaf",      met: s.totalLessons >= 1 },
    { id: "first_win",       met: s.totalWins >= 1 },
    { id: "bookworm_begins", met: s.totalBooks >= 1 },
    { id: "shutter",         met: s.totalPhotosAndDrawings >= 1 },
    { id: "showing_up",      met: s.activeDays >= 5 },
    { id: "gallery_wall",    met: s.totalDrawings >= 3 },
    { id: "author",          met: s.totalBooks >= 5 },
    { id: "full_circle",     met: s.onThisDayCount >= 1 },
    { id: "rooted",          met: s.daysSinceSignup >= 365 },
  ];
  return checks.filter((c) => c.met).map((c) => c.id);
}

const LEGACY_MEMORY_TYPES = ["memory_photo", "memory_project", "memory_book", "memory_field_trip", "memory_activity"];

/** One request, one number. Never a row. */
function countRows(q: PromiseLike<CountResult>): Promise<number> {
  return Promise.resolve(q).then((r) => r.count ?? 0);
}

/** Every number the badge checks need, fetched in a single wave. */
export async function collectBadgeSignals(client: BadgeClient, userId: string, now = new Date()): Promise<BadgeSignals> {
  const monthStart = new Date(now);
  monthStart.setDate(1);
  monthStart.setHours(0, 0, 0, 0);
  const monthStartIso = monthStart.toISOString();
  const yearAgoStart = new Date(now.getFullYear() - 1, now.getMonth(), now.getDate() - 3);
  const yearAgoEnd = new Date(now.getFullYear() - 1, now.getMonth(), now.getDate() + 3);
  const yStart = yearAgoStart.toISOString().slice(0, 10);
  const yEnd = yearAgoEnd.toISOString().slice(0, 10);

  const head = { count: "exact" as const, head: true };
  const memories = () => client.from("memories").select("*", head).eq("user_id", userId);
  const legacy = () => client.from("app_events").select("*", head).eq("user_id", userId);

  const [
    memCount, memPhotos, memDrawings, memBooks, memWins,
    legacyCount, legacyPhotos, legacyBooks, legacyWins,
    lessonCount, onThisDayCount,
    monthEvents, monthMemories, monthLessons,
    profileRow,
  ] = await Promise.all([
    countRows(memories()),
    countRows(memories().eq("type", "photo")),
    countRows(memories().eq("type", "drawing")),
    countRows(memories().eq("type", "book")),
    countRows(memories().in("type", ["win", "moment"])),
    countRows(legacy().in("type", LEGACY_MEMORY_TYPES)),
    countRows(legacy().eq("type", "memory_photo")),
    countRows(legacy().eq("type", "memory_book")),
    countRows(legacy().in("type", ["memory_activity", "memory_project"])),
    // The badge only asks "at least one", and an unranged read would stop at
    // PostgREST's 1,000 rows anyway. See lib/supabase-all-rows.ts.
    countRows(client.from("lessons").select("*", head).eq("user_id", userId).eq("completed", true)),
    countRows(memories().gte("date", yStart).lte("date", yEnd)),
    // "showing_up" needs the days themselves, not a number, so these three
    // read one date column each. Still one wave, no longer three in a row.
    client.from("app_events").select("created_at").eq("user_id", userId).gte("created_at", monthStartIso) as PromiseLike<RowsResult<{ created_at: string }>>,
    client.from("memories").select("created_at").eq("user_id", userId).gte("created_at", monthStartIso) as PromiseLike<RowsResult<{ created_at: string }>>,
    client.from("lessons").select("date, scheduled_date").eq("user_id", userId).eq("completed", true).gte("scheduled_date", monthStartIso.slice(0, 10)) as PromiseLike<RowsResult<{ date: string | null; scheduled_date: string | null }>>,
    client.from("profiles").select("created_at").eq("id", userId).single() as PromiseLike<RowResult<{ created_at?: string | null }>>,
  ]);

  const activeDays = new Set<string>();
  for (const e of monthEvents.data ?? []) activeDays.add(e.created_at.slice(0, 10));
  for (const m of monthMemories.data ?? []) activeDays.add(m.created_at.slice(0, 10));
  for (const l of monthLessons.data ?? []) {
    const d = l.date ?? l.scheduled_date;
    if (d) activeDays.add(d.slice(0, 10));
  }

  const createdAt = profileRow.data?.created_at;
  const daysSinceSignup = createdAt ? Math.floor((now.getTime() - new Date(createdAt).getTime()) / 86400000) : 0;

  return {
    totalMemories: memCount + legacyCount,
    totalPhotosAndDrawings: memPhotos + memDrawings + legacyPhotos,
    totalDrawings: memDrawings,
    totalBooks: memBooks + legacyBooks,
    totalWins: memWins + legacyWins,
    totalLessons: lessonCount,
    activeDays: activeDays.size,
    onThisDayCount,
    daysSinceSignup,
  };
}

/**
 * Award every activity badge the family has newly earned. Returns the first
 * new one, in ACTIVITY_BADGES order, for the notification. The existing-badge
 * read runs in the same wave as the counts.
 */
export async function awardActivityBadges(client: BadgeClient, userId: string, now = new Date()): Promise<BadgeDef | null> {
  const [existingResult, signals] = await Promise.all([
    client.from("user_badges").select("badge_id").eq("user_id", userId) as PromiseLike<RowsResult<{ badge_id: string }>>,
    collectBadgeSignals(client, userId, now),
  ]);
  const earned = new Set((existingResult.data ?? []).map((b) => b.badge_id));

  let firstNew: BadgeDef | null = null;
  for (const id of metBadgeIds(signals)) {
    if (earned.has(id)) continue;
    await client.from("user_badges").upsert({ user_id: userId, badge_id: id }, { onConflict: "user_id,badge_id" });
    if (!firstNew) firstNew = ACTIVITY_BADGES.find((b) => b.id === id) ?? null;
  }
  return firstNew;
}

/** Award founding_family when the plan says so and it is not held yet. */
export async function awardFoundingBadge(client: BadgeClient, userId: string): Promise<BadgeDef | null> {
  const [profileResult, existingResult] = await Promise.all([
    client.from("profiles").select("plan_type").eq("id", userId).single() as PromiseLike<RowResult<{ plan_type?: string | null }>>,
    client.from("user_badges").select("badge_id").eq("user_id", userId).eq("badge_id", "founding_family") as PromiseLike<RowsResult<{ badge_id: string }>>,
  ]);
  if (profileResult.data?.plan_type !== "founding_family") return null;
  if ((existingResult.data ?? []).length > 0) return null;
  await client.from("user_badges").upsert({ user_id: userId, badge_id: "founding_family" }, { onConflict: "user_id,badge_id" });
  return ACTIVITY_BADGES.find((b) => b.id === "founding_family")!;
}
