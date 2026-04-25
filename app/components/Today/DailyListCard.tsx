"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, ChevronRight, Plus, Printer } from "lucide-react";
import { CheckCircle, InlineLeaf } from "@/app/components/PlanV2/print-decorations";

/* ============================================================================
 * DailyListCard — single auto-created "Today" checklist on the Today page.
 *
 * Distinct from <ListsSection> (which manages many user-created lists) — this
 * is one persistent list scoped per user, identified by name="Today" +
 * sort_order=-1.
 *
 * Add / save semantics (must match `/api/list-items` validation, which
 * rejects empty `text` on POST):
 *   - "+ Add item" creates a row LOCAL-ONLY with a temp id and isPending=true.
 *     No network call. The input is focused so the user can start typing.
 *   - Typing into a row debounces 500ms. When the timer fires:
 *       · pending + non-empty text → POST; on success, swap temp id with the
 *         server id and clear isPending. If the user typed more text (or
 *         toggled done) while the POST was in flight, follow up with a PATCH
 *         using the freshest state.
 *       · pending + empty text → no-op (we never POST blanks).
 *       · real + empty text → DELETE the row (text cleared = remove).
 *       · real + non-empty text → PATCH text + done.
 *   - Toggling the checkbox on a pending row only flips local state — the
 *     follow-up POST + PATCH cycle persists `done`.
 *   - Backspace on an empty row removes it (DELETE if it had a server id);
 *     focus moves to the previous row's input at end-of-text.
 *   - Enter on a row with text appends a new pending row right after.
 *   - Enter on an empty row is a no-op (no chains of empties).
 *
 * Status indicator: "Saving" while any debounce is queued OR a fetch is in
 * flight. "Saved ✓" briefly after all settled (1.5s fade). "Couldn't save"
 * sticks until the next save attempt; the row text is preserved so the
 * user doesn't lose work.
 * ==========================================================================*/

type ListRow = {
  id: string;
  name: string;
  emoji: string | null;
  sort_order: number | null;
  archived: boolean;
};

/** Public shape exported to the Today page (and into DailyPrintSheet via the
 *  parent). isPending + rowKey are intentionally omitted — consumers only
 *  need id/text/done. */
export type DailyListItem = {
  id: string;
  list_id: string;
  text: string;
  done: boolean;
  sort_order: number | null;
};

/** Internal row shape — adds a stable rowKey (so React reuses the input
 *  element across the temp→real id swap, preserving focus + cursor) and an
 *  isPending flag (true until we've POSTed it). */
type LocalItem = DailyListItem & {
  rowKey: string;
  isPending: boolean;
};

type SaveState = "idle" | "saving" | "saved" | "error";

const COLLAPSE_KEY = "rooted_today_daily_list_collapsed_v1";
const DEBOUNCE_MS = 500;
const SAVED_INDICATOR_MS = 1500;

