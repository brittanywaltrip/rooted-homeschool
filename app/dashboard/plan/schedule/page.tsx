"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { MoreVertical, Trash2 } from "lucide-react";
import { captureSupabaseError } from "@/lib/sentry-error";
import { supabase } from "@/lib/supabase";
import { capitalizeName } from "@/lib/utils";
import { usePartner } from "@/lib/partner-context";
import { isPhase2NoOp, computeNextLessonsForGoal, forwardScheduleStart, historyBackfillRefusal, projectHistoryBackfill, currentLessonFor, deriveHistoryFromNextLesson, nextLessonSentence, startingFreshSentence, previewLessonLine, formatWeekdayLong, formatYmdShort, type DerivedHistory, recomputeCurrentLesson, createInFlightGate, hasScheduleFieldsChanged, isPinProjectable, isStartAtLessonInRange, clampStartAtLesson, isTotalLessonsAboveProgress, pinsFromRows, planPhase2LessonInserts, type PinnedSlot, type VacationBlock as SchedVacationBlock } from "@/app/lib/scheduler";
import { recalibrateCurriculumGoal } from "@/app/lib/recalibrate";
import { lostLessonRows, countCompletedBelowStart } from "@/app/lib/lost-lesson-rows";
import { batches, LESSON_INSERT_BATCH } from "@/app/lib/batches";
import { RecalibrateForm, type CurriculumGoal as PanelGoal } from "@/app/components/PlanV2/CurriculumGroupsPanel";
import { logPlanEvent } from "@/lib/audit-log";
import PageHero from "@/app/components/PageHero";
import RootedCelebration from "@/app/components/RootedCelebration";
import { posthog } from "@/lib/posthog";
import { GARDEN_PER_YEAR, gardenLine, joinNames, possessive } from "@/app/lib/garden-config";
import { CURRICULUM_PUBLISHERS, COMMON_SUBJECTS, mergeSuggestions } from "@/app/lib/curriculum-suggestions";
import {
  readScheduleDraft,
  writeScheduleDraft,
  clearScheduleDraft,
  mergeDraftWithDbRows,
} from "@/app/lib/schedule-draft";

// ─── Constants ─────────────────────────────────────────────────────────────

// UI-facing day labels (compact). Index 0 = Mon, 6 = Sun.
const DAY_LABEL_SHORT = ["M", "T", "W", "Th", "F", "Sa", "Su"] as const;
// DB / scheduler day labels matching curriculum_goals.school_days.
const DAY_LABEL = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;

const CHILD_COLORS = [
  "#5c7f63", "#7a9e7e", "#4a7a8a",
  "#5a5c8a", "#c4956a", "#c4697a",
] as const;

const COOP_DEFAULT_EMOJI = "🏫";
const ACTIVITY_DEFAULT_EMOJI = "🎯";

const PACE_WARN_WEEKS = 40;

const DISCARD_PROMPT =
  "You have unsaved changes to your schedule. Leave without saving?";

// ─── Types ─────────────────────────────────────────────────────────────────

type RowType = "curriculum" | "coop" | "activity";
type SavedAs = "curriculum_goals" | "activities" | null;

type Row = {
  // identity
  localId: string;
  dbId: string | null;
  previouslySavedAs: SavedAs;

  // current state
  type: RowType;
  child_id: string;
  pendingDelete: boolean;

  // shared
  name: string;
  active_days: boolean[];      // length 5: [Mon..Fri]
  per_day_counts: number[];    // length 5; 1..3 cycling
  minutes_per_lesson: number | null;
  start_date: string | null;   // YYYY-MM-DD; null = active now

  // curriculum-only
  subject: string;
  total_lessons: number | null;
  start_at_lesson: number;
  // Initial pre-filled value (current_lesson + 1) when loaded from DB. Null
  // for never-saved rows. Used by the "Changing this will reset your
  // progress tracking" guard so it only prompts the first time a user
  // diverges from the live progress count.
  start_at_lesson_initial: number | null;
  // Flips true once the user has confirmed they want to override the
  // pre-fill. Prevents re-prompting on every subsequent +/- click.
  progress_confirmed: boolean;
  // Did the family TYPE this start date, or did "Where are you with this?"
  // derive it from the next-lesson number? Derived dates are recomputed as the
  // schedule changes; a typed one is theirs and is never silently re-derived
  // (the Invariant 12 spirit: what a person set, the system does not overrule).
  // Transient row state, never a column.
  start_date_is_manual: boolean;
  // The branch the family picked, once they have picked one. Null means "work
  // it out from the data", which is what a freshly loaded row wants (rule 6).
  // Without it, choosing a past date under "Starting fresh" inferred its way
  // straight back to "Already into it" and moved the family off the branch
  // they had just chosen.
  where_branch: WhereBranch | null;
  // curriculum_goals.current_lesson as loaded. Null for never-saved rows.
  // The Invariant 21 pre-flight needs to know where progress stands BEFORE
  // phase 1 writes, and start_at_lesson alone cannot say: the pre-fill seeds
  // it to max(current_lesson + 1, start_at_lesson), so a family who lowers it
  // would otherwise read as having less progress than the database holds.
  _dbCurrentLesson: number | null;

  // activity-only
  emoji: string;

  // load-time guards (round-trip safety, no data loss)
  readOnly: boolean;
  readOnlyReason: string | null;

  // Schedule-relevant DB values as loaded, so phase 2 can tell an intentional
  // re-spread of THIS goal from a sibling goal that is only along for the ride.
  // Null for never-saved rows (nothing to compare against). See
  // scheduleFieldsChangedForRow + the pin-preservation block in phase 2.
  _originalSchedule: {
    lessons_per_day: number | null;
    lessons_per_day_overrides: Record<string, number> | null;
    school_days: string[] | null;
    start_date: string | null;
    total_lessons: number | null;
  } | null;

  // legacy DB fields preserved on UPDATE so the builder doesn't clobber them
  _legacyTargetDate: string | null;
  _legacyIconEmoji: string | null;
  _legacyScheduledStartTime: string | null;
  _legacyActivityFrequency: "weekly" | "biweekly" | "monthly";
  _legacyActivityDays: number[];        // raw days array including any weekend indices
  _legacyActivityChildIds: string[];    // raw child_ids array; preserved for multi-child activities
  _legacyActivityStartTime: string | null;
};

type Child = {
  id: string;
  name: string;
  color: string | null;
  sort_order: number | null;
};

// DB row shapes (only the columns we read).
type CurriculumGoalDbRow = {
  id: string;
  child_id: string | null;
  curriculum_name: string | null;
  subject_label: string | null;
  total_lessons: number | null;
  current_lesson: number;
  lessons_per_day: number | null;
  lessons_per_day_overrides: Record<string, number> | null;
  school_days: string[] | null;
  start_date: string | null;
  start_at_lesson: number | null;
  default_minutes: number | null;
  target_date: string | null;
  icon_emoji: string | null;
  scheduled_start_time: string | null;
  archived: boolean;
  completed_at: string | null;
};

type ActivityDbRow = {
  id: string;
  name: string;
  emoji: string | null;
  frequency: "weekly" | "biweekly" | "monthly";
  days: number[];
  duration_minutes: number | null;
  scheduled_start_time: string | null;
  child_ids: string[];
  is_active: boolean;
};

// ─── Helpers ───────────────────────────────────────────────────────────────

function newLocalId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function todayDate(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function formatMonthYear(d: Date): string {
  return d.toLocaleDateString("en-US", { month: "long", year: "numeric" });
}

function isFutureDate(ymdStr: string | null, today: Date): boolean {
  if (!ymdStr) return false;
  return ymdStr > ymd(today);
}

function blankRow(child_id: string, type: RowType): Row {
  return {
    localId: newLocalId(),
    dbId: null,
    previouslySavedAs: null,
    type,
    child_id,
    pendingDelete: false,
    name: "",
    // Index 0..6 = Mon..Sun. Mon-Fri toggled on, Sat/Sun toggled off by
    // default. active_days[i] and per_day_counts[i] are independent
    // visual signals: OFF days always carry count=1 as a sensible
    // default for the next toggle-on; the count=0 state is meaningful
    // only when active_days[i] is true (a day in the schedule that
    // explicitly produces 0 lessons today). A day produces lessons iff
    // active_days[i] AND per_day_counts[i] > 0.
    active_days: [true, true, true, true, true, false, false],
    per_day_counts: [1, 1, 1, 1, 1, 1, 1],
    // Default to 30 minutes so the weekly-hours rollup renders as soon as
    // the user adds a row, and so curriculum_goals.default_minutes (NOT
    // NULL in the DB) always has a value at INSERT time.
    minutes_per_lesson: 30,
    start_date: null,
    subject: "",
    total_lessons: null,
    start_at_lesson: 1,
    start_at_lesson_initial: null,
    progress_confirmed: false,
    start_date_is_manual: false,
    where_branch: null,
    _dbCurrentLesson: null,
    emoji: type === "curriculum" ? "" : type === "coop" ? COOP_DEFAULT_EMOJI : ACTIVITY_DEFAULT_EMOJI,
    readOnly: false,
    readOnlyReason: null,
    _originalSchedule: null,
    _legacyTargetDate: null,
    _legacyIconEmoji: null,
    _legacyScheduledStartTime: null,
    _legacyActivityFrequency: "weekly",
    _legacyActivityDays: [],
    _legacyActivityChildIds: [],
    _legacyActivityStartTime: null,
  };
}

function rowFromCurriculumGoal(g: CurriculumGoalDbRow): Row {
  const schoolDays = (g.school_days ?? []) as string[];
  const overrides = g.lessons_per_day_overrides ?? null;
  const baseLpd = Math.max(1, g.lessons_per_day ?? 1);

  const active_days: boolean[] = [];
  const per_day_counts: number[] = [];
  for (let i = 0; i < 7; i++) {
    const label = DAY_LABEL[i];
    const isActive = schoolDays.includes(label);
    let count: number;
    if (isActive) {
      // Day is in the schedule. Pull from the override map if set,
      // otherwise fall back to lessons_per_day. A keyed value of 0 is
      // preserved as a meaningful "in the schedule, but 0 lessons today"
      // state; the toggle stays on.
      count = baseLpd;
      if (overrides && Object.prototype.hasOwnProperty.call(overrides, label)) {
        const v = overrides[label];
        if (typeof v === "number" && Number.isFinite(v) && v >= 0) {
          count = Math.floor(v);
        }
      }
    } else {
      // Day is not in the schedule. Counts default to 1 so toggling the
      // day on later restores a usable lesson count without an extra
      // click. The count value is invisible while the toggle is off.
      count = 1;
    }
    active_days.push(isActive);
    per_day_counts.push(count);
  }

  // Pre-fill "Already completed" (start_at_lesson - 1) with the live
  // current_lesson count rather than the wizard's original start_at_lesson
  // hint. Without this, a family that's logged 30 lessons sees the field
  // default to 0 when they reopen the builder, which looks like progress
  // loss. Falls back to the stored start_at_lesson when current_lesson is
  // unset; either way the seed is the higher of the two so we never under-
  // report progress.
  const seedFromCurrent = Math.max(1, (g.current_lesson ?? 0) + 1);
  const seedFromStartAt = Math.max(1, g.start_at_lesson ?? 1);
  const startAtLesson = Math.max(seedFromCurrent, seedFromStartAt);
  return {
    localId: newLocalId(),
    dbId: g.id,
    previouslySavedAs: "curriculum_goals",
    type: "curriculum",
    child_id: g.child_id ?? "",
    pendingDelete: false,
    name: g.curriculum_name ?? "",
    active_days,
    per_day_counts,
    minutes_per_lesson: g.default_minutes ?? null,
    start_date: g.start_date ?? null,
    subject: g.subject_label ?? "",
    total_lessons: g.total_lessons ?? null,
    start_at_lesson: startAtLesson,
    start_at_lesson_initial: startAtLesson,
    progress_confirmed: false,
    // A stored start date was chosen by someone, so the builder treats it as
    // theirs until they switch branches.
    start_date_is_manual: g.start_date != null,
    where_branch: null,
    _dbCurrentLesson: g.current_lesson ?? 0,
    emoji: "",
    readOnly: false,
    readOnlyReason: null,
    _originalSchedule: {
      lessons_per_day: g.lessons_per_day ?? null,
      lessons_per_day_overrides: g.lessons_per_day_overrides ?? null,
      school_days: g.school_days ?? null,
      start_date: g.start_date ?? null,
      total_lessons: g.total_lessons ?? null,
    },
    _legacyTargetDate: g.target_date ?? null,
    _legacyIconEmoji: g.icon_emoji ?? null,
    _legacyScheduledStartTime: g.scheduled_start_time ?? null,
    _legacyActivityFrequency: "weekly",
    _legacyActivityDays: [],
    _legacyActivityChildIds: [],
    _legacyActivityStartTime: null,
  };
}

function rowFromActivity(a: ActivityDbRow, anchorChildId: string): Row {
  // Weekend days are first-class in the builder now (Sat/Sun toggles), so
  // hasWeekend is no longer a read-only criterion. Non-weekly frequency
  // and multi-child membership remain managed-elsewhere.
  const isMultiChild = a.child_ids.length > 1;
  const isNonWeekly = a.frequency !== "weekly";
  const readOnly = isMultiChild || isNonWeekly;
  let reason: string | null = null;
  if (readOnly) {
    const reasons: string[] = [];
    if (isNonWeekly) reasons.push(a.frequency);
    if (isMultiChild) reasons.push("shared across kids");
    reason = `Managed elsewhere (${reasons.join(", ")})`;
  }

  const active_days: boolean[] = [];
  const per_day_counts: number[] = [];
  for (let i = 0; i < 7; i++) {
    active_days.push(a.days.includes(i));
    // Activities don't track per-day counts (the count badge is hidden
    // for non-curriculum rows). Default to 1 so the row has a sensible
    // count value if the user later toggles type to curriculum.
    per_day_counts.push(1);
  }

  // Default emoji by type if missing.
  const fallbackEmoji = a.emoji && a.emoji.trim().length > 0
    ? a.emoji
    : ACTIVITY_DEFAULT_EMOJI;
  // Heuristic: name contains "co-op" / "coop" → coop type, else activity. The
  // builder's only outward-facing distinction between coop and activity is the
  // emoji default; anything more nuanced lives in ActivitySetupModal.
  const looksLikeCoop = /co-?op/i.test(a.name);
  const type: RowType = looksLikeCoop ? "coop" : "activity";

  return {
    localId: newLocalId(),
    dbId: a.id,
    previouslySavedAs: "activities",
    type,
    child_id: anchorChildId,
    pendingDelete: false,
    name: a.name ?? "",
    active_days,
    per_day_counts,
    minutes_per_lesson: a.duration_minutes ?? null,
    start_date: null,
    subject: "",
    total_lessons: null,
    start_at_lesson: 1,
    start_at_lesson_initial: null,
    progress_confirmed: false,
    start_date_is_manual: false,
    where_branch: null,
    _dbCurrentLesson: null,
    emoji: fallbackEmoji,
    readOnly,
    readOnlyReason: reason,
    _originalSchedule: null,
    _legacyTargetDate: null,
    _legacyIconEmoji: null,
    _legacyScheduledStartTime: null,
    _legacyActivityFrequency: a.frequency,
    _legacyActivityDays: a.days.slice(),
    _legacyActivityChildIds: a.child_ids.slice(),
    _legacyActivityStartTime: a.scheduled_start_time ?? null,
  };
}

/**
 * Compact per_day_counts + active_days into the (lessons_per_day,
 * lessons_per_day_overrides, school_days) triple we persist on
 * curriculum_goals. Matches the spec:
 *   - if every active day shares a count, lessons_per_day = that count and
 *     overrides = null.
 *   - else overrides = { Mon: c, Tue: c, ... } over active days only, and
 *     lessons_per_day = round(avg of counts) for legacy fallback callers.
 */
function compactCurriculumPerDay(row: Row): {
  lessons_per_day: number;
  lessons_per_day_overrides: Record<string, number> | null;
  school_days: string[];
} {
  // A day produces lessons iff it's BOTH toggled on and has count > 0.
  // Either signal at "off" (active_days[i]=false OR per_day_counts[i]=0)
  // excludes the day from school_days. The two are kept in sync by the
  // toggleDay / cycleCount mutators, so this AND check is mostly belt-
  // and-suspenders.
  const active: { idx: number; count: number }[] = [];
  for (let i = 0; i < 7; i++) {
    if (row.active_days[i] && row.per_day_counts[i] > 0) {
      active.push({ idx: i, count: row.per_day_counts[i] });
    }
  }
  if (active.length === 0) {
    // Defensive: validation should prevent this, but never write empty
    // school_days (Invariant 5 fallback).
    return {
      lessons_per_day: 1,
      lessons_per_day_overrides: null,
      school_days: ["Mon", "Tue", "Wed", "Thu", "Fri"],
    };
  }
  const school_days = active.map((a) => DAY_LABEL[a.idx]);
  const allSame = active.every((a) => a.count === active[0].count);
  if (allSame) {
    return { lessons_per_day: active[0].count, lessons_per_day_overrides: null, school_days };
  }
  const overrides: Record<string, number> = {};
  for (const a of active) overrides[DAY_LABEL[a.idx]] = a.count;
  const sum = active.reduce((s, a) => s + a.count, 0);
  const avg = Math.max(1, Math.round(sum / active.length));
  return { lessons_per_day: avg, lessons_per_day_overrides: overrides, school_days };
}

/**
 * Did THIS row's schedule shape actually change in this save?
 *
 * This is the one explicit exception to Invariant 12 (a manual placement is
 * never re-dated by the system). Phase 2 re-spreads every curriculum row in the
 * builder on every save, not just the one the user edited — so without this
 * distinction, saving one curriculum would wipe manual moves on all the others.
 * That is exactly what happened on the test account: an e2e spec created a new
 * goal, and sibling goal 4193f9b3's pinned lesson 30 was deleted and re-created
 * unpinned in the same save (created_at 2026-07-30 05:06:23, while the rows
 * below it dated from Jul 9).
 *
 * THE RULE:
 *   * schedule fields changed on this goal  → its pins are CLEARED. Changing
 *     school_days / per-day counts / total_lessons / start_date redefines the
 *     grid the pins were placed on. Honoring stale pins would produce a
 *     schedule matching neither the old plan nor the new settings — lessons
 *     stranded on days that are no longer school days, or past a reduced
 *     total_lessons. The user just told us to re-spread this curriculum.
 *   * schedule fields unchanged (cosmetic edit, or a sibling goal along for the
 *     ride) → its pins are RESPECTED. Nothing about the grid moved, so there is
 *     no honest reason to touch her placements.
 *
 * Reuses `hasScheduleFieldsChanged` — the same whitelist the wizard's saveEdit
 * reshuffle gate uses — so there is one definition of "the schedule changed"
 * rather than a second that can drift from it. The per-day overrides map is
 * compared here because that helper predates it.
 */
function scheduleFieldsChangedForRow(row: Row): boolean {
  const orig = row._originalSchedule;
  // Brand-new row: a fresh spread by definition, and it has no pins yet.
  if (!orig) return true;

  const { lessons_per_day, lessons_per_day_overrides, school_days } =
    compactCurriculumPerDay(row);

  const changed = hasScheduleFieldsChanged(
    {
      lessons_per_day: orig.lessons_per_day,
      school_days: orig.school_days,
      start_date: orig.start_date,
      // target_date is not editable in the builder (it round-trips via
      // _legacyTargetDate), so feed the same value both sides rather than
      // letting a null-vs-value mismatch fake a change.
      target_date: row._legacyTargetDate,
      total_lessons: orig.total_lessons,
    },
    {
      lessons_per_day,
      school_days,
      start_date: row.start_date,
      target_date: row._legacyTargetDate,
      total_lessons: row.total_lessons ?? 0,
    },
  );
  if (changed) return true;

  // Per-day overrides: {Mon: 2, Wed: 1} → a change here re-shapes the week even
  // when school_days and the flat lessons_per_day both hold still.
  const a = orig.lessons_per_day_overrides ?? null;
  const b = lessons_per_day_overrides ?? null;
  if (a === null && b === null) return false;
  if (a === null || b === null) return true;
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const k of keys) if (a[k] !== b[k]) return true;
  return false;
}

/**
 * Is this row one the family is actually asserting something about in THIS save?
 *
 * Invariant 21 judges a stated completion count. The inputs to that judgement
 * are the starting position and the shape of the school week the history is
 * laid down on: `start_at_lesson`, `school_days`, the per-day counts and
 * overrides, `total_lessons`, `start_date`. A brand-new row is always claimed.
 * An existing row is claimed only when one of those moved.
 *
 * Why it matters: phase 2 re-spreads EVERY curriculum in the builder on every
 * save, so without this a family holding one old curriculum in the refused
 * shape could not rename an activity or fix a different child's schedule. They
 * were blocked on a number they had not touched and were not being asked about.
 * About 70 curricula are in that shape.
 *
 * A rename, a subject change or a new minutes-per-lesson deliberately does NOT
 * count. None of them changes what the family is claiming they finished, so
 * none of them is a reason to re-open the question.
 */
function invariant21ClaimChanged(row: Row): boolean {
  // Covers the schedule fields AND returns true for a never-saved row.
  if (scheduleFieldsChangedForRow(row)) return true;
  // The starting position is the claim itself, and it is not a schedule field.
  return row.start_at_lesson_initial != null && row.start_at_lesson !== row.start_at_lesson_initial;
}

function activeDayIndices(row: Row): number[] {
  const out: number[] = [];
  for (let i = 0; i < 7; i++) {
    if (row.active_days[i] && row.per_day_counts[i] > 0) out.push(i);
  }
  return out;
}

function lessonsPerWeek(row: Row): number {
  let sum = 0;
  for (let i = 0; i < 7; i++) {
    if (row.active_days[i] && row.per_day_counts[i] > 0) sum += row.per_day_counts[i];
  }
  return sum;
}

type Pace = {
  lessonsPerWeek: number;
  lessonsDone: number;
  weeksRemaining: number;
  finishLabel: string;
  warning: boolean;
};

/* ─────────────────────────────────────────────────────────────────────────
 * One question: "Where are you with this?"
 *
 * `estimateLessonsDoneFromPastStart` lived here. It walked
 * `while (cursor < today)` to guess how many lessons a past start date implied,
 * excluding today, so its "about 9 lessons ago" banner was a day short of the
 * truth. It was the fourth piece of arithmetic on a card that already showed
 * the same fact three ways: a Start at field, an Already completed stepper
 * (the same number minus one, also editable) and the start date itself.
 *
 * It is deleted. The family types the NEXT lesson number and every date derives
 * from it through `deriveHistoryFromNextLesson` in scheduler.ts, which is also
 * what the save projects the backfill from. One walk, no estimate.
 * ─────────────────────────────────────────────────────────────────────── */

/**
 * Is this new row a replacement for a curriculum the child is already doing?
 *
 * A family swapping Math programmes mid-year adds the new one and leaves the
 * old one running, so the child ends up with two active Maths and Today shows
 * lessons from both. Asking once, on the row they just added, is cheaper than
 * a support email in November.
 *
 * Matched on child plus subject, trimmed and case-insensitive, because the
 * subject is the thing that collides. Two different curricula under the same
 * subject for one child is exactly the shape worth asking about.
 */
function findReplacedRow(newRow: Row, rows: readonly Row[]): Row | null {
  if (newRow.type !== "curriculum" || newRow.dbId) return null;
  const subject = newRow.subject.trim().toLowerCase();
  if (subject.length === 0) return null;
  return (
    rows.find(
      (r) =>
        r.localId !== newRow.localId &&
        r.type === "curriculum" &&
        !!r.dbId &&
        !r.pendingDelete &&
        r.child_id === newRow.child_id &&
        r.subject.trim().toLowerCase() === subject,
    ) ?? null
  );
}

/** Which branch of "Where are you with this?" a row is on. */
type WhereBranch = "fresh" | "already";

/**
 * Rule: a row is "Already into it" when it carries progress or a past start
 * date, and "Starting fresh" otherwise. Derived, never stored, so reopening
 * the builder puts a family back on the branch their data already implies.
 */
function whereBranchFor(row: Row, todayStr: string): WhereBranch {
  // An explicit choice wins. Only when the family has not made one does the
  // branch come from what the row already holds (rule 6: reopening an existing
  // curriculum lands on the branch its data implies).
  if (row.where_branch) return row.where_branch;
  if (row.start_at_lesson > 1) return "already";
  if (row.start_date && row.start_date < todayStr) return "already";
  return "fresh";
}

/**
 * Everything the row card and the Preview need to say about one curriculum,
 * computed once from the shared walk.
 *
 * `historyStart` is what gets written to `row.start_date` on the derived
 * branch, so the sentence a family reads and the dates the save writes come
 * from the same call.
 */
type RowSchedule = {
  branch: WhereBranch;
  history: DerivedHistory;
  nextLesson: number;
  nextLessonDate?: string;
  /** The derived start date, or the family's own when they typed one. */
  effectiveStartDate?: string;
  /** Non-null when a TYPED start date cannot hold the stated count. */
  overflow: string | null;
  finishLabel: string | null;
  /** What the backward walk says, regardless of any typed date. */
  derivedStart?: string;
};

