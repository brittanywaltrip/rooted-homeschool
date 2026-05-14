"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { capitalizeName } from "@/lib/utils";
import { usePartner } from "@/lib/partner-context";
import { computeNextLessonsForGoal, recomputeCurrentLesson, createInFlightGate } from "@/app/lib/scheduler";
import PageHero from "@/app/components/PageHero";

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

  // activity-only
  emoji: string;

  // load-time guards (round-trip safety, no data loss)
  readOnly: boolean;
  readOnlyReason: string | null;

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
    emoji: type === "curriculum" ? "" : type === "coop" ? COOP_DEFAULT_EMOJI : ACTIVITY_DEFAULT_EMOJI,
    readOnly: false,
    readOnlyReason: null,
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
    emoji: "",
    readOnly: false,
    readOnlyReason: null,
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
    emoji: fallbackEmoji,
    readOnly,
    readOnlyReason: reason,
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

/**
 * Estimate how many lessons should already be done given a past start date,
 * the row's per-day counts, and the active-days mask. Used to pre-fill
 * start_at_lesson when the user picks a past start date for a curriculum
 * they've already been working through. Returns 0 if the date is null,
 * today, or in the future, or if total_lessons is unset. Capped at
 * total_lessons so we never seed past the end of the curriculum.
 *
 * active_days / per_day_counts are indexed Mon=0..Sun=6 (per the activities
 * convention). Convert getDay() with `(d.getDay() + 6) % 7` before reading.
 */
