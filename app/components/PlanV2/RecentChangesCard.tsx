"use client";

import { useMemo, useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import {
  countEventsInLastDays,
  dateGroupKey,
  dateGroupLabel,
  formatEvent,
  relativeTimestamp,
  type FormattedEvent,
  type PlanEventRow,
} from "@/lib/audit-log";

/* ============================================================================
 * RecentChangesCard — inline audit trail below the calendar.
 *
 * Collapsed state shows "Recent changes · N in the last 7 days"; expanded
 * state shows up to `initialPageSize` events, grouped by local-day header
 * ("Today", "Yesterday", "Mon Apr 21"). Pagination is additive — the "See
 * all" button bumps the visible-count by +30 each press, up to the total
 * number of loaded rows. If the caller loaded only 100 rows and the user
 * hits the bottom, the card shows a "Showing the last 100 changes" note.
 *
 * Pure presentational component. Formatter + categorization live in
 * lib/audit-log so the per-day panel can reuse the same shapes.
 * ==========================================================================*/

const CATEGORY_BORDER: Record<FormattedEvent["category"], string> = {
  completed: "#5c7f63",
  uncompleted: "#b5aca4",
  moved: "#d9b670",
  skipped: "#9a8e84",
  deleted: "#b91c1c",
  bulk: "#5c7f63",
  appointment: "#7C3AED",
  vacation: "#C4962A",
};

const CATEGORY_BG: Record<FormattedEvent["category"], string> = {
  completed: "#e8f0e9",
  uncompleted: "#f4f0e8",
  moved: "#fef9e8",
  skipped: "#f4f0e8",
  deleted: "#fef2f2",
  bulk: "#e8f0e9",
  appointment: "#f5f0ff",
  vacation: "#fef9e8",
};

export interface RecentChangesCardProps {
  events: PlanEventRow[];
  /** Called to load more rows when the user presses "See all" and the
   *  visible window has exhausted what's already in memory. Optional — if
   *  omitted, pagination stops at the end of the loaded set. */
  onLoadMore?: () => Promise<void>;
  /** True while onLoadMore is in flight. */
  loadingMore?: boolean;
  /** If true, all rows that could be loaded are already in `events`. */
  fullyLoaded?: boolean;
  initialPageSize?: number;
}

const DEFAULT_PAGE_SIZE = 30;
const PAGE_SIZE_STEP = 30;

export default function RecentChangesCard(props: RecentChangesCardProps) {
  const {
    events,
    onLoadMore,
    loadingMore,
    fullyLoaded,
    initialPageSize = DEFAULT_PAGE_SIZE,
  } = props;

  const [expanded, setExpanded] = useState(false);
  const [visibleCount, setVisibleCount] = useState(initialPageSize);

  const last7d = useMemo(() => countEventsInLastDays(events, 7), [events]);

  const visibleEvents = useMemo(() => events.slice(0, visibleCount), [events, visibleCount]);

  // Group by local-calendar-day. Events are already sorted desc by caller.
  const grouped = useMemo(() => {
    const groups: { label: string; key: string; rows: PlanEventRow[] }[] = [];
    let current: { label: string; key: string; rows: PlanEventRow[] } | null = null;
    for (const e of visibleEvents) {
      const key = dateGroupKey(e.created_at);
      if (!current || current.key !== key) {
        current = { key, label: dateGroupLabel(e.created_at), rows: [] };
        groups.push(current);
      }
      current.rows.push(e);
    }
    return groups;
  }, [visibleEvents]);

  async function handleSeeMore() {
    // Reveal more from the already-loaded set first; only call onLoadMore
    // when the visible window has caught up to what's in memory.
    if (visibleCount < events.length) {
      setVisibleCount((v) => Math.min(v + PAGE_SIZE_STEP, events.length));
      return;
    }
    if (fullyLoaded || !onLoadMore) return;
    await onLoadMore();
    setVisibleCount((v) => v + PAGE_SIZE_STEP);
  }

  const hasMore = visibleCount < events.length || (!fullyLoaded && !!onLoadMore);

  return (
    <section
      aria-label="Recent changes"
      className="bg-white border border-[#e8e5e0] rounded-2xl overflow-hidden"
    >
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
        aria-controls="recent-changes-body"
        className="w-full flex items-center gap-2.5 px-4 py-3 text-left hover:bg-[#faf8f4] transition-colors"
      >
        <span aria-hidden className="text-base leading-none">
          📋
        </span>
        <div className="flex-1 min-w-0">
          <p className="text-[13px] font-semibold text-[#2d2926] leading-tight">
            Recent changes
          </p>
          <p className="text-[11px] text-[#7a6f65] mt-0.5">
            {last7d} in the last 7 days
          </p>
        </div>
        {expanded ? (
          <ChevronDown size={16} className="text-[#7a6f65]" />
        ) : (
          <ChevronRight size={16} className="text-[#7a6f65]" />
        )}
      </button>

      {expanded ? (
        <div
          id="recent-changes-body"
          className="border-t border-[#f0ede8] px-4 py-3"
        >
          {events.length === 0 ? (
            <p className="text-xs text-[#9a8e84] text-center py-4">
              No recent changes. Your calendar is quiet.
            </p>
          ) : (
            <>
              {grouped.map((g) => (
                <div key={g.key} className="mb-3 last:mb-0">
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-[#8B7E74] mb-1.5">
                    {g.label}
                  </p>
                  <ul className="space-y-1.5">
                    {g.rows.map((row) => (
                      <EventRow key={row.id} row={row} />
                    ))}
                  </ul>
                </div>
              ))}

              {hasMore ? (
                <div className="flex justify-center pt-2">
                  <button
                    type="button"
                    onClick={handleSeeMore}
                    disabled={loadingMore}
                    className="text-[11px] font-semibold text-[#5c7f63] hover:text-[var(--g-deep)] px-3 py-1.5 rounded-lg hover:bg-[#e8f0e9] transition-colors disabled:opacity-50"
                  >
                    {loadingMore ? "Loading…" : "See all"}
                  </button>
                </div>
              ) : events.length >= 100 ? (
                <p className="text-[10px] text-[#b5aca4] text-center pt-2">
                  Showing the last {events.length} changes.
                </p>
              ) : null}
            </>
          )}
        </div>
      ) : null}
    </section>
  );
}

function EventRow({ row }: { row: PlanEventRow }) {
  const formatted = formatEvent(row);
  const border = CATEGORY_BORDER[formatted.category];
  const bg = CATEGORY_BG[formatted.category];
  return (
    <li
      className="flex items-start gap-2.5 rounded-lg px-2.5 py-1.5"
      style={{ borderLeft: `3px solid ${border}`, background: bg }}
    >
      <span aria-hidden className="text-[13px] leading-none mt-0.5 shrink-0">
        {formatted.icon}
      </span>
      <div className="flex-1 min-w-0">
        <p className="text-[12px] text-[#2d2926] leading-snug">
          {formatted.summary}
        </p>
      </div>
      <span
        className="text-[10px] text-[#9a8e84] tabular-nums shrink-0 mt-0.5"
        title={new Date(row.created_at).toLocaleString()}
      >
        {relativeTimestamp(row.created_at)}
      </span>
    </li>
  );
}