function rowScheduleFor(
  row: Row,
  today: Date,
  todayStr: string,
  vacations: SchedVacationBlock[],
): RowSchedule | null {
  if (row.type !== "curriculum") return null;
  // Ask the ROW, not compactCurriculumPerDay: that helper falls back to Mon-Fri
  // when nothing is selected (Invariant 5), so checking its output could never
  // be false and a row with every day toggled off was quietly given dates on a
  // week the family had not chosen.
  if (activeDayIndices(row).length === 0) return null;
  const { lessons_per_day, lessons_per_day_overrides, school_days } =
    compactCurriculumPerDay(row);

  const branch = whereBranchFor(row, todayStr);
  const nextLesson = Math.max(1, row.start_at_lesson);

  // The history the family will actually get.
  //
  // On the derived branch that is the backward walk. When they have TYPED a
  // start date it is the forward projection from that date instead, because
  // that is what the save writes: reading the walk here said "Sep 7 through
  // today" while the save dated the same lessons from the typed Aug 1, so the
  // confirmation contradicted the thing it was confirming.
  const stated = branch === "fresh" ? 0 : nextLesson - 1;
  const typedStart = row.start_date_is_manual ? row.start_date : null;
  const history: DerivedHistory =
    typedStart && stated > 0
      ? (() => {
          const dates = projectHistoryBackfill({
            goalId: row.dbId ?? row.localId,
            schoolDays: school_days,
            lessonsPerDay: lessons_per_day,
            lessonsPerDayOverrides: lessons_per_day_overrides,
            statedCompleted: stated,
            startDate: typedStart,
            todayYmd: todayStr,
            vacations,
          })
            .map((p) => p.date)
            .filter((d) => d <= todayStr);
          return {
            dates,
            startDate: dates[0],
            endDate: dates[dates.length - 1],
            schoolDayCount: new Set(dates).size,
            lastLesson: dates.length,
            truncated: dates.length < stated,
          };
        })()
      : deriveHistoryFromNextLesson({
          nextLesson: branch === "fresh" ? 1 : nextLesson,
          schoolDays: school_days,
          lessonsPerDay: lessons_per_day,
          lessonsPerDayOverrides: lessons_per_day_overrides,
          throughYmd: todayStr,
          vacations,
        });
  // The walk's own answer, which is what "Use the date we worked out" restores
  // and what the "Started earlier than ..." link names.
  const derivedStart = deriveHistoryFromNextLesson({
    nextLesson: branch === "fresh" ? 1 : nextLesson,
    schoolDays: school_days,
    lessonsPerDay: lessons_per_day,
    lessonsPerDayOverrides: lessons_per_day_overrides,
    throughYmd: todayStr,
    vacations,
  }).startDate;

  // A typed date is the family's; a derived one follows the walk.
  const effectiveStartDate =
    row.start_date_is_manual && row.start_date
      ? row.start_date
      : branch === "already"
        ? derivedStart
        : (row.start_date ?? undefined);

  // Does a TYPED date still hold the count? Same rule as Invariant 21's
  // refusal, run inline so the family is told here rather than at save time.
  let overflow: string | null = null;
  if (branch === "already" && row.start_date_is_manual && row.start_date && nextLesson > 1) {
    const projected = projectHistoryBackfill({
      goalId: row.dbId ?? row.localId,
      schoolDays: school_days,
      lessonsPerDay: lessons_per_day,
      lessonsPerDayOverrides: lessons_per_day_overrides,
      statedCompleted: nextLesson - 1,
      startDate: row.start_date,
      todayYmd: todayStr,
      vacations,
    });
    overflow = historyBackfillRefusal({
      curriculumName: row.subject.trim() || row.name.trim() || "This curriculum",
      statedCompleted: nextLesson - 1,
      startDate: row.start_date,
      todayYmd: todayStr,
      projected,
    });
  }

  // Where the next lesson actually lands. Invariant 1 for a row being created;
  // an existing goal keeps today, matching what phase 2 will do.
  const isNew = !(row.previouslySavedAs === "curriculum_goals" && row.dbId);
  const startPick = effectiveStartDate
    ? new Date(`${effectiveStartDate}T00:00:00`)
    : today;
  const anchor = isNew ? forwardScheduleStart(startPick, today) : today;
  const projected = computeNextLessonsForGoal(
    {
      id: row.dbId ?? row.localId,
      school_days,
      lessons_per_day,
      lessons_per_day_overrides,
      current_lesson: branch === "fresh" ? 0 : nextLesson - 1,
      total_lessons: row.total_lessons ?? 0,
      start_date: effectiveStartDate,
    },
    anchor,
    3650,
    vacations,
  );

  const pace = calcPace(row, today);
  return {
    branch,
    history,
    nextLesson: branch === "fresh" ? 1 : nextLesson,
    nextLessonDate: projected[0]?.date,
    effectiveStartDate,
    overflow,
    finishLabel: pace?.finishLabel ?? null,
    derivedStart,
  };
}

function calcPace(row: Row, today: Date): Pace | null {
  if (row.type !== "curriculum") return null;
  if (!row.total_lessons || row.total_lessons <= 0) return null;
  const lpw = lessonsPerWeek(row);
  if (lpw === 0) return null;
  const lessonsDone = Math.max(0, (row.start_at_lesson ?? 1) - 1);
  const lessonsRemaining = row.total_lessons - lessonsDone;
  if (lessonsRemaining <= 0) return null;
  const weeksRemaining = Math.ceil(lessonsRemaining / lpw);
  const start = row.start_date ? new Date(row.start_date + "T12:00:00") : today;
  const finish = new Date(start);
  finish.setDate(finish.getDate() + weeksRemaining * 7);
  return {
    lessonsPerWeek: lpw,
    lessonsDone,
    weeksRemaining,
    finishLabel: formatMonthYear(finish),
    warning: weeksRemaining > PACE_WARN_WEEKS,
  };
}

// ─── Answering a tap that cannot proceed ───────────────────────────────────
//
// On a phone, a tap on a disabled button and a tap that iOS swallowed while it
// dismissed a keyboard look identical: nothing happens. PostHog dead-click
// events from one App Store reviewer's evening in this builder: "+ Add
// curriculum" three times, "Preview schedule" twice, "Next" and "Review" once
// each. They wrote that the app was "so glitchy I couldn't enjoy it".
//
// So every builder tap now moves something the family can see. Adding a row
// scrolls to it and opens the keyboard on its name; a blocked "Preview
// schedule" says why in the sticky bar and scrolls to the row that is holding
// it up.

/**
 * Bring a row card on screen, and optionally put the cursor in its name field.
 *
 * Two frames, not one: the first lets React commit a row that may not exist in
 * the DOM yet, the second lets layout settle before anything is measured.
 * `preventScroll` because the smooth scroll owns the movement, and letting
 * focus scroll as well makes the page jump.
 */
function revealRow(localId: string, options: { focus: boolean }) {
  if (typeof document === "undefined") return;
  requestAnimationFrame(() =>
    requestAnimationFrame(() => {
      const card = document.querySelector<HTMLElement>(
        `[data-local-id="${localId}"]`,
      );
      if (!card) return;
      card.scrollIntoView({ behavior: "smooth", block: "center" });
      if (!options.focus) return;
      card
        .querySelector<HTMLInputElement>("[data-row-first-input]")
        ?.focus({ preventScroll: true });
    }),
  );
}

function rowIsValid(row: Row): boolean {
  if (row.pendingDelete) return true;
  if (row.readOnly) return true;
  if (!row.child_id) return false;
  if (row.name.trim().length === 0) return false;
  // At least one day must be toggled on AND have a non-zero count.
  // Toggling a day off and cycling its count to 0 are independent
  // visual signals; either at "off" excludes the day from producing
  // lessons, so a row needs at least one day that's clean on both
  // axes.
  let anyProducingDay = false;
  for (let i = 0; i < 7; i++) {
    if (row.active_days[i] && row.per_day_counts[i] > 0) {
      anyProducingDay = true;
      break;
    }
  }
  if (!anyProducingDay) return false;
  if (row.type === "curriculum") {
    if (!row.total_lessons || row.total_lessons <= 0) return false;
    // A starting position the curriculum cannot contain generates NOTHING:
    // the builder seeds current_lesson = start_at_lesson - 1, and the
    // projector returns [] the moment that reaches total_lessons. Four
    // production goals were saved empty this way. See isStartAtLessonInRange.
    if (!isStartAtLessonInRange(row.start_at_lesson, row.total_lessons)) return false;
    // A total below the progress already logged leaves current_lesson past the
    // end: the card reads "22 of 13" and the projector emits nothing. See
    // isTotalLessonsAboveProgress. start_at_lesson_initial is current_lesson+1
    // as loaded from the DB, and is null for a row that has never been saved.
    if (!isTotalLessonsAboveProgress(row.total_lessons, completedThrough(row))) return false;
  }
  return true;
}

/**
 * How far this goal has actually been completed, as the builder knows it.
 * `start_at_lesson_initial` is the DB's `current_lesson + 1` at load time; a
 * never-saved row has no progress to protect.
 */
function completedThrough(row: Row): number {
  return row.start_at_lesson_initial != null ? row.start_at_lesson_initial - 1 : 0;
}

/**
 * Why can't this row be saved yet? Returns one short sentence naming the
 * missing piece, or null when the row is fine.
 *
 * `rowIsValid` stays the single authority on whether a row passes: this
 * short-circuits on it and then only decides WHICH message to show for a row it
 * has already rejected. That is what stops the footer explaining a problem the
 * Preview button doesn't actually have, or going quiet on one it does.
 */
function rowMissingLabel(row: Row): string | null {
  if (rowIsValid(row)) return null;
  const name = row.name.trim();
  const label = name.length > 0 ? name : "this row";
  if (!row.child_id) return `Pick a child for ${label}.`;
  if (name.length === 0) return "Give every curriculum and activity a name.";
  let anyProducingDay = false;
  for (let i = 0; i < 7; i++) {
    if (row.active_days[i] && row.per_day_counts[i] > 0) {
      anyProducingDay = true;
      break;
    }
  }
  if (!anyProducingDay) return `Pick at least one day with lessons for ${label}.`;
  if (row.type === "curriculum") {
    if (!row.total_lessons || row.total_lessons <= 0) {
      return `Add a total lesson count for ${label}.`;
    }
    if (row.start_at_lesson < 1) return `Set a starting lesson for ${label}.`;
    if (!isStartAtLessonInRange(row.start_at_lesson, row.total_lessons)) {
      return (
        `${label} starts at lesson ${row.start_at_lesson} but only has ` +
        `${row.total_lessons}. Use ${row.total_lessons + 1} if it is finished.`
      );
    }
    const done = completedThrough(row);
    if (!isTotalLessonsAboveProgress(row.total_lessons, done)) {
      return (
        `${label} already has ${done} lesson${done === 1 ? "" : "s"} marked done, ` +
        `so the total can't be less than ${done}.`
      );
    }
  }
  return `Finish setting up ${label}.`;
}

// Fields on a restored draft row that must be taken from the database
// rather than from the draft snapshot. Everything else is the user's
// in-progress edit and is kept.
//
// The draft can be days old, and these are the fields the save flow reads
// to decide what changed: _originalSchedule drives the pin-preservation
// check in phase 2, start_at_lesson_initial drives the "this will reset
// your progress tracking" prompt, and the _legacy* fields exist purely so
// an UPDATE doesn't clobber columns the builder doesn't render. Restoring
// a stale copy of any of them would make the save compare against a
// database state that no longer exists.
//
// A row that has since become read-only is returned whole: the draft's
// edits to it can no longer be saved, so the live row is the honest one.
function carryDbFieldsOntoDraftRow(draftRow: Row, freshRow: Row): Row {
  if (freshRow.readOnly) return freshRow;
  return {
    ...draftRow,
    previouslySavedAs: freshRow.previouslySavedAs,
    readOnly: freshRow.readOnly,
    readOnlyReason: freshRow.readOnlyReason,
    start_at_lesson_initial: freshRow.start_at_lesson_initial,
    _dbCurrentLesson: freshRow._dbCurrentLesson,
    _originalSchedule: freshRow._originalSchedule,
    _legacyTargetDate: freshRow._legacyTargetDate,
    _legacyIconEmoji: freshRow._legacyIconEmoji,
    _legacyScheduledStartTime: freshRow._legacyScheduledStartTime,
    _legacyActivityFrequency: freshRow._legacyActivityFrequency,
    _legacyActivityDays: freshRow._legacyActivityDays,
    _legacyActivityChildIds: freshRow._legacyActivityChildIds,
    _legacyActivityStartTime: freshRow._legacyActivityStartTime,
  };
}

/**
 * A phase 2 assertion refused the batch: the projector emitted an overcapacity
 * date, or it tried to schedule a lesson at or below the starting position.
 * Carries the same user-facing message the plain Error used to; the distinct
 * type is what lets the retry wrapper tell "this will fail identically" from
 * "the network hiccuped".
 */
class ScheduleAssertionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ScheduleAssertionError";
  }
}

/**
 * A phase 2 refusal the FAMILY can act on, carrying the words they should see.
 *
 * A ScheduleAssertionError says the projector built something the assertions
 * reject: nothing the family typed explains it, so the notice sends them to
 * support. A refusal is the opposite. The numbers they entered do not
 * reconcile with the calendar, both numbers are theirs to change, and the
 * message already names them. It extends ScheduleAssertionError so it is
 * deterministic by construction (a retry rebuilds the identical batch); the
 * catch in handleSave shows `message` verbatim instead of the support copy.
 */
class ScheduleRefusedError extends ScheduleAssertionError {
  constructor(message: string) {
    super(message);
    this.name = "ScheduleRefusedError";
  }
}

/**
 * Invariant 21 fired in phase 2, which should now be impossible.
 *
 * The refusal is decided in the pre-flight before phase 1 writes anything, off
 * the same formula and the same projection. If this type is ever constructed,
 * the two disagreed: the pre-flight let a row through that the backfill then
 * could not record. It keeps the family-facing message (it extends
 * ScheduleRefusedError, so the notice still says what to change) and carries
 * its own Sentry tag so a late firing is never filed as an ordinary refusal.
 */
class LateInvariant21Error extends ScheduleRefusedError {
  constructor(message: string) {
    super(message);
    this.name = "LateInvariant21Error";
  }
}

/**
 * Is this phase 2 failure one a second attempt cannot fix?
 *
 * Two shapes qualify. A Postgres 23505 means the row we are about to insert
 * already exists, which is just as true 500ms later. A refused batch means the
 * projector built something the assertions reject, and it rebuilds the same
 * batch from the same inputs every time. Retrying either one only doubles the
 * wait before the user reaches the notice, and it doubles the Sentry noise.
 */
function isDeterministicPhase2Failure(err: unknown): boolean {
  if (err instanceof ScheduleAssertionError) return true;
  return (err as { code?: string } | null)?.code === "23505";
}

function formatDraftSavedAt(savedAt: number): string {
  const d = new Date(savedAt);
  if (Number.isNaN(d.getTime())) return "";
  const sameDay = new Date().toDateString() === d.toDateString();
  const time = d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  if (sameDay) return `today at ${time}`;
  return `${d.toLocaleDateString(undefined, { month: "long", day: "numeric" })} at ${time}`;
}

// ─── Component ─────────────────────────────────────────────────────────────

