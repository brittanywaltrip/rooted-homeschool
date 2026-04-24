/**
 * Plan audit log — persisted user-visible changelog for the Plan page.
 *
 * Rationale: partners grade after-the-fact and occasionally reschedule in
 * bulk; when something "feels mixed up" they need a receipt. The audit trail
 * surfaces as a Recent Changes card + per-day history in the day panel (no
 * separate tab).
 *
 * Storage: rows are written to `app_events` (re-used rather than introducing
 * a new table). Every existing consumer of app_events filters by a specific
 * `type` value, so `lesson.*` / `appointment.*` / `vacation_block.*` rows
 * are invisible to memory / badges / admin-stats queries. If app_events is
 * ever retired, the PLAN_EVENT_TYPES const here lists every row the Plan
 * audit feature writes — migrations can key off those prefixes.
 *
 * Failure policy: fire-and-forget. A logging failure must never block the
 * user's mutation — we console.warn and move on. The UI optimistically
 * appends the event locally so display latency is decoupled from DB latency.
 */

import { supabase } from "@/lib/supabase";

// ── Event catalog ───────────────────────────────────────────────────────────

export type PlanEventActor = "user" | "bulk" | "drag";

export type LessonMovedPayload = {
  lesson_id: string;
  lesson_title: string;
  from_date: string;
  to_date: string;
  actor: PlanEventActor;
};
export type LessonCompletedPayload = {
  lesson_id: string;
  lesson_title: string;
  date: string | null;
  actor: PlanEventActor;
};
export type LessonUncompletedPayload = LessonCompletedPayload;
export type LessonSkippedPayload = {
  lesson_id: string;
  lesson_title: string;
  from_date: string;
  actor: PlanEventActor;
};
export type LessonDeletedPayload = {
  lesson_id: string;
  lesson_title: string;
  from_date: string | null;
  actor: PlanEventActor;
};

export type LessonCreatedPayload = {
  lesson_id: string;
  lesson_title: string;
  date: string;
  curriculum_goal_id: string | null;
  actor: PlanEventActor;
};

/** Per-field change shape: { from, to }. Payload stores only fields that
 * actually moved so the Recent Changes card can show compact diffs. */
export type LessonUpdatedPayload = {
  lesson_id: string;
  lesson_title: string;
  changes: Record<string, { from: unknown; to: unknown }>;
  actor: PlanEventActor;
};

/** Notes payload intentionally omits the body — `note_length` only.
 * Parents often write personal observations in notes, and the audit row
 * appears in the Recent Changes card; storing the prose there would leak
 * PII-ish text into a surface meant for "what did I change". */
export type LessonNotesUpdatedPayload = {
  lesson_id: string;
  lesson_title: string;
  date: string | null;
  note_length: number;
  actor: PlanEventActor;
};

export type LessonBulkAction =
  | "move"
  | "mark_done"
  | "skip"
  | "delete"
  /** Catch-up banner: batch-move past-incomplete lessons to next school days. */
  | "catch_up_shift"
  /** Push-back flow: shift all future lessons forward by N school days. */
  | "push_back_future"
  /** Push-back flow: fit missed lessons into the now-vacated near-term slots. */
  | "push_back_missed_fit";
export type LessonBulkActionPayload = {
  action: LessonBulkAction;
  count: number;
  lesson_ids: string[];
  from_dates: string[];
  to_date?: string;
  succeeded: number;
  failed: number;
};

export type AppointmentCreatedPayload = {
  appointment_id: string;
  title: string;
  date: string;
};
export type AppointmentUpdatedPayload = {
  appointment_id: string;
  title: string;
  changes: Record<string, unknown>;
};
export type AppointmentDeletedPayload = {
  appointment_id: string;
  title: string;
  date: string;
};

export type VacationBlockCreatedPayload = {
  vacation_block_id: string;
  name: string;
  start_date: string;
  end_date: string;
  /** True if, on creation, lessons in the range were auto-shifted forward.
   * Omitted on older rows — read defensively. */
  shift_applied?: boolean;
};
export type VacationBlockDeletedPayload = VacationBlockCreatedPayload;

export const PLAN_EVENT_TYPES = [
  "lesson.created",
  "lesson.updated",
  "lesson.notes_updated",
  "lesson.moved",
  "lesson.completed",
  "lesson.uncompleted",
  "lesson.skipped",
  "lesson.deleted",
  "lesson.bulk_action",
  "appointment.created",
  "appointment.updated",
  "appointment.deleted",
  "vacation_block.created",
  "vacation_block.deleted",
] as const;

export type PlanEventType = (typeof PLAN_EVENT_TYPES)[number];

// ── Row shape (what we read back from app_events) ──────────────────────────

