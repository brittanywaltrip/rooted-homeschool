// Pure grouping function for the Today page redesign. Takes a flat list
// of normalized items + the family's children, returns the grouped shape
// the UI renders: an Everyone bucket (whole-family or multi-kid items)
// plus per-kid sections (each with subject groups + an "Appointments &
// Activities" subsection).
//
// ─── Day-of-week conventions across source tables ──────────────────────
// (matches feedback in project_day_index_conventions.md)
//
//   activities.days[]              : Mon=0..Sun=6 (number array)
//   appointments.recurrence_rule.days[] : Sun=0..Sat=6 (matches JS getDay)
//   curriculum_goals.school_days   : ["Mon","Tue",…] string labels (Mon=0)
//
// THIS MODULE'S INTERNAL CONVENTION: Mon=0..Sun=6.
// Callers pre-normalize at the loader boundary so by the time items reach
// groupItems they all carry a `time` (HH:MM 24h) and were already filtered
// to "today". This module does NOT re-decide what counts as today; it
// only groups + sorts what was handed in. That keeps the day-of-week
// landmines off this module's surface.
//
// ─── Item shape ────────────────────────────────────────────────────────
// All three source kinds (lesson, appointment, activity) get normalized
// into the same TodayItem shape before they reach this module. The two
// fields that drive grouping are `child_ids` and `kind`. Everything else
// is passed through to the renderer.
//
//   - child_ids.length === 0 OR null  → Everyone
//   - child_ids.length > 1            → Everyone
//   - child_ids.length === 1          → that kid's section
//
// Lessons always carry a single child_id (set from the curriculum goal's
// child_id at the loader). Appointments and activities carry the array
// straight from the DB column (UUID[]).

export type TodayItemKind = 'lesson' | 'appointment' | 'activity';

export type TodayItem = {
  id: string;
  kind: TodayItemKind;
  // Single-kid for lessons, array for appts/activities. Empty/null = Everyone.
  child_ids: string[] | null;
  // HH:MM 24h. null = anytime.
  time: string | null;
  duration_minutes: number | null;
  title: string;
  // Lessons only. Free-text subject label (e.g. "Math", "Language Arts").
  subject_label: string | null;
  // Lessons only — drives ordering within a subject when time is null.
  lesson_number: number | null;
  completed: boolean;
  // The original row data — opaque to this module. The renderer uses it.
  raw: unknown;
  // Optional insertion-order timestamp for stable sort fallback.
  created_at?: string | null;
};

export type Child = {
  id: string;
  name: string;
  // DB allows null; the app's convention (see plan/page.tsx:2425) is to
  // fall back to a neutral warm gray when null. Accept null here so the
  // grouping code doesn't force callers to pre-normalize.
  color: string | null;
  sort_order?: number | null;
};

/** Default color when child.color is null. Matches the plan-page fallback. */
export const FALLBACK_CHILD_COLOR = "#7a6f65";

export type KidSection = {
  child: Child;
  // Subject label → lesson items (sorted within group).
  // Insertion order is the subject sort order (earliest time, ties alpha).
  subjects: Map<string, TodayItem[]>;
  // Single-kid appointments + activities (one of `child_ids`).
  apptsAndActivities: TodayItem[];
  // For "X of Y done" counter.
  totalCount: number;
  doneCount: number;
};

export type Grouped = {
  everyone: TodayItem[];
  kids: KidSection[];
};

function isEveryone(item: TodayItem): boolean {
  return !item.child_ids || item.child_ids.length === 0 || item.child_ids.length > 1;
}

// HH:MM string compare works lexically: "08:30" < "10:00". Null sorts last.
function compareTime(a: string | null, b: string | null): number {
  if (a === b) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return a < b ? -1 : 1;
}

// Sort lessons within a subject group: time asc, then lesson_number asc, then created_at.
function sortLessonsWithinSubject(items: TodayItem[]): TodayItem[] {
  return items.slice().sort((a, b) => {
    const t = compareTime(a.time, b.time);
    if (t !== 0) return t;
    const an = a.lesson_number ?? Number.POSITIVE_INFINITY;
    const bn = b.lesson_number ?? Number.POSITIVE_INFINITY;
    if (an !== bn) return an - bn;
    return (a.created_at ?? '').localeCompare(b.created_at ?? '');
  });
}

// Sort appointments + activities within a kid: time asc, then created_at.
function sortApptsActivities(items: TodayItem[]): TodayItem[] {
  return items.slice().sort((a, b) => {
    const t = compareTime(a.time, b.time);
    if (t !== 0) return t;
    return (a.created_at ?? '').localeCompare(b.created_at ?? '');
  });
}