function estimateLessonsDoneFromPastStart(row: Row, today: Date, startDateStr: string | null): number {
  if (!startDateStr) return 0;
  const total = row.total_lessons ?? 0;
  if (total <= 0) return 0;
  const start = new Date(`${startDateStr}T00:00:00`);
  if (Number.isNaN(start.getTime()) || start >= today) return 0;
  let count = 0;
  const cursor = new Date(start);
  while (cursor < today) {
    const idx = (cursor.getDay() + 6) % 7;
    if (row.active_days[idx] && row.per_day_counts[idx] > 0) {
      count += row.per_day_counts[idx];
    }
    cursor.setDate(cursor.getDate() + 1);
  }
  return Math.min(count, total);
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
    if (row.start_at_lesson < 1) return false;
  }
  return true;
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
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  const [children, setChildren] = useState<Child[]>([]);
  const [rows, setRows] = useState<Row[]>([]);
  const [originalCurriculumIds, setOriginalCurriculumIds] = useState<Set<string>>(new Set());
  const [originalActivityIds, setOriginalActivityIds] = useState<Set<string>>(new Set());

  const [dirty, setDirty] = useState(false);

  // `?goal=<id>` deep-link from the curriculum panel's "Edit goal" action.
  // Read once on mount via window.location to avoid the Suspense boundary
  // that useSearchParams requires for SSG. After rows load, the matching
  // row card is scrolled into view and highlighted briefly so the user
  // lands on the curriculum they clicked from instead of the first child.
  const [targetGoalId, setTargetGoalId] = useState<string | null>(null);
  const [highlightedGoalId, setHighlightedGoalId] = useState<string | null>(null);
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
        const [kidsResp, goalsResp, activitiesResp] = await Promise.all([
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
        ]);
        if (cancelled) return;

        if (kidsResp.error) throw kidsResp.error;
        if (goalsResp.error) throw goalsResp.error;
        if (activitiesResp.error) throw activitiesResp.error;

        const kidRows = (kidsResp.data ?? []) as Child[];
        const goalRows = (goalsResp.data ?? []) as CurriculumGoalDbRow[];
        const actRows = (activitiesResp.data ?? []) as ActivityDbRow[];

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
        setRows(builtRows);
        setOriginalCurriculumIds(new Set(goalRows.map((g) => g.id)));
        setOriginalActivityIds(new Set(actRows.map((a) => a.id)));

        // Default the new-child swatch to the first unused color
        const used = new Set(kidRows.map((k) => k.color).filter(Boolean) as string[]);
        const firstFree = CHILD_COLORS.find((c) => !used.has(c));
        if (firstFree) setNewChildColor(firstFree);

        setDirty(false);
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
  useEffect(() => {
    if (!dirty) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [dirty]);

  // ── Deep-link scroll/highlight ───────────────────────────────────────────
  // After rows finish loading, find the row card matching the ?goal=<id>
  // search param, scroll it into view, and apply a brief ring highlight so
  // the user lands on the curriculum they clicked "Edit goal" from. The
  // highlight self-clears after 2.5s.
  useEffect(() => {
    if (loading || !targetGoalId) return;
    if (!rows.some((r) => r.dbId === targetGoalId)) return;
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
    setRows((prev) => [...prev, blankRow(child_id, type)]);
    markDirty();
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

  // ── Validation ───────────────────────────────────────────────────────────
  const allValid = useMemo(() => rows.every(rowIsValid), [rows]);
  const anyEditableRow = useMemo(
    () => rows.some((r) => !r.pendingDelete && !r.readOnly),
    [rows],
  );

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
    try {
      // Each entry pairs a saved curriculum_goals row with the local Row it
      // came from. The lesson-generation pass below needs both the dbId (for
      // the FK + dedup query) and the Row's name / child_id / school_days /
      // counts (to project lesson dates).
      const savedCurriculumGoals: Array<{ id: string; row: Row }> = [];
      const localCurriculumIds = new Set<string>();
      const localActivityIds = new Set<string>();

      // 1. Per-row writes via the (previouslySavedAs, type, pendingDelete) matrix.
      for (const row of rows) {
        if (row.readOnly) {
          // Preserve membership so the sweep doesn't archive them.
          if (row.previouslySavedAs === "curriculum_goals" && row.dbId) {
            localCurriculumIds.add(row.dbId);
          } else if (row.previouslySavedAs === "activities" && row.dbId) {
            localActivityIds.add(row.dbId);
          }
          continue;
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
          continue;
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
            start_at_lesson: Math.max(1, row.start_at_lesson),
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
            savedCurriculumGoals.push({ id: row.dbId, row });
          } else if (row.previouslySavedAs === "activities" && row.dbId) {
            // Type changed activity → curriculum: archive the activity row,
            // insert as new curriculum_goals row.
            const { error: deactErr } = await supabase
              .from("activities")
              .update({ is_active: false })
              .eq("id", row.dbId);
            if (deactErr) throw deactErr;
            const { data: inserted, error: insErr } = await supabase
              .from("curriculum_goals")
              .insert(payload)
              .select("id")
              .single();
            if (insErr || !inserted) throw insErr ?? new Error("insert failed");
            const newId = (inserted as { id: string }).id;
            localCurriculumIds.add(newId);
            savedCurriculumGoals.push({ id: newId, row });
          } else {
            // Brand-new row.
            const { data: inserted, error } = await supabase
              .from("curriculum_goals")
              .insert(payload)
              .select("id")
              .single();
            if (error || !inserted) throw error ?? new Error("insert failed");
            const newId = (inserted as { id: string }).id;
            localCurriculumIds.add(newId);
            savedCurriculumGoals.push({ id: newId, row });
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
      }

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
      //    No unique constraint exists on (curriculum_goal_id, lesson_number),
      //    so we pre-check the lessons table and only insert numbers that
      //    don't already exist. This keeps re-saves of the same goal
      //    idempotent.
      const { data: vacationData } = await supabase
        .from("vacation_blocks")
        .select("start_date, end_date")
        .eq("user_id", effectiveUserId);
      const vacations = (vacationData ?? []) as { start_date: string; end_date: string }[];
      const todayMid = todayDate();

      for (const { id: goalId, row } of savedCurriculumGoals) {
        // Recompute first so we know where the queue stands. The return
        // value is the post-recompute current_lesson; for brand-new goals
        // it equals max(start_at_lesson - 1, 0). For UPDATE flows it can be
        // higher if the user has completed lessons past start_at_lesson.
        const newCurrent = await recomputeCurrentLesson(supabase, goalId);
        const currentLesson = newCurrent ?? Math.max(0, row.start_at_lesson - 1);

        if (!row.total_lessons || row.total_lessons <= 0) continue;
        const { lessons_per_day, lessons_per_day_overrides, school_days } =
          compactCurriculumPerDay(row);
        if (school_days.length === 0) continue;

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
        const upcoming = computeNextLessonsForGoal(goalConfig, todayMid, 3650, vacations);
        if (upcoming.length === 0) continue;

        // Delete-before-insert guard, NEW goals only. Closes the race where
        // two parallel saves both pass the in-process gate (e.g. retry after
        // partial failure, multi-tab) and both insert their full lesson sets
        // — observed in production via near-simultaneous created_at on
        // duplicate (curriculum_goal_id, lesson_number) rows. Safe at create
        // time because there are no completed lessons yet to clobber. The
        // edit/regenerate path (previouslySavedAs === "curriculum_goals")
        // skips this delete since it may have completed history.
        if (row.previouslySavedAs === null) {
          await supabase
            .from("lessons")
            .delete()
            .eq("curriculum_goal_id", goalId)
            .eq("completed", false);
        }

        const { data: existingLessons } = await supabase
          .from("lessons")
          .select("lesson_number")
          .eq("curriculum_goal_id", goalId)
          .not("lesson_number", "is", null);
        const existingNums = new Set(
          ((existingLessons ?? []) as { lesson_number: number }[]).map((l) => l.lesson_number),
        );

        const toInsert = upcoming
          .filter((l) => !existingNums.has(l.lesson_number))
          .map((l) => ({
            user_id: effectiveUserId,
            child_id: row.child_id,
            curriculum_goal_id: goalId,
            lesson_number: l.lesson_number,
            title: `${row.name.trim()} — Lesson ${l.lesson_number}`,
            scheduled_date: l.date,
            date: l.date,
            scheduled_source: "wizard_create",
            completed: false,
            hours: 0,
          }));

        if (toInsert.length > 0) {
          for (let i = 0; i < toInsert.length; i += 100) {
            const { error: lessonErr } = await supabase
              .from("lessons")
              .insert(toInsert.slice(i, i + 100));
            if (lessonErr) {
              console.error(
                "[ScheduleBuilder] lesson insert error for goal",
                goalId,
                ":",
                lessonErr.message,
              );
            }
          }
        }

        // Cleanup: if the user reduced total_lessons on an edit, any rows
        // previously inserted past the new ceiling become stale. Delete
        // only INCOMPLETE rows so historical completions are preserved
        // (Invariant 3: backfilled / completed lessons stay put).
        const { error: cleanupErr } = await supabase
          .from("lessons")
          .delete()
          .eq("curriculum_goal_id", goalId)
          .gt("lesson_number", row.total_lessons)
          .eq("completed", false);
        if (cleanupErr) {
          console.error(
            "[ScheduleBuilder] lesson cleanup error for goal",
            goalId,
            ":",
            cleanupErr.message,
          );
        }
      }

      setDirty(false);
      router.push("/dashboard/plan");
    } catch (err) {
      const msg = (err as { message?: string })?.message ?? String(err);
      setSaveError(msg);
    } finally {
      setSaving(false);
      // 1.5s settle window: prevents a back-to-back re-tap (e.g. impatient
      // user clicking twice while the post-save router transition is in
      // flight) from firing handleSave again before the page unmounts.
      setTimeout(() => saveGate.exit(), 1500);
    }
  }

  // ── Navigation guard ─────────────────────────────────────────────────────
  function confirmDiscardAndNavigate(href: string) {
    if (dirty) {
      const ok = window.confirm("Discard your unsaved changes?");
      if (!ok) return;
    }
    router.push(href);
  }

  // ── Render ───────────────────────────────────────────────────────────────
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
        {view === "builder" && (
          <BuilderView
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
          />
        )}

        {view === "preview" && (
          <PreviewView
            childrenList={children}
            rows={rows}
            today={today}
            todayStr={todayStr}
            onBackToEdit={() => setView("builder")}
          />
        )}

        {saveError && (
          <div className="mt-4 bg-white border border-[#e8c8c8] rounded-2xl p-3">
            <p className="text-sm text-[#9a3a3a]">Save failed: {saveError}</p>
          </div>
        )}
      </div>

      {/* Sticky bottom bar.
          pr-20 keeps the right-side button clear of the global floating
          camera FAB (rendered fixed at bottom-right elsewhere in the
          dashboard). Without it the FAB sits directly on top of the
          Save / Preview button on mobile. */}
      <div className="fixed bottom-[3.75rem] md:bottom-0 inset-x-0 border-t border-[#e8e2d9] bg-white px-4 pr-20 py-3 z-50 pb-[env(safe-area-inset-bottom,0px)]">
        <div className="max-w-5xl mx-auto flex items-center gap-2">
          {view === "builder" && (
            <>
              <button
                onClick={() => confirmDiscardAndNavigate("/dashboard/plan")}
                className="text-sm text-[#7a6f65] hover:text-[#2d2926] underline-offset-2 hover:underline"
              >
                Cancel
              </button>
              <div className="flex-1" />
              <button
                onClick={() => setView("preview")}
                disabled={!allValid || !anyEditableRow}
                className="px-5 py-2.5 rounded-xl text-white text-sm font-medium disabled:opacity-40"
                style={{ background: "var(--g-brand)" }}
              >
                Preview schedule →
              </button>
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
              <div className="flex-1" />
              <button
                onClick={handleSave}
                disabled={saving}
                className="px-5 py-2.5 rounded-xl text-white text-sm font-medium disabled:opacity-40"
                style={{ background: "var(--g-brand)" }}
              >
                {saving ? "Saving..." : "Save & build schedule"}
              </button>
            </>
          )}
        </div>
      </div>
    </>
  );
}

// ─── Builder view ──────────────────────────────────────────────────────────

function BuilderView(props: {
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
}) {
  const visibleRows = (childId: string) =>
    props.rows.filter((r) => r.child_id === childId && !r.pendingDelete);

  return (
    <div className="space-y-5">
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
                  onPatchRow={props.onPatchRow}
                  onDeleteRow={props.onDeleteRow}
                  onCycleType={props.onCycleType}
                  onToggleDay={props.onToggleDay}
                  onCycleCount={props.onCycleCount}
                  isHighlighted={
                    !!props.highlightedGoalId && row.dbId === props.highlightedGoalId
                  }
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
  onPatchRow: (localId: string, patch: Partial<Row>) => void;
  onDeleteRow: (localId: string) => void;
  onCycleType: (localId: string) => void;
  onToggleDay: (localId: string, dayIdx: number) => void;
  onCycleCount: (localId: string, dayIdx: number) => void;
  isHighlighted: boolean;
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
  function changeStartAtLesson(rawValue: number) {
    const clamped = Math.max(1, Math.floor(rawValue) || 1);
    if (clamped === row.start_at_lesson) return;
    const hasSeed = row.start_at_lesson_initial !== null;
    const needsConfirm =
      hasSeed && !row.progress_confirmed && clamped !== row.start_at_lesson_initial;
    if (needsConfirm) {
      const ok = window.confirm(
        "Changing this will reset your progress tracking — are you sure?",
      );
      if (!ok) return;
      props.onPatchRow(row.localId, {
        start_at_lesson: clamped,
        progress_confirmed: true,
      });
      return;
    }
    props.onPatchRow(row.localId, { start_at_lesson: clamped });
  }

  return (
    <div
      data-goal-id={row.dbId ?? undefined}
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
        {!isReadOnly && (
          <button
            onClick={() => props.onDeleteRow(row.localId)}
            aria-label="Remove row"
            className="text-[#b5aca4] hover:text-[#9a3a3a] p-1"
          >
            <Trash2 size={16} />
          </button>
        )}
      </div>

      {/* Name */}
      <input
        type="text"
        value={row.name}
        onChange={(e) => props.onPatchRow(row.localId, { name: e.target.value })}
        disabled={isReadOnly}
        placeholder={
          row.type === "curriculum"
            ? "e.g. The Good and the Beautiful Language Arts Level 3"
            : row.type === "coop"
            ? "e.g. Tuesday co-op"
            : "e.g. Piano lessons"
        }
        className="w-full px-3 py-2 rounded-xl border border-[#e8e2d9] bg-white text-sm placeholder-[#c8bfb5] focus:outline-none focus:border-[#5c7f63] disabled:bg-[#f8f7f4]"
      />

      {/* Subject — curriculum only */}
      {isCurriculum && (
        <input
          type="text"
          value={row.subject}
          onChange={(e) => props.onPatchRow(row.localId, { subject: e.target.value })}
          placeholder="Subject (e.g. Math)"
          className="mt-2 w-full px-3 py-1.5 rounded-xl border border-[#e8e2d9] bg-white text-xs placeholder-[#c8bfb5] focus:outline-none focus:border-[#5c7f63]"
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

      {/* Number / date inputs */}
      <div className="mt-3 grid grid-cols-2 sm:grid-cols-4 gap-2">
        {isCurriculum ? (
          <>
            <FieldInput
              label="Start at"
              value={row.start_at_lesson}
              onChange={(v) => changeStartAtLesson(Number(v) || 1)}
              type="number"
              min={1}
              disabled={isReadOnly}
            />
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
            />
          </>
        ) : (
          <>
            <FieldDash label="Start at" />
            <FieldDash label="Total lessons" />
          </>
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
        {isCurriculum ? (
          <FieldInput
            label="Start date"
            value={row.start_date ?? ""}
            onChange={(v) => {
              const next = v || null;
              const patch: Partial<Row> = { start_date: next };
              // Auto-pre-fill start_at_lesson when the user picks a past start
              // date and hasn't manually bumped the field yet (still default 1).
              // Once they engage with the stepper, leave their value alone even
              // on subsequent date changes.
              if (next && row.start_at_lesson === 1) {
                const candidate = { ...row, start_date: next };
                const estimated = estimateLessonsDoneFromPastStart(candidate, props.today, next);
                if (estimated > 0) patch.start_at_lesson = estimated + 1;
              }
              props.onPatchRow(row.localId, patch);
            }}
            type="date"
            placeholder="Today (already started)"
            disabled={isReadOnly}
          />
        ) : (
          <FieldDash label="Start date" />
        )}
      </div>

      {/* Past-start backfill banner — visible when start_date is in the past.
          Stepper writes start_at_lesson directly; recomputeCurrentLesson on
          save derives current_lesson from it (max(start_at_lesson - 1, ...)),
          so no separate field is needed. Banner hides for today/future dates. */}
      {isCurriculum && row.start_date && row.start_date < ymd(props.today) && (row.total_lessons ?? 0) > 0 ? (() => {
        const estimated = estimateLessonsDoneFromPastStart(row, props.today, row.start_date);
        const done = Math.max(0, row.start_at_lesson - 1);
        const max = row.total_lessons ?? 0;
        const dateLabel = new Date(`${row.start_date}T12:00:00`).toLocaleDateString("en-US", {
          month: "short", day: "numeric", year: "numeric",
        });
        return (
          <div className="mt-3 rounded-xl border border-[#c5dbc9] bg-[#f0f7f2] p-3">
            <p className="text-[12px] text-[#2d4a36] leading-relaxed">
              You&apos;ve already started this. Your start date was{" "}
              <span className="font-semibold">{dateLabel}</span>, that&apos;s about{" "}
              <span className="font-semibold">{estimated}</span> lesson{estimated === 1 ? "" : "s"} ago
              based on your schedule. Adjust how many you&apos;ve actually completed and we&apos;ll pick up from there.
            </p>
            <div className="mt-2 flex items-center gap-2">
              <span className="text-[11px] text-[#5c7f63] font-medium">Already completed</span>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => changeStartAtLesson(row.start_at_lesson - 1)}
                  disabled={isReadOnly || done <= 0}
                  aria-label="One fewer completed lesson"
                  className="w-7 h-7 flex items-center justify-center rounded-lg border border-[#c5dbc9] bg-white text-[#2D5A3D] hover:bg-[#e8f0e9] disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  −
                </button>
                <span className="min-w-[36px] text-center text-[14px] font-semibold text-[#2D5A3D]">{done}</span>
                <button
                  type="button"
                  onClick={() => changeStartAtLesson(Math.min(max, row.start_at_lesson + 1))}
                  disabled={isReadOnly || done >= max}
                  aria-label="One more completed lesson"
                  className="w-7 h-7 flex items-center justify-center rounded-lg border border-[#c5dbc9] bg-white text-[#2D5A3D] hover:bg-[#e8f0e9] disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  +
                </button>
              </div>
            </div>
          </div>
        );
      })() : null}

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

function FieldInput(props: {
  label: string;
  value: string | number;
  onChange: (v: string) => void;
  type: "number" | "date" | "text";
  min?: number;
  placeholder?: string;
  disabled?: boolean;
}) {
  return (
    <label className="block">
      <span className="block text-[10px] font-medium uppercase tracking-wide text-[#7a6f65] mb-1">
        {props.label}
      </span>
      <input
        type={props.type}
        value={props.value}
        min={props.min}
        onChange={(e) => props.onChange(e.target.value)}
        placeholder={props.placeholder}
        disabled={props.disabled}
        className="w-full px-2.5 py-1.5 rounded-lg border border-[#e8e2d9] bg-white text-sm placeholder-[#c8bfb5] focus:outline-none focus:border-[#5c7f63] disabled:bg-[#f8f7f4]"
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

function PreviewView(props: {
  childrenList: Child[];
  rows: Row[];
  today: Date;
  todayStr: string;
  onBackToEdit: () => void;
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

  // Build per-child / per-day cells
  const childBlocks = props.childrenList.map((child) => {
    const childRows = props.rows.filter(
      (r) => r.child_id === child.id && !r.pendingDelete,
    );
    const cellsByDay = days.map((d) => {
      const cells = childRows
        .filter((r) => {
          if (!r.active_days[d.idx]) return false;
          // For curriculum rows, a count of 0 means no lessons that day
          // even if the toggle is somehow still on (defensive).
          if (r.type === "curriculum" && (r.per_day_counts[d.idx] ?? 0) <= 0) return false;
          return true;
        })
        .map((r) => {
          const pending =
            r.type === "curriculum" && isFutureDate(r.start_date, props.today);
          const count = r.type === "curriculum" ? r.per_day_counts[d.idx] : 1;
          return {
            localId: r.localId,
            name: r.name || "(no name)",
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

  // Per-curriculum pace summary
  const paceLines = props.rows
    .filter((r) => !r.pendingDelete && r.type === "curriculum")
    .map((r) => ({ row: r, pace: calcPace(r, props.today) }))
    .filter((x) => x.pace !== null) as { row: Row; pace: Pace }[];

  return (
    <div className="space-y-5">
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
                      <span className="text-[#c8bfb5]">—</span>
                    )}
                    {d.cells.map((c) => (
                      <div
                        key={c.localId}
                        className={`mb-1 leading-snug ${c.pending ? "italic text-[#b5aca4]" : "text-[#2d2926]"}`}
                      >
                        {c.type === "curriculum" ? (
                          <>
                            {c.count > 1 ? `${c.count}× ` : ""}
                            {c.name}
                            {c.pending && (
                              <span className="ml-1 text-[10px] text-[#b5aca4]">(Pending)</span>
                            )}
                          </>
                        ) : (
                          <>
                            <span className="mr-1">{c.emoji}</span>
                            {c.name}
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

      {paceLines.length > 0 && (
        <div className="bg-white rounded-2xl border border-[#e8e2d9] p-4">
          <p className="text-[10px] font-medium uppercase tracking-wide text-[#7a6f65] mb-2">
            Pace summary
          </p>
          <ul className="space-y-1">
            {paceLines.map(({ row, pace }) => (
              <li key={row.localId} className="text-xs text-[#2d2926]">
                <span className="font-medium">{row.name || "(no name)"}:</span>{" "}
                <span className={pace.warning ? "text-[#9a6a1a]" : "text-[#7a6f65]"}>
                  on pace for {pace.finishLabel}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Back-to-edit link in the content flow. The sticky bottom bar has
          one too, but on mobile the floating camera FAB can sit on top of
          the bar so an in-content link guarantees the user always has a
          visible way back. */}
      <div className="text-center">
        <button
          onClick={props.onBackToEdit}
          className="text-sm text-[var(--g-brand)] underline underline-offset-2 hover:opacity-80"
        >
          ← Back to edit
        </button>
      </div>
    </div>
  );
}