function makeTempId(): string {
  return `temp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export interface DailyListCardProps {
  /** Returns a fresh Supabase access token. Mirrors the ListsSection pattern. */
  getToken: () => Promise<string | null>;
  /** Fired whenever items change — Today page passes them to DailyPrintSheet
   *  so the print sheet stays in sync. Pending (unsaved) rows are excluded. */
  onItemsChange?: (items: DailyListItem[]) => void;
  /** Today page invokes its own window.print() flow. */
  onPrint?: () => void;
}

export default function DailyListCard(props: DailyListCardProps) {
  const { getToken, onItemsChange, onPrint } = props;
  const [list, setList] = useState<ListRow | null>(null);
  const [items, setItems] = useState<LocalItem[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [collapsed, setCollapsed] = useState(false);
  const [collapsedLoaded, setCollapsedLoaded] = useState(false);

  // Refs that mirror items + list so async save callbacks always read the
  // freshest values without a stale closure.
  const itemsRef = useRef<LocalItem[]>([]);
  const listRef = useRef<ListRow | null>(null);
  // Per-row debounce timers, keyed by rowKey. Pending until they fire OR
  // they're cleared because something happened that supersedes the save.
  const debounceTimersRef = useRef<Map<string, number>>(new Map());
  // Set of rowKeys with an in-flight network call. Used to skip overlapping
  // saves (a second debounce that fires while the first is still posting).
  const inflightRef = useRef<Set<string>>(new Set());
  // Sticky error flag for the current "burst" — cleared when a new save
  // starts, so a single failure doesn't block subsequent successful saves
  // from clearing the error state.
  const burstErrorRef = useRef<boolean>(false);
  const savedTimerRef = useRef<number | null>(null);

  /** Update items state AND mirror it to the ref synchronously inside the
   *  setState callback. Async handlers can read itemsRef.current without
   *  worrying about React batching. */
  const updateItems = useCallback((updater: (prev: LocalItem[]) => LocalItem[]) => {
    setItems((prev) => {
      const next = updater(prev);
      itemsRef.current = next;
      return next;
    });
  }, []);

  // ── Collapse state persistence ──────────────────────────────────────────
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const raw = window.localStorage.getItem(COLLAPSE_KEY);
      if (raw === "1") setCollapsed(true);
    } catch { /* private mode */ }
    setCollapsedLoaded(true);
  }, []);

  useEffect(() => {
    if (!collapsedLoaded) return;
    try {
      window.localStorage.setItem(COLLAPSE_KEY, collapsed ? "1" : "0");
    } catch { /* ignore */ }
  }, [collapsed, collapsedLoaded]);

  // ── Save-state transitions ──────────────────────────────────────────────
  const flashSaved = useCallback(() => {
    setSaveState("saved");
    if (savedTimerRef.current !== null) window.clearTimeout(savedTimerRef.current);
    savedTimerRef.current = window.setTimeout(() => {
      setSaveState("idle");
      savedTimerRef.current = null;
    }, SAVED_INDICATOR_MS);
  }, []);

  /** Called after every save attempt. If anything is still pending or in
   *  flight we stay in "saving"; otherwise transition to saved or error
   *  based on whether anything failed during the burst. */
  const settleAfterSave = useCallback(() => {
    const stillBusy =
      inflightRef.current.size > 0 || debounceTimersRef.current.size > 0;
    if (stillBusy) return;
    if (burstErrorRef.current) {
      setSaveState("error");
      // Don't clear burstErrorRef here — let the next save start clear it.
    } else {
      flashSaved();
    }
  }, [flashSaved]);

  // ── Load (or auto-create) the daily list + its items ───────────────────
  const load = useCallback(async () => {
    const token = await getToken();
    if (!token) return;
    try {
      const res = await fetch("/api/lists", {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) return;
      const allLists = (await res.json()) as ListRow[];
      let daily = allLists.find((l) => l.name === "Today" && l.sort_order === -1);
      if (!daily) {
        const insertRes = await fetch("/api/lists", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
          body: JSON.stringify({ name: "Today", emoji: "🌿", sort_order: -1 }),
        });
        if (!insertRes.ok) return;
        daily = (await insertRes.json()) as ListRow;
      }
      setList(daily);
      listRef.current = daily;

      const itemsRes = await fetch(`/api/list-items?list_id=${daily.id}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (itemsRes.ok) {
        const data = (await itemsRes.json()) as DailyListItem[];
        const sorted = data
          .slice()
          .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
          .map<LocalItem>((row) => ({
            ...row,
            rowKey: row.id,
            isPending: false,
          }));
        updateItems(() => sorted);
      }
    } catch { /* silent — empty list is fine */ }
    setLoaded(true);
  }, [getToken, updateItems]);

  useEffect(() => {
    void load();
    // Cleanup any pending debounce timers when the user leaves the page.
    const timers = debounceTimersRef.current;
    return () => {
      timers.forEach((t) => window.clearTimeout(t));
      timers.clear();
      if (savedTimerRef.current !== null) window.clearTimeout(savedTimerRef.current);
    };
  }, [load]);

  // Notify parent when items change. Pending rows are filtered out so the
  // print sheet only ever shows server-acknowledged items.
  useEffect(() => {
    if (!loaded) return;
    const exposed: DailyListItem[] = items
      .filter((i) => !i.isPending)
      .map(({ id, list_id, text, done, sort_order }) => ({ id, list_id, text, done, sort_order }));
    onItemsChange?.(exposed);
    // onItemsChange identity may change per render — depend on items only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, loaded]);

  // ── The single save engine ──────────────────────────────────────────────
  /** Reads the freshest row from itemsRef and decides between POST / PATCH /
   *  DELETE / no-op based on isPending + text. Skips if a save for this
   *  rowKey is already in flight (prevents duplicate POSTs when typing fast
   *  on a slow network). */
  const persistSave = useCallback(async (rowKey: string) => {
    if (inflightRef.current.has(rowKey)) return;
    const item = itemsRef.current.find((i) => i.rowKey === rowKey);
    if (!item) return;
    const text = item.text.trim();
    const listId = listRef.current?.id;

    // No-op: empty pending row. Do NOT POST blank text — the API rejects
    // it, and there's nothing to persist anyway.
    if (item.isPending && text.length === 0) return;

    burstErrorRef.current = false;
    inflightRef.current.add(rowKey);
    setSaveState("saving");

    try {
      const token = await getToken();
      if (!token) throw new Error("no session");

      if (item.isPending) {
        // POST — first time persisting this row.
        if (!listId) throw new Error("no list");
        const res = await fetch("/api/list-items", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
          body: JSON.stringify({ list_id: listId, text }),
        });
        if (!res.ok) throw new Error(`post failed (${res.status})`);
        const created = (await res.json()) as DailyListItem;

        // Swap temp id → real id, clear isPending. rowKey stays the same so
        // React reuses the <input> DOM node and focus + cursor are preserved.
        updateItems((prev) =>
          prev.map((i) =>
            i.rowKey === rowKey
              ? { ...i, id: created.id, sort_order: created.sort_order, isPending: false }
              : i,
          ),
        );

        // Did the user keep typing during the POST? Or toggle done? Read
        // the freshest snapshot and follow up with a PATCH if anything
        // has drifted from what we just sent.
        const fresh = itemsRef.current.find((i) => i.rowKey === rowKey);
        if (fresh) {
          const freshText = fresh.text.trim();
          const driftText = freshText !== text;
          // Server defaults done to false, so any local true needs syncing.
          const driftDone = fresh.done !== false;
          if (driftText || driftDone) {
            // If the follow-up text is empty, DELETE the row instead of
            // PATCH-ing it to "" (which would fail the same validator).
            if (driftText && freshText.length === 0) {
              await fetch("/api/list-items", {
                method: "DELETE",
                headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
                body: JSON.stringify({ id: created.id }),
              });
              updateItems((prev) => prev.filter((i) => i.rowKey !== rowKey));
            } else {
              const patchBody: Record<string, unknown> = { id: created.id };
              if (driftText) patchBody.text = freshText;
              if (driftDone) patchBody.done = fresh.done;
              const patchRes = await fetch("/api/list-items", {
                method: "PATCH",
                headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
                body: JSON.stringify(patchBody),
              });
              if (!patchRes.ok) throw new Error(`followup patch failed (${patchRes.status})`);
            }
          }
        }
      } else if (text.length === 0) {
        // DELETE — user emptied a saved row.
        const res = await fetch("/api/list-items", {
          method: "DELETE",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
          body: JSON.stringify({ id: item.id }),
        });
        if (!res.ok) throw new Error(`delete failed (${res.status})`);
        updateItems((prev) => prev.filter((i) => i.rowKey !== rowKey));
      } else {
        // PATCH — text + done sync for an existing saved row.
        const res = await fetch("/api/list-items", {
          method: "PATCH",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
          body: JSON.stringify({ id: item.id, text, done: item.done }),
        });
        if (!res.ok) throw new Error(`patch failed (${res.status})`);
      }
    } catch {
      burstErrorRef.current = true;
    } finally {
      inflightRef.current.delete(rowKey);
      settleAfterSave();
    }
  }, [getToken, updateItems, settleAfterSave]);

  /** Schedule a debounced save for the given rowKey. Restarts the timer if
   *  one was already queued. */
  const scheduleSave = useCallback((rowKey: string) => {
    const existing = debounceTimersRef.current.get(rowKey);
    if (existing !== undefined) window.clearTimeout(existing);
    setSaveState("saving");
    const t = window.setTimeout(() => {
      debounceTimersRef.current.delete(rowKey);
      void persistSave(rowKey);
    }, DEBOUNCE_MS);
    debounceTimersRef.current.set(rowKey, t);
  }, [persistSave]);

  /** Cancel any debounce queued for the given rowKey (used when the row is
   *  immediately removed via Backspace). */
  const cancelDebounce = useCallback((rowKey: string) => {
    const t = debounceTimersRef.current.get(rowKey);
    if (t !== undefined) {
      window.clearTimeout(t);
      debounceTimersRef.current.delete(rowKey);
    }
  }, []);

  // ── User actions ────────────────────────────────────────────────────────

  /** Append a brand-new row LOCAL ONLY and focus its input. No network call
   *  happens here — the row is persisted only after the user types text and
   *  the debounce fires. */
  const appendPendingRow = useCallback((afterRowKey: string | null) => {
    const tempId = makeTempId();
    if (!list) {
      // List hasn't loaded yet; bail rather than create an orphan row.
      return;
    }
    const newRow: LocalItem = {
      rowKey: tempId,
      id: tempId,
      list_id: list.id,
      text: "",
      done: false,
      sort_order:
        items.length > 0 ? (items[items.length - 1].sort_order ?? 0) + 1 : 0,
      isPending: true,
    };
    updateItems((prev) => {
      if (afterRowKey === null) return [...prev, newRow];
      const idx = prev.findIndex((i) => i.rowKey === afterRowKey);
      if (idx === -1) return [...prev, newRow];
      const next = prev.slice();
      next.splice(idx + 1, 0, newRow);
      return next;
    });
    // Focus the new input on next paint.
    window.requestAnimationFrame(() => {
      const el = document.querySelector<HTMLInputElement>(
        `[data-daily-list-input="${tempId}"]`,
      );
      el?.focus();
    });
  }, [list, items, updateItems]);

  function updateItemText(rowKey: string, text: string) {
    updateItems((prev) => prev.map((i) => (i.rowKey === rowKey ? { ...i, text } : i)));
    scheduleSave(rowKey);
  }

  function toggleDone(item: LocalItem) {
    // Optimistic flip locally regardless of pending state.
    updateItems((prev) =>
      prev.map((i) => (i.rowKey === item.rowKey ? { ...i, done: !i.done } : i)),
    );
    if (item.isPending) {
      // Pending row — don't try to PATCH a temp id. The flip is captured in
      // local state; once the row is POSTed, the post-success handler
      // detects the done drift and PATCHes it then.
      return;
    }
    // Real row — schedule a save. Debounced rather than immediate so a
    // second click doesn't double-fire if the user double-toggles fast.
    scheduleSave(item.rowKey);
  }

  /** Remove a row entirely. Cancels any pending debounce, removes from
   *  state, and DELETE-s if the row had a server id. */
  function removeRow(item: LocalItem, refocusPrevRowKey: string | null) {
    cancelDebounce(item.rowKey);
    updateItems((prev) => prev.filter((i) => i.rowKey !== item.rowKey));
    if (refocusPrevRowKey !== null) {
      window.requestAnimationFrame(() => {
        const el = document.querySelector<HTMLInputElement>(
          `[data-daily-list-input="${refocusPrevRowKey}"]`,
        );
        if (el) {
          el.focus();
          const len = el.value.length;
          el.setSelectionRange(len, len);
        }
      });
    }
    if (item.isPending) return; // never persisted — nothing to delete
    burstErrorRef.current = false;
    inflightRef.current.add(item.rowKey);
    setSaveState("saving");
    void (async () => {
      try {
        const token = await getToken();
        if (!token) throw new Error("no session");
        const res = await fetch("/api/list-items", {
          method: "DELETE",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
          body: JSON.stringify({ id: item.id }),
        });
        if (!res.ok) throw new Error(`delete failed (${res.status})`);
      } catch {
        burstErrorRef.current = true;
      } finally {
        inflightRef.current.delete(item.rowKey);
        settleAfterSave();
      }
    })();
  }

  function handleInputKeyDown(
    e: React.KeyboardEvent<HTMLInputElement>,
    item: LocalItem,
  ) {
    if (e.key === "Enter") {
      e.preventDefault();
      // No chains of empty rows — Enter on an empty input is a no-op.
      if (item.text.trim().length === 0) return;
      appendPendingRow(item.rowKey);
    } else if (e.key === "Backspace" && item.text === "") {
      e.preventDefault();
      const idx = itemsRef.current.findIndex((i) => i.rowKey === item.rowKey);
      const prevRowKey = idx > 0 ? itemsRef.current[idx - 1].rowKey : null;
      removeRow(item, prevRowKey);
    }
  }

  // ── Render ──────────────────────────────────────────────────────────────
  const saveStateLabel = useMemo(() => {
    if (saveState === "saving") return "Saving…";
    if (saveState === "saved") return "Saved ✓";
    if (saveState === "error") return "Couldn't save";
    return "";
  }, [saveState]);

  return (
    <section
      aria-label="Today's list"
      className="paper-bg"
      style={{
        border: "1px solid var(--paper-edge, #f0dda8)",
        borderRadius: 14,
        overflow: "hidden",
      }}
    >
      <button
        type="button"
        onClick={() => setCollapsed((v) => !v)}
        aria-expanded={!collapsed}
        aria-controls="daily-list-body"
        className="w-full flex items-center gap-2 px-4 py-3 text-left hover:bg-[#fff4d8] transition-colors"
      >
        <InlineLeaf size={20} color="var(--leaf-sage, #7C9070)" />
        <span
          className="font-handwritten flex-1"
          style={{ fontSize: 28, lineHeight: 1, color: "var(--ink-primary, #2E3A2A)" }}
        >
          Today
        </span>
        {saveStateLabel ? (
          <span
            className="text-[11px] font-medium"
            style={{
              color:
                saveState === "saved" ? "#5c7f63"
                : saveState === "error" ? "#b91c1c"
                : "#a07000",
            }}
          >
            {saveStateLabel}
          </span>
        ) : null}
        {collapsed ? (
          <ChevronRight size={16} className="text-[#a07000]" />
        ) : (
          <ChevronDown size={16} className="text-[#a07000]" />
        )}
      </button>

      {!collapsed ? (
        <div id="daily-list-body" className="paper-lined px-4 pb-4 pt-0 border-t border-[var(--paper-edge,#f0dda8)]">
          {!loaded ? (
            <p className="text-[12px] text-[#a07000] italic py-3">Loading…</p>
          ) : items.length === 0 ? (
            <p className="text-[12px] text-[#a07000] italic py-3">
              Nothing yet — add a reminder, prep item, or prayer.
            </p>
          ) : (
            <ul className="flex flex-col gap-1 pt-2">
              {items.map((item, idx) => {
                const isLast = idx === items.length - 1;
                return (
                  <li
                    key={item.rowKey}
                    className="flex items-center gap-2 group"
                    style={{
                      borderBottom: isLast ? "none" : "1px dotted var(--paper-line, #E8DFC8)",
                      paddingBottom: isLast ? 0 : 2,
                    }}
                  >
                    <button
                      type="button"
                      onClick={() => toggleDone(item)}
                      aria-label={item.done ? "Mark incomplete" : "Mark complete"}
                      className="shrink-0 inline-flex items-center justify-center"
                    >
                      <CheckCircle filled={item.done} size={20} />
                    </button>
                    <input
                      data-daily-list-input={item.rowKey}
                      type="text"
                      value={item.text}
                      onChange={(e) => updateItemText(item.rowKey, e.target.value)}
                      onKeyDown={(e) => handleInputKeyDown(e, item)}
                      placeholder="Write a reminder…"
                      className="flex-1 min-w-0 bg-transparent border-0 outline-none text-[14px] py-1.5 placeholder:text-[#c8b598]"
                      style={{
                        color: "#2d2926",
                        textDecoration: item.done ? "line-through" : "none",
                      }}
                    />
                    <button
                      type="button"
                      onClick={() => {
                        const i = itemsRef.current.findIndex((x) => x.rowKey === item.rowKey);
                        const prevRowKey = i > 0 ? itemsRef.current[i - 1].rowKey : null;
                        removeRow(item, prevRowKey);
                      }}
                      aria-label="Delete item"
                      className="shrink-0 w-6 h-6 flex items-center justify-center rounded-full text-[#c8b598] hover:text-[#b91c1c] hover:bg-[#fef2f2] opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity"
                    >
                      ×
                    </button>
                  </li>
                );
              })}
            </ul>
          )}

          <div className="flex items-center justify-between mt-3 pt-3 border-t border-[#f0dda8]">
            <button
              type="button"
              onClick={() => appendPendingRow(null)}
              className="flex items-center gap-1 text-[12px] font-semibold text-[#7a4a1a] hover:text-[#5a3a12]"
            >
              <Plus size={13} /> Add item
            </button>
            {onPrint ? (
              <button
                type="button"
                onClick={onPrint}
                className="pencil-btn pencil-btn--gold"
                style={{ fontSize: 14 }}
              >
                <Printer size={12} /> Print today&apos;s list
              </button>
            ) : null}
          </div>
        </div>
      ) : null}
    </section>
  );
}
