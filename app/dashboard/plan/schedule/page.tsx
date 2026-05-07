"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { capitalizeName } from "@/lib/utils";
import { usePartner } from "@/lib/partner-context";
import { recomputeCurrentLesson } from "@/app/lib/scheduler";
import PageHero from "@/app/components/PageHero";

// ─── Constants ─────────────────────────────────────────────────────────────

// UI-facing day labels (compact). Index 0 = Mon, 4 = Fri.
const DAY_LABEL_SHORT = ["M", "T", "W", "Th", "F"] as const;
// DB / scheduler day labels matching curriculum_goals.school_days.
const DAY_LABEL = ["Mon", "Tue", "Wed", "Thu", "Fri"] as const;

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
    active_days: [true, true, true, true, true],
    per_day_counts: [1, 1, 1, 1, 1],
    minutes_per_lesson: null,
    start_date: null,
    subject: "",
    total_lessons: null,
    start_at_lesson: 1,
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
  for (let i = 0; i < 5; i++) {
    const label = DAY_LABEL[i];
    const isActive = schoolDays.includes(label);
    active_days.push(isActive);
    let count = baseLpd;
    if (overrides && Object.prototype.hasOwnProperty.call(overrides, label)) {
      const v = overrides[label];
      if (typeof v === "number" && Number.isFinite(v) && v >= 1) {
        count = Math.floor(v);
      }
    }
    per_day_counts.push(count);
  }

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
    start_at_lesson: Math.max(1, g.start_at_lesson ?? 1),
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
  const hasWeekend = a.days.some((d) => d > 4);
  const isMultiChild = a.child_ids.length > 1;
  const isNonWeekly = a.frequency !== "weekly";
  const readOnly = hasWeekend || isMultiChild || isNonWeekly;
  let reason: string | null = null;
  if (readOnly) {
    const reasons: string[] = [];
    if (isNonWeekly) reasons.push(a.frequency);
    if (hasWeekend) reasons.push("weekend day");
    if (isMultiChild) reasons.push("shared across kids");
    reason = `Managed elsewhere (${reasons.join(", ")})`;
  }

  const active_days: boolean[] = [];
  const per_day_counts: number[] = [];
  for (let i = 0; i < 5; i++) {
    active_days.push(a.days.includes(i));
    per_day_counts.push(1); // activities don't carry per-day counts; UI hides count badges anyway
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
  const active: { idx: number; count: number }[] = [];
  for (let i = 0; i < 5; i++) {
    if (row.active_days[i]) active.push({ idx: i, count: Math.max(1, row.per_day_counts[i]) });
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
  for (let i = 0; i < 5; i++) if (row.active_days[i]) out.push(i);
  return out;
}

function lessonsPerWeek(row: Row): number {
  let sum = 0;
  for (let i = 0; i < 5; i++) if (row.active_days[i]) sum += Math.max(1, row.per_day_counts[i]);
  return sum;
}

type Pace = {
  lessonsPerWeek: number;
  lessonsDone: number;
  weeksRemaining: number;
  finishLabel: string;
  warning: boolean;
};

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
  if (activeDayIndices(row).length === 0) return false;
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

  const [newChildName, setNewChildName] = useState("");
  const [newChildColor, setNewChildColor] = useState<string>(CHILD_COLORS[0]);
  const [addingChild, setAddingChild] = useState(false);

  const saveInFlight = useRef(false);

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
              "id, child_id, curriculum_name, subject_label, total_lessons, current_lesson, lessons_per_day, lessons_per_day_overrides, school_days, start_date, start_at_lesson, default_minutes, target_date, icon_emoji, scheduled_start_time, archived",
            )
            .eq("user_id", effectiveUserId)
            .eq("archived", false),
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
        const next = r.active_days.slice();
        next[dayIdx] = !next[dayIdx];
        return { ...r, active_days: next };
      }),
    );
    markDirty();
  }

  function cycleCount(localId: string, dayIdx: number) {
    setRows((prev) =>
      prev.map((r) => {
        if (r.localId !== localId) return r;
        if (r.readOnly || r.type !== "curriculum") return r;
        const next = r.per_day_counts.slice();
        const cur = next[dayIdx] || 1;
        next[dayIdx] = cur >= 3 ? 1 : cur + 1;
        return { ...r, per_day_counts: next };
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
    if (saveInFlight.current || saving || !effectiveUserId) return;
    if (!allValid) return;
    saveInFlight.current = true;
    setSaving(true);
    setSaveError(null);
    try {
      const recomputeIds: string[] = [];
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
            default_minutes: row.minutes_per_lesson,
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
            recomputeIds.push(row.dbId);
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
            localCurriculumIds.add((inserted as { id: string }).id);
            recomputeIds.push((inserted as { id: string }).id);
          } else {
            // Brand-new row.
            const { data: inserted, error } = await supabase
              .from("curriculum_goals")
              .insert(payload)
              .select("id")
              .single();
            if (error || !inserted) throw error ?? new Error("insert failed");
            localCurriculumIds.add((inserted as { id: string }).id);
            recomputeIds.push((inserted as { id: string }).id);
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
      //    starts at current_lesson + 1).
      for (const id of recomputeIds) {
        await recomputeCurrentLesson(supabase, id);
      }

      setDirty(false);
      router.push("/dashboard/plan");
    } catch (err) {
      const msg = (err as { message?: string })?.message ?? String(err);
      setSaveError(msg);
    } finally {
      saveInFlight.current = false;
      setSaving(false);
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
          />
        )}

        {view === "preview" && (
          <PreviewView
            childrenList={children}
            rows={rows}
            today={today}
            todayStr={todayStr}
          />
        )}

        {saveError && (
          <div className="mt-4 bg-white border border-[#e8c8c8] rounded-2xl p-3">
            <p className="text-sm text-[#9a3a3a]">Save failed: {saveError}</p>
          </div>
        )}
      </div>

      {/* Sticky bottom bar */}
      <div className="fixed bottom-0 inset-x-0 border-t border-[#e8e2d9] bg-white px-4 py-3 z-30">
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
                className="w-7 h-7 rounded-full border-2 transition-all"
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
}) {
  const { row } = props;
  const pace = calcPace(row, props.today);
  const isPending = row.type === "curriculum" && isFutureDate(row.start_date, props.today);
  const isCurriculum = row.type === "curriculum";
  const isReadOnly = row.readOnly;

  const typeLabel = row.type === "curriculum" ? "Curriculum" : row.type === "coop" ? "Co-op" : "Activity";

  return (
    <div
      className={`px-4 py-4 border-b border-[#f0ede8] last:border-b-0 ${isReadOnly ? "opacity-70" : ""}`}
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

      {/* Days */}
      <div className="mt-3">
        <p className="text-[10px] font-medium uppercase tracking-wide text-[#7a6f65] mb-1.5">
          Days
        </p>
        <div className="flex gap-2">
          {DAY_LABEL_SHORT.map((label, idx) => {
            const active = row.active_days[idx];
            const count = row.per_day_counts[idx];
            return (
              <div key={label} className="flex flex-col items-center gap-1 w-9">
                <button
                  onClick={() => props.onToggleDay(row.localId, idx)}
                  disabled={isReadOnly}
                  className="w-8 h-8 rounded-full text-xs font-medium transition-colors"
                  style={{
                    background: active ? "var(--g-accent)" : "transparent",
                    color: active ? "white" : "#b5aca4",
                    border: `1px solid ${active ? "var(--g-accent)" : "#e8e2d9"}`,
                  }}
                >
                  {label}
                </button>
                {isCurriculum && active && (
                  <button
                    onClick={() => props.onCycleCount(row.localId, idx)}
                    disabled={isReadOnly}
                    aria-label={`Lessons on ${DAY_LABEL[idx]}`}
                    className="w-6 h-5 rounded text-[10px] font-medium"
                    style={{
                      background: "var(--g-accent)",
                      color: "white",
                    }}
                  >
                    {count}
                  </button>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Number / date inputs */}
      <div className="mt-3 grid grid-cols-2 sm:grid-cols-4 gap-2">
        {isCurriculum ? (
          <>
            <FieldInput
              label="Start at"
              value={row.start_at_lesson}
              onChange={(v) =>
                props.onPatchRow(row.localId, {
                  start_at_lesson: Math.max(1, Number(v) || 1),
                })
              }
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
            onChange={(v) => props.onPatchRow(row.localId, { start_date: v || null })}
            type="date"
            placeholder="Today (already started)"
            disabled={isReadOnly}
          />
        ) : (
          <FieldDash label="Start date" />
        )}
      </div>

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
}) {
  const days: { idx: number; short: string; full: string }[] = [
    { idx: 0, short: "Mon", full: "Monday" },
    { idx: 1, short: "Tue", full: "Tuesday" },
    { idx: 2, short: "Wed", full: "Wednesday" },
    { idx: 3, short: "Thu", full: "Thursday" },
    { idx: 4, short: "Fri", full: "Friday" },
  ];

  // Build per-child / per-day cells
  const childBlocks = props.childrenList.map((child) => {
    const childRows = props.rows.filter(
      (r) => r.child_id === child.id && !r.pendingDelete,
    );
    const cellsByDay = days.map((d) => {
      const cells = childRows
        .filter((r) => r.active_days[d.idx])
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
    </div>
  );
}