export type PlanEventRow = {
  id: string;
  type: PlanEventType;
  payload: Record<string, unknown> | null;
  created_at: string;
};

// ── Writer ─────────────────────────────────────────────────────────────────

export interface LogPlanEventOpts {
  userId: string | null | undefined;
  type: PlanEventType;
  payload: Record<string, unknown>;
}

/**
 * Insert one row into app_events. Returns void. Never throws — if the DB
 * write fails, we log a warning and carry on so the user-facing mutation
 * path isn't disrupted. Callers should NOT await this from inside a hot
 * critical path; treat the promise as fire-and-forget.
 */
export async function logPlanEvent(opts: LogPlanEventOpts): Promise<void> {
  const { userId, type, payload } = opts;
  if (!userId) {
    // No user → nothing to attribute. Not an error, but there's no valid
    // row to write, so silently no-op.
    return;
  }
  try {
    const { error } = await supabase.from("app_events").insert({
      user_id: userId,
      type,
      payload,
    });
    if (error) {
      console.warn("[audit-log] insert failed", { type, error: error.message });
    }
  } catch (e) {
    console.warn("[audit-log] insert threw", { type, error: e });
  }
}

// ── Optimistic row builder ─────────────────────────────────────────────────

/**
 * Build a locally-keyed PlanEventRow for optimistic display. The DB row
 * will have a different id+created_at when it lands, but for a 30-row
 * recent-changes card this mismatch is invisible. Callers prepend the
 * returned row to their local state immediately, then the real row lands
 * on the next mount / manual reload.
 */