export default function ScheduleBuilderPage() {
  const router = useRouter();
  const { effectiveUserId } = usePartner();
  const today = useMemo(() => todayDate(), []);
  const todayStr = useMemo(() => ymd(today), [today]);

  const [view, setView] = useState<"builder" | "preview" | "saved">("builder");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  // The save gate stays shut for 1.5s AFTER setSaving(false) (see the
  // `finally` in handleSave). Without mirroring that window in the UI the
  // button re-labelled itself "Save & build schedule" and re-enabled while
  // handleSave was still returning early at the gate, so a second press did
  // nothing at all and gave no sign why. Keep it visibly busy for the whole
  // window instead of silently swallowing the press.
  const [settling, setSettling] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  // The save-error banner sits in normal page flow at the bottom of the
  // Preview, BELOW the sticky footer that holds Save & build schedule.
  // On phones (and on any scrolled desktop) the banner renders off-screen
  // and the user sees the button drop from "Saving..." back to normal
  // with no other feedback. The ref + effect below scrolls the banner
  // into the centre of the viewport whenever saveError flips truthy so
  // the failure is always visible without restructuring the layout.
  const saveErrorRef = useRef<HTMLDivElement | null>(null);
  // Distinct from saveError: post-save phase (lesson regen / recompute /
  // overcapacity assertion) runs AFTER the curriculum_goals + activities
  // writes have already committed. A failure here doesn't roll back the
  // schema writes, so showing "Save failed:" would lie. This carries the
  // softer "settings saved, lessons did not generate" notice instead.
  const [postSaveNotice, setPostSaveNotice] = useState<string | null>(null);
  // postSaveNotice used to render as a plain div at the bottom of the page,
  // under the fixed bottom bar, with no role and no scroll. It is the ONLY
  // signal a family gets that their goal has zero lessons, and 26 goals across
  // 22 accounts reached that state without anyone noticing. It gets exactly
  // what saveError gets: alert semantics, and scrolled into view on arrival.
  const postSaveNoticeRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    // saveError wins when both are somehow set; they are mutually exclusive in
    // practice (the catch sets one or the other).
    const target = saveError
      ? saveErrorRef.current
      : postSaveNotice
        ? postSaveNoticeRef.current
        : null;
    if (!target) return;
    target.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [saveError, postSaveNotice]);

  const [children, setChildren] = useState<Child[]>([]);
  const [rows, setRows] = useState<Row[]>([]);
  const [originalCurriculumIds, setOriginalCurriculumIds] = useState<Set<string>>(new Set());
  const [originalActivityIds, setOriginalActivityIds] = useState<Set<string>>(new Set());

  const [dirty, setDirty] = useState(false);

  // ── Draft persistence ────────────────────────────────────────────────────
  // Everything in this builder is local state until "Save & build schedule",
  // so an unmount used to mean the work was gone. The draft is written to
  // localStorage on every change and restored on mount. See
  // app/lib/schedule-draft.ts for why localStorage and not sessionStorage.
  const [draftNotice, setDraftNotice] = useState<
    { savedAt: number; dropped: number } | null
  >(null);
  // Database rows exactly as loaded, so a family who doesn't want the
  // restored draft can drop back to their saved schedule without a reload.
  const dbRowsRef = useRef<Row[]>([]);
  // Mirrors `rows` for the flush-on-hide listeners, which are registered
  // once per dirty transition and would otherwise close over a stale array.
  const rowsRef = useRef<Row[]>([]);

  // Per-row UI state for the curriculum kebab menu and the inline
  // RecalibrateForm. menuOpenLocalId tracks which kebab is currently
  // expanded; recalibratingLocalId tracks which row's "I'm actually on..."
  // form is mounted. Both clear on outside-click / form close.
  const [menuOpenLocalId, setMenuOpenLocalId] = useState<string | null>(null);
  const [recalibratingLocalId, setRecalibratingLocalId] = useState<string | null>(null);
  // Recalibration / mark-finished errors surface in a small banner above
  // the row — kept separate from saveError so the user can still drive
  // the rest of the Save flow if a per-row immediate action fails.
  const [rowActionError, setRowActionError] = useState<string | null>(null);

  // `?goal=<id>` deep-link from the curriculum panel's "Edit goal" action.
  // Read once on mount via window.location to avoid the Suspense boundary
  // that useSearchParams requires for SSG. After rows load, the matching
  // row card is scrolled into view and highlighted briefly so the user
  // lands on the curriculum they clicked from instead of the first child.
  const [targetGoalId, setTargetGoalId] = useState<string | null>(null);
  const [highlightedGoalId, setHighlightedGoalId] = useState<string | null>(null);
  // A tap on "Preview schedule" while it cannot proceed. `previewNudge` turns
  // the standing grey hint in the sticky bar into a message that announces
  // itself; `nudgedLocalId` rings the row the family has to go fix.
  const [previewNudge, setPreviewNudge] = useState(false);
  const [nudgedLocalId, setNudgedLocalId] = useState<string | null>(null);
  // Rows the Invariant 21 pre-flight refused. Plural, because one save can
  // carry several curricula and the family needs to see every one that has to
  // change, not just the first. Rings the same rows `nudgedLocalId` does.
  const [refusedLocalIds, setRefusedLocalIds] = useState<Set<string>>(new Set());
  // Breaks the family has already entered. "Where are you with this?" derives
  // dates by walking their real school days, so a week off has to move the
  // derived start date the same way it moves the saved schedule. Loaded with
  // the rest of the builder; the save reads its own copy at save time.
  const [vacations, setVacations] = useState<SchedVacationBlock[]>([]);
  // What this family has typed before, newest first, for the two suggestion
  // lists. Read once with the rest of the builder; no new table.
  const [ownCurriculumNames, setOwnCurriculumNames] = useState<string[]>([]);
  const [ownSubjects, setOwnSubjects] = useState<string[]>([]);
  // Set only when a save CREATED curricula. An edit keeps the old
  // `?saved=1` landing: this screen is the moment a family finishes setting
  // up, not every tweak, and celebrating a tweak cheapens it.
  // Rows where the family has answered "Keep both" to the replace prompt.
  // Local and transient: the question is about this editing session.
  const [keepBothLocalIds, setKeepBothLocalIds] = useState<Set<string>>(new Set());
  const [celebration, setCelebration] = useState<{
    childNames: string[];
    subjects: string[];
    firstLessonDate: string | null;
    curriculaCount: number;
  } | null>(null);
  const curriculumSuggestions = useMemo(
    () => mergeSuggestions(ownCurriculumNames, CURRICULUM_PUBLISHERS),
    [ownCurriculumNames],
  );
  const subjectSuggestions = useMemo(
    () => mergeSuggestions(ownSubjects, COMMON_SUBJECTS),
    [ownSubjects],
  );
  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const id = params.get("goal");
    if (id) setTargetGoalId(id);
  }, []);

  const [newChildName, setNewChildName] = useState("");
  const [newChildColor, setNewChildColor] = useState<string>(CHILD_COLORS[0]);
  const [addingChild, setAddingChild] = useState(false);

  // In-flight gate for handleSave. createInFlightGate gives a stricter
  // contract than a bare ref: it adds a post-action settle window so a
  // double-tap during the brief moment between setSaving(false) and the
  // next render can't slip a second handleSave through. tryEnter()/exit()
  // are pure, so the gate survives strict-mode double mounts and React 18
  // concurrent-feature double invocations.
  const saveGate = useMemo(() => createInFlightGate(), []);

  // ── Load ─────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!effectiveUserId) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      setLoadError(null);
      try {
        const [kidsResp, goalsResp, activitiesResp, vacationsResp, pastNamesResp] = await Promise.all([
          supabase
            .from("children")
            .select("id, name, color, sort_order")
            .eq("user_id", effectiveUserId)
            .eq("archived", false)
            .order("sort_order"),
          supabase
            .from("curriculum_goals")
            .select(
              "id, child_id, curriculum_name, subject_label, total_lessons, current_lesson, lessons_per_day, lessons_per_day_overrides, school_days, start_date, start_at_lesson, default_minutes, target_date, icon_emoji, scheduled_start_time, archived, completed_at",
            )
            .eq("user_id", effectiveUserId)
            .eq("archived", false)
            .is("completed_at", null),
          supabase
            .from("activities")
            .select(
              "id, name, emoji, frequency, days, duration_minutes, scheduled_start_time, child_ids, is_active",
            )
            .eq("user_id", effectiveUserId)
            .eq("is_active", true),
          supabase
            .from("vacation_blocks")
            .select("start_date, end_date")
            .eq("user_id", effectiveUserId),
          // Every name this family has used, archived years included, newest
          // first. Their own words beat any list we could ship.
          supabase
            .from("curriculum_goals")
            .select("curriculum_name, subject_label, created_at")
            .eq("user_id", effectiveUserId)
            .order("created_at", { ascending: false })
            .limit(500),
        ]);
        if (cancelled) return;

        if (kidsResp.error) throw kidsResp.error;
        if (goalsResp.error) throw goalsResp.error;
        if (activitiesResp.error) throw activitiesResp.error;

        const kidRows = (kidsResp.data ?? []) as Child[];
        const goalRows = (goalsResp.data ?? []) as CurriculumGoalDbRow[];
        const actRows = (activitiesResp.data ?? []) as ActivityDbRow[];
        // Non-fatal: a failed read means the derived dates ignore breaks, which
        // is the behaviour the builder had before it derived anything at all.
        // Not worth refusing to open the page over.
        if (!vacationsResp.error) {
          setVacations((vacationsResp.data ?? []) as SchedVacationBlock[]);
        }
        // Non-fatal for the same reason: without it the shared list still
        // suggests, it just does not know this family yet.
        if (!pastNamesResp.error) {
          const past = (pastNamesResp.data ?? []) as {
            curriculum_name: string | null;
            subject_label: string | null;
          }[];
          setOwnCurriculumNames(
            past.map((g) => g.curriculum_name ?? "").filter((v) => v.trim().length > 0),
          );
          setOwnSubjects(
            past.map((g) => g.subject_label ?? "").filter((v) => v.trim().length > 0),
          );
        }

        const builtRows: Row[] = [];
        for (const g of goalRows) {
          if (!g.child_id) continue; // orphan goals stay archived in DB but don't render
          builtRows.push(rowFromCurriculumGoal(g));
        }
        for (const a of actRows) {
          // Anchor multi-child activities to the first child_id in the array
          // so the dbId only enters the local set once. The save sweep keys on
          // dbId membership; readOnly rows don't write either way.
          const anchor = a.child_ids[0];
          if (!anchor) continue;
          builtRows.push(rowFromActivity(a, anchor));
        }

        setChildren(kidRows);
        setOriginalCurriculumIds(new Set(goalRows.map((g) => g.id)));
        setOriginalActivityIds(new Set(actRows.map((a) => a.id)));

        // Default the new-child swatch to the first unused color
        const used = new Set(kidRows.map((k) => k.color).filter(Boolean) as string[]);
        const firstFree = CHILD_COLORS.find((c) => !used.has(c));
        if (firstFree) setNewChildColor(firstFree);

        // ── Draft restore ────────────────────────────────────────────
        // Keep the untouched database rows so "start from my saved
        // schedule" can throw the draft away without a reload.
        dbRowsRef.current = builtRows;
        const draft = readScheduleDraft<Row>(effectiveUserId);
        if (draft) {
          const validChildIds = new Set(kidRows.map((k) => k.id));
          const { rows: restored, droppedCount } = mergeDraftWithDbRows<Row>(
            draft.rows,
            builtRows,
            validChildIds,
            carryDbFieldsOntoDraftRow,
          );
          setRows(restored);
          // A restored draft is by definition unsaved work, so the page
          // comes up dirty: the exit guards and the unsaved indicator have
          // to be live from the first render, not from the next keystroke.
          setDirty(true);
          setDraftNotice({ savedAt: draft.savedAt, dropped: droppedCount });
        } else {
          setRows(builtRows);
          setDirty(false);
        }
      } catch (err) {
        const msg = (err as { message?: string })?.message ?? String(err);
        setLoadError(msg);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [effectiveUserId]);

  // ── Unsaved changes guard ────────────────────────────────────────────────
  // Kept for desktop browsers. It does NOT fire on iOS Safari, which is why
  // the draft autosave below exists rather than this being the only net.
  useEffect(() => {
    if (!dirty) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [dirty]);

  // ── Draft autosave ───────────────────────────────────────────────────────
  useEffect(() => {
    rowsRef.current = rows;
  }, [rows]);

  // Debounced so a burst of keystrokes in a name field is one write, not
  // one per character. 400ms is short enough that the pagehide flush below
  // is a backstop rather than the primary path.
  useEffect(() => {
    if (!effectiveUserId || loading || !dirty) return;
    const t = setTimeout(() => {
      writeScheduleDraft<Row>(effectiveUserId, rows);
    }, 400);
    return () => clearTimeout(t);
  }, [rows, dirty, loading, effectiveUserId]);

  // Flush immediately when the page is being backgrounded or torn down.
  // pagehide + visibilitychange are the two events iOS Safari actually
  // delivers when a tab is evicted, the app is swiped away, or the phone
  // locks; unload and beforeunload are not reliable there.
  useEffect(() => {
    if (!effectiveUserId || !dirty) return;
    const flush = () => writeScheduleDraft<Row>(effectiveUserId, rowsRef.current);
    const onVisibility = () => {
      if (document.visibilityState === "hidden") flush();
    };
    window.addEventListener("pagehide", flush);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("pagehide", flush);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [dirty, effectiveUserId]);

  // ── Exit guards ──────────────────────────────────────────────────────────
  // The Cancel button routes through confirmDiscardAndNavigate, but it is
  // one exit out of many: the sidebar, the mobile bottom nav, the logo, and
  // the Settings link are all plain <Link>s rendered by the dashboard
  // layout, and a soft navigation through any of them unmounts this page
  // without a word. Rather than reach into the shared layout (an auth
  // manifest file), catch the click here in the capture phase while this
  // page is mounted and dirty. The listener is registered only while dirty,
  // so it is inert for everyone else.
  useEffect(() => {
    if (!dirty) return;
    const onClickCapture = (e: MouseEvent) => {
      if (e.defaultPrevented) return;
      // Let modified clicks (new tab / new window) and non-primary buttons
      // through untouched; they don't unmount this page.
      if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const anchor = (e.target as HTMLElement | null)?.closest?.("a[href]") as
        | HTMLAnchorElement
        | null;
      if (!anchor) return;
      if (anchor.target && anchor.target !== "_self") return;
      if (anchor.hasAttribute("download")) return;

      let url: URL;
      try {
        url = new URL(anchor.href, window.location.href);
      } catch {
        return;
      }
      // Off-site links and in-page anchors aren't a soft navigation away
      // from the builder. beforeunload still covers the off-site case on
      // desktop, and the draft covers it everywhere.
      if (url.origin !== window.location.origin) return;
      if (url.pathname === window.location.pathname) return;

      if (!window.confirm(DISCARD_PROMPT)) {
        e.preventDefault();
        e.stopPropagation();
        return;
      }
      // They chose to discard, so the draft goes with the changes.
      if (effectiveUserId) clearScheduleDraft(effectiveUserId);
    };
    document.addEventListener("click", onClickCapture, true);
    return () => document.removeEventListener("click", onClickCapture, true);
  }, [dirty, effectiveUserId]);

  // ── Deep-link scroll/highlight ───────────────────────────────────────────
  // After rows finish loading, find the row card matching the ?goal=<id>
  // search param, scroll it into view, and apply a brief ring highlight so
  // the user lands on the curriculum they clicked "Edit" from. The
  // highlight self-clears after 2.5s.
  //
  // `rows` is in the dep array because we need to wait for it to populate
  // before the data-goal-id node exists in the DOM. Without a guard, every
  // subsequent rows mutation (every keystroke in a row input) re-fires the
  // scrollIntoView and yanks the user away from the field they're typing
  // in. consumedTargetGoalRef remembers which targetGoalId we already
  // scrolled to so the effect short-circuits on later rows changes.
  const consumedTargetGoalRef = useRef<string | null>(null);
  useEffect(() => {
    if (loading || !targetGoalId) return;
    if (consumedTargetGoalRef.current === targetGoalId) return;
    if (!rows.some((r) => r.dbId === targetGoalId)) return;
    consumedTargetGoalRef.current = targetGoalId;
    const id = targetGoalId;
    const t = setTimeout(() => {
      const el = document.querySelector(`[data-goal-id="${id}"]`);
      if (el && typeof (el as HTMLElement).scrollIntoView === "function") {
        (el as HTMLElement).scrollIntoView({ behavior: "smooth", block: "center" });
      }
      setHighlightedGoalId(id);
    }, 50);
    const clearTimer = setTimeout(() => setHighlightedGoalId(null), 2500);
    return () => {
      clearTimeout(t);
      clearTimeout(clearTimer);
    };
  }, [loading, rows, targetGoalId]);

  // ── Mutators ─────────────────────────────────────────────────────────────
  const markDirty = () => {
    if (!dirty) setDirty(true);
  };

  function patchRow(localId: string, patch: Partial<Row>) {
    setRows((prev) =>
      prev.map((r) => (r.localId === localId ? { ...r, ...patch } : r)),
    );
    markDirty();
  }

  function addRow(child_id: string, type: RowType) {
    // The row is built here rather than inside the updater so its localId is
    // available to scroll to. The updater must stay pure: see
    // app/components/updaterPurity.test.ts.
    const row = blankRow(child_id, type);
    setRows((prev) => [...prev, row]);
    markDirty();
    // A new row lands at the bottom of that child's list, which on a phone is
    // usually below the fold. Without this the tap produces nothing the family
    // can see and they tap again, which is what the dead-click events show.
    revealRow(row.localId, { focus: true });
  }

  function deleteRow(localId: string) {
    setRows((prev) =>
      prev
        .map((r) =>
          r.localId === localId
            ? r.previouslySavedAs
              ? { ...r, pendingDelete: true }
              : r // never-saved → marker; we filter below
            : r,
        )
        .filter((r) => !(r.previouslySavedAs === null && r.localId === localId)),
    );
    markDirty();
  }

  function cycleType(localId: string) {
    setRows((prev) =>
      prev.map((r) => {
        if (r.localId !== localId) return r;
        if (r.readOnly) return r;
        const next: RowType =
          r.type === "curriculum" ? "coop" : r.type === "coop" ? "activity" : "curriculum";
        // Set a default emoji when entering a non-curriculum type, blank it
        // when going back to curriculum (curriculum rows don't have emoji).
        const emoji =
          next === "curriculum" ? "" : next === "coop" ? COOP_DEFAULT_EMOJI : ACTIVITY_DEFAULT_EMOJI;
        return { ...r, type: next, emoji };
      }),
    );
    markDirty();
  }

  function toggleDay(localId: string, dayIdx: number) {
    setRows((prev) =>
      prev.map((r) => {
        if (r.localId !== localId) return r;
        if (r.readOnly) return r;
        const nextActive = r.active_days.slice();
        const nextCounts = r.per_day_counts.slice();
        nextActive[dayIdx] = !nextActive[dayIdx];
        // Toggle is a separate visual affordance from cycling the count
        // to 0. Toggling off always resets the count to 1 so the next
        // toggle-on resumes from a clean default — the count=0 state is
        // only meaningful while the day is toggled on. Toggling on
        // leaves the count where it was; if the user previously cycled
        // it to 0, the badge will read "0" until they cycle it again.
        if (!nextActive[dayIdx]) {
          nextCounts[dayIdx] = 1;
        }
        return { ...r, active_days: nextActive, per_day_counts: nextCounts };
      }),
    );
    markDirty();
  }

  function cycleCount(localId: string, dayIdx: number) {
    setRows((prev) =>
      prev.map((r) => {
        if (r.localId !== localId) return r;
        if (r.readOnly || r.type !== "curriculum") return r;
        // Cycle 0 → 1 → 2 → 3 → 0. The badge stays visible while the
        // toggle is on, so the user sees "0" as a distinct state. The
        // toggle is left untouched; cycling does not turn the day off.
        const nextCounts = r.per_day_counts.slice();
        const cur = nextCounts[dayIdx] ?? 0;
        nextCounts[dayIdx] = cur >= 3 ? 0 : cur + 1;
        return { ...r, per_day_counts: nextCounts };
      }),
    );
    markDirty();
  }

  // ── Inline child add ─────────────────────────────────────────────────────
  async function handleAddChild() {
    const trimmed = newChildName.trim();
    if (!trimmed || addingChild || !effectiveUserId) return;
    setAddingChild(true);
    try {
      const { data: activeRows } = await supabase
        .from("children")
        .select("color, sort_order")
        .eq("user_id", effectiveUserId)
        .eq("archived", false);
      const rowsRaw = (activeRows ?? []) as { color: string | null; sort_order: number | null }[];
      const maxSort = rowsRaw.reduce((m, r) => Math.max(m, r.sort_order ?? 0), 0);
      const { data: inserted, error } = await supabase
        .from("children")
        .insert({
          user_id: effectiveUserId,
          name: capitalizeName(trimmed),
          color: newChildColor,
          sort_order: maxSort + 1,
          archived: false,
          name_key: trimmed.toLowerCase().replace(/\s+/g, "_"),
        })
        .select("id, name, color, sort_order")
        .single();
      if (error || !inserted) {
        setLoadError("Couldn't add child. Please try again.");
        return;
      }
      setChildren((prev) => [...prev, inserted as Child]);
      setNewChildName("");
      // Advance the swatch picker to the next unused color
      const used = new Set([
        ...children.map((c) => c.color).filter(Boolean) as string[],
        (inserted as Child).color ?? "",
      ]);
      const firstFree = CHILD_COLORS.find((c) => !used.has(c));
      if (firstFree) setNewChildColor(firstFree);
    } finally {
      setAddingChild(false);
    }
  }

  // One schedule computation per curriculum row per change, shared by the
  // derived-date sync, the preview-blocked check and every row card.
  //
  // rowScheduleFor runs computeNextLessonsForGoal over the whole remaining
  // curriculum and only `projected[0]` is ever used, so doing it three times
  // over on every keystroke in a name field is exactly the shape the
  // "Schedule Builder speed for big families" work went after.
  const schedByLocalId = useMemo(() => {
    const out = new Map<string, RowSchedule>();
    for (const r of rows) {
      if (r.type !== "curriculum" || r.pendingDelete) continue;
      const sched = rowScheduleFor(r, today, todayStr, vacations);
      if (sched) out.set(r.localId, sched);
    }
    return out;
  }, [rows, today, todayStr, vacations]);

  // ── The derived start date is written back onto the row ──────────────────
  //
  // "Where are you with this?" shows a date the family never typed, and the
  // save path has to see it as an ordinary `start_date`: the Invariant 21
  // pre-flight, `planHistoricalBackfill` and the projector all read that field
  // and none of them knows this screen exists. Syncing it here rather than
  // threading a second notion of "start" through the save is what keeps the
  // date the family read and the date the save writes the same one.
  //
  // Converges because it only writes when the value actually differs, and a
  // manual date is never touched.
  useEffect(() => {
    const patches = new Map<string, string | null>();
    for (const r of rows) {
      if (r.type !== "curriculum" || r.pendingDelete || r.readOnly) continue;
      if (r.start_date_is_manual) continue;
      // ONLY rows this save is claiming something about. Stamping a derived
      // date on an untouched existing goal would be a change the family never
      // asked for, and a loud one: a goal loaded with current_lesson 30 and no
      // start date would gain one, which reads as a schedule-field change, so
      // scheduleFieldsChangedForRow RELEASES ITS PINS (the exact regression
      // Invariant 12's phase-2 exception exists to stop) and
      // invariant21ClaimChanged pulls it back into the pre-flight that CC #1c
      // deliberately scoped it out of. Same predicate, so the three cannot
      // disagree about what "touched" means.
      if (!invariant21ClaimChanged(r)) continue;
      const sched = schedByLocalId.get(r.localId);
      if (!sched) continue;
      const derived = sched.branch === "already" ? (sched.history.startDate ?? null) : r.start_date;
      if (derived !== r.start_date) patches.set(r.localId, derived);
    }
    if (patches.size === 0) return;
    setRows((prev) =>
      prev.map((r) => (patches.has(r.localId) ? { ...r, start_date: patches.get(r.localId)! } : r)),
    );
  }, [rows, schedByLocalId]);

  // ── Validation ───────────────────────────────────────────────────────────
  const allValid = useMemo(() => rows.every(rowIsValid), [rows]);
  const anyEditableRow = useMemo(
    () => rows.some((r) => !r.pendingDelete && !r.readOnly),
    [rows],
  );

  // Why "Preview schedule" is disabled, in words. The button carried no
  // explanation at all, just 40% opacity, and "Save & build schedule" only
  // exists inside the preview: a family who can't get past this button can
  // never save anything. One reported it as "there is no way to save it" with
  // three children on the account and zero curriculum goals, which is exactly
  // the !anyEditableRow case. Null when the button is enabled.
  const previewBlockedReason = useMemo<string | null>(() => {
    if (!anyEditableRow) return "Add a curriculum above to continue.";
    // A start date the family typed that cannot hold the count they stated is
    // the CC #1 overflow, caught here so they are told on the row rather than
    // at save time. Never trimmed silently.
    for (const r of rows) {
      if (r.type !== "curriculum" || r.pendingDelete || r.readOnly) continue;
      const sched = schedByLocalId.get(r.localId);
      if (sched?.overflow) return sched.overflow;
    }
    if (allValid) return null;
    const issues: string[] = [];
    for (const r of rows) {
      const issue = rowMissingLabel(r);
      if (issue && !issues.includes(issue)) issues.push(issue);
    }
    if (issues.length === 0) return null;
    // Three is enough to act on. More than that and the bar would cover the
    // rows she needs to go fix.
    if (issues.length <= 3) return issues.join(" ");
    return `${issues.slice(0, 3).join(" ")} And ${issues.length - 3} more to finish.`;
  }, [rows, allValid, anyEditableRow, schedByLocalId]);

  // ── A tap on "Preview schedule" that cannot proceed ──────────────────────
  //
  // The reason has been sitting in the sticky bar all along, as 12px grey text
  // that nobody reads. It is the tap that has to answer, so the tap is what
  // promotes it: the hint becomes a dark message that screen readers announce,
  // and the first row standing in the way is scrolled to and ringed.
  //
  // The disabled button cannot report its own clicks. Browsers do not dispatch
  // pointer events to a disabled control, and the event does not reach an
  // ancestor either, so the button carries `disabled:pointer-events-none` and
  // the wrapper below it hears the tap instead.
  const nudgeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (nudgeTimer.current) clearTimeout(nudgeTimer.current); }, []);

  function handleBlockedPreviewTap() {
    if (!previewBlockedReason) return;
    setPreviewNudge(true);
    const firstIncomplete = rows.find(
      (r) => !r.pendingDelete && !r.readOnly && !rowIsValid(r),
    );
    // "Add a curriculum above to continue." has no row to point at; the
    // message is the whole answer in that case.
    setNudgedLocalId(firstIncomplete?.localId ?? null);
    if (firstIncomplete) revealRow(firstIncomplete.localId, { focus: false });
    if (nudgeTimer.current) clearTimeout(nudgeTimer.current);
    nudgeTimer.current = setTimeout(() => {
      setPreviewNudge(false);
      setNudgedLocalId(null);
    }, 6000);
  }

  // A refusal names numbers on specific rows. The moment the family changes
  // anything, the rings are stale, so they come off with the next edit rather
  // than sitting on rows that may already be fixed.
  // `rows` is the only trigger on purpose. Listing refusedLocalIds as well
  // would re-run the effect on its own clear.
  useEffect(() => {
    setRefusedLocalIds((prev) => (prev.size === 0 ? prev : new Set()));
  }, [rows]);

  // Fixing the thing that was blocking clears the message with it, rather than
  // leaving a stale complaint on screen for the rest of the six seconds.
  useEffect(() => {
    if (previewBlockedReason) return;
    setPreviewNudge(false);
    setNudgedLocalId(null);
  }, [previewBlockedReason]);

  // ── Per-child weekly total ───────────────────────────────────────────────
  function weeklyHoursFor(child_id: string): number {
    let totalMinutes = 0;
    for (const r of rows) {
      if (r.child_id !== child_id) continue;
      if (r.pendingDelete) continue;
      const minutes = r.minutes_per_lesson ?? 0;
      if (minutes <= 0) continue;
      totalMinutes += lessonsPerWeek(r) * minutes;
    }
    return totalMinutes / 60;
  }

  // ── Save flow ────────────────────────────────────────────────────────────
  async function handleSave() {
    if (saveGate.isBusy() || saving || !effectiveUserId) return;
    if (!allValid) return;
    if (!saveGate.tryEnter()) return;
    setSaving(true);
    setSaveError(null);
    setPostSaveNotice(null);

    // Duplicate pre-check. The Layer-1 in-flight gate above stops true
    // double-clicks; this layer stops the slower duplicate path that's
    // been hitting prod (same name, same child, separate save events
    // seconds-to-minutes apart, often from a second tab or a user who
    // didn't realise the goal had already saved). We also catch the
    // intra-batch case where the user adds two new rows with the same
    // name + child in one session. Case-insensitive on curriculum_name
    // so "A River Of Voices" and "a river of voices" collide.
    //
    // Skips updates: rows already saved as curriculum_goals just hit
    // UPDATE in the loop below, so they can't create dupes here. Rows
    // converting activity → curriculum DO insert a new goal row and so
    // are checked.
    const dupReleaseAndExit = (msg: string) => {
      setSaveError(msg);
      setSaving(false);
      // No settle window — the save never started, so a quick retry
      // after the user fixes the name should not be locked out.
      saveGate.exit();
    };

    const newCurriculumRows = rows.filter(
      (r) =>
        r.type === "curriculum" &&
        !r.pendingDelete &&
        !r.readOnly &&
        !(r.previouslySavedAs === "curriculum_goals" && r.dbId),
    );

    if (newCurriculumRows.length > 0) {
      const childNameFor = (cid: string) =>
        children.find((c) => c.id === cid)?.name ?? "this child";

      // Intra-batch first — cheaper, no round-trip.
      const seen = new Map<string, Row>();
      for (const r of newCurriculumRows) {
        const canonical = capitalizeName(r.name.trim());
        const canonicalName = canonical.toLowerCase();
        const canonicalSubject = (r.subject ?? "").trim().toLowerCase();
        const key = `${r.child_id}|${canonicalName}|${canonicalSubject}`;
        if (seen.has(key)) {
          dupReleaseAndExit(
            `Two rows on this page have the same name AND subject ("${r.name.trim()}" / "${r.subject?.trim() || "no subject"}") for ${childNameFor(r.child_id)}. Either give them different names, different subjects, or remove one.`,
          );
          return;
        }
        seen.set(key, r);
      }

      // DB check. Filter mirrors the Builder's load query (archived =
      // false AND completed_at IS NULL) so a finished curriculum doesn't
      // block starting the same one fresh next school year. The DB
      // partial unique index uses the same predicate.
      //
      // newCurriculumRows already excludes in-place edits (rows whose
      // previouslySavedAs === 'curriculum_goals' && dbId), so every row
      // we're about to check is a brand-new insert with no "self" to
      // exclude. Compare against EVERY active DB goal for this child,
      // including ones the form has loaded into other slots — otherwise
      // a user who reopens the Builder with goal "Foo" already loaded
      // can add a second "Foo" row and the existing one would be
      // skipped as "already being edited" (this was the 2026-05-23
      // DUP TEST V2 regression on staging adc0d7d).
      const { data: existingGoals, error: dupCheckErr } = await supabase
        .from("curriculum_goals")
        .select("id, child_id, curriculum_name, subject_label")
        .eq("user_id", effectiveUserId)
        .eq("archived", false)
        .is("completed_at", null);
      if (dupCheckErr) {
        console.error("[handleSave] duplicate pre-check query failed", dupCheckErr);
        dupReleaseAndExit(dupCheckErr.message);
        return;
      }
      for (const r of newCurriculumRows) {
        const canonical = capitalizeName(r.name.trim());
        const targetName = canonical.toLowerCase();
        const targetSubject = (r.subject ?? "").trim().toLowerCase();
        const conflict = (existingGoals ?? []).find(
          (g) =>
            g.child_id === r.child_id &&
            (g.curriculum_name ?? "").trim().toLowerCase() === targetName &&
            (g.subject_label ?? "").trim().toLowerCase() === targetSubject,
        );
        if (conflict) {
          dupReleaseAndExit(
            `You already have a goal called "${r.name.trim()}" with subject "${r.subject?.trim() || "no subject"}" for ${childNameFor(r.child_id)}. Edit the existing one, change this row's subject, or rename this row.`,
          );
          return;
        }
      }
    }
    /* ── Invariant 21 pre-flight: decided BEFORE phase 1 writes anything ──
     *
     * The refusal used to live in phase 2, which runs after the
     * `curriculum_goals` row has committed. A refused family was left holding a
     * curriculum with no lessons and none of the history they had stated, and
     * `healEmptyGoal` filled it with a forward queue 24 hours later. That is
     * the same silent reduction Invariant 21 exists to stop, one day late and
     * harder to see.
     *
     * Everything the check needs is knowable here. `current_lesson` is
     * `currentLessonFor(...)`, the same formula `recomputeCurrentLesson` runs:
     * for an INSERT the max-completed term is 0 (there are no rows yet), which
     * is exactly the seed phase 1 writes; for an UPDATE it comes off the goal's
     * completed rows. The projection is the shared `projectHistoryBackfill`.
     *
     * Nothing here writes. A refusal returns before phase 1, so no goal row,
     * no activity row and no lesson row is created, and the builder keeps the
     * family's edits and their draft.
     */
    // One clock for the whole save. `today` is memoised at mount, so a builder
    // left open across midnight would have the pre-flight and phase 2
    // projecting against different days: the pre-flight could refuse a save
    // phase 2 would have taken, or wave one through that it then refuses after
    // phase 1 has written. Both read this.
    const saveTodayMid = todayDate();
    const saveTodayStr = ymd(saveTodayMid);

    // Vacation blocks are needed twice: here, to know which days between
    // start_date and today were actually school days, and by phase 2's
    // projector. Read once, before either.
    const { data: preflightVacationData, error: preflightVacationErr } = await supabase
      .from("vacation_blocks")
      .select("start_date, end_date")
      .eq("user_id", effectiveUserId);
    if (preflightVacationErr) {
      console.error("[handleSave] vacation-block read failed", preflightVacationErr);
      dupReleaseAndExit(preflightVacationErr.message);
      return;
    }
    const preflightVacations = (preflightVacationData ?? []) as {
      start_date: string;
      end_date: string;
    }[];

    // ONLY the rows this save is asserting something about. An untouched goal
    // is never re-judged: the family is not claiming anything new about it, and
    // blocking their whole builder on a number they did not type is the thing
    // this filter exists to stop. See invariant21ClaimChanged.
    const refusalCandidates = rows.filter(
      (r) =>
        r.type === "curriculum" &&
        !r.pendingDelete &&
        !r.readOnly &&
        !!r.start_date &&
        r.start_date < saveTodayStr &&
        !!r.total_lessons &&
        r.total_lessons > 0 &&
        invariant21ClaimChanged(r),
    );

    type RefusalCheck = {
      row: Row;
      schoolDays: string[];
      lessonsPerDay: number;
      overrides: Record<string, number> | null;
      /** Upper bound on current_lesson, before the database is consulted. */
      coarse: number;
      /**
       * How many of those slots land on or before today. The projection places
       * slots 1..datable in the window, so only lesson numbers ABOVE it can
       * still be rescued by a row that already exists.
       */
      datable: number;
    };
    const atRisk: RefusalCheck[] = [];
    for (const r of refusalCandidates) {
      const { lessons_per_day, lessons_per_day_overrides, school_days } =
        compactCurriculumPerDay(r);
      if (school_days.length === 0) continue;
      const total = r.total_lessons ?? 0;
      // An UPPER BOUND on where current_lesson can land, used only to decide
      // whether this row is worth a database read at all. Overstating is the
      // safe direction: it can only pull MORE rows into the exact pass below,
      // never let one slip past it.
      //
      // The carried pointer usually serves, because it is itself a max that
      // already includes the goal's highest completed queue position. The one
      // case where it does NOT is a curriculum whose total was just RAISED:
      // `recomputeCurrentLesson` clamps the stored pointer with the old
      // `total_lessons`, so a goal holding a completed slot at 120 under a
      // total of 30 reads back as 30. Raise the total to 180 and the recompute
      // answers 120, which the stored 30 never bounded. Fall back to the new
      // total there, which bounds it by construction.
      const raisedTotal =
        r._originalSchedule?.total_lessons != null && total > r._originalSchedule.total_lessons;
      const coarse = raisedTotal
        ? total
        : currentLessonFor({
            startAtLesson: clampStartAtLesson(r.start_at_lesson, total),
            totalLessons: total,
            maxCompletedQueuePosition: r._dbCurrentLesson ?? 0,
          });
      if (coarse <= 0) continue;
      const projected = projectHistoryBackfill({
        goalId: r.dbId ?? r.localId,
        schoolDays: school_days,
        lessonsPerDay: lessons_per_day,
        lessonsPerDayOverrides: lessons_per_day_overrides,
        statedCompleted: coarse,
        startDate: r.start_date!,
        todayYmd: saveTodayStr,
        vacations: preflightVacations,
      });
      // Every slot the family could need already fits on or before today, and
      // the true current_lesson is never above `coarse`, so this row is safe
      // whatever the database says. No query, which is the common case.
      const datable = projected.filter((p) => p.date <= saveTodayStr).length;
      if (datable >= coarse) continue;
      atRisk.push({
        row: r,
        schoolDays: school_days,
        lessonsPerDay: lessons_per_day,
        overrides: lessons_per_day_overrides,
        coarse,
        datable,
      });
    }

    // Each at-risk row needs two small reads and none of them depend on each
    // other, so they go together. Phase 1 settles its rows the same way and for
    // the same reason: a family with several at-risk curricula should not pay
    // for them one after another before the save has even started.
    type RefusalProbe =
      | { ok: true; localId: string; message: string | null }
      | { ok: false; message: string };
    const probes = await Promise.all(
      atRisk.map(async (check): Promise<RefusalProbe> => {
        const r = check.row;
        const total = r.total_lessons ?? 0;
        let maxCompleted = 0;
        let alreadyRecorded: number[] = [];

        // Only a saved goal can already hold rows. A brand-new curriculum is
        // decided entirely in the browser.
        if (r.previouslySavedAs === "curriculum_goals" && r.dbId) {
          const { data: maxRow, error: maxErr } = await supabase
            .from("lessons")
            .select("queue_position")
            .eq("curriculum_goal_id", r.dbId)
            .eq("completed", true)
            .not("queue_position", "is", null)
            .order("queue_position", { ascending: false })
            .limit(1);
          if (maxErr) {
            console.error("[handleSave] progress pre-flight read failed", maxErr);
            return { ok: false, message: maxErr.message };
          }
          maxCompleted =
            (maxRow?.[0] as { queue_position: number | null } | undefined)?.queue_position ?? 0;

          // COMPLETED rows only. An incomplete row at lesson 100 is not a record
          // that lesson 100 was done, it is a lesson waiting to be done, and
          // phase 2's floor delete removes every one of them above the completed
          // floor before it asks this same question. Counting them made the
          // pre-flight MORE permissive than the backstop it fronts: a goal with
          // lessons 1-5 completed and 6-200 sitting as future rows, whose family
          // sets the starting position to 150, sailed through here and then threw
          // LateInvariant21Error in phase 2 with the goal row already committed.
          //
          // Only lesson numbers ABOVE the datable window can change the answer:
          // everything at or below it is already accounted for by a slot. That
          // bounds this read to the shortfall itself rather than the goal's whole
          // history, which is what keeps it clear of PostgREST's row cap.
          const {
            data: haveRows,
            error: haveErr,
            count: haveCount,
          } = await supabase
            .from("lessons")
            .select("lesson_number", { count: "exact" })
            .eq("curriculum_goal_id", r.dbId)
            .eq("completed", true)
            .gt("lesson_number", check.datable)
            .lte("lesson_number", Math.max(check.coarse, maxCompleted));
          if (haveErr) {
            console.error("[handleSave] progress pre-flight read failed", haveErr);
            return { ok: false, message: haveErr.message };
          }
          const have = (haveRows ?? []) as { lesson_number: number | null }[];
          alreadyRecorded = have
            .map((x) => x.lesson_number)
            .filter((n): n is number => n != null);
          // A shortfall bigger than PostgREST will return in one page needs a
          // curriculum with more than a thousand COMPLETED lessons the calendar
          // cannot date. Counting only what came back understates what the goal
          // holds, so the check errs toward refusing, which is the safe
          // direction. Reported so it is never invisible.
          if (haveCount != null && haveCount !== have.length) {
            captureSupabaseError(
              "Invariant 21 pre-flight read a truncated lesson-number page",
              new Error(
                `Goal ${r.dbId}: read ${have.length} of ${haveCount} completed lesson numbers above slot ${check.datable}`,
              ),
              {
                level: "warning",
                tags: { phase: "invariant_21_preflight_truncated", goal_id: r.dbId },
                extra: { got: have.length, expected: haveCount, datable: check.datable },
              },
            );
          }
        }

        const statedCompleted = currentLessonFor({
          startAtLesson: clampStartAtLesson(r.start_at_lesson, total),
          totalLessons: total,
          maxCompletedQueuePosition: maxCompleted,
        });
        if (statedCompleted <= 0) return { ok: true, localId: r.localId, message: null };

        const projected = projectHistoryBackfill({
          goalId: r.dbId ?? r.localId,
          schoolDays: check.schoolDays,
          lessonsPerDay: check.lessonsPerDay,
          lessonsPerDayOverrides: check.overrides,
          statedCompleted,
          startDate: r.start_date!,
          todayYmd: saveTodayStr,
          vacations: preflightVacations,
        });
        return {
          ok: true,
          localId: r.localId,
          message: historyBackfillRefusal({
            curriculumName: r.name.trim() || "This curriculum",
            statedCompleted,
            startDate: r.start_date!,
            todayYmd: saveTodayStr,
            projected,
            alreadyRecorded,
          }),
        };
      }),
    );

    // A read that failed tells us nothing about whether progress fits, and
    // guessing is what this whole invariant exists to stop. Fail the save
    // before phase 1 rather than write on an unanswered question.
    const probeFailure = probes.find((x): x is Extract<RefusalProbe, { ok: false }> => !x.ok);
    if (probeFailure) {
      dupReleaseAndExit(probeFailure.message);
      return;
    }
    const refusals = probes
      .filter((x): x is Extract<RefusalProbe, { ok: true }> => x.ok)
      .filter((x) => x.message !== null)
      .map((x) => ({ localId: x.localId, message: x.message as string }));

    if (refusals.length > 0) {
      // One refused row refuses the WHOLE save. Phase 2 re-spreads every
      // curriculum in the builder anyway, so a partial save would leave the
      // family's page and their database disagreeing about what they just did.
      setRefusedLocalIds(new Set(refusals.map((x) => x.localId)));
      // Save is only reachable from the preview, where BuilderView and its
      // data-local-id cards are not mounted: revealing without switching back
      // silently found nothing and left the family on the preview with a
      // message about rows they could not see. Switch first, then reveal.
      setView("builder");
      revealRow(refusals[0].localId, { focus: false });
      captureSupabaseError(
        "Curriculum save refused before phase 1: stated progress does not fit",
        new Error(refusals.map((x) => x.message).join(" | ")),
        {
          level: "warning",
          tags: { phase: "invariant_21_preflight" },
          extra: { refusedCount: refusals.length },
        },
      );
      dupReleaseAndExit(refusals.map((x) => x.message).join(" "));
      return;
    }

    // Phase tracking so the catch can distinguish a true write failure
    // (curriculum_goals / activities never committed) from a post-save
    // hiccup (writes committed; lesson regen / recompute / overcapacity
    // assertion threw afterward). Flip to "post_save" once Phase 1 + 2
    // settle so any throw past that point routes to the soft notice.
    let phase: "write" | "post_save" = "write";
    // Which goal's phase 2 failed. The re-throw below carries only the error,
    // so this is how the catch names the goal in the console warning support
    // reads alongside the matching Sentry event.
    let failedPhase2GoalId: string | null = null;
    try {
      // Each entry pairs a saved curriculum_goals row with the local Row it
      // came from. The lesson-generation pass below needs both the dbId (for
      // the FK + dedup query) and the Row's name / child_id / school_days /
      // counts (to project lesson dates).
      const savedCurriculumGoals: Array<{ id: string; row: Row }> = [];
      const localCurriculumIds = new Set<string>();
      const localActivityIds = new Set<string>();

      // Resolve the user's active school year ONCE so brand-new curriculum_goals
      // are linked to it. Goals created here with school_year_id = NULL became
      // invisible to surfaces that scope by the active year (year-end / close
      // flows, and the Plan page's year filter), so a brand-new user who just
      // built their first schedule could see an empty plan (2026-06 unlinked-
      // goals bug; 39 existing rows were backfilled directly in the DB). If the
      // user somehow has no active year, fall back to NULL — same as before.
      const { data: activeYearRow } = await supabase
        .from("school_years")
        .select("id")
        .eq("user_id", effectiveUserId)
        .eq("status", "active")
        .maybeSingle();
      const activeSchoolYearId = (activeYearRow as { id?: string } | null)?.id ?? null;

      // 1. Per-row writes via the (previouslySavedAs, type, pendingDelete) matrix.
      // Phase 1 writes one row per curriculum or activity and none of them
      // depend on another, so they run together. Before 2026-09-10 this was a
      // sequential loop: a 13-row builder paid 13 round trips in a row, about
      // 2.4 s, before phase 2 could even start. Each row's result is returned
      // and gathered in row order so phase 2 sees the same order it always did.
      const phase1Settled = await Promise.allSettled(rows.map(async (row): Promise<{ id: string; row: Row } | null> => {
        let saved: { id: string; row: Row } | null = null;
        if (row.readOnly) {
          // Preserve membership so the sweep doesn't archive them.
          if (row.previouslySavedAs === "curriculum_goals" && row.dbId) {
            localCurriculumIds.add(row.dbId);
          } else if (row.previouslySavedAs === "activities" && row.dbId) {
            localActivityIds.add(row.dbId);
          }
          return null;
        }

        if (row.pendingDelete) {
          // Soft-delete the row in its origin table; nothing else.
          if (row.previouslySavedAs === "curriculum_goals" && row.dbId) {
            const { error } = await supabase
              .from("curriculum_goals")
              .update({ archived: true })
              .eq("id", row.dbId);
            if (error) throw error;
          } else if (row.previouslySavedAs === "activities" && row.dbId) {
            const { error } = await supabase
              .from("activities")
              .update({ is_active: false })
              .eq("id", row.dbId);
            if (error) throw error;
          }
          return null;
        }

        if (row.type === "curriculum") {
          // Destination = curriculum_goals
          const { lessons_per_day, lessons_per_day_overrides, school_days } =
            compactCurriculumPerDay(row);
          const payload = {
            user_id: effectiveUserId,
            child_id: row.child_id,
            curriculum_name: capitalizeName(row.name.trim()),
            subject_label: row.subject.trim() || null,
            total_lessons: row.total_lessons,
            lessons_per_day,
            lessons_per_day_overrides,
            school_days,
            start_date: row.start_date,
            // Clamped on the way out too. total_lessons can be edited after
            // the starting position was typed, and nothing re-validates the
            // pair, so the write path is the last place this can be caught.
            start_at_lesson: clampStartAtLesson(row.start_at_lesson, row.total_lessons ?? 0),
            // default_minutes is NOT NULL in DB; fall back to 30 if the user
            // cleared the field. Same fallback applies on UPDATE so an empty
            // input never null-trips the constraint.
            default_minutes: row.minutes_per_lesson ?? 30,
            archived: false,
          };

          if (row.previouslySavedAs === "curriculum_goals" && row.dbId) {
            // In-place UPDATE, preserving legacy fields the builder doesn't expose.
            const { error } = await supabase
              .from("curriculum_goals")
              .update(payload)
              .eq("id", row.dbId);
            if (error) throw error;
            localCurriculumIds.add(row.dbId);
            saved = { id: row.dbId, row };
          } else if (row.previouslySavedAs === "activities" && row.dbId) {
            // Type changed activity → curriculum: archive the activity row,
            // insert as new curriculum_goals row.
            const { error: deactErr } = await supabase
              .from("activities")
              .update({ is_active: false })
              .eq("id", row.dbId);
            if (deactErr) throw deactErr;
            // INSERTs must seed current_lesson in lockstep with start_at_lesson
            // so the DB row is consistent BEFORE Phase 2 runs. Without this
            // seed, a Phase 2 throw left rows with start_at_lesson=3 and
            // current_lesson=0 (Kendra Poole, 5/27/26): internally
            // inconsistent and stuck behind the "save again" notice.
            const insertPayload = {
              ...payload,
              school_year_id: activeSchoolYearId,
              current_lesson: Math.max(0, clampStartAtLesson(row.start_at_lesson, row.total_lessons ?? 0) - 1),
            };
            const { data: inserted, error: insErr } = await supabase
              .from("curriculum_goals")
              .insert(insertPayload)
              .select("id")
              .single();
            if (insErr || !inserted) throw insErr ?? new Error("insert failed");
            const newId = (inserted as { id: string }).id;
            localCurriculumIds.add(newId);
            saved = { id: newId, row };
          } else {
            // Brand-new row. Same seed as above so the post-INSERT row is
            // consistent before Phase 2 runs.
            const insertPayload = {
              ...payload,
              school_year_id: activeSchoolYearId,
              current_lesson: Math.max(0, clampStartAtLesson(row.start_at_lesson, row.total_lessons ?? 0) - 1),
            };
            const { data: inserted, error } = await supabase
              .from("curriculum_goals")
              .insert(insertPayload)
              .select("id")
              .single();
            if (error || !inserted) throw error ?? new Error("insert failed");
            const newId = (inserted as { id: string }).id;
            localCurriculumIds.add(newId);
            saved = { id: newId, row };
          }
        } else {
          // Destination = activities (coop or activity rows)
          const days: number[] = activeDayIndices(row);
          const payload = {
            user_id: effectiveUserId,
            name: row.name.trim(),
            emoji: row.emoji || (row.type === "coop" ? COOP_DEFAULT_EMOJI : ACTIVITY_DEFAULT_EMOJI),
            frequency: "weekly" as const,
            days,
            duration_minutes: row.minutes_per_lesson ?? null,
            child_ids: [row.child_id],
            is_active: true,
            scheduled_start_time: null,
          };

          if (row.previouslySavedAs === "activities" && row.dbId) {
            const { error } = await supabase
              .from("activities")
              .update(payload)
              .eq("id", row.dbId);
            if (error) throw error;
            localActivityIds.add(row.dbId);
          } else if (row.previouslySavedAs === "curriculum_goals" && row.dbId) {
            // Type changed curriculum → coop/activity: archive the goal,
            // insert as new activities row.
            const { error: archErr } = await supabase
              .from("curriculum_goals")
              .update({ archived: true })
              .eq("id", row.dbId);
            if (archErr) throw archErr;
            const { data: inserted, error: insErr } = await supabase
              .from("activities")
              .insert(payload)
              .select("id")
              .single();
            if (insErr || !inserted) throw insErr ?? new Error("insert failed");
            localActivityIds.add((inserted as { id: string }).id);
          } else {
            // Brand-new activity.
            const { data: inserted, error } = await supabase
              .from("activities")
              .insert(payload)
              .select("id")
              .single();
            if (error || !inserted) throw error ?? new Error("insert failed");
            localActivityIds.add((inserted as { id: string }).id);
          }
        }
              return saved;
      }));
      // Every row has settled, so nothing is still landing behind the error
      // the family sees. A brand-new goal that DID land is written back onto
      // its row as saved, so the retry updates it instead of inserting a twin
      // (the live-DB duplicate check would otherwise refuse the retry with
      // "You already have a goal called ..."). Then the first failure, in row
      // order, is thrown exactly as the sequential loop threw it.
      const landedNewGoals: { localId: string; id: string }[] = [];
      let firstPhase1Failure: unknown = null;
      phase1Settled.forEach((result, i) => {
        if (result.status === "fulfilled") {
          if (result.value) {
            savedCurriculumGoals.push(result.value);
            const r = rows[i];
            if (!(r.previouslySavedAs === "curriculum_goals" && r.dbId)) {
              landedNewGoals.push({ localId: r.localId, id: result.value.id });
            }
          }
        } else if (firstPhase1Failure === null) {
          firstPhase1Failure = result.reason;
        }
      });
      if (landedNewGoals.length > 0) {
        setRows((prev) =>
          prev.map((r) => {
            const landed = landedNewGoals.find((l) => l.localId === r.localId);
            return landed ? { ...r, dbId: landed.id, previouslySavedAs: "curriculum_goals" as const } : r;
          }),
        );
      }
      if (firstPhase1Failure !== null) throw firstPhase1Failure;

      // 2. Reconciliation sweep — anything in DB at load time that didn't end
      //    up in the local-id set is a row the user removed (or whose origin
      //    table we changed away from).
      const goalsToArchive: string[] = [];
      for (const id of originalCurriculumIds) {
        if (!localCurriculumIds.has(id)) goalsToArchive.push(id);
      }
      const activitiesToDeactivate: string[] = [];
      for (const id of originalActivityIds) {
        if (!localActivityIds.has(id)) activitiesToDeactivate.push(id);
      }
      if (goalsToArchive.length > 0) {
        const { error } = await supabase
          .from("curriculum_goals")
          .update({ archived: true })
          .in("id", goalsToArchive);
        if (error) throw error;
      }
      if (activitiesToDeactivate.length > 0) {
        const { error } = await supabase
          .from("activities")
          .update({ is_active: false })
          .in("id", activitiesToDeactivate);
        if (error) throw error;
      }

      // Phase 1 (per-row writes) and Phase 2 (reconciliation sweep) are
      // committed at this point. Anything that throws below is a post-save
      // hiccup, not a write failure — route through the soft notice.
      phase = "post_save";

      // 3. Recompute current_lesson on every curriculum row we wrote so
      //    start_at_lesson is honored on the read side (queue projector
      //    starts at current_lesson + 1) — and then materialize lesson rows
      //    in the lessons table.
      //
      //    Why pre-generate: the Plan page reads concrete lesson rows by
      //    (curriculum_goal_id, lesson_number) for its weekly grid. Without
      //    these rows it shows "No curriculum added yet" even after a save.
      //    The legacy CurriculumWizard pre-generated lessons for the same
      //    reason; the Schedule Builder mirrors that flow.
      //
      //    Each goal is reinserted from the "completed floor" up: pending
      //    rows above max(lesson_number where completed=true) are deleted
      //    first, then the queue is rewritten from current_lesson+1 to
      //    total_lessons against fresh dates. Completed rows are never
      //    touched (Invariant 3). The (curriculum_goal_id, lesson_number)
      //    unique index is the DB-side safety net; the floor-based delete
      //    is what makes re-saves IDEMPOTENT instead of stacking a fresh
      //    batch on the same calendar dates (the May 2026 overcapacity
      //    bug: pending rows above the floor were left in place at stale
      //    dates and the reinsert skipped them, so different lesson_numbers
      //    landed on the same date across multiple runs).
      // Read once, above the Invariant 21 pre-flight, which needs the same
      // blocks to know which days between start_date and today were school
      // days at all.
      const vacations = preflightVacations;
      // The same instant the Invariant 21 pre-flight used, so the two cannot
      // straddle midnight and disagree about how many school days have passed.
      const todayMid = saveTodayMid;

      // Per-goal Phase 2 with one-shot retry. Phase 1 (curriculum_goals +
      // activities) has already committed; a throw here means the lesson
      // layout didn't land, not that the user's saved row is gone. A 500ms
      // retry catches transient blips (network jitter, momentary RLS hiccup)
      // before the soft "save again" notice fires. If both attempts fail,
      // Sentry captures the final error AND we throw so the outer catch's
      // soft notice still fires. Same UX as before, just observable now.
      // The 3 early-returns inside `applyPhase2ForGoal` replace `continue`s
      // from the original inline loop and mean "no Phase 2 work for this
      // goal" (no lessons to project, no school days, etc.).
      const applyPhase2ForGoal = async (goalId: string, row: Row): Promise<void> => {
        // Recompute first so we know where the queue stands. The return
        // value is the post-recompute current_lesson; for brand-new goals
        // it equals max(start_at_lesson - 1, 0). For UPDATE flows it can be
        // higher if the user has completed lessons past start_at_lesson.
        const newCurrent = await recomputeCurrentLesson(supabase, goalId);
        const currentLesson = newCurrent ?? Math.max(0, row.start_at_lesson - 1);

        if (!row.total_lessons || row.total_lessons <= 0) return;
        const { lessons_per_day, lessons_per_day_overrides, school_days } =
          compactCurriculumPerDay(row);
        if (school_days.length === 0) return;

        // ── Pins (Invariant 12) ──────────────────────────────────────────────
        // Phase 2 re-spreads EVERY curriculum row in the builder on every save,
        // not just the one the user edited. Its floor-anchored delete removes
        // incomplete rows above the completed floor — which used to include
        // pinned ones — so saving any curriculum silently destroyed manual moves
        // on all the others. Proven on the test account: sibling goal 4193f9b3's
        // pinned lesson 30 was deleted and re-created unpinned when an e2e spec
        // saved a different curriculum.
        //
        // scheduleFieldsChangedForRow is the single documented exception: see
        // its doc comment for why an intentional re-spread of THIS goal clears
        // its pins while a sibling save must respect them.
        // Every row this goal holds right now. Two jobs:
        //
        //   1. It is the input the post-delete state is simulated from, which
        //      is what lets the assertions run before anything is destroyed.
        //   2. Row-count invariant, part 1 of 2 — what the goal held BEFORE the
        //      delete. Phase 2 deletes and re-inserts, so a bug in what the
        //      batch decides to write can destroy a lesson and still report
        //      success. Not hypothetical: commit 6905c4f dropped exactly one
        //      row per drifted pin, and goal 5d6ac7b5 came out of a save with
        //      99 rows instead of 100, lesson 4 gone, Wednesday empty, no error.
        //
        // A read failure used to be non-fatal here, because this read was only
        // job 2 — a guard rail, not worth failing a save over. It is job 1 now,
        // so it throws: without it the batch cannot be checked, and deleting
        // rows we cannot check is exactly the bug being fixed. Throwing costs
        // the family nothing — nothing has been written yet, the retry wrapper
        // gets a non-deterministic error and tries again, and the worst case is
        // the soft "save again to sync" notice with every lesson still intact.
        const {
          data: beforeRowsData,
          error: beforeRowsErr,
          count: beforeRowsCount,
        } = await supabase
          .from("lessons")
          .select("id, lesson_number, queue_position, completed, notes, minutes_spent, queue_pinned, scheduled_date, date, title", { count: "exact" })
          .eq("curriculum_goal_id", goalId);
        if (beforeRowsErr) throw beforeRowsErr;
        const beforeRows = (beforeRowsData ?? []) as {
          id: string;
          lesson_number: number | null;
          queue_position: number | null;
          completed: boolean;
          notes: string | null;
          minutes_spent: number | null;
          queue_pinned: boolean | null;
          scheduled_date: string | null;
          date: string | null;
          title: string | null;
        }[];
        // A partial snapshot is worse than no snapshot: rows PostgREST capped
        // out of the response look "missing", the batch plans inserts for
        // lesson numbers that already exist, and the delete has run by the time
        // the unique index says so. This is the row cap that already truncated
        // the Today reconciler's cross-goal fetch (see
        // reconcileGoalScheduleCache), so it gets checked rather than assumed.
        // The exact count comes back in the same round trip.
        if (beforeRowsCount != null && beforeRowsCount !== beforeRows.length) {
          throw new Error(
            `Phase 2 read ${beforeRows.length} of ${beforeRowsCount} lesson rows for goal ${goalId}; refusing to plan against a truncated snapshot`,
          );
        }
        const clearPins = scheduleFieldsChangedForRow(row);
        // Derived from the one read of the goal's rows above; this used to be
        // its own request, and the completed floor below a third.
        // (Spread, not a literal: this is an in-memory view of rows already
        // read, not a payload, and Invariant 10's source sweep reads any
        // literal carrying scheduled_date as a write.)
        const pinnedRows = beforeRows
          .filter((r) => !r.completed && r.queue_pinned)
          .map((r) => ({ ...r, completed: false, queue_pinned: true, curriculum_goal_id: goalId }));

        const survivingPins = clearPins ? [] : pinnedRows;
        // Keyed by queue_position, which is what the projector's slots mean.
        const pins: PinnedSlot[] = pinsFromRows(survivingPins, goalId);
        const pinnedIdsToKeep = clearPins ? [] : survivingPins.map((r) => r.id);

        const goalConfig = {
          id: goalId,
          school_days,
          lessons_per_day,
          lessons_per_day_overrides,
          current_lesson: currentLesson,
          total_lessons: row.total_lessons,
          start_date: row.start_date,
        };

        // Project until total_lessons is reached. The 3650 daysAhead is the
        // scheduler's internal safety bound; computeNextLessonsForGoal stops
        // earlier once the queue runs out. start_date in the future is
        // honored inside the projector.
        // Surviving pins are date-occupying inputs: the projector emits them
        // where they sit and fills unpinned slots around them without stacking
        // on their days — the same occupancy discipline the vacation re-spread
        // relies on.
        //
        // ── Invariant 1: nothing NEW is dated on or before today ─────────────
        // A brand-new curriculum anchors its forward projection at
        // forwardScheduleStart, so its first lesson lands strictly after today
        // (or on the family's own later start date). The invariant was written
        // in May 2026 and the helper has been exported and tested ever since,
        // but until today nothing in the app called it: the builder anchored
        // every projection at todayMid, so creating a curriculum dropped a
        // lesson onto the very day the family set it up. 101 curricula across
        // 32 families arrived that way. It is also the other half of the
        // history/forward seam. The last backfilled lesson now lands on
        // today, and an anchor of todayMid would put lesson N+1 on top of it.
        //
        // An EXISTING goal keeps todayMid. Its lesson due today is legitimate
        // work the family planned, and phase 2 re-spreads every row in the
        // builder on every save: moving that lesson to tomorrow because they
        // opened the builder to edit a different subject would be its own
        // regression.
        // `beforeRows.length === 0` is the half that survives a RETRY. Phase 1
        // stamps a landed insert back onto its row as
        // previouslySavedAs: "curriculum_goals", so on the family's second tap
        // of Save (which the refusal notice and the transient notice both ask
        // for) the flag alone reads the brand-new goal as an existing one and
        // the anchor falls back to today, re-introducing the violation this
        // change exists to fix. A goal holding no lesson rows is still being
        // created however its flag reads, and it has no lesson due today for
        // the todayMid branch to protect.
        const isNewGoal =
          !(row.previouslySavedAs === "curriculum_goals" && row.dbId) || beforeRows.length === 0;
        const startPick = row.start_date ? new Date(`${row.start_date}T00:00:00`) : todayMid;
        const forwardAnchor = isNewGoal ? forwardScheduleStart(startPick, todayMid) : todayMid;
        const upcoming = computeNextLessonsForGoal(goalConfig, forwardAnchor, 3650, vacations, 0, pins);
        if (upcoming.length === 0) return;

        /* ── PLAN ─────────────────────────────────────────────────────────────
         * Nothing between here and the COMMIT block below writes to the
         * database. That ordering IS the fix for the August 2026 data loss.
         *
         * The floor delete used to run first and the assertion that can refuse
         * the batch ran several statements later. These are separate PostgREST
         * calls: no transaction, no rollback. So when the assertion threw, the
         * delete had already committed. The family kept their curriculum
         * settings, their completed lessons and their pinned rows, and lost
         * every other future lesson with nothing re-inserted. The failure was
         * deterministic, so the retry could not help, and all they were shown
         * was "email hello@".
         *
         * Every assertion here is a check on COMPUTED data, so every one of
         * them can run before the first destructive call. The only thing that
         * used to force the old order was reading the surviving rows back after
         * the delete — and what the delete leaves behind is fully predictable
         * from the rows we already hold plus the delete's own predicate. So the
         * batch is planned against a simulated post-delete state instead.
         * ─────────────────────────────────────────────────────────────────── */

        // Floor-anchored delete (issued in COMMIT below). The floor is the
        // highest lesson_number among completed rows for this goal (0 if
        // none). Pending rows strictly above the floor are nuked before
        // reinsert, so the upcoming projection lands on fresh dates with no
        // stale rows locked in from a prior run. Completed history above the
        // floor is preserved (Invariant 3). For brand-new goals the floor is
        // 0, which collapses to "delete every pending row," matching the
        // pre-floor behavior of the create path and closing the same
        // multi-tab / retry race it always guarded against.
        const completedFloor = beforeRows.reduce(
          (m, r) => (r.completed && r.lesson_number != null ? Math.max(m, r.lesson_number) : m),
          0,
        );



        // Simulate the floor delete. Mirrors the query issued in COMMIT exactly:
        // incomplete, lesson_number strictly above the floor, minus the pinned
        // rows held back. PostgREST's `gt` never matches a NULL, so rows with no
        // lesson_number survive the real delete and must survive this one too.
        const keepPinnedIds = new Set(pinnedIdsToKeep);

        // ITEM 4 of the 2026-09-08 queue-slot brief: a rebuild never deletes a
        // row carrying the parent's own work.
        //
        // djdillon88, 2026-09-07: at 00:05 he wrote 46 characters of notes on
        // "Happy Cheetah — Lesson 1", unpinned and incomplete. At 00:38 a save
        // re-spread all five of his goals, the floor delete took every unpinned
        // incomplete row with it, and the reinsert brought them back with new
        // ids and no notes. He retyped them at 01:54. No lesson.deleted event
        // was logged, because this delete is a bulk statement and logs nothing.
        //
        // Completed and pinned rows were already held back. Notes and
        // minutes_spent are the other two things only a person can put on a
        // row, so they join them. The row keeps its id, its notes and its
        // lesson_number; what the rebuild is still allowed to do is re-date it,
        // which happens in COMMIT below.
        const holdsParentWork = (r: { notes: string | null; minutes_spent: number | null }) =>
          (r.notes != null && r.notes.trim().length > 0) || r.minutes_spent != null;
        const workRowIds = new Set(
          beforeRows.filter((r) => !r.completed && holdsParentWork(r)).map((r) => r.id),
        );
        // One set for both the simulation and the real delete, so they cannot
        // drift apart the way the pin exclusion once did.
        const heldBackIds = new Set([...keepPinnedIds, ...workRowIds]);

        const deletedIds = new Set(
          beforeRows
            .filter(
              (r) =>
                !r.completed &&
                r.lesson_number != null &&
                r.lesson_number > completedFloor &&
                !heldBackIds.has(r.id),
            )
            .map((r) => r.id),
        );
        const survivors = beforeRows.filter((r) => !deletedIds.has(r.id));

        // Historical backfill: when the user enters a past start_date AND
        // has already completed lessons (currentLesson > 0), generate
        // is_backfill=true rows for lesson_numbers 1..currentLesson dated
        // from start_date forward using the schedule. Without this block
        // the past start_date was silently ignored: forward lessons all
        // landed on today and the Plan calendar showed no record of the
        // family's actual past work. The rows are marked is_backfill so
        // the queue projector never re-spreads them (Invariant 3) and the
        // Today page's `is_backfill !== true` filter keeps them out of the
        // daily checklist. They exist only as historical entries the Plan
        // calendar surfaces on their past dates.
        const ymdToday = ymd(todayMid);
        // Set when an UNCLAIMED row turns out to hold less history than it
        // states. Phase 2 must then do NOTHING for that goal: see the bail-out
        // below the call for why returning is the only safe answer.
        let unclaimedShortfall: string | null = null;
        const planHistoricalBackfill = () => {
          if (!row.start_date || row.start_date >= ymdToday || currentLesson <= 0) return [];
          const startMid = new Date(`${row.start_date}T00:00:00`);
          // Project from start_date with current_lesson=0 +
          // total_lessons=currentLesson so the projector lays down exactly
          // the historical slots numbered 1..currentLesson.
          const histConfig = {
            id: goalId,
            school_days,
            lessons_per_day,
            lessons_per_day_overrides,
            current_lesson: 0,
            total_lessons: currentLesson,
            start_date: row.start_date,
          };
          const daysSpan = Math.max(
            1,
            Math.floor((todayMid.getTime() - startMid.getTime()) / 86400000) + 60,
          );
          const histProjected = computeNextLessonsForGoal(
            histConfig,
            startMid,
            daysSpan,
            vacations,
          );
          // Respect the (curriculum_goal_id, lesson_number) unique index.
          // The floor delete clears incomplete rows 1..currentLesson; anything
          // left is either a real completion or a previously inserted backfill
          // row, both of which must be preserved. Read off `survivors` rather
          // than the database so this stays on the pre-delete side of the line.
          const existingHistNums = new Set(
            survivors
              .map((r) => r.lesson_number)
              .filter((n): n is number => n != null && n >= 1 && n <= currentLesson),
          );

          // ── Invariant 21: the stated count is never silently reduced ────
          // Progress that cannot fit in the school days between start_date and
          // today used to be dropped by the filter below and the save reported
          // success. One family set a start date of 2026-08-19 and said they
          // were on lesson 182: one school day had passed, Rooted recorded 1
          // lesson and discarded 180 without a word. Refuse instead, and say
          // which two numbers do not reconcile.
          //
          // `existingHistNums` is what keeps this off the back of a family who
          // is merely ahead of their own pace. current_lesson measures real
          // work, not a rate, so a 1/day goal whose family did three a day
          // reaches lesson 15 in nine school days with all fifteen rows on
          // disk. Nothing is missing there and nothing needs writing, so
          // nothing is refused. See historyBackfillRefusal.
          //
          // BELT AND BRACES, for the rows the pre-flight actually judged.
          //
          // A CLAIMED row (new, or one whose starting position or school-week
          // shape the family just changed) was decided before phase 1, off the
          // same formula and the same projection. Reaching a refusal here means
          // the two disagreed and the `curriculum_goals` row is already on
          // disk, so it throws, tagged separately.
          //
          // An UNCLAIMED row is a sibling along for the ride: the family is not
          // asserting anything about it in this save and the pre-flight did not
          // ask. Throwing here would block their whole builder on a number they
          // did not type, which is exactly what scoping the pre-flight removed.
          // It writes what fits, as it always did, and the shortfall is
          // reported rather than thrown so it is never invisible.
          const refusal = historyBackfillRefusal({
            curriculumName: row.name.trim() || "This curriculum",
            statedCompleted: currentLesson,
            startDate: row.start_date,
            todayYmd: ymdToday,
            projected: histProjected,
            alreadyRecorded: existingHistNums,
          });
          if (refusal) {
            if (invariant21ClaimChanged(row)) throw new LateInvariant21Error(refusal);
            unclaimedShortfall = refusal;
            return [];
          }

          // Everything from start_date through today INCLUSIVE is history the
          // family asserted. `histProjected` is built with
          // `total_lessons: currentLesson`, so it holds exactly one slot per
          // lesson they told us they finished, including the one that lands
          // on today.
          //
          // This used to read `<`, on the reasoning that today's slot "still
          // belongs to the normal Today flow". It does not: the forward planner
          // starts at current_lesson + 1, so the slot on today was claimed by
          // neither planner and the lesson was lost at the seam. A family who
          // started 2026-08-31 Mon-Fri and said 10 were done got lessons 1-9
          // and no row at all for lesson 10. Live on 32 curricula across 23
          // families. Invariant 1 (above) is what keeps the forward projection
          // off today now that history reaches it.
          const pastSlots = histProjected.filter((p) => p.date <= ymdToday);

          // Slots the surviving rows already occupy. The forward planner
          // (planPhase2LessonInserts) has always respected this; THIS planner
          // did not, and that asymmetry is the bug.
          //
          // A history row's slot is not load-bearing: it is completed, so the
          // projector never emits it and Today never hydrates by it (the
          // is_backfill filter keeps it off the daily list either way). So
          // when the slot is taken, write the row with a null slot rather
          // than losing the lesson. Drift E does not apply: that contract is
          // about INCOMPLETE goal-linked rows falling through Today's
          // queries, and these are completed by construction.
          const occupiedSlots = new Set(
            survivors
              .map((r) => r.queue_position)
              .filter((n): n is number => n != null),
          );

          const minutes = row.minutes_per_lesson ?? 30;
          return pastSlots
            .filter((p) => !existingHistNums.has(p.lesson_number))
            .map((p) => ({
              user_id: effectiveUserId,
              child_id: row.child_id,
              curriculum_goal_id: goalId,
              lesson_number: p.lesson_number,
              queue_position: occupiedSlots.has(p.lesson_number) ? null : p.lesson_number,
              title: `${row.name.trim()} — Lesson ${p.lesson_number}`,
              scheduled_date: p.date,
              date: p.date,
              // `wizard_create` covers both forward AND backfill rows per
              // Invariant 10 in docs/CURRICULUM-SCHEDULING.md.
              scheduled_source: "wizard_create",
              completed: true,
              // Noon UTC, matching logPastDayLessons.ts and recalibrate.ts.
              // `T12:00:00` with no Z is browser-local noon, which serializes to
              // the PREVIOUS calendar day east of UTC (local noon at UTC+13 is
              // 23:00Z the day before). Attendance in app/dashboard/reports
              // buckets on completed_at.slice(0, 10), so those families had
              // every backfilled lesson reported a day early.
              completed_at: `${p.date}T12:00:00Z`,
              is_backfill: true,
              minutes_spent: minutes,
              hours: minutes / 60,
            }));
        };
        const histToInsert = planHistoricalBackfill();

        // ── An unclaimed goal that cannot fit its history is LEFT ALONE ──────
        //
        // Not "rebuilt without the part that does not fit". Phase 2 is a
        // delete-then-reinsert: the floor delete takes every unpinned, note-free
        // incomplete row above the highest COMPLETED lesson number, and what
        // comes back is the history that fits plus the forward queue from
        // current_lesson + 1. Lesson numbers in between are re-created by
        // neither, so a goal holding pending rows across that gap would lose
        // them permanently, on a save the family made about a different child,
        // and the next save would recompute the same current_lesson so the hole
        // could never heal.
        //
        // A claimed row throws above and never reaches here. An unclaimed one
        // returns before the first destructive call, so its lessons are exactly
        // as they were: not rebuilt, not trimmed, not deleted. The shortfall is
        // real and is reported; it is not this save's business to act on it.
        if (unclaimedShortfall) {
          const stated = currentLesson;
          const datable = projectHistoryBackfill({
            goalId,
            schoolDays: school_days,
            lessonsPerDay: lessons_per_day,
            lessonsPerDayOverrides: lessons_per_day_overrides,
            statedCompleted: stated,
            startDate: row.start_date!,
            todayYmd: ymdToday,
            vacations,
          }).filter((p) => p.date <= ymdToday).length;
          console.debug(
            `[handleSave] goal ${goalId}: untouched and short of its stated history, phase 2 skipped`,
          );
          captureSupabaseError(
            "Invariant 21: an untouched curriculum holds less history than it states",
            new Error(unclaimedShortfall),
            {
              level: "warning",
              tags: { phase: "invariant_21_untouched", goal_id: goalId },
              extra: {
                statedCompleted: stated,
                datableSlots: datable,
                shortfall: stated - datable,
                startDate: row.start_date,
                schoolDays: school_days,
                lessonsPerDay: lessons_per_day,
              },
            },
          );
          void logPlanEvent({
            userId: effectiveUserId,
            type: "schedule.rebuilt",
            payload: {
              goal_id: goalId,
              curriculum_name: row.name,
              inserted: 0,
              updated: 0,
              skipped: beforeRows.length,
              unchanged: true,
              reason: "invariant_21_untouched",
            },
          });
          return;
        }

        // What the batch needs, against BOTH partial unique indexes on lessons:
        //   lessons_goal_lesson_number_unique  (curriculum_goal_id, lesson_number)
        //   lessons_goal_queue_position_uniq   (curriculum_goal_id, queue_position)
        //
        // These are two different questions and must not share a branch. A
        // taken lesson_number means the lesson exists, so skip it. A taken
        // queue slot means only that the slot is occupied: the lesson can still
        // be missing and must still be written, just not into that slot.
        // Answering both with one filter is what destroyed lesson 4 on goal
        // 5d6ac7b5 — see planPhase2LessonInserts for the full shape.
        //
        // Rows with a NULL lesson_number contribute nothing, matching the
        // `.not("lesson_number", "is", null)` filter this used to read with.
        // The backfill rows count too: they are written before the forward
        // batch and hold both a number and a slot.
        const existingNums = new Set<number>();
        const existingSlots = new Set<number>();
        for (const r of survivors) {
          // Slot registration comes FIRST and is unconditional. A row with a
          // queue_position but a NULL lesson_number used to be skipped whole,
          // so its slot never reached existingSlots, the planner handed that
          // same slot to a fresh insert, and the batch died on
          // lessons_goal_queue_position_uniq. The row is invisible to the
          // lesson-number question and still very much occupies its slot.
          if (r.queue_position != null) existingSlots.add(r.queue_position);
          if (r.lesson_number == null) continue;
          existingNums.add(r.lesson_number);
        }
        for (const h of histToInsert) {
          existingNums.add(h.lesson_number);
          // A backfill row yields its slot when that slot was already taken
          // (see planHistoricalBackfill), in which case it registers no slot
          // here: it holds a lesson number and nothing else. The forward
          // planner must not then treat that free slot as occupied.
          if (h.queue_position != null) existingSlots.add(h.queue_position);
        }

        // Pure, and unit-tested in scheduler.test.ts: the missing lesson
        // numbers are zipped onto the free projected slots, so each row takes
        // its queue_position and its date from the slot it lands in.
        const plannedInserts = planPhase2LessonInserts({
          upcoming,
          existingLessonNumbers: existingNums,
          existingQueuePositions: existingSlots,
        });

        const toInsert = plannedInserts.map((p) => ({
          user_id: effectiveUserId,
          child_id: row.child_id,
          curriculum_goal_id: goalId,
          lesson_number: p.lesson_number,
          queue_position: p.queue_position,
          title: `${row.name.trim()} — Lesson ${p.lesson_number}`,
          scheduled_date: p.date,
          date: p.date,
          scheduled_source: "wizard_create",
          completed: false,
          hours: 0,
        }));

        // How many lessons of this goal may land on one date. One local
        // definition so the pre-write assertion, the pin warning and the
        // post-write assertion cannot disagree about the ceiling — the July
        // 2026 Lepior bug was two copies of this disagreeing, where the
        // post-check compared an uneven goal against the override AVERAGE and
        // threw on every save.
        const perDayAllowed = (dateStr: string): number => {
          const [yy, mm, dd] = dateStr.split("-").map(Number);
          const dateObj = new Date(yy, mm - 1, dd);
          const dayLabel = DAY_LABEL[(dateObj.getDay() + 6) % 7];
          const map = lessons_per_day_overrides ?? null;
          return map && typeof map[dayLabel] === "number" ? map[dayLabel] : lessons_per_day;
        };

        // PRE-WRITE capacity assertion. Refuses to commit a batch where the
        // projector put more than the day's ceiling on a single date. The May
        // 2026 t.ferrebee bug ("lesson 1 + lesson 2 both on 5/30 for lpd=1")
        // shipped because the equivalent post-write check threw inside
        // phase="post_save" and the catch swallowed it softly, leaving the bad
        // rows in the database.
        //
        // The ceiling applies to PROJECTED, UNPINNED lessons only. A pinned row
        // is the family's own placement, and stacking is a supported feature:
        // bulk-move-to-one-day puts N lessons on one date on purpose, and
        // `move_lesson_to_date` stacks queue positions to match (see the
        // "Invariant 2 carve-out for manual moves" section of
        // docs/CURRICULUM-SCHEDULING.md — auto-scheduling never bunches, only
        // the user can). Seeding this count from the surviving pins read a
        // supported feature as corruption and refused the save: goal 503610a9
        // has lessons 8 and 18 both pinned to 2026-09-02 on a 1/day goal, so
        // the guard saw "2 > 1" and threw. The projector already reserves each
        // pinned date's capacity before it places anything unpinned, so an
        // unpinned row can never land on a pinned day that is full.
        const unpinnedByDate: Record<string, number> = {};
        for (const r of toInsert) {
          if (!r.scheduled_date) continue;
          unpinnedByDate[r.scheduled_date] = (unpinnedByDate[r.scheduled_date] ?? 0) + 1;
        }
        const preInsertViolations: string[] = [];
        for (const [dateStr, count] of Object.entries(unpinnedByDate)) {
          const allowed = perDayAllowed(dateStr);
          if (count > allowed) {
            preInsertViolations.push(`${dateStr} (${count} > ${allowed})`);
          }
        }
        if (preInsertViolations.length > 0) {
          console.error(
            "[handleSave] Projector emitted overcapacity batch, refusing INSERT",
            { goalId, violations: preInsertViolations },
          );
          throw new ScheduleAssertionError(
            `Lesson scheduling produced ${preInsertViolations.length} overcapacity date(s): ${preInsertViolations.join(", ")}. The curriculum saved, but lessons were not generated. Please try a different start date or contact support.`,
          );
        }

        // Pins are exempt from the ceiling, not from observability. A date
        // holding more hand-placed lessons than the goal plans per day is worth
        // knowing about, so it goes to Sentry as a WARNING with the dates
        // attached — never as a throw, because the family chose it.
        //
        // Counted the way the PROJECTOR counts pins: isPinProjectable is the
        // single definition of which pins hold a slot, and it lives next to the
        // projector that reads it. A pin whose slot is at or below
        // current_lesson, or past total_lessons, is stale — the projector emits
        // nothing for it and reserves no capacity on its date, so counting it
        // here would double-count a day the projector had legitimately filled
        // with a fresh lesson. That mismatch is what produced 49 "overcapacity"
        // dates on a single goal, and 45 goals across 12 families still hold a
        // pin in that shape.
        const pinnedByDate: Record<string, number> = {};
        for (const p of pins) {
          if (!isPinProjectable(p, { current_lesson: currentLesson, total_lessons: row.total_lessons })) {
            continue;
          }
          pinnedByDate[p.date] = (pinnedByDate[p.date] ?? 0) + 1;
        }
        const stackedPinDates = Object.entries(pinnedByDate)
          .filter(([dateStr, count]) => count > perDayAllowed(dateStr))
          .map(([dateStr, count]) => `${dateStr} (${count} > ${perDayAllowed(dateStr)})`);
        if (stackedPinDates.length > 0) {
          captureSupabaseError(
            "Curriculum save phase 2: hand-placed lessons stacked past the per-day cap",
            new Error(
              `Goal ${goalId} has hand-placed lessons above its per-day count on ${stackedPinDates.join(", ")}`,
            ),
            {
              level: "warning",
              tags: { phase: "curriculum_save_phase2_pin_stack", goal_id: goalId },
              extra: { stackedPinDates, lessons_per_day, lessons_per_day_overrides },
            },
          );
        }

        // PRE-WRITE starting-position assertion. A save with starting position
        // N must never insert an INCOMPLETE dated row at or below N. Those
        // lessons are "already done before you started tracking", and the
        // orphan-cleanup trigger auto-completes them the moment current_lesson
        // advances — historically leaving their date caches parked on future
        // school days that the live queue also claimed. That is exactly how
        // kierrak745's goal came to render two lessons a day for seven school
        // days: starting position 8 with a future start_date of Aug 10, and
        // rows 1-7 written as wizard_create incompletes dated Aug 10-18.
        //
        // HEAD should already make this unreachable — `upcoming` projects from
        // current_lesson + 1, and the historical block only runs for a
        // past start_date and inserts completed=true rows. The assertion is
        // here so a future regression fails loudly, per goal, instead of
        // silently doubling a family's calendar. Backfill rows are checked
        // separately by construction: they are completed=true, so they are
        // legitimately at or below the floor and are not in `toInsert`.
        const belowFloor = toInsert.filter(
          (r) => !r.completed && r.lesson_number != null && r.lesson_number <= currentLesson,
        );
        if (belowFloor.length > 0) {
          const nums = belowFloor.map((r) => r.lesson_number).join(", ");
          console.error(
            "[handleSave] Batch would insert incomplete rows at/below the starting position, refusing INSERT",
            { goalId, currentLesson, lessonNumbers: belowFloor.map((r) => r.lesson_number) },
          );
          throw new ScheduleAssertionError(
            `Lesson scheduling tried to schedule lesson(s) ${nums} that are at or below your starting position (${currentLesson}). The curriculum saved, but lessons were not generated. Please contact support.`,
          );
        }

        /* ── COMMIT ───────────────────────────────────────────────────────────
         * Every assertion above passed against the computed batch, so the
         * writes below are the first destructive calls this goal makes. Keep it
         * that way: anything that can refuse the batch belongs in PLAN, above.
         * ─────────────────────────────────────────────────────────────────── */

        // When the user re-spread THIS goal, release the pins explicitly rather
        // than just ignoring them: leaving queue_pinned=true on rows we are
        // about to re-date would freeze them at their new projector dates and
        // make the next sibling save unable to move them either.
        // ProjectedLesson.lesson_number IS the queue slot (see its doc
        // comment); this is the slot-to-date map the held-back rows and the
        // no-op check below both read.
        const projDateBySlot = new Map<number, string>();
        for (const u of upcoming) {
          if (!projDateBySlot.has(u.lesson_number)) projDateBySlot.set(u.lesson_number, u.date);
        }

        // ── An unchanged sibling writes nothing ──────────────────────────────
        // See isPhase2NoOp in scheduler.ts for the rule and the reasons. The
        // decision is made on the completed plan, before the first write, and
        // logs a schedule.rebuilt event (Invariant 18) saying nothing moved.
        const verdict = isPhase2NoOp({
          beforeRows,
          deletedIds,
          workRowIds,
          toInsert,
          histToInsertCount: histToInsert.length,
          projDateBySlot,
          releasesPins: clearPins && pinnedRows.length > 0,
          totalLessons: row.total_lessons,
          todayYmd: ymd(todayMid),
          perDayAllowed,
        });
        if (verdict.noop) {
          console.debug(`[handleSave] goal ${goalId}: ${verdict.reason}, no rows written`);
          void logPlanEvent({
            userId: effectiveUserId,
            type: "schedule.rebuilt",
            payload: {
              goal_id: goalId,
              curriculum_name: row.name,
              inserted: 0,
              updated: 0,
              skipped: beforeRows.length,
              unchanged: true,
            },
          });
          return;
        }


        if (clearPins && pinnedRows.length > 0) {
          const { error: unpinErr } = await supabase
            .from("lessons")
            .update({ queue_pinned: false })
            .in("id", pinnedRows.map((r) => r.id));
          if (unpinErr) throw unpinErr;
        }

        let floorDelete = supabase
          .from("lessons")
          .delete()
          .eq("curriculum_goal_id", goalId)
          .eq("completed", false)
          .gt("lesson_number", completedFloor);
        // Manual placements survive the re-spread (unless this goal's own
        // schedule changed, in which case pinnedIdsToKeep is empty and they were
        // already released above). Without this exclusion the delete wiped them
        // and the reinsert brought them back unpinned at projector dates.
        if (heldBackIds.size > 0) {
          floorDelete = floorDelete.not("id", "in", `(${[...heldBackIds].join(",")})`);
        }
        const { error: incompleteDeleteErr } = await floorDelete;
        if (incompleteDeleteErr) throw incompleteDeleteErr;

        // One request per batch of 500 (app/lib/batches.ts), the same helper
        // "Add a past year" writes with. 100 per request cost a 180-lesson
        // goal two round trips where one does.
        for (const batch of batches(histToInsert, LESSON_INSERT_BATCH)) {
          const { error: histErr } = await supabase.from("lessons").insert(batch);
          if (histErr) throw histErr;
        }
        for (const batch of batches(toInsert, LESSON_INSERT_BATCH)) {
          const { error: lessonErr } = await supabase.from("lessons").insert(batch);
          if (lessonErr) throw lessonErr;
        }

        // Cleanup: if the user reduced total_lessons on an edit, any rows
        // previously inserted past the new ceiling become stale. Delete
        // only INCOMPLETE rows so historical completions are preserved
        // (Invariant 3: backfilled / completed lessons stay put).
        //
        // Pinned rows are deliberately NOT excluded here. A pin says "this
        // lesson belongs on this day"; it cannot say "this lesson exists" once
        // the user has shortened the curriculum past it. Reducing total_lessons
        // to 100 retires lesson 120 whether or not it was hand-placed. Note
        // that shortening total_lessons is itself a schedule-field change, so
        // scheduleFieldsChangedForRow already released this goal's pins above.
        let overCeilingDelete = supabase
          .from("lessons")
          .delete()
          .eq("curriculum_goal_id", goalId)
          .gt("lesson_number", row.total_lessons)
          .eq("completed", false);
        // Item 4 again. Shortening a curriculum retires the lessons past the
        // new end, but it does not entitle the app to shred what the parent
        // wrote on one of them. A retired row carrying notes or logged minutes
        // is UNSCHEDULED instead of deleted: it leaves every calendar surface
        // (they all select on scheduled_date) and it stops holding a queue
        // slot, so it can blank nothing, and the text survives.
        const overCeilingWorkIds = beforeRows
          .filter(
            (r) =>
              !r.completed &&
              r.lesson_number != null &&
              // Unknown ceiling retires nothing, matching how PostgREST's `gt`
              // treats the NULL in the delete above.
              row.total_lessons != null &&
              r.lesson_number > row.total_lessons &&
              holdsParentWork(r),
          )
          .map((r) => r.id);
        if (overCeilingWorkIds.length > 0) {
          overCeilingDelete = overCeilingDelete.not("id", "in", `(${overCeilingWorkIds.join(",")})`);
          const { error: unscheduleErr } = await supabase
            .from("lessons")
            .update({ scheduled_date: null, queue_position: null, queue_pinned: false })
            .in("id", overCeilingWorkIds);
          if (unscheduleErr) throw unscheduleErr;
        }
        const { error: cleanupErr } = await overCeilingDelete;
        if (cleanupErr) throw cleanupErr;

        // Item 4: the held-back rows are UPDATED rather than deleted and
        // recreated. They keep their id, their notes and their lesson_number;
        // what the rebuild is entitled to change is where they sit. The
        // projector's date for a slot is read out of `upcoming`, the same
        // output the fresh inserts were built from, so a kept row lands on the
        // same day the row that replaced it would have.
        //
        // Pinned rows are excluded: a pin is the parent saying "this lesson
        // belongs on this day" and Invariant 12 is that the system never
        // re-dates a manual placement. They were already surviving the delete
        // before this change and they keep surviving it untouched.
        // ProjectedLesson.lesson_number IS the queue slot, not the lesson
        // number — see its doc comment. That is the column a kept row is
        // matched on, the same way the fresh inserts take their date from the
        // slot they land in.
        let rebuiltUpdated = 0;
        for (const r of beforeRows) {
          if (!workRowIds.has(r.id)) continue;
          if (r.queue_pinned) continue;
          if (r.queue_position == null) continue;
          const projDate = projDateBySlot.get(r.queue_position);
          if (!projDate) continue;
          const { error: redateErr } = await supabase
            .from("lessons")
            .update({ scheduled_date: projDate, date: projDate, scheduled_source: "wizard_create" })
            .eq("id", r.id);
          if (redateErr) throw redateErr;
          rebuiltUpdated += 1;
        }

        void logPlanEvent({
          userId: effectiveUserId,
          type: "schedule.rebuilt",
          payload: {
            goal_id: goalId,
            curriculum_name: row.name,
            inserted: toInsert.length + histToInsert.length,
            updated: rebuiltUpdated,
            // Rows the rebuild deliberately did not touch: completed history,
            // pins, and the notes/minutes rows it is no longer allowed to
            // delete.
            skipped: survivors.length,
          },
        });

        // Row-count invariant, part 2 of 2: a goal must never come out of a save
        // holding fewer lesson rows than it should.
        //
        // "Should" is total_lessons - start_at_lesson + 1, plus the completed
        // rows below start_at_lesson that every save keeps. It is deliberately
        // NOT `rows === total_lessons` (plenty of healthy goals hold fewer rows
        // than that, because the projector only writes from current_lesson
        // forward) and no longer plain never-shrink either: that version fired
        // for a family who moved start_at_lesson from 3 to 5, whose two
        // uncompleted rows in slots 3 and 4 were correctly removed. The helper
        // excuses a drop of exactly the change in expectation and reports
        // anything beyond it. See app/lib/lost-lesson-rows.ts.
        //
        // Detect and report only. By the time this runs the rows are already
        // gone, so throwing would show a frightening notice about something
        // this save cannot undo. Sentry is where it needs to land.
        const { data: afterRowsData, error: afterRowsErr } = await supabase
          .from("lessons")
          .select("lesson_number")
          .eq("curriculum_goal_id", goalId);
        if (!afterRowsErr && afterRowsData) {
          const afterRows = afterRowsData as { lesson_number: number | null }[];
          const beforeCount = beforeRows.length;
          const afterCount = afterRows.length;
          const totalBefore = row._originalSchedule?.total_lessons ?? row.total_lessons ?? 0;
          const totalAfter = row.total_lessons ?? 0;
          const startBefore = row.start_at_lesson_initial ?? row.start_at_lesson;
          const startAfter = clampStartAtLesson(row.start_at_lesson, totalAfter);
          const lost = lostLessonRows(
            {
              totalLessons: totalBefore,
              startAtLesson: startBefore,
              completedBelowStart: countCompletedBelowStart(beforeRows, startBefore),
              rows: beforeCount,
            },
            {
              totalLessons: totalAfter,
              startAtLesson: startAfter,
              // From the BEFORE snapshot on purpose. Completed history is kept
              // by every save (Invariant 3), so the rows that were completed
              // below the new start going in must all still be there coming
              // out. Counting them from the after snapshot would let a deleted
              // completed row lower the expectation along with the count.
              completedBelowStart: countCompletedBelowStart(beforeRows, startAfter),
              rows: afterCount,
            },
          );
          if (lost) {
            const afterNums = new Set(
              afterRows
                .map((r) => r.lesson_number)
                .filter((n): n is number => n !== null),
            );
            const missingLessonNumbers = beforeRows
              .map((r) => r.lesson_number)
              .filter((n): n is number => n !== null && !afterNums.has(n))
              .sort((a, b) => a - b);
            console.error("[handleSave] phase 2 lost lesson rows", {
              goalId,
              beforeCount,
              afterCount,
              expected: lost.expectedAfter,
              missingLessonNumbers,
            });
            captureSupabaseError(
              "Curriculum save phase 2 lost lesson rows",
              new Error(
                `Goal ${goalId} went from ${beforeCount} to ${afterCount} lesson rows, expected ${lost.expectedAfter} (start_at_lesson ${startBefore} to ${startAfter}, total_lessons ${totalBefore} to ${totalAfter})`,
              ),
              {
                tags: {
                  phase: "curriculum_save_phase2_invariant",
                  goal_id: goalId,
                },
                extra: {
                  beforeCount,
                  afterCount,
                  expected: lost.expectedAfter,
                  expectedBefore: lost.expectedBefore,
                  allowedDrop: lost.allowedDrop,
                  actualDrop: lost.actualDrop,
                  startBefore,
                  startAfter,
                  totalBefore,
                  totalAfter,
                  missingLessonNumbers,
                },
              },
            );
          }
        }

        // Post-INSERT overcapacity assertion. The May 20 audit surfaced
        // pre-existing goals where two disjoint lesson_number ranges
        // collided onto the same future scheduled_date (e.g. lessons
        // 94-95 AND 155-156 both on the same day) — a silent corruption
        // pattern the floor-anchored delete + lesson_number dedup is
        // supposed to prevent. This read-only check verifies no future
        // school day exceeds lessons_per_day for THIS goal after the
        // INSERT batch settled. On violation: throw so handleSave's
        // catch surfaces the error and the user can re-try, instead of
        // silently shipping the bad rows.
        const todayYmd = ymd(todayMid);
        const { data: overCheck, error: overCheckErr } = await supabase
          .from("lessons")
          .select("scheduled_date, queue_pinned")
          .eq("curriculum_goal_id", goalId)
          .eq("completed", false)
          .gte("scheduled_date", todayYmd);
        if (overCheckErr) throw overCheckErr;
        // Same rule as the pre-write assertion: the ceiling is for lessons the
        // SCHEDULER placed. Pinned rows are the family's own placements and are
        // skipped entirely — not just the projectable ones. A stale pin (slot
        // at or below current_lesson) is invisible to the projector, so the
        // projector legitimately puts a fresh lesson on that same date; if the
        // stale pinned row were counted here the day would read as doubly
        // booked and the save would end on "email hello@" for a schedule that
        // is in fact correct.
        const dateMap: Record<string, number> = {};
        for (const r of (overCheck ?? []) as {
          scheduled_date: string | null;
          queue_pinned: boolean | null;
        }[]) {
          if (!r.scheduled_date) continue;
          if (r.queue_pinned) continue;
          dateMap[r.scheduled_date] = (dateMap[r.scheduled_date] ?? 0) + 1;
        }
        // The per-day ceiling MUST honor lessons_per_day_overrides, which is
        // why both checks now read the one `perDayAllowed` closure. Pre-fix,
        // this compared every date against the flat lessons_per_day (the
        // override AVERAGE for uneven goals), so any goal with e.g. Mon=2/Tue=1
        // legitimately projected 2 Monday lessons, passed the pre-check,
        // INSERTed, then THREW here on every save attempt. The thrown error
        // killed the phase-2 loop, so every goal after it in the same save
        // silently got zero lessons (the July 2026 Lepior bug: all of one
        // child's new curricula dead because her first goal had uneven per-day
        // counts).
        const violated = Object.entries(dateMap).filter(
          ([dateStr, count]) => count > perDayAllowed(dateStr),
        );
        if (violated.length > 0) {
          console.error("[handleSave] Overcapacity after INSERT", violated);
          throw new ScheduleAssertionError(
            `Overcapacity detected on ${violated.length} date(s) after save. Lesson rows may need another save to resolve.`,
          );
        }
      };

      // One goal's Phase 2 failure must NOT abandon the other goals in the
      // same save. Pre-fix, the first throw here aborted the loop, so every
      // goal after the failing one silently got zero lessons (the July 2026
      // Lepior bug: one child's uneven-per-day goal failed the old post-
      // INSERT check and took her whole batch down with it, save after
      // save). Now each goal gets its own two attempts; failures are
      // captured per-goal and re-thrown ONCE at the end so handleSave's
      // catch still shows the soft "save again" notice.
      //
      // The retry only earns its keep against transient trouble. A unique
      // violation or a refused batch is deterministic, so those skip the second
      // attempt and go straight to the failure path (see
      // isDeterministicPhase2Failure).
      const phase2Failures: { goalId: string; err: unknown }[] = [];
      const runPhase2ForGoal = async ({ id: goalId, row }: { id: string; row: Row }) => {
        let lastErr: unknown = null;
        for (let attempt = 0; attempt < 2; attempt++) {
          try {
            await applyPhase2ForGoal(goalId, row);
            lastErr = null;
            break;
          } catch (err) {
            lastErr = err;
            if (isDeterministicPhase2Failure(err)) break;
            if (attempt === 0) {
              await new Promise((r) => setTimeout(r, 500));
            }
          }
        }
        if (lastErr) {
          // Phase 2 throws raw Supabase errors (`throw lessonErr` etc.), which
          // Sentry titled "Object captured as exception with keys: code,
          // details, hint, message". Wrap so the real message is the title.
          //
          // A refusal is not a fault: the family entered more progress than
          // the calendar holds and the save stopped before writing anything.
          // Worth counting (about 70 curricula are in that shape) but not
          // worth paging anyone, so it lands as a warning.
          const late = lastErr instanceof LateInvariant21Error;
          const refused = lastErr instanceof ScheduleRefusedError;
          captureSupabaseError(
            late
              ? "Invariant 21 fired in phase 2; the pre-flight should have caught it"
              : refused
                ? "Curriculum save phase 2 refused: stated progress does not fit"
                : "Curriculum save phase 2 failed",
            lastErr,
            {
              // A late firing is an error, not a warning: the goal row has
              // already committed and the two checks disagree.
              ...(refused && !late ? { level: "warning" as const } : {}),
              tags: {
                phase: late
                  ? "invariant_21_late"
                  : refused
                    ? "curriculum_save_phase2_refused"
                    : "curriculum_save_phase2",
                goal_id: goalId,
              },
            },
          );
          phase2Failures.push({ goalId, err: lastErr });
        }
            };
      // Every goal's phase 2 reads and writes only its own rows, so goals run
      // a few at a time instead of one after another. Four keeps the browser
      // under its per-host connection limit while the reads of one goal
      // overlap the writes of another. Failures are gathered as they land and
      // put back in builder order before one is chosen.
      const PHASE2_CONCURRENCY = 4;
      let nextGoal = 0;
      await Promise.all(
        Array.from({ length: Math.min(PHASE2_CONCURRENCY, savedCurriculumGoals.length) }, async () => {
          while (nextGoal < savedCurriculumGoals.length) {
            const item = savedCurriculumGoals[nextGoal++];
            await runPhase2ForGoal(item);
          }
        }),
      );
      if (phase2Failures.length > 0) {
        // Surface a DETERMINISTIC failure over a transient one when the save
        // hit both. Re-throwing phase2Failures[0] meant goal A failing on a
        // network blip decided the copy for the whole save, so a family whose
        // goal B hit a unique violation was told to "save again" for a
        // conflict that reproduces identically every time: a loop with no way
        // out. The transient goal still heals on that next save either way.
        // The pool finishes goals in whatever order they complete; put the
        // failures back in builder order so the fallback is the same goal on
        // every save.
        const goalOrder = new Map(savedCurriculumGoals.map((g, i) => [g.id, i]));
        phase2Failures.sort((a, b) => (goalOrder.get(a.goalId) ?? 0) - (goalOrder.get(b.goalId) ?? 0));
        // A refusal outranks everything: it is the only failure shape whose
        // message tells the family what to change, and it is the only one they
        // can clear themselves.
        const chosen =
          phase2Failures.find((f) => f.err instanceof ScheduleRefusedError) ??
          phase2Failures.find((f) => isDeterministicPhase2Failure(f.err)) ??
          phase2Failures[0];
        failedPhase2GoalId = chosen.goalId;
        throw chosen.err;
      }

      setDirty(false);
      setDraftNotice(null);
      // The schedule is on disk, so the local draft has nothing left to
      // protect. Leaving it would restore now-saved rows on the next visit
      // and show the "we saved your draft" notice for work already done.
      clearScheduleDraft(effectiveUserId);

      // ── "You're Rooted" ───────────────────────────────────────────────────
      // A successful save used to push straight to Plan with a banner: no
      // confirmation of what had just been set up and no next step, at the one
      // moment a family has finished the hardest screen in the app. Families
      // who capture a memory in their first session convert at 11% and
      // schedule-only families at 0%, so this screen exists to offer that.
      //
      // Only for a save that CREATED something. `landedNewGoals` is already
      // the list of rows that went in as inserts.
      if (landedNewGoals.length > 0) {
        const newLocalIds = new Set(landedNewGoals.map((l) => l.localId));
        const createdRows = rows.filter((r) => newLocalIds.has(r.localId));
        const childNames = children
          .filter((c) => createdRows.some((r) => r.child_id === c.id))
          .map((c) => c.name);
        const subjects: string[] = [];
        for (const r of createdRows) {
          const label = r.subject.trim() || r.name.trim();
          if (label && !subjects.some((x) => x.toLowerCase() === label.toLowerCase())) {
            subjects.push(label);
          }
        }
        // The earliest forward-scheduled lesson across everything just saved.
        const firstDates = createdRows
          .map((r) => rowScheduleFor(r, today, todayStr, vacations)?.nextLessonDate)
          .filter((d): d is string => !!d)
          .sort();
        setCelebration({
          childNames,
          subjects,
          firstLessonDate: firstDates[0] ?? null,
          curriculaCount: createdRows.length,
        });
        return;
      }
      // `?saved=1` tells the Plan page to force one fresh data load on arrival.
      // The schedule + lessons are committed above (awaited), but the Plan
      // page's first load on this soft navigation could render before the
      // just-written lessons landed in component state — staging showed the
      // week view with day rows but zero lessons until any re-render. PlanV2
      // consumes the flag, calls reload(), and strips it from the URL.
      router.push("/dashboard/plan?saved=1");
    } catch (err) {
      const raw = err as { message?: string; code?: string };
      const msg = raw?.message ?? String(err);
      if (phase === "write") {
        // Schema writes never committed. True save failure. Postgres
        // unique-violation (23505) from the curriculum_goals partial
        // unique index gets translated so the user sees the same
        // "already exists" copy as the pre-check. The index can only
        // trip after the pre-check passes if a concurrent tab wrote
        // the matching row in between (the rare race the index exists
        // to close); we can't easily recover the row context here, so
        // the message stays generic.
        if (raw?.code === "23505") {
          setSaveError(
            "One of these goals already exists for this child with the same name and subject. Reload the page and edit the existing goal, or change the subject on this row.",
          );
        } else {
          setSaveError(msg);
        }
      } else {
        // curriculum_goals + activities did commit. Lesson regen / recompute /
        // overcapacity assertion threw. Don't alarm the user with "Save failed"
        // when the thing they edited is on disk. Log the raw error for debug,
        // surface the soft notice, and clear dirty so the saved schema isn't
        // treated as pending changes.
        //
        // "Save again to sync" is only true for a transient failure. On a
        // deterministic one the next save reproduces the same error exactly, so
        // that copy sends the family round a loop she cannot get out of. Name
        // the goal in the warning so support can line it up with the Sentry
        // event captured above.
        const deterministic = isDeterministicPhase2Failure(err);
        console.warn("[handleSave] post-save phase failed:", msg, {
          goal_id: failedPhase2GoalId,
          deterministic,
        });
        // Neither line opens with success wording. The old transient copy led
        // with "Curriculum changes saved", which reads as "you are done" to
        // anyone skimming, and the thing that did NOT happen is the whole
        // point of the message.
        // A refusal already says what is wrong and what to change, in the
        // family's own numbers. The support copy below would bury that under
        // "we've been notified" for a problem nobody but they can fix.
        setPostSaveNotice(
          err instanceof ScheduleRefusedError
            ? `${err.message} Your other settings were saved. The lessons for this curriculum were not created.`
            : deterministic
              ? "Your curriculum settings were saved, but the lessons hit a conflict and did not generate. We've been notified. Email hello@rootedhomeschoolapp.com and we'll fix it for you."
              : "Your curriculum settings were saved, but the lessons themselves did not generate. Tap Save again to finish. Nothing you entered was lost.",
        );
        // A refusal is the one deterministic failure with something to do
        // about it, so it keeps the draft and the leave-guard: the family
        // lowers the count or moves the start date and saves again, on the
        // same rows they are looking at. Every other deterministic failure
        // reproduces identically no matter what they change, so there is
        // nothing to trap them here for.
        if (deterministic && !(err instanceof ScheduleRefusedError)) {
          setDirty(false);
          setDraftNotice(null);
          clearScheduleDraft(effectiveUserId);
        }
        // Transient: dirty deliberately stays TRUE and the draft is kept. The
        // lessons are still missing, so the schedule is not fully saved, and a
        // second Save is the fix. Leaving dirty set means
        // confirmDiscardAndNavigate and the anchor-capture guard both fire if
        // they try to walk away, which is the one moment worth catching them.
      }
    } finally {
      setSaving(false);
      // 1.5s settle window: prevents a back-to-back re-tap (e.g. impatient
      // user clicking twice while the post-save router transition is in
      // flight) from firing handleSave again before the page unmounts.
      setSettling(true);
      setTimeout(() => {
        saveGate.exit();
        setSettling(false);
      }, 1500);
    }
  }

  // ── Navigation guard ─────────────────────────────────────────────────────
  function confirmDiscardAndNavigate(href: string) {
    if (dirty) {
      const ok = window.confirm(DISCARD_PROMPT);
      if (!ok) return;
      // Discarding is an explicit choice, so the saved draft goes too.
      // Leaving it behind would restore the same changes on the next visit
      // and read as the page ignoring them.
      if (effectiveUserId) clearScheduleDraft(effectiveUserId);
    }
    router.push(href);
  }

  // Drop the restored draft and go back to what is actually saved in the
  // database. Paired with the restore notice so a family who didn't want
  // the draft has a one-tap way out that isn't "undo it all by hand".
  function discardRestoredDraft() {
    if (!window.confirm("Go back to your saved schedule and discard the draft?")) return;
    if (effectiveUserId) clearScheduleDraft(effectiveUserId);
    setRows(dbRowsRef.current);
    setDirty(false);
    setDraftNotice(null);
  }

  // ── Immediate row actions (recalibrate + mark finished) ─────────────────
  // Both bypass the pending-delete Save flow because they're destructive
  // edits the user expects to apply right now: "I'm actually on lesson X"
  // re-anchors the queue + backfills gap dates, and "Mark as finished"
  // archives the goal so it drops off Today + Plan. Local row state syncs
  // afterward so the page reflects the new DB truth without a reload.
  async function handleRowRecalibrate(localId: string, newCurrentLesson: number) {
    setRowActionError(null);
    try {
      if (!effectiveUserId) throw new Error("Not signed in");
      const row = rows.find((r) => r.localId === localId);
      if (!row || !row.dbId) throw new Error("Row not yet saved");
      // The schedule page doesn't keep vacation_blocks in state — fetch them
      // here for the projector resync. Save flow does the same.
      const { data: vacationData, error: vacationErr } = await supabase
        .from("vacation_blocks")
        .select("start_date, end_date")
        .eq("user_id", effectiveUserId);
      if (vacationErr) throw vacationErr;
      const vacations = (vacationData ?? []) as SchedVacationBlock[];
      const result = await recalibrateCurriculumGoal({
        supabase,
        goalId: row.dbId,
        newCurrentLesson,
        vacationBlocks: vacations,
      });
      void logPlanEvent({
        userId: effectiveUserId,
        type: "curriculum_goal.updated",
        payload: {
          goal_id: row.dbId,
          curriculum_name: row.name,
          action: "recalibrate",
          new_current_lesson: result.clamped,
          gap_count: result.gapCount,
        },
      });
      // Sync local row to match the DB truth without marking dirty — the
      // edit already landed in Supabase. Reset progress_confirmed so the
      // stepper re-prompts on the next manual divergence.
      setRows((prev) =>
        prev.map((r) =>
          r.localId === localId
            ? {
                ...r,
                start_at_lesson: result.clamped,
                start_at_lesson_initial: result.clamped,
                progress_confirmed: false,
              }
            : r,
        ),
      );
      setRecalibratingLocalId((id) => (id === localId ? null : id));
    } catch (err) {
      const msg = (err as { message?: string })?.message ?? "Couldn't recalibrate.";
      setRowActionError(msg);
    }
  }

  /**
   * Fill a blank row from another child's curriculum.
   *
   * Everything about WHAT is being studied copies: subject, publisher, days,
   * per-day counts, total lessons, minutes. Nothing about WHERE THIS CHILD IS
   * copies, because two children are rarely on the same lesson and a silently
   * inherited starting position is exactly the wrong thing to guess.
   */
  function copyRowSetup(targetLocalId: string, sourceLocalId: string) {
    const source = rows.find((r) => r.localId === sourceLocalId);
    if (!source) return;
    setRows((prev) =>
      prev.map((r) =>
        r.localId === targetLocalId
          ? {
              ...r,
              type: "curriculum" as const,
              subject: source.subject,
              name: source.name,
              active_days: source.active_days.slice(),
              per_day_counts: source.per_day_counts.slice(),
              total_lessons: source.total_lessons,
              minutes_per_lesson: source.minutes_per_lesson,
              // "Where are you with this?" resets to the question.
              start_at_lesson: 1,
              start_date: null,
              start_date_is_manual: false,
            }
          : r,
      ),
    );
    setDirty(true);
  }

  async function handleRowMarkFinished(localId: string) {
    if (!effectiveUserId) return;
    const row = rows.find((r) => r.localId === localId);
    if (!row || !row.dbId) return;
    const ok = window.confirm(
      `Mark ${row.name || "this curriculum"} as finished? It won't appear on Today or Plan anymore, but your lesson history is saved.`,
    );
    if (!ok) return;
    setRowActionError(null);
    try {
      const { error } = await supabase
        .from("curriculum_goals")
        .update({ archived: true })
        .eq("id", row.dbId);
      if (error) throw error;
    } catch (err) {
      const msg = (err as { message?: string })?.message ?? "Couldn't mark as finished.";
      setRowActionError(msg);
      return;
    }
    void logPlanEvent({
      userId: effectiveUserId,
      type: "curriculum_goal.updated",
      payload: {
        goal_id: row.dbId,
        curriculum_name: row.name,
        action: "marked_finished",
      },
    });
    // Drop the row locally so the panel re-renders without it, and remove
    // the dbId from originalCurriculumIds so the reconciliation sweep on
    // Save doesn't try to archive an already-archived row.
    const archivedDbId = row.dbId;
    setRows((prev) => prev.filter((r) => r.localId !== localId));
    setOriginalCurriculumIds((prev) => {
      if (!prev.has(archivedDbId)) return prev;
      const next = new Set(prev);
      next.delete(archivedDbId);
      return next;
    });
    setMenuOpenLocalId((id) => (id === localId ? null : id));
    setRecalibratingLocalId((id) => (id === localId ? null : id));
  }

  // ── Render ───────────────────────────────────────────────────────────────
  if (celebration) {
    return (
      <SetupCelebration
        childNames={celebration.childNames}
        subjects={celebration.subjects}
        firstLessonDate={celebration.firstLessonDate}
        curriculaCount={celebration.curriculaCount}
        onNavigate={(href, choice) => {
          posthog.capture("curriculum_setup_next_step", { choice });
          router.push(href);
        }}
      />
    );
  }

  if (loading) {
    return (
      <>
        <PageHero overline="Your Curriculum" title="Your Schedule" subtitle="One place to plan it all." />
        <div className="px-4 pt-5 pb-7 max-w-5xl mx-auto" style={{ background: "#F8F7F4" }}>
          <p className="text-sm text-[#7a6f65]">Loading...</p>
        </div>
      </>
    );
  }

  if (loadError) {
    return (
      <>
        <PageHero overline="Your Curriculum" title="Your Schedule" subtitle="One place to plan it all." />
        <div className="px-4 pt-5 pb-7 max-w-5xl mx-auto" style={{ background: "#F8F7F4" }}>
          <div className="bg-white border border-[#e8e2d9] rounded-2xl p-4">
            <p className="text-sm text-[#2d2926] font-medium mb-1">Couldn&apos;t load your schedule.</p>
            <p className="text-xs text-[#7a6f65]">{loadError}</p>
          </div>
        </div>
      </>
    );
  }

  return (
    <>
      <PageHero overline="Your Curriculum" title="Your Schedule" subtitle="One place to plan it all." />
      <div className="px-4 pt-5 pb-32 max-w-5xl mx-auto" style={{ background: "#F8F7F4" }}>
        {draftNotice && (
          <div
            role="status"
            className="mb-4 bg-[#fefcf9] border border-[#e8e2d9] rounded-2xl p-4"
          >
            <p className="text-sm text-[#2d2926]">
              We saved your draft. Here&apos;s where you left off
              {formatDraftSavedAt(draftNotice.savedAt)
                ? ` on ${formatDraftSavedAt(draftNotice.savedAt)}`
                : ""}
              . Nothing is scheduled until you tap Save &amp; build schedule.
            </p>
            {draftNotice.dropped > 0 && (
              <p className="text-xs text-[#7a6f65] mt-1.5">
                {draftNotice.dropped === 1
                  ? "One row from your draft was left out because that curriculum or child is no longer active."
                  : `${draftNotice.dropped} rows from your draft were left out because those curricula or children are no longer active.`}
              </p>
            )}
            <div className="flex items-center gap-4 mt-3">
              <button
                onClick={() => setDraftNotice(null)}
                className="text-sm font-medium text-[#2d5a3d] underline-offset-2 hover:underline"
              >
                Keep my draft
              </button>
              <button
                onClick={discardRestoredDraft}
                className="text-sm text-[#7a6f65] underline-offset-2 hover:underline"
              >
                Use my saved schedule instead
              </button>
            </div>
          </div>
        )}

        {/* Both failure surfaces render HERE, at the top of the builder, so
            they are in one place and above the fold. They used to sit at the
            bottom of the page flow, BELOW the fixed bottom bar, which is how a
            goal could come out of a save with zero lessons and nothing the
            family would ever see. */}
        {saveError && (
          <div
            ref={saveErrorRef}
            role="alert"
            aria-live="assertive"
            className="mb-4 bg-white border border-[#e8c8c8] rounded-2xl p-3 scroll-mt-24"
          >
            <p className="text-sm text-[#9a3a3a]">Save failed: {saveError}</p>
          </div>
        )}

        {postSaveNotice && (
          <div
            ref={postSaveNoticeRef}
            role="alert"
            aria-live="assertive"
            className="mb-4 bg-[#fefcf9] border border-[#e8d9a8] rounded-2xl p-3 scroll-mt-24"
          >
            <p className="text-sm text-[#2d2926]">{postSaveNotice}</p>
          </div>
        )}

        {view === "builder" && (
          <BuilderView
            vacations={vacations}
            schedByLocalId={schedByLocalId}
            subjectSuggestions={subjectSuggestions}
            curriculumSuggestions={curriculumSuggestions}
            keepBothLocalIds={keepBothLocalIds}
            childNameById={(id) => children.find((c) => c.id === id)?.name ?? "Another child"}
            onCopyFrom={copyRowSetup}
            onMarkRowFinished={handleRowMarkFinished}
            onKeepBoth={(localId) =>
              setKeepBothLocalIds((prev) => {
                if (prev.has(localId)) return prev;
                const next = new Set(prev);
                next.add(localId);
                return next;
              })
            }
            children={children}
            rows={rows}
            today={today}
            todayStr={todayStr}
            onPatchRow={patchRow}
            onAddRow={addRow}
            onDeleteRow={deleteRow}
            onCycleType={cycleType}
            onToggleDay={toggleDay}
            onCycleCount={cycleCount}
            weeklyHoursFor={weeklyHoursFor}
            newChildName={newChildName}
            setNewChildName={(v) => { setNewChildName(v); }}
            newChildColor={newChildColor}
            setNewChildColor={setNewChildColor}
            addingChild={addingChild}
            onAddChild={handleAddChild}
            highlightedGoalId={highlightedGoalId}
            nudgedLocalId={nudgedLocalId}
            refusedLocalIds={refusedLocalIds}
            menuOpenLocalId={menuOpenLocalId}
            setMenuOpenLocalId={setMenuOpenLocalId}
            recalibratingLocalId={recalibratingLocalId}
            setRecalibratingLocalId={setRecalibratingLocalId}
            onRecalibrateRow={handleRowRecalibrate}
            onMarkFinishedRow={handleRowMarkFinished}
            rowActionError={rowActionError}
            onDismissRowActionError={() => setRowActionError(null)}
          />
        )}

        {view === "preview" && (
          <PreviewView
            childrenList={children}
            rows={rows}
            today={today}
            todayStr={todayStr}
            vacations={vacations}
            schedByLocalId={schedByLocalId}
            onBackToEdit={() => setView("builder")}
            onFixRow={(localId) => {
              // "Not right?" goes back to the row itself, ringed and with the
              // cursor in it. Both pieces of that already exist for the deep
              // link from the Plan panel and the blocked-preview nudge.
              setView("builder");
              setNudgedLocalId(localId);
              revealRow(localId, { focus: true });
            }}
          />
        )}

      </div>

      {/* Sticky bottom bar.
          pr-20 keeps the right-side button clear of the global floating
          camera FAB (rendered fixed at bottom-right elsewhere in the
          dashboard). Without it the FAB sits directly on top of the
          Save / Preview button on mobile. */}
      <div className="fixed bottom-[3.75rem] md:bottom-0 inset-x-0 border-t border-[#e8e2d9] bg-white px-4 pr-20 py-3 z-50 pb-[env(safe-area-inset-bottom,0px)]">
        <div className="max-w-5xl mx-auto">
          {/* One node, two treatments, so aria-describedby always resolves and
              the reason is never on screen twice. Swapping the element type is
              deliberate: React remounts it, and role="alert" only announces on
              a node that has just entered the document. */}
          {view === "builder" && previewBlockedReason && (
            previewNudge ? (
              <div
                id="preview-blocked-reason"
                role="alert"
                className="mb-2 rounded-xl bg-[#2d2926] text-white text-[13px] leading-snug px-3.5 py-2.5 shadow-lg"
              >
                {previewBlockedReason}
              </div>
            ) : (
              <p
                id="preview-blocked-reason"
                className="mb-2 text-xs text-[#7a6f65] leading-snug sm:text-right"
              >
                {previewBlockedReason}
              </p>
            )
          )}
          <div className="flex items-center gap-2">
            {view === "builder" && (
              <>
                <button
                  onClick={() => confirmDiscardAndNavigate("/dashboard/plan")}
                  className="text-sm text-[#7a6f65] hover:text-[#2d2926] underline-offset-2 hover:underline"
                >
                  Cancel
                </button>
                {dirty && <UnsavedIndicator />}
                <div className="flex-1" />
                <span
                  onClick={handleBlockedPreviewTap}
                  className="inline-flex"
                  style={{ touchAction: "manipulation" }}
                >
                  <button
                    onClick={() => setView("preview")}
                    disabled={!allValid || !anyEditableRow}
                    aria-describedby={previewBlockedReason ? "preview-blocked-reason" : undefined}
                    className="px-5 py-2.5 rounded-xl text-white text-sm font-medium disabled:opacity-40 disabled:pointer-events-none"
                    style={{ background: "var(--g-brand)", touchAction: "manipulation" }}
                  >
                    Preview schedule →
                  </button>
                </span>
              </>
            )}
            {view === "preview" && (
              <>
                <button
                  onClick={() => setView("builder")}
                  className="text-sm text-[#7a6f65] hover:text-[#2d2926] underline-offset-2 hover:underline"
                >
                  ← Back to edit
                </button>
                {dirty && <UnsavedIndicator />}
                <div className="flex-1" />
                <button
                  onClick={handleSave}
                  disabled={saving || settling}
                  className="px-5 py-2.5 rounded-xl text-white text-sm font-medium disabled:opacity-40"
                  style={{ background: "var(--g-brand)" }}
                >
                  {saving || settling ? "Saving..." : "Save & build schedule"}
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </>
  );
}

// ─── Unsaved indicator ─────────────────────────────────────────────────────

// Sits in the sticky footer, which is the one piece of chrome visible from
// anywhere in the builder. Nothing on this page is written to the database
// until Save & build schedule, and families had no way to tell: the rows
// look identical whether they're saved or not. The draft autosave means
// the work is safe either way, so the wording promises "kept on this
// device", not "saved", which would be a lie about the schedule itself.
/**
 * The screen a family lands on when their year is planned.
 *
 * It replaces `router.push("/dashboard/plan?saved=1")`, which dropped them on
 * the Plan page with a banner: no confirmation of what they had just set up and
 * no next step, at the end of the hardest screen in the app.
 *
 * The three actions are deliberately ordered. Families who capture a memory in
 * their first session convert at 11%; schedule-only families convert at 0%. So
 * the photo is the primary button and stays the primary button.
 */
function SetupCelebration(props: {
  childNames: string[];
  subjects: string[];
  firstLessonDate: string | null;
  curriculaCount: number;
  onNavigate: (href: string, choice: string) => void;
}) {
  useEffect(() => {
    posthog.capture("curriculum_setup_celebrated", {
      children: props.childNames.length,
      curricula: props.curriculaCount,
      first_lesson_date: props.firstLessonDate,
    });
    // Fires once for the screen, not once per render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const names = joinNames(props.childNames);
  const whose = possessive(names) || "Your family's";
  const subjectList = joinNames(props.subjects);
  const when = props.firstLessonDate ? formatWeekdayLong(props.firstLessonDate) : null;

  return (
    <RootedCelebration heading="You're Rooted.">
      <p className="text-[17px] leading-relaxed mb-8" style={{ color: "rgba(255,255,255,0.8)" }}>
        {whose} year is planned.
        {subjectList ? ` ${subjectList}` : ""}
        {when ? `, starting ${when}.` : "."}
      </p>

      <p className="text-[15px] leading-relaxed mb-10" style={{ color: "rgba(255,255,255,0.6)" }}>
        {gardenLine(props.childNames.length, GARDEN_PER_YEAR)} Every lesson they finish, every photo
        you snap, every book you read together is a leaf. By spring you&apos;ll look back and see the
        whole tree.
      </p>

      <p
        className="text-[13px] tracking-[2px] uppercase mb-4"
        style={{ color: "rgba(255,255,255,0.45)" }}
      >
        Here&apos;s what to do with today
      </p>

      <button
        onClick={() => props.onNavigate("/dashboard?capture=1", "photo")}
        className="w-full bg-white text-[#2D5A3D] font-semibold rounded-2xl text-[17px] py-[18px] px-8 shadow-lg transition-all hover:opacity-90 active:scale-[0.98]"
      >
        Snap a first-day photo
      </button>

      <button
        onClick={() => props.onNavigate("/dashboard/garden", "garden")}
        className="mt-3 w-full rounded-2xl border border-white/25 text-white text-[15px] py-[14px] px-8 transition-colors hover:bg-white/10"
      >
        See their seeds in the Garden
      </button>

      <button
        onClick={() => props.onNavigate("/dashboard/resources", "resources")}
        className="mt-3 w-full rounded-2xl border border-white/25 text-white text-[15px] py-[14px] px-8 transition-colors hover:bg-white/10"
      >
        Browse this week&apos;s Resources
      </button>

      <button
        onClick={() => props.onNavigate("/dashboard", "today")}
        className="mt-6 text-[15px] text-white/55 hover:text-white/80 transition-colors"
      >
        or Go to Today
      </button>
    </RootedCelebration>
  );
}

function UnsavedIndicator() {
  return (
    <span
      className="text-xs text-[#7a6f65] flex items-center gap-1.5 whitespace-nowrap"
      title="Your changes are stored on this device until you save"
    >
      <span
        aria-hidden="true"
        className="inline-block w-1.5 h-1.5 rounded-full"
        style={{ background: "#c4956a" }}
      />
      Unsaved changes
    </span>
  );
}

// ─── Builder view ──────────────────────────────────────────────────────────

function BuilderView(props: {
  vacations: SchedVacationBlock[];
  schedByLocalId: Map<string, RowSchedule>;
  subjectSuggestions: string[];
  curriculumSuggestions: string[];
  keepBothLocalIds: Set<string>;
  childNameById: (id: string) => string;
  onMarkRowFinished: (localId: string) => Promise<void>;
  onKeepBoth: (localId: string) => void;
  onCopyFrom: (targetLocalId: string, sourceLocalId: string) => void;
  children: Child[];
  rows: Row[];
  today: Date;
  todayStr: string;
  onPatchRow: (localId: string, patch: Partial<Row>) => void;
  onAddRow: (child_id: string, type: RowType) => void;
  onDeleteRow: (localId: string) => void;
  onCycleType: (localId: string) => void;
  onToggleDay: (localId: string, dayIdx: number) => void;
  onCycleCount: (localId: string, dayIdx: number) => void;
  weeklyHoursFor: (child_id: string) => number;
  newChildName: string;
  setNewChildName: (v: string) => void;
  newChildColor: string;
  setNewChildColor: (v: string) => void;
  addingChild: boolean;
  onAddChild: () => void | Promise<void>;
  highlightedGoalId: string | null;
  nudgedLocalId: string | null;
  refusedLocalIds: Set<string>;
  menuOpenLocalId: string | null;
  setMenuOpenLocalId: (id: string | null) => void;
  recalibratingLocalId: string | null;
  setRecalibratingLocalId: (id: string | null) => void;
  onRecalibrateRow: (localId: string, newCurrentLesson: number) => Promise<void>;
  onMarkFinishedRow: (localId: string) => Promise<void>;
  rowActionError: string | null;
  onDismissRowActionError: () => void;
}) {
  const visibleRows = (childId: string) =>
    props.rows.filter((r) => r.child_id === childId && !r.pendingDelete);

  return (
    // touch-manipulation on the whole builder: it drops the ~300ms
    // double-tap-zoom wait Safari otherwise puts in front of every tap in
    // here. On a page whose complaint is that taps do nothing, a third of a
    // second of nothing before every response is the wrong default.
    <div className="space-y-5 touch-manipulation">
      {props.rowActionError && (
        <div className="bg-white border border-[#e8c8c8] rounded-2xl px-3 py-2 flex items-start gap-2">
          <p className="flex-1 text-sm text-[#9a3a3a]">{props.rowActionError}</p>
          <button
            type="button"
            onClick={props.onDismissRowActionError}
            className="text-xs text-[#9a3a3a] underline underline-offset-2"
          >
            Dismiss
          </button>
        </div>
      )}

      {props.children.length === 0 && (
        <div className="bg-white border border-[#e8e2d9] rounded-2xl p-5 text-center">
          <p className="text-sm text-[#7a6f65]">
            Add your first child below to start building a schedule.
          </p>
        </div>
      )}

      {props.children.map((child) => {
        const childRows = visibleRows(child.id);
        const hours = props.weeklyHoursFor(child.id);
        return (
          <div
            key={child.id}
            className="bg-white rounded-2xl border border-[#e8e2d9] overflow-hidden"
            style={{ borderLeft: `4px solid ${child.color ?? "var(--g-accent)"}` }}
          >
            <div className="px-4 py-3 flex items-baseline justify-between">
              <h3 className="text-base font-medium text-[#2d2926]">{child.name}</h3>
              <span className="text-xs text-[#7a6f65]">
                {hours > 0 ? `~${hours.toFixed(1)} hrs/week` : "0 hrs/week"}
              </span>
            </div>

            <div className="border-t border-[#f0ede8]">
              {childRows.length === 0 && (
                <div className="px-4 py-5 text-center text-xs text-[#b5aca4]">
                  No curriculum or activities yet for {child.name}.
                </div>
              )}
              {childRows.map((row) => (
                <RowCard
                  key={row.localId}
                  row={row}
                  today={props.today}
                  todayStr={props.todayStr}
                  vacations={props.vacations}
                  sched={props.schedByLocalId.get(row.localId) ?? null}
                  subjectSuggestions={props.subjectSuggestions}
                  curriculumSuggestions={props.curriculumSuggestions}
                  replacedRow={
                    props.keepBothLocalIds.has(row.localId)
                      ? null
                      : findReplacedRow(row, props.rows)
                  }
                  replacedChildName={child.name}
                  onMarkReplacedFinished={async () => {
                    const target = findReplacedRow(row, props.rows);
                    if (target) await props.onMarkRowFinished(target.localId);
                  }}
                  onKeepBoth={() => props.onKeepBoth(row.localId)}
                  copyableRows={
                    // Only a row the family has not started filling in: once
                    // they have typed a subject the offer is noise.
                    row.type === "curriculum" && !row.dbId && row.subject.trim() === "" && row.name.trim() === ""
                      ? props.rows.filter(
                          (r) =>
                            r.type === "curriculum" &&
                            !r.pendingDelete &&
                            r.child_id !== row.child_id &&
                            (r.subject.trim() !== "" || r.name.trim() !== ""),
                        )
                      : []
                  }
                  childNameById={props.childNameById}
                  onCopyFrom={(sourceLocalId) => props.onCopyFrom(row.localId, sourceLocalId)}
                  onPatchRow={props.onPatchRow}
                  onDeleteRow={props.onDeleteRow}
                  onCycleType={props.onCycleType}
                  onToggleDay={props.onToggleDay}
                  onCycleCount={props.onCycleCount}
                  isHighlighted={
                    (!!props.highlightedGoalId &&
                      row.dbId === props.highlightedGoalId) ||
                    row.localId === props.nudgedLocalId ||
                    props.refusedLocalIds.has(row.localId)
                  }
                  menuOpen={props.menuOpenLocalId === row.localId}
                  onMenuOpenChange={(open) =>
                    props.setMenuOpenLocalId(open ? row.localId : null)
                  }
                  recalibrating={props.recalibratingLocalId === row.localId}
                  onOpenRecalibrate={() => props.setRecalibratingLocalId(row.localId)}
                  onCloseRecalibrate={() => props.setRecalibratingLocalId(null)}
                  onRecalibrate={(newValue) => props.onRecalibrateRow(row.localId, newValue)}
                  onMarkFinished={() => props.onMarkFinishedRow(row.localId)}
                />
              ))}
            </div>

            <div className="px-3 py-3 flex flex-wrap gap-2 border-t border-[#f0ede8] bg-[#fbfaf7]">
              <button
                onClick={() => props.onAddRow(child.id, "curriculum")}
                className="text-xs font-medium px-3 py-1.5 rounded-full border border-[#dbe5dc] text-[#2D5A3D] hover:bg-[#eef5ee]"
              >
                + Add curriculum
              </button>
              <button
                onClick={() => props.onAddRow(child.id, "coop")}
                className="text-xs font-medium px-3 py-1.5 rounded-full border border-[#dbe5dc] text-[#2D5A3D] hover:bg-[#eef5ee]"
              >
                + Add co-op or activity
              </button>
            </div>
          </div>
        );
      })}

      {/* Add a child */}
      <div className="bg-white rounded-2xl border border-[#e8e2d9] p-4">
        <p className="text-xs font-medium uppercase tracking-wide text-[#7a6f65] mb-2">
          Add a child
        </p>
        <div className="flex flex-col sm:flex-row gap-2 sm:items-center">
          <input
            type="text"
            value={props.newChildName}
            onChange={(e) => props.setNewChildName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && props.newChildName.trim() && !props.addingChild) {
                e.preventDefault();
                props.onAddChild();
              }
            }}
            placeholder="Child's name"
            style={{ textTransform: "capitalize" }}
            className="flex-1 px-3 py-2 rounded-xl border border-[#e8e2d9] bg-white text-sm placeholder-[#c8bfb5] focus:outline-none focus:border-[#5c7f63]"
          />
          <div className="flex items-center gap-2">
            {CHILD_COLORS.map((c) => (
              <button
                key={c}
                aria-label={`Color ${c}`}
                onClick={() => props.setNewChildColor(c)}
                className="w-7 h-7 rounded border-2 transition-all"
                style={{
                  backgroundColor: c,
                  borderColor: props.newChildColor === c ? "#2d2926" : "transparent",
                }}
              />
            ))}
          </div>
          <button
            onClick={() => props.onAddChild()}
            disabled={!props.newChildName.trim() || props.addingChild}
            className="px-4 py-2 rounded-xl text-white text-sm font-medium disabled:opacity-40"
            style={{ background: "var(--g-accent)" }}
          >
            {props.addingChild ? "Adding..." : "Add child"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Row card ──────────────────────────────────────────────────────────────

function RowCard(props: {
  row: Row;
  today: Date;
  todayStr: string;
  vacations: SchedVacationBlock[];
  /** Computed once per change in the page, not per row render. */
  sched: RowSchedule | null;
  subjectSuggestions: string[];
  curriculumSuggestions: string[];
  /** The active curriculum this new row looks like a replacement for. */
  replacedRow: Row | null;
  replacedChildName: string;
  onMarkReplacedFinished: () => Promise<void>;
  onKeepBoth: () => void;
  /** Other children's curricula this blank row could be filled from. */
  copyableRows: Row[];
  childNameById: (id: string) => string;
  onCopyFrom: (sourceLocalId: string) => void;
  onPatchRow: (localId: string, patch: Partial<Row>) => void;
  onDeleteRow: (localId: string) => void;
  onCycleType: (localId: string) => void;
  onToggleDay: (localId: string, dayIdx: number) => void;
  onCycleCount: (localId: string, dayIdx: number) => void;
  isHighlighted: boolean;
  /** Kebab menu state — only meaningful for saved curriculum rows. */
  menuOpen: boolean;
  onMenuOpenChange: (open: boolean) => void;
  recalibrating: boolean;
  onOpenRecalibrate: () => void;
  onCloseRecalibrate: () => void;
  onRecalibrate: (newCurrentLesson: number) => Promise<void>;
  onMarkFinished: () => Promise<void>;
}) {
  const { row } = props;
  const pace = calcPace(row, props.today);
  const isPending = row.type === "curriculum" && isFutureDate(row.start_date, props.today);
  const isCurriculum = row.type === "curriculum";
  const isReadOnly = row.readOnly;

  const typeLabel = row.type === "curriculum" ? "Curriculum" : row.type === "coop" ? "Co-op" : "Activity";

  // Guarded setter for start_at_lesson. When the row was pre-filled from a
  // live current_lesson value, the first user-driven divergence from that
  // seed prompts a confirm — diverging means the queue's "I've already done
  // N lessons" count is about to be rewritten. Subsequent edits in the same
  // session skip the prompt (progress_confirmed flips true on yes).
  // `extra` is optional rather than defaulted in the signature: a `= {}` there
  // puts a brace before the body that the source-level tests' brace scanner
  // reads as the function body.
  function applyStartAtLesson(rawValue: number, extraPatch?: Partial<Row>): boolean {
    const extra: Partial<Row> = extraPatch ?? {};
    // Clamped against total_lessons, not just against 1. The field carried
    // min={1} and no max, so "start at 80" on a 1-lesson curriculum was
    // accepted and generated no lessons at all.
    //
    // But NOT clamped when total_lessons is still blank. clampStartAtLesson
    // returns 1 for an unknown total, which silently forced every answer back
    // to 1 and made "Already into it" unreachable until the family had filled
    // in a field further up the card, with nothing on screen saying so.
    const clamped =
      row.total_lessons && row.total_lessons > 0
        ? clampStartAtLesson(rawValue, row.total_lessons)
        : Math.max(1, Math.floor(Number.isFinite(rawValue) ? rawValue : 1));
    if (clamped === row.start_at_lesson && Object.keys(extra).length === 0) return false;
    const hasSeed = row.start_at_lesson_initial !== null;
    const needsConfirm =
      hasSeed &&
      !row.progress_confirmed &&
      clamped !== row.start_at_lesson_initial &&
      clamped !== row.start_at_lesson;
    if (needsConfirm) {
      const ok = window.confirm(
        "Changing this will reset your progress tracking, are you sure?",
      );
      // Nothing is written on a decline, including the caller's own patch.
      if (!ok) return false;
      props.onPatchRow(row.localId, {
        start_at_lesson: clamped,
        progress_confirmed: true,
        ...extra,
      });
      return true;
    }
    props.onPatchRow(row.localId, { start_at_lesson: clamped, ...extra });
    return true;
  }

  function changeStartAtLesson(rawValue: number) {
    applyStartAtLesson(rawValue);
  }

  // ── "Where are you with this?" ───────────────────────────────────────────
  // One computation feeds the radio state, both sentences, the derived start
  // date and the inline overflow message, so none of them can disagree.
  const sched = props.sched;

  const alreadySentence =
    sched && sched.branch === "already"
      ? nextLessonSentence({
          history: sched.history,
          nextLesson: sched.nextLesson,
          nextLessonDate: sched.nextLessonDate,
          todayYmd: props.todayStr,
        })
      : "";

  const freshSentence =
    sched && sched.branch === "fresh"
      ? startingFreshSentence({
          firstLessonDate: sched.nextLessonDate,
          totalLessons: row.total_lessons,
          lessonsPerWeek: lessonsPerWeek(row),
          finishLabel: sched.finishLabel,
          todayYmd: props.todayStr,
        })
      : "";

  /**
   * Switching branches rewrites the fact the branch is about, so it clears the
   * other branch's answer rather than leaving a stale one behind. "Starting
   * fresh" means nothing is done: next lesson 1, and the date goes back to
   * being the first lesson's day rather than a past start.
   */
  function setBranch(next: WhereBranch) {
    if (!sched || sched.branch === next) return;
    // One patch, so a declined "this will reset your progress tracking" confirm
    // leaves the row exactly as it was. Splitting it meant declining still
    // wiped the typed start date and left the radio where it started.
    const seed = next === "fresh" ? 1 : Math.max(2, row.start_at_lesson);
    if (!applyStartAtLesson(seed, { where_branch: next, start_date: null, start_date_is_manual: false })) {
      return;
    }
  }

  return (
    <div
      data-goal-id={row.dbId ?? undefined}
      data-local-id={row.localId}
      className={`px-4 py-4 border-b border-[#f0ede8] last:border-b-0 ${isReadOnly ? "opacity-70" : ""} ${props.isHighlighted ? "ring-2 ring-[var(--g-brand)] ring-inset bg-[#f0f7f2]" : ""}`}
    >
      {/* Header strip */}
      <div className="flex items-center gap-2 mb-3">
        <button
          onClick={() => props.onCycleType(row.localId)}
          disabled={isReadOnly}
          className="text-[11px] font-medium px-2.5 py-1 rounded-full border"
          style={{
            background: isCurriculum ? "var(--g-accent)" : "transparent",
            color: isCurriculum ? "white" : "var(--g-brand)",
            borderColor: isCurriculum ? "var(--g-accent)" : "var(--g-brand)",
          }}
        >
          {row.type !== "curriculum" && <span className="mr-1">{row.emoji}</span>}
          {typeLabel}
        </button>
        {isPending && (
          <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-[#f0ede8] text-[#7a6f65]">
            Pending
          </span>
        )}
        {isReadOnly && (
          <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-[#f0ede8] text-[#7a6f65]">
            {row.readOnlyReason ?? "Managed elsewhere"}
          </span>
        )}
        <div className="flex-1" />
        {/* Saved curriculum rows expose the kebab menu so desktop users
            can reach "I'm actually on..." / "Mark as finished" / "Remove
            curriculum" without the mobile-only Plan UI. New (unsaved)
            curriculum rows + activity/coop rows keep the inline trash
            because the menu's two extra items don't apply to them — you
            can't recalibrate or archive a row that doesn't have a DB id
            yet. */}
        {!isReadOnly && isCurriculum && row.dbId ? (
          <CurriculumKebabMenu
            isOpen={props.menuOpen}
            onOpenChange={props.onMenuOpenChange}
            onRecalibrate={() => {
              props.onMenuOpenChange(false);
              props.onOpenRecalibrate();
            }}
            onMarkFinished={() => {
              props.onMenuOpenChange(false);
              void props.onMarkFinished();
            }}
            onRemove={() => {
              props.onMenuOpenChange(false);
              props.onDeleteRow(row.localId);
            }}
          />
        ) : !isReadOnly ? (
          <button
            onClick={() => props.onDeleteRow(row.localId)}
            aria-label="Remove row"
            className="text-[#b5aca4] hover:text-[#9a3a3a] p-1"
          >
            <Trash2 size={16} />
          </button>
        ) : null}
      </div>

      {/* Inline recalibration form. Matches the Plan panel's tinted
          sub-block so the row card retains its existing visual rhythm.
          handleRowRecalibrate (page-level) handles the DB write and local
          state sync; the form itself only owns the input + validation. */}
      {props.recalibrating ? (
        <div className="mb-3 rounded-xl border border-[#c5dbc9] bg-[#f0f7f2] px-3 pb-3">
          <RecalibrateForm
            goal={rowToPanelGoal(row)}
            onSubmit={props.onRecalibrate}
            onClose={props.onCloseRecalibrate}
          />
        </div>
      ) : null}

      {/* ── Copy from another child ─────────────────────────────────────────
          A family setting up a second child re-types the same subject, the
          same publisher, the same days and the same counts. The chip fills all
          of that. It deliberately does NOT copy "Where are you with this?":
          two children are rarely on the same lesson, so that question is asked
          again for this child. */}
      {props.copyableRows.length > 0 ? (
        <div className="mb-3 flex items-center gap-1.5 flex-wrap">
          <span className="text-[11px] text-[#7a6f65]">Copy from</span>
          {props.copyableRows.map((r) => (
            <button
              key={r.localId}
              type="button"
              onClick={() => props.onCopyFrom(r.localId)}
              className="text-[11px] px-2 py-1 rounded-full border border-[#c5dbc9] bg-white text-[#2D5A3D] hover:bg-[#f0f7f2]"
            >
              {props.childNameById(r.child_id)}&apos;s {r.subject.trim() || r.name.trim()}
            </button>
          ))}
        </div>
      ) : null}

      {/* ── Subject first, curriculum second ───────────────────────────────
          These were the other way round, with the curriculum field leading and
          carrying the placeholder "e.g. The Good and the Beautiful Language
          Arts Level 3". Families could not tell the boxes apart: 22 of them
          typed "math" into the curriculum field and 33 typed the publisher
          name with no subject at all, so the Plan calendar printed the same
          words for every lesson of their day.

          Subject is what a family calls the thing out loud ("time for Math"),
          so it leads, in the larger field. The publisher is the smaller one
          under it, and both suggest from what this family has typed before. */}
      {isCurriculum ? (
        <>
          <label
            htmlFor={`subject-${row.localId}`}
            className="block text-[10px] font-medium uppercase tracking-wide text-[#7a6f65] mb-1"
          >
            Subject
          </label>
          <input
            id={`subject-${row.localId}`}
            data-row-first-input=""
            type="text"
            list={`subjects-${row.localId}`}
            value={row.subject}
            onChange={(e) => props.onPatchRow(row.localId, { subject: e.target.value })}
            disabled={isReadOnly}
            placeholder="e.g. Math"
            className="w-full px-3 py-2 rounded-xl border border-[#e8e2d9] bg-white text-sm placeholder-[#c8bfb5] focus:outline-none focus:border-[#5c7f63] disabled:bg-[#f8f7f4]"
          />
          <datalist id={`subjects-${row.localId}`}>
            {props.subjectSuggestions.map((v) => (
              <option key={v} value={v} />
            ))}
          </datalist>

          <label
            htmlFor={`curriculum-${row.localId}`}
            className="block text-[10px] font-medium uppercase tracking-wide text-[#7a6f65] mt-2 mb-1"
          >
            Curriculum
          </label>
          <input
            id={`curriculum-${row.localId}`}
            type="text"
            list={`curricula-${row.localId}`}
            value={row.name}
            onChange={(e) => props.onPatchRow(row.localId, { name: e.target.value })}
            disabled={isReadOnly}
            placeholder="Who makes it? e.g. The Good and the Beautiful"
            className="w-full px-3 py-1.5 rounded-xl border border-[#e8e2d9] bg-white text-xs placeholder-[#c8bfb5] focus:outline-none focus:border-[#5c7f63] disabled:bg-[#f8f7f4]"
          />
          <datalist id={`curricula-${row.localId}`}>
            {props.curriculumSuggestions.map((v) => (
              <option key={v} value={v} />
            ))}
          </datalist>
        </>
      ) : (
        <input
          data-row-first-input=""
          type="text"
          value={row.name}
          onChange={(e) => props.onPatchRow(row.localId, { name: e.target.value })}
          disabled={isReadOnly}
          placeholder={row.type === "coop" ? "e.g. Tuesday co-op" : "e.g. Piano lessons"}
          className="w-full px-3 py-2 rounded-xl border border-[#e8e2d9] bg-white text-sm placeholder-[#c8bfb5] focus:outline-none focus:border-[#5c7f63] disabled:bg-[#f8f7f4]"
        />
      )}

      {/* Days — chip toggle for which days are school days. Per-day lesson
          counts now live in the stepper list below (curriculum rows only). */}
      <div className="mt-3">
        <p className="text-[10px] font-medium uppercase tracking-wide text-[#7a6f65] mb-1.5">
          Days
        </p>
        <div className="flex gap-1.5">
          {DAY_LABEL_SHORT.map((label, idx) => {
            const active = row.active_days[idx];
            return (
              <button
                key={label}
                onClick={() => props.onToggleDay(row.localId, idx)}
                disabled={isReadOnly}
                aria-pressed={active}
                className="w-8 h-8 rounded-md text-xs font-medium transition-colors"
                style={{
                  background: active ? "var(--g-accent)" : "transparent",
                  color: active ? "white" : "#b5aca4",
                  border: `1px solid ${active ? "var(--g-accent)" : "#e8e2d9"}`,
                }}
              >
                {label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Lessons per day — explicit +/- stepper for each weekday (curriculum
          rows only). All 7 days always render so families can see exactly
          where lessons land; rows whose day chip is off are disabled with a
          "Not selected" hint. Counts of 0 are honored by the scheduler as
          "skip this day" even when the day chip is on. */}
      {isCurriculum && (
        <div className="mt-3">
          <p className="text-[10px] font-medium uppercase tracking-wide text-[#7a6f65]">
            Lessons per day
          </p>
          <p className="text-[11px] text-[#8a8580] mt-0.5 mb-2">
            Set how many lessons your child does each day. Days set to 0 will be skipped in the schedule.
          </p>
          <div className="rounded-xl border border-[#e8e2d9] divide-y divide-[#f0ede8] overflow-hidden">
            {DAY_LABEL.map((dayName, idx) => {
              const active = row.active_days[idx];
              const count = row.per_day_counts[idx] ?? 0;
              const setCount = (next: number) => {
                const clamped = Math.max(0, Math.min(10, next));
                const arr = [...row.per_day_counts];
                arr[idx] = clamped;
                props.onPatchRow(row.localId, { per_day_counts: arr });
              };
              const decDisabled = isReadOnly || !active || count <= 0;
              const incDisabled = isReadOnly || !active || count >= 10;
              return (
                <div
                  key={dayName}
                  className={`flex items-center justify-between px-3 py-2 ${active ? "bg-white" : "bg-[#faf8f4]"}`}
                >
                  <div className="flex items-baseline gap-2 min-w-0">
                    <span className={`text-[13px] font-medium ${active ? "text-[#2D2A26]" : "text-[#b5aca4]"}`}>
                      {dayName === "Mon" ? "Monday"
                        : dayName === "Tue" ? "Tuesday"
                        : dayName === "Wed" ? "Wednesday"
                        : dayName === "Thu" ? "Thursday"
                        : dayName === "Fri" ? "Friday"
                        : dayName === "Sat" ? "Saturday"
                        : "Sunday"}
                    </span>
                    {!active ? (
                      <span className="text-[11px] text-[#b5aca4]">Not selected</span>
                    ) : null}
                  </div>
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => setCount(count - 1)}
                      disabled={decDisabled}
                      aria-label={`One fewer lesson on ${dayName}`}
                      className="w-7 h-7 flex items-center justify-center rounded-md border border-[#e8e2d9] bg-white text-[#2D5A3D] hover:bg-[#f0ede8] disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      −
                    </button>
                    <span
                      className={`min-w-[24px] text-center text-[13px] font-semibold ${
                        active && count > 0 ? "text-[#2D5A3D]" : "text-[#c8bfb5]"
                      }`}
                      aria-label={`${count} lessons on ${dayName}`}
                    >
                      {count}
                    </span>
                    <button
                      type="button"
                      onClick={() => setCount(count + 1)}
                      disabled={incDisabled}
                      aria-label={`One more lesson on ${dayName}`}
                      className="w-7 h-7 flex items-center justify-center rounded-md border border-[#e8e2d9] bg-white text-[#2D5A3D] hover:bg-[#f0ede8] disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      +
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Total lessons / minutes. "Start at" and "Start date" are gone: both
          asked for a fact the family now gives once, below. */}
      <div className="mt-3 grid grid-cols-2 gap-2">
        {isCurriculum ? (
          /* Required, and marked as such: a blank total lesson count is the
             single most common reason Preview stays disabled. */
          <FieldInput
            label="Total lessons"
            value={row.total_lessons ?? ""}
            onChange={(v) => {
              const n = Number(v);
              props.onPatchRow(row.localId, {
                total_lessons: Number.isFinite(n) && n > 0 ? Math.floor(n) : null,
              });
            }}
            type="number"
            min={1}
            placeholder="e.g. 120"
            disabled={isReadOnly}
            required
            invalid={
              row.name.trim().length > 0 &&
              !(row.total_lessons != null && row.total_lessons > 0)
            }
          />
        ) : (
          <FieldDash label="Total lessons" />
        )}
        <FieldInput
          label="Min/lesson"
          value={row.minutes_per_lesson ?? ""}
          onChange={(v) => {
            const n = Number(v);
            props.onPatchRow(row.localId, {
              minutes_per_lesson: Number.isFinite(n) && n > 0 ? Math.floor(n) : null,
            });
          }}
          type="number"
          min={1}
          placeholder="30"
          disabled={isReadOnly}
        />
      </div>

      {/* ── Where are you with this? ────────────────────────────────────────
          One question in place of Start at, Already completed, the start date
          and the green estimate banner. The family types the NEXT lesson and
          every date derives from it through the shared walk, so the sentence
          they read is computed from the same output the save writes. */}
      {isCurriculum && sched ? (
        <div className="mt-4 rounded-xl border border-[#e8e2d9] bg-[#fdfcfa] p-3">
          <p className="text-[10px] font-medium uppercase tracking-wide text-[#7a6f65] mb-2">
            Where are you with this?
          </p>

          <label className="flex items-start gap-2 cursor-pointer">
            <input
              type="radio"
              name={`where-${row.localId}`}
              checked={sched.branch === "fresh"}
              disabled={isReadOnly}
              onChange={() => setBranch("fresh")}
              className="mt-[3px] accent-[#2D5A3D]"
            />
            <span className="text-[13px] text-[#2D2A26]">Starting fresh</span>
          </label>

          {sched.branch === "fresh" ? (
            <div className="ml-6 mt-1.5">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-[12px] text-[#7a6f65]">First lesson on</span>
                <input
                  type="date"
                  value={row.start_date ?? (sched.nextLessonDate ?? "")}
                  disabled={isReadOnly}
                  onChange={(e) =>
                    props.onPatchRow(row.localId, {
                      start_date: e.target.value || null,
                      start_date_is_manual: !!e.target.value,
                    })
                  }
                  className="px-2 py-1 rounded-lg border border-[#e8e2d9] bg-white text-[13px] focus:outline-none focus:border-[#5c7f63]"
                />
              </div>
              {freshSentence ? (
                <p className="mt-1.5 text-[12px] text-[#5c7f63] leading-relaxed">{freshSentence}</p>
              ) : null}
            </div>
          ) : null}

          <label className="flex items-start gap-2 cursor-pointer mt-2">
            <input
              type="radio"
              name={`where-${row.localId}`}
              checked={sched.branch === "already"}
              disabled={isReadOnly}
              onChange={() => setBranch("already")}
              className="mt-[3px] accent-[#2D5A3D]"
            />
            <span className="text-[13px] text-[#2D2A26]">Already into it</span>
          </label>

          {sched.branch === "already" ? (
            <div className="ml-6 mt-1.5">
              <div className="flex items-center gap-2 flex-wrap">
                <label
                  htmlFor={`next-lesson-${row.localId}`}
                  className="text-[12px] text-[#7a6f65]"
                >
                  What lesson are you on next?
                </label>
                <input
                  id={`next-lesson-${row.localId}`}
                  type="number"
                  min={1}
                  max={row.total_lessons ? row.total_lessons + 1 : undefined}
                  value={row.start_at_lesson}
                  disabled={isReadOnly}
                  onChange={(e) => changeStartAtLesson(Number(e.target.value) || 1)}
                  className="w-20 px-2 py-1 rounded-lg border border-[#e8e2d9] bg-white text-[13px] font-semibold text-[#2D5A3D] focus:outline-none focus:border-[#5c7f63]"
                />
              </div>

              {sched.overflow ? (
                <p className="mt-2 text-[12px] text-[#9a3a3a] leading-relaxed">
                  {sched.overflow}
                </p>
              ) : alreadySentence ? (
                <p className="mt-1.5 text-[12px] text-[#5c7f63] leading-relaxed">
                  {alreadySentence}
                </p>
              ) : null}

              {/* The start date is derived, not typed, until the family asks
                  for it. Once they type one it is theirs and is never silently
                  re-derived. */}
              {row.start_date_is_manual ? (
                <div className="mt-2 flex items-center gap-2 flex-wrap">
                  <span className="text-[12px] text-[#7a6f65]">Start date</span>
                  <input
                    type="date"
                    value={row.start_date ?? ""}
                    disabled={isReadOnly}
                    onChange={(e) =>
                      props.onPatchRow(row.localId, {
                        start_date: e.target.value || null,
                        start_date_is_manual: !!e.target.value,
                      })
                    }
                    className="px-2 py-1 rounded-lg border border-[#e8e2d9] bg-white text-[13px] focus:outline-none focus:border-[#5c7f63]"
                  />
                  <button
                    type="button"
                    disabled={isReadOnly}
                    onClick={() =>
                      props.onPatchRow(row.localId, {
                        start_date: sched.derivedStart ?? null,
                        start_date_is_manual: false,
                      })
                    }
                    className="text-[12px] text-[var(--g-brand)] underline underline-offset-2 hover:opacity-80"
                  >
                    Use the date we worked out
                  </button>
                </div>
              ) : sched.history.startDate ? (
                <button
                  type="button"
                  disabled={isReadOnly}
                  onClick={() =>
                    props.onPatchRow(row.localId, {
                      start_date: sched.derivedStart ?? null,
                      start_date_is_manual: true,
                    })
                  }
                  className="mt-1.5 text-[12px] text-[var(--g-brand)] underline underline-offset-2 hover:opacity-80"
                >
                  Started earlier than {formatYmdShort(sched.derivedStart ?? "")}? Change the start date.
                </button>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}

      {/* Replacing a curriculum mid-year. One line, two answers, and
          "Mark it finished" is the same handler the row's three-dot menu
          uses so there is nothing new to keep working. */}
      {props.replacedRow ? (
        <div className="mt-3 rounded-xl border border-[#e8dfc9] bg-[#fdfaf0] p-3">
          <p className="text-[12px] text-[#6b5a2a] leading-relaxed">
            Replacing {props.replacedChildName}&apos;s current{" "}
            {props.replacedRow.subject.trim() || props.replacedRow.name.trim()}?
          </p>
          <div className="mt-2 flex items-center gap-2 flex-wrap">
            <button
              type="button"
              onClick={() => void props.onMarkReplacedFinished()}
              className="text-[12px] font-medium px-2.5 py-1 rounded-lg border border-[#c5dbc9] bg-white text-[#2D5A3D] hover:bg-[#f0f7f2]"
            >
              Mark it finished at lesson {Math.max(0, props.replacedRow.start_at_lesson - 1)}
            </button>
            <button
              type="button"
              onClick={props.onKeepBoth}
              className="text-[12px] px-2.5 py-1 rounded-lg border border-[#e8e2d9] bg-white text-[#7a6f65] hover:bg-[#f8f7f4]"
            >
              Keep both
            </button>
          </div>
        </div>
      ) : null}

      {/* Pace line */}
      {isCurriculum && (
        <div className="mt-2 text-xs">
          {pace ? (
            <p
              className={pace.warning ? "text-[#9a6a1a]" : "text-[#7a6f65]"}
            >
              {pace.lessonsPerWeek} lessons/wk
              {" • "}
              {pace.lessonsDone} done already
              {" • "}
              {pace.weeksRemaining} weeks left
              {" • "}
              on pace for {pace.finishLabel}
              {pace.warning && (
                <span className="block mt-0.5 text-[11px] text-[#9a6a1a]">
                  Heads up: this is a long timeline. You may want to bump lessons/week.
                </span>
              )}
            </p>
          ) : (
            <p className="text-[#b5aca4]">Set lessons and days to see pace.</p>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Builds a PanelGoal-shaped object from a Row so RecalibrateForm — which
 * was written against the Plan curriculum panel's CurriculumGoal type — can
 * be reused verbatim. Only the fields the form actually reads are filled
 * (id, total_lessons, current_lesson). The form derives its default value
 * from current_lesson + 1, so passing start_at_lesson - 1 keeps the
 * round-trip idempotent: re-opening the form after a save shows mom's
 * last entered value.
 */
function rowToPanelGoal(row: Row): PanelGoal {
  return {
    id: row.dbId ?? "",
    child_id: row.child_id,
    curriculum_name: row.name,
    subject_label: row.subject || null,
    total_lessons: row.total_lessons ?? 0,
    current_lesson: Math.max(0, row.start_at_lesson - 1),
    lessons_per_day: 1,
    target_date: null,
    school_days: null,
    start_date: row.start_date,
  };
}

function CurriculumKebabMenu(props: {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  onRecalibrate: () => void;
  onMarkFinished: () => void;
  onRemove: () => void;
}) {
  return (
    <div className="relative shrink-0">
      <button
        type="button"
        onClick={() => props.onOpenChange(!props.isOpen)}
        aria-label="More actions"
        aria-haspopup="menu"
        aria-expanded={props.isOpen}
        className="w-7 h-7 flex items-center justify-center rounded-full text-[#7a6f65] hover:text-[#2d2926] hover:bg-[#f0ede8] transition-colors"
      >
        <MoreVertical size={15} />
      </button>
      {props.isOpen ? (
        <>
          <div
            className="fixed inset-0 z-40"
            onClick={() => props.onOpenChange(false)}
            aria-hidden
          />
          <div
            role="menu"
            className="absolute right-0 top-full mt-1 z-50 bg-white rounded-xl shadow-lg border border-[#e8e2d9] overflow-hidden min-w-[180px]"
          >
            <button
              type="button"
              role="menuitem"
              onClick={props.onRecalibrate}
              className="w-full px-3 py-2 text-left text-[13px] text-[#2d2926] hover:bg-[#faf8f4] flex items-center gap-2"
            >
              <span aria-hidden className="text-[14px] leading-none">🎯</span> I&apos;m actually on...
            </button>
            <button
              type="button"
              role="menuitem"
              onClick={props.onMarkFinished}
              className="w-full px-3 py-2 text-left text-[13px] text-[#2d2926] hover:bg-[#faf8f4] flex items-center gap-2"
            >
              <span aria-hidden className="text-[14px] leading-none">✅</span> Mark as finished
            </button>
            <button
              type="button"
              role="menuitem"
              onClick={props.onRemove}
              className="w-full px-3 py-2 text-left text-[13px] text-[#b91c1c] hover:bg-[#fef2f2] flex items-center gap-2"
            >
              <Trash2 size={14} /> Remove curriculum
            </button>
          </div>
        </>
      ) : null}
    </div>
  );
}

function FieldInput(props: {
  label: string;
  value: string | number;
  onChange: (v: string) => void;
  type: "number" | "date" | "text";
  min?: number;
  /** Upper bound for number fields. Advisory: the browser enforces it on the
   *  spinner and on form validation, but a typed value still reaches onChange,
   *  so the caller must clamp as well. */
  max?: number;
  placeholder?: string;
  disabled?: boolean;
  /** Marks the label so the field reads as required before it is filled in. */
  required?: boolean;
  /** Red border. Set when the field is required and still empty. */
  invalid?: boolean;
}) {
  return (
    <label className="block">
      <span className="block text-[10px] font-medium uppercase tracking-wide text-[#7a6f65] mb-1">
        {props.label}
        {props.required ? (
          <>
            <span aria-hidden="true" className="ml-0.5 text-[#b91c1c]">*</span>
            <span className="sr-only"> (required)</span>
          </>
        ) : null}
      </span>
      <input
        type={props.type}
        value={props.value}
        min={props.min}
        max={props.max}
        onChange={(e) => props.onChange(e.target.value)}
        placeholder={props.placeholder}
        disabled={props.disabled}
        aria-invalid={props.invalid ? true : undefined}
        className={`w-full px-2.5 py-1.5 rounded-lg border bg-white text-sm placeholder-[#c8bfb5] focus:outline-none disabled:bg-[#f8f7f4] ${
          props.invalid
            ? "border-[#c98b8b] focus:border-[#b91c1c]"
            : "border-[#e8e2d9] focus:border-[#5c7f63]"
        }`}
      />
    </label>
  );
}

function FieldDash(props: { label: string }) {
  return (
    <div>
      <span className="block text-[10px] font-medium uppercase tracking-wide text-[#7a6f65] mb-1">
        {props.label}
      </span>
      <span className="block px-2.5 py-1.5 text-sm text-[#c8bfb5]">—</span>
    </div>
  );
}

// ─── Preview view ──────────────────────────────────────────────────────────

/**
 * A row's days in words, when they are not the Mon-Fri default.
 * "Fridays" / "Mon, Wed, Fri". Returns null for a plain Mon-Fri week, which
 * needs no comment.
 */
function scheduleDaysLabel(row: Row): string | null {
  const idxs = activeDayIndices(row);
  if (idxs.length === 0) return null;
  const isMonFri = idxs.length === 5 && idxs.every((i) => i <= 4);
  if (isMonFri) return null;
  if (idxs.length === 1) {
    const one = ["Mondays", "Tuesdays", "Wednesdays", "Thursdays", "Fridays", "Saturdays", "Sundays"];
    return one[idxs[0]];
  }
  return idxs.map((i) => DAY_LABEL[i]).join(", ");
}

function PreviewView(props: {
  childrenList: Child[];
  rows: Row[];
  today: Date;
  todayStr: string;
  vacations: SchedVacationBlock[];
  schedByLocalId: Map<string, RowSchedule>;
  onBackToEdit: () => void;
  onFixRow: (localId: string) => void;
}) {
  const days: { idx: number; short: string; full: string }[] = [
    { idx: 0, short: "Mon", full: "Monday" },
    { idx: 1, short: "Tue", full: "Tuesday" },
    { idx: 2, short: "Wed", full: "Wednesday" },
    { idx: 3, short: "Thu", full: "Thursday" },
    { idx: 4, short: "Fri", full: "Friday" },
    { idx: 5, short: "Sat", full: "Saturday" },
    { idx: 6, short: "Sun", full: "Sunday" },
  ];

  // One schedule computation per curriculum row, shared by the confirmation
  // list and the "what the next school day will show" block. Same helper the
  // builder card reads, so the preview cannot say something the row did not.
  const schedByLocalId = props.schedByLocalId;

  // ── What the next school day will show ──────────────────────────────────
  // The earliest date any curriculum puts a lesson on. If something still
  // lands today, today is the day worth naming.
  const nextDates = [...schedByLocalId.values()]
    .map((x) => x.nextLessonDate)
    .filter((d): d is string => !!d)
    .sort();
  const headlineDate = nextDates[0];
  const headlineRows = props.rows.filter((r) => {
    const sched = schedByLocalId.get(r.localId);
    return !!sched && sched.nextLessonDate === headlineDate;
  });
  const headlineByChild = props.childrenList
    .map((child) => ({
      child,
      items: headlineRows
        .filter((r) => r.child_id === child.id)
        .map((r) => `${r.subject.trim() || r.name.trim() || "Curriculum"} ${schedByLocalId.get(r.localId)!.nextLesson}`),
    }))
    .filter((x) => x.items.length > 0);

  // Build per-child / per-day cells for the at-a-glance grid.
  const childBlocks = props.childrenList.map((child) => {
    const childRows = props.rows.filter(
      (r) => r.child_id === child.id && !r.pendingDelete,
    );
    const cellsByDay = days.map((d) => {
      const cells = childRows
        .filter((r) => {
          if (!r.active_days[d.idx]) return false;
          if (r.type === "curriculum" && (r.per_day_counts[d.idx] ?? 0) <= 0) return false;
          return true;
        })
        .map((r) => {
          const pending =
            r.type === "curriculum" && isFutureDate(r.start_date, props.today);
          const count = r.type === "curriculum" ? r.per_day_counts[d.idx] : 1;
          return {
            localId: r.localId,
            // Subject leads. The grid used to print the curriculum NAME in
            // every cell, so a family with three The Good and the Beautiful
            // books read the same words 28 times and could not tell which
            // subject any cell was.
            lead: r.type === "curriculum" ? (r.subject.trim() || r.name.trim() || "(no name)") : (r.name || "(no name)"),
            sub: r.type === "curriculum" ? r.name.trim() : "",
            count,
            type: r.type,
            emoji: r.emoji,
            pending,
            minutes: r.minutes_per_lesson ?? 0,
          };
        });
      const totalMinutes = cells
        .filter((c) => !c.pending)
        .reduce((s, c) => s + c.count * (c.minutes || 0), 0);
      return { ...d, cells, totalMinutes };
    });
    return { child, cellsByDay };
  });

  return (
    <div className="space-y-5">
      {/* ── 1. Per-child confirmation. This IS the preview: it answers "did it
              understand where we are, and what happens next". ───────────── */}
      {props.childrenList.map((child) => {
        const childRows = props.rows.filter(
          (r) => r.child_id === child.id && !r.pendingDelete && r.type === "curriculum",
        );
        if (childRows.length === 0) return null;
        return (
          <div
            key={child.id}
            className="bg-white rounded-2xl border border-[#e8e2d9] p-4"
            style={{ borderLeft: `3px solid ${child.color ?? "var(--g-accent)"}` }}
          >
            <p className="text-[15px] font-semibold text-[#2d2926] mb-2">{child.name}</p>
            <ul className="space-y-3">
              {childRows.map((r) => {
                const sched = schedByLocalId.get(r.localId);
                const daysLabel = scheduleDaysLabel(r);
                return (
                  <li key={r.localId}>
                    <p className="text-[13px] leading-snug">
                      <span className="font-semibold text-[#2d2926]">
                        {r.subject.trim() || "No subject yet"}
                      </span>
                      {r.name.trim() ? (
                        <span className="text-[#7a6f65]"> · {r.name.trim()}</span>
                      ) : null}
                      {daysLabel ? <span className="text-[#7a6f65]"> · {daysLabel}</span> : null}
                    </p>
                    <p className="text-[12px] text-[#7a6f65] leading-relaxed mt-0.5">
                      {sched
                        ? previewLessonLine({
                            history: sched.history,
                            nextLesson: sched.nextLesson,
                            nextLessonDate: sched.nextLessonDate,
                            finishLabel: sched.finishLabel,
                            todayYmd: props.todayStr,
                          })
                        : "Set days and a lesson count to see this."}{" "}
                      <button
                        onClick={() => props.onFixRow(r.localId)}
                        className="text-[var(--g-brand)] underline underline-offset-2 hover:opacity-80"
                      >
                        Not right?
                      </button>
                    </p>
                  </li>
                );
              })}
            </ul>
          </div>
        );
      })}

      {/* ── 2. What the next school day will show ───────────────────────── */}
      {headlineDate && headlineByChild.length > 0 ? (
        <div className="bg-[#f0f7f2] rounded-2xl border border-[#c5dbc9] p-4">
          <p className="text-[13px] text-[#2d4a36] leading-relaxed">
            <span className="font-semibold">
              {headlineDate === props.todayStr
                ? `Today, ${formatWeekdayLong(headlineDate)} will show:`
                : `${formatWeekdayLong(headlineDate)} will show:`}
            </span>{" "}
            {headlineByChild.map((x, i) => (
              <span key={x.child.id}>
                {i > 0 ? " " : ""}
                {x.child.name}: {x.items.join(", ")}.
              </span>
            ))}
          </p>
        </div>
      ) : null}

      {/* ── 3. The weekly grid, at a glance ─────────────────────────────── */}
      <div className="bg-white rounded-2xl border border-[#e8e2d9] overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-[#f0ede8]">
              <th className="px-3 py-2 text-left text-[10px] font-medium uppercase tracking-wide text-[#7a6f65] w-28">
                Child
              </th>
              {days.map((d) => (
                <th
                  key={d.idx}
                  className="px-2 py-2 text-left text-[10px] font-medium uppercase tracking-wide text-[#7a6f65]"
                >
                  {d.short}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {childBlocks.map(({ child, cellsByDay }) => (
              <tr
                key={child.id}
                className="border-b border-[#f0ede8] last:border-b-0 align-top"
              >
                <td
                  className="px-3 py-3 font-medium text-[#2d2926]"
                  style={{ borderLeft: `3px solid ${child.color ?? "var(--g-accent)"}` }}
                >
                  {child.name}
                </td>
                {cellsByDay.map((d) => (
                  <td key={d.idx} className="px-2 py-3 align-top">
                    {d.cells.length === 0 && (
                      <span className="text-[#c8bfb5]">&ndash;</span>
                    )}
                    {d.cells.map((c) => (
                      <div
                        key={c.localId}
                        className={`mb-1.5 leading-snug ${c.pending ? "italic text-[#b5aca4]" : "text-[#2d2926]"}`}
                      >
                        {c.type === "curriculum" ? (
                          <>
                            <span>
                              {c.count > 1 ? `${c.count}\u00d7 ` : ""}
                              {c.lead}
                            </span>
                            {c.pending && (
                              <span className="ml-1 text-[10px] text-[#b5aca4]">(Pending)</span>
                            )}
                            {c.sub ? (
                              <span className="block text-[10px] text-[#7a6f65]">{c.sub}</span>
                            ) : null}
                          </>
                        ) : (
                          <>
                            <span className="mr-1">{c.emoji}</span>
                            {c.lead}
                          </>
                        )}
                      </div>
                    ))}
                    {d.totalMinutes > 0 && (
                      <p className="mt-1 text-[10px] text-[#7a6f65]">
                        ~{(d.totalMinutes / 60).toFixed(1)} hrs
                      </p>
                    )}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* The Pace summary block is gone: it was six lines all starting with the
          same words, naming neither child nor subject. The finish month is on
          each curriculum's own line above. */}

      {/* Back-to-edit link in the content flow. The sticky bottom bar has
          one too, but on mobile the floating camera FAB can sit on top of
          the bar so an in-content link guarantees the user always has a
          visible way back. */}
      <div className="text-center">
        <button
          onClick={props.onBackToEdit}
          className="text-sm text-[var(--g-brand)] underline underline-offset-2 hover:opacity-80"
        >
          &larr; Back to edit
        </button>
      </div>
    </div>
  );
}