// Subject section ordering: earliest lesson time in the subject ascending,
// ties broken alphabetically. A null time within a subject is treated as
// "infinity" so timed subjects float to the top.
function orderedSubjectKeys(subjects: Map<string, TodayItem[]>): string[] {
  const keys = Array.from(subjects.keys());
  return keys.sort((a, b) => {
    const itemsA = subjects.get(a)!;
    const itemsB = subjects.get(b)!;
    const minTimeA = itemsA.reduce<string | null>((acc, it) => {
      if (it.time === null) return acc;
      if (acc === null || it.time < acc) return it.time;
      return acc;
    }, null);
    const minTimeB = itemsB.reduce<string | null>((acc, it) => {
      if (it.time === null) return acc;
      if (acc === null || it.time < acc) return it.time;
      return acc;
    }, null);
    const t = compareTime(minTimeA, minTimeB);
    if (t !== 0) return t;
    return a.localeCompare(b);
  });
}

/**
 * Build the grouped Today structure.
 *
 *   - Everyone: items where isEveryone(item) — multi-kid or whole-family.
 *   - Kids: one section per child that has any solo item, in `sort_order`
 *     ascending (already the canonical app order). Within a kid, lessons
 *     are bucketed by subject_label (or "Untitled" if null) and the
 *     appts/activities go in their own bucket.
 *
 * Children with no items are skipped entirely (no empty sections).
 * Subjects with no items are skipped (the loop never inserts them).
 */
export function groupItems(items: TodayItem[], children: Child[]): Grouped {
  const everyone: TodayItem[] = [];
  // child_id → kid section accumulator
  const kidMap = new Map<string, { subjects: Map<string, TodayItem[]>; apptsAndActivities: TodayItem[]; totalCount: number; doneCount: number }>();

  function bumpCounts(childId: string, completed: boolean) {
    const acc = kidMap.get(childId);
    if (!acc) return;
    acc.totalCount += 1;
    if (completed) acc.doneCount += 1;
  }

  for (const item of items) {
    if (isEveryone(item)) {
      everyone.push(item);
      continue;
    }
    const childId = item.child_ids![0];
    if (!kidMap.has(childId)) {
      kidMap.set(childId, {
        subjects: new Map(),
        apptsAndActivities: [],
        totalCount: 0,
        doneCount: 0,
      });
    }
    const acc = kidMap.get(childId)!;
    if (item.kind === 'lesson') {
      const subjectKey = item.subject_label ?? 'Untitled';
      if (!acc.subjects.has(subjectKey)) acc.subjects.set(subjectKey, []);
      acc.subjects.get(subjectKey)!.push(item);
    } else {
      acc.apptsAndActivities.push(item);
    }
    bumpCounts(childId, item.completed);
  }

  // Sort within each bucket and emit the final ordered structure.
  const sortedEveryone = sortApptsActivities(everyone);

  const orderedChildren = children
    .slice()
    .sort((a, b) => {
      const ao = a.sort_order ?? Number.POSITIVE_INFINITY;
      const bo = b.sort_order ?? Number.POSITIVE_INFINITY;
      if (ao !== bo) return ao - bo;
      return a.name.localeCompare(b.name);
    });

  const kids: KidSection[] = [];
  for (const child of orderedChildren) {
    const acc = kidMap.get(child.id);
    if (!acc) continue;
    if (acc.totalCount === 0) continue;

    // Sort lessons inside each subject; rebuild the Map in the desired
    // subject display order.
    const orderedSubjectsMap = new Map<string, TodayItem[]>();
    const orderedKeys = orderedSubjectKeys(acc.subjects);
    for (const k of orderedKeys) {
      orderedSubjectsMap.set(k, sortLessonsWithinSubject(acc.subjects.get(k)!));
    }

    kids.push({
      child,
      subjects: orderedSubjectsMap,
      apptsAndActivities: sortApptsActivities(acc.apptsAndActivities),
      totalCount: acc.totalCount,
      doneCount: acc.doneCount,
    });
  }

  return { everyone: sortedEveryone, kids };
}

// ─── Boundary helpers (used by the loader / page.tsx, NOT by this module) ──
//
// These convert each source's day-of-week convention to Mon=0..Sun=6 so
// "is this item scheduled for today?" can be answered consistently. They
// are exported so the page-level loader can use them directly and so the
// boundary normalization is unit-tested rather than reimplemented inline.

/** JS Date.getDay() (Sun=0..Sat=6) → Mon=0..Sun=6 */
export function jsDowToMonZero(jsDow: number): number {
  return (jsDow + 6) % 7;
}

/** "Mon"/"Tue"/... → Mon=0..Sun=6. Returns -1 for unknown labels. */
export function curriculumDayLabelToMonZero(label: string): number {
  const m: Record<string, number> = { Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5, Sun: 6 };
  return m[label] ?? -1;
}

/** appointments.recurrence_rule day index (Sun=0..Sat=6) → Mon=0..Sun=6 */
export function appointmentDowToMonZero(apptDow: number): number {
  return jsDowToMonZero(apptDow);
}