export function buildOptimisticEventRow(
  type: PlanEventType,
  payload: Record<string, unknown>,
): PlanEventRow {
  const id =
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : `opt-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  return {
    id,
    type,
    payload,
    created_at: new Date().toISOString(),
  };
}

// ── Presentation helpers ───────────────────────────────────────────────────

/** Short weekday+month+day label: "Mon Apr 21". */
export function shortDateLabel(dateStr: string | null | undefined): string {
  if (!dateStr) return "";
  const [y, m, d] = dateStr.split("-").map(Number);
  if (!y || !m || !d) return dateStr;
  return new Date(y, m - 1, d).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

/** Short weekday label only: "Mon". */
export function shortWeekdayLabel(dateStr: string | null | undefined): string {
  if (!dateStr) return "";
  const [y, m, d] = dateStr.split("-").map(Number);
  if (!y || !m || !d) return "";
  return new Date(y, m - 1, d).toLocaleDateString("en-US", { weekday: "short" });
}

/** "just now" · "12m ago" · "3h ago" · "yesterday at 2:14 PM" · "2d ago". */
export function relativeTimestamp(isoString: string, now: Date = new Date()): string {
  const then = new Date(isoString);
  const diffMs = now.getTime() - then.getTime();
  const diffSec = Math.floor(diffMs / 1000);
  if (diffSec < 60) return "just now";
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;

  // Same calendar day → N h ago
  const sameDay =
    now.getFullYear() === then.getFullYear() &&
    now.getMonth() === then.getMonth() &&
    now.getDate() === then.getDate();
  if (sameDay) {
    const diffHr = Math.max(1, Math.floor(diffMin / 60));
    return `${diffHr}h ago`;
  }

  // Yesterday in local calendar
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  const wasYesterday =
    yesterday.getFullYear() === then.getFullYear() &&
    yesterday.getMonth() === then.getMonth() &&
    yesterday.getDate() === then.getDate();
  if (wasYesterday) {
    const t = then.toLocaleTimeString("en-US", {
      hour: "numeric",
      minute: "2-digit",
    });
    return `yesterday at ${t}`;
  }

  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  if (diffDays < 7) return `${diffDays}d ago`;
  return then.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

/** Group header for the Recent Changes card: "Today", "Yesterday", or "Mon Apr 21". */
export function dateGroupLabel(isoString: string, now: Date = new Date()): string {
  const then = new Date(isoString);
  const sameDay =
    now.getFullYear() === then.getFullYear() &&
    now.getMonth() === then.getMonth() &&
    now.getDate() === then.getDate();
  if (sameDay) return "Today";
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  const wasYesterday =
    yesterday.getFullYear() === then.getFullYear() &&
    yesterday.getMonth() === then.getMonth() &&
    yesterday.getDate() === then.getDate();
  if (wasYesterday) return "Yesterday";
  return then.toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

/** Deterministic YYYY-MM-DD floor of an ISO timestamp, used as a grouping key. */
export function dateGroupKey(isoString: string): string {
  const then = new Date(isoString);
  const y = then.getFullYear();
  const m = String(then.getMonth() + 1).padStart(2, "0");
  const d = String(then.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

// ── One-liner formatter ────────────────────────────────────────────────────

export type FormattedEvent = {
  /** Short one-liner: e.g. 'Moved Math Lesson 12 — Mon Apr 21 → Tue Apr 22'. */
  summary: string;
  /** Category used for the left-border color. */
  category:
    | "completed"
    | "uncompleted"
    | "moved"
    | "skipped"
    | "deleted"
    | "bulk"
    | "appointment"
    | "vacation";
  /** Icon glyph — kept as emoji to avoid pulling icon-lib into the formatter. */
  icon: string;
};

function titleOrFallback(title: unknown): string {
  if (typeof title === "string" && title.trim().length > 0) return title.trim();
  return "lesson";
}

/**
 * Format a PlanEventRow into a human one-liner + category for row styling.
 * Pure function — safe to call inside a render. Returns a sensible fallback
 * for unknown types so a bad row never crashes the card.
 */
export function formatEvent(row: PlanEventRow): FormattedEvent {
  const p = (row.payload ?? {}) as Record<string, unknown>;
  switch (row.type) {
    case "lesson.created": {
      const title = titleOrFallback(p.lesson_title);
      const date = shortDateLabel(p.date as string | null);
      return {
        summary: `Added ${title}${date ? ` on ${date}` : ""}`,
        category: "completed",
        icon: "➕",
      };
    }
    case "lesson.updated": {
      const title = titleOrFallback(p.lesson_title);
      const changes = (p.changes ?? {}) as Record<string, { from: unknown; to: unknown }>;
      const keys = Object.keys(changes);
      const summaryTail =
        keys.length === 0
          ? ""
          : keys.length === 1
            ? ` (${keys[0]})`
            : ` (${keys.slice(0, 2).join(" + ")}${keys.length > 2 ? ` +${keys.length - 2}` : ""})`;
      return {
        summary: `Edited ${title}${summaryTail}`,
        category: "moved",
        icon: "✏️",
      };
    }
    case "lesson.notes_updated": {
      const title = titleOrFallback(p.lesson_title);
      const len = Number(p.note_length ?? 0);
      const cleared = len === 0;
      return {
        summary: cleared ? `Cleared notes on ${title}` : `Updated notes on ${title}`,
        category: "moved",
        icon: "📝",
      };
    }
    case "lesson.moved": {
      const title = titleOrFallback(p.lesson_title);
      const from = shortDateLabel(p.from_date as string | null);
      const to = shortDateLabel(p.to_date as string | null);
      return {
        summary: `Moved ${title} — ${from} → ${to}`,
        category: "moved",
        icon: "📅",
      };
    }
    case "lesson.completed": {
      const title = titleOrFallback(p.lesson_title);
      return { summary: `Marked ${title} done`, category: "completed", icon: "✅" };
    }
    case "lesson.uncompleted": {
      const title = titleOrFallback(p.lesson_title);
      return {
        summary: `Unmarked ${title}`,
        category: "uncompleted",
        icon: "↩️",
      };
    }
    case "lesson.skipped": {
      const title = titleOrFallback(p.lesson_title);
      return { summary: `Skipped ${title}`, category: "skipped", icon: "⏩" };
    }
    case "lesson.deleted": {
      const title = titleOrFallback(p.lesson_title);
      return { summary: `Deleted ${title}`, category: "deleted", icon: "🗑" };
    }
    case "lesson.bulk_action": {
      const action = String(p.action ?? "move") as LessonBulkAction;
      const count = Number(p.count ?? 0);
      const fromDates = Array.isArray(p.from_dates)
        ? (p.from_dates as (string | null)[])
        : [];
      const uniqueDays = Array.from(
        new Set(fromDates.filter((d): d is string => typeof d === "string" && d.length > 0)),
      );
      const fromLabel =
        uniqueDays.length === 0
          ? ""
          : ` (from ${uniqueDays
              .slice(0, 2)
              .map((d) => shortWeekdayLabel(d))
              .filter(Boolean)
              .join(" + ")})`;
      if (action === "mark_done") {
        return {
          summary: `Marked ${count} lesson${count === 1 ? "" : "s"} done${fromLabel}`,
          category: "bulk",
          icon: "✅",
        };
      }
      if (action === "move") {
        const to = shortDateLabel(p.to_date as string | null);
        return {
          summary: `Moved ${count} lesson${count === 1 ? "" : "s"}${fromLabel} → ${to}`,
          category: "bulk",
          icon: "📅",
        };
      }
      if (action === "skip") {
        return {
          summary: `Skipped ${count} lesson${count === 1 ? "" : "s"}${fromLabel}`,
          category: "bulk",
          icon: "⏩",
        };
      }
      if (action === "catch_up_shift") {
        return {
          summary: `Shifted ${count} lesson${count === 1 ? "" : "s"} forward to catch up`,
          category: "bulk",
          icon: "🗓️",
        };
      }
      if (action === "push_back_future") {
        const daysVal = Number(p.school_days_shifted ?? 0);
        const daysLabel = daysVal > 0
          ? ` by ${daysVal} school day${daysVal === 1 ? "" : "s"}`
          : "";
        return {
          summary: `Pushed ${count} future lesson${count === 1 ? "" : "s"} back${daysLabel}`,
          category: "bulk",
          icon: "⏭",
        };
      }
      if (action === "push_back_missed_fit") {
        return {
          summary: `Filled vacated days with ${count} missed lesson${count === 1 ? "" : "s"}`,
          category: "bulk",
          icon: "🧩",
        };
      }
      return {
        summary: `Deleted ${count} lesson${count === 1 ? "" : "s"}${fromLabel}`,
        category: "bulk",
        icon: "🗑",
      };
    }
    case "appointment.created": {
      const title = typeof p.title === "string" ? p.title : "appointment";
      const date = shortDateLabel(p.date as string | null);
      return {
        summary: `Added appointment: ${title}${date ? ` on ${date}` : ""}`,
        category: "appointment",
        icon: "📍",
      };
    }
    case "appointment.updated": {
      const title = typeof p.title === "string" ? p.title : "appointment";
      return {
        summary: `Updated appointment: ${title}`,
        category: "appointment",
        icon: "📍",
      };
    }
    case "appointment.deleted": {
      const title = typeof p.title === "string" ? p.title : "appointment";
      const date = shortDateLabel(p.date as string | null);
      return {
        summary: `Deleted appointment: ${title}${date ? ` on ${date}` : ""}`,
        category: "appointment",
        icon: "📍",
      };
    }
    case "vacation_block.created": {
      const name = typeof p.name === "string" && p.name.length > 0 ? p.name : "Break";
      const start = shortDateLabel(p.start_date as string | null);
      const end = shortDateLabel(p.end_date as string | null);
      const range = start === end ? start : `${start} – ${end}`;
      const shifted = p.shift_applied === true;
      return {
        summary: shifted
          ? `Added break: ${name} (${range}) and shifted lessons forward`
          : `Added break: ${name} (${range})`,
        category: "vacation",
        icon: "🏖",
      };
    }
    case "vacation_block.deleted": {
      const name = typeof p.name === "string" && p.name.length > 0 ? p.name : "Break";
      return {
        summary: `Removed break: ${name}`,
        category: "vacation",
        icon: "🏖",
      };
    }
    default: {
      return { summary: String(row.type), category: "moved", icon: "•" };
    }
  }
}

// ── Per-day filter ─────────────────────────────────────────────────────────

/**
 * Return the events whose payload touches `targetDateStr` — meaning any of
 * { date, from_date, to_date, start_date, end_date } equals the target OR
 * the target falls inside a start_date..end_date range (vacation blocks).
 */
export function filterEventsForDay(
  events: PlanEventRow[],
  targetDateStr: string,
): PlanEventRow[] {
  return events.filter((e) => {
    const p = (e.payload ?? {}) as Record<string, unknown>;
    const date = typeof p.date === "string" ? p.date : undefined;
    const fromDate = typeof p.from_date === "string" ? p.from_date : undefined;
    const toDate = typeof p.to_date === "string" ? p.to_date : undefined;
    const startDate = typeof p.start_date === "string" ? p.start_date : undefined;
    const endDate = typeof p.end_date === "string" ? p.end_date : undefined;

    if (date === targetDateStr) return true;
    if (fromDate === targetDateStr) return true;
    if (toDate === targetDateStr) return true;

    if (startDate && endDate) {
      if (targetDateStr >= startDate && targetDateStr <= endDate) return true;
    } else if (startDate === targetDateStr || endDate === targetDateStr) {
      return true;
    }

    // Bulk events store from_dates[] + optional to_date.
    const fromDates = Array.isArray(p.from_dates) ? (p.from_dates as unknown[]) : [];
    if (fromDates.some((d) => typeof d === "string" && d === targetDateStr)) return true;

    return false;
  });
}

// ── Counter for the collapsed header summary ──────────────────────────────

/** Count events in the last `days` days. Used for the collapsed card header. */
export function countEventsInLastDays(
  events: PlanEventRow[],
  days: number,
  now: Date = new Date(),
): number {
  const cutoff = new Date(now);
  cutoff.setDate(cutoff.getDate() - days);
  const cutoffMs = cutoff.getTime();
  let n = 0;
  for (const e of events) {
    if (new Date(e.created_at).getTime() >= cutoffMs) n++;
  }
  return n;
}
