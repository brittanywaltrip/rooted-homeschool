"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, ChevronRight, Plus, Printer } from "lucide-react";
import { CheckCircle, InlineLeaf } from "@/app/components/PlanV2/print-decorations";

/* ============================================================================
 * DailyListCard — single auto-created "Today" checklist on the Today page.
 *
 * Distinct from <ListsSection> (which manages many user-created lists) — this
 * is one persistent list scoped per user, identified by name="Today" +
 * sort_order=-1. The sort_order sentinel keeps it out of the way of the
 * normal sort-order lane that ListsSection uses (>= 0) and pins it to the
 * top whenever lists are sorted ascending.
 *
 * Editing pattern:
 *   - Hollow circle on the left = uncompleted item; tap to fill + strike.
 *   - Text input is debounced — 500ms after the last keystroke we PATCH.
 *   - Enter on the last input = blank new item; Backspace on an empty
 *     input = delete that item.
 *   - "Saving…" / "Saved ✓" / "Couldn't save" indicator next to the
 *     header, mirroring the day-panel notes editor pattern.
 *
 * Print: parent owns the trigger. We just expose `items` upward via the
 * `onItemsLoaded` callback so the parent can pass them into DailyPrintSheet.
 * ==========================================================================*/

type ListRow = {
  id: string;
  name: string;
  emoji: string | null;
  sort_order: number | null;
  archived: boolean;
};

export type DailyListItem = {
  id: string;
  list_id: string;
  text: string;
  done: boolean;
  sort_order: number | null;
};

type SaveState = "idle" | "saving" | "saved" | "error";

const COLLAPSE_KEY = "rooted_today_daily_list_collapsed_v1";
const DEBOUNCE_MS = 500;
const SAVED_INDICATOR_MS = 1500;

export interface DailyListCardProps {
  /** Returns a fresh Supabase access token. Mirrors the ListsSection pattern. */
  getToken: () => Promise<string | null>;
  /** Fired whenever the loaded items array changes — Today page passes them
   *  to DailyPrintSheet so the print sheet stays in sync. */
  onItemsChange?: (items: DailyListItem[]) => void;
  /** Today page invokes its own window.print() flow. We just notify via a
   *  callback so the parent can set up the body class + print sheet. */
  onPrint?: () => void;
}

export default function DailyListCard(props: DailyListCardProps) {
  const { getToken, onItemsChange, onPrint } = props;
  const [list, setList] = useState<ListRow | null>(null);
  const [items, setItems] = useState<DailyListItem[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [collapsed, setCollapsed] = useState(false);
  const [collapsedLoaded, setCollapsedLoaded] = useState(false);

  // Per-item debounce timers, keyed by item id.
  const debounceTimersRef = useRef<Map<string, number>>(new Map());
  const savedTimerRef = useRef<number | null>(null);

  // Read the persisted collapse state once on mount (post-hydration).
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

  // ── Load (or create) the daily list + its items ─────────────────────────
  const load = useCallback(async () => {
    const token = await getToken();
    if (!token) return;
    try {
      const res = await fetch("/api/lists", {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) return;
      const allLists = (await res.json()) as ListRow[];
      // Sentinel: name="Today" + sort_order=-1.
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

      const itemsRes = await fetch(`/api/list-items?list_id=${daily.id}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (itemsRes.ok) {
        const data = (await itemsRes.json()) as DailyListItem[];
        const sorted = data.slice().sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
        setItems(sorted);
      }
    } catch { /* silent — empty list is fine */ }
    setLoaded(true);
  }, [getToken]);

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

  // Notify parent when items change.
  useEffect(() => {
    if (!loaded) return;
    onItemsChange?.(items);
    // onItemsChange identity may change per render — depend on items only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, loaded]);

  // ── Save helpers ────────────────────────────────────────────────────────
  function flashSaved() {
    setSaveState("saved");
    if (savedTimerRef.current !== null) window.clearTimeout(savedTimerRef.current);
    savedTimerRef.current = window.setTimeout(() => {
      setSaveState("idle");
      savedTimerRef.current = null;
    }, SAVED_INDICATOR_MS);
  }

  const persistTextChange = useCallback(async (item: DailyListItem) => {
    const token = await getToken();
    if (!token) return;
    setSaveState("saving");
    try {
      const res = await fetch("/api/list-items", {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ id: item.id, text: item.text }),
      });
      if (!res.ok) throw new Error("patch failed");
      flashSaved();
    } catch {
      setSaveState("error");
    }
  }, [getToken]);

  function scheduleTextSave(item: DailyListItem) {
    const existing = debounceTimersRef.current.get(item.id);
    if (existing !== undefined) window.clearTimeout(existing);
    const t = window.setTimeout(() => {
      debounceTimersRef.current.delete(item.id);
      void persistTextChange(item);
    }, DEBOUNCE_MS);
    debounceTimersRef.current.set(item.id, t);
  }

  function updateItemText(id: string, text: string) {
    setItems((prev) => {
      const next = prev.map((i) => (i.id === id ? { ...i, text } : i));
      const updated = next.find((i) => i.id === id);
      if (updated) scheduleTextSave(updated);
      return next;
    });
  }

  async function toggleDone(item: DailyListItem) {
    setItems((prev) => prev.map((i) => (i.id === item.id ? { ...i, done: !i.done } : i)));
    const token = await getToken();
    if (!token) return;
    setSaveState("saving");
    try {
      const res = await fetch("/api/list-items", {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ id: item.id, done: !item.done }),
      });
      if (!res.ok) throw new Error("patch failed");
      flashSaved();
    } catch {
      setSaveState("error");
      // Roll back the optimistic flip.
      setItems((prev) => prev.map((i) => (i.id === item.id ? { ...i, done: item.done } : i)));
    }
  }

  async function addItem(initialText = "") {
    if (!list) return;
    const token = await getToken();
    if (!token) return;
    setSaveState("saving");
    try {
      const nextOrder = items.length > 0 ? (items[items.length - 1].sort_order ?? 0) + 1 : 0;
      const res = await fetch("/api/list-items", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ list_id: list.id, text: initialText, sort_order: nextOrder }),
      });
      if (!res.ok) throw new Error("post failed");
      const created = (await res.json()) as DailyListItem;
      setItems((prev) => [...prev, created]);
      flashSaved();
      // Focus the new input on next paint.
      window.requestAnimationFrame(() => {
        const el = document.querySelector<HTMLInputElement>(
          `[data-daily-list-input="${created.id}"]`,
        );
        el?.focus();
      });
    } catch {
      setSaveState("error");
    }
  }

  async function deleteItem(item: DailyListItem) {
    setItems((prev) => prev.filter((i) => i.id !== item.id));
    const token = await getToken();
    if (!token) return;
    try {
      await fetch("/api/list-items", {
        method: "DELETE",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ id: item.id }),
      });
      flashSaved();
    } catch {
      setSaveState("error");
    }
    // Cancel any pending text-save for the deleted item.
    const t = debounceTimersRef.current.get(item.id);
    if (t !== undefined) {
      window.clearTimeout(t);
      debounceTimersRef.current.delete(item.id);
    }
  }

  function handleInputKeyDown(e: React.KeyboardEvent<HTMLInputElement>, item: DailyListItem, isLast: boolean) {
    if (e.key === "Enter") {
      e.preventDefault();
      // Only enter-to-add when on the last row (matches the spec).
      if (isLast) void addItem();
    } else if (e.key === "Backspace" && item.text === "") {
      e.preventDefault();
      void deleteItem(item);
    }
  }

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
                    key={item.id}
                    className="flex items-center gap-2 group"
                    style={{
                      borderBottom: isLast ? "none" : "1px dotted var(--paper-line, #E8DFC8)",
                      paddingBottom: isLast ? 0 : 2,
                    }}
                  >
                    <button
                      type="button"
                      onClick={() => void toggleDone(item)}
                      aria-label={item.done ? "Mark incomplete" : "Mark complete"}
                      className="shrink-0 inline-flex items-center justify-center"
                    >
                      <CheckCircle filled={item.done} size={20} />
                    </button>
                    <input
                      data-daily-list-input={item.id}
                      type="text"
                      value={item.text}
                      onChange={(e) => updateItemText(item.id, e.target.value)}
                      onKeyDown={(e) => handleInputKeyDown(e, item, isLast)}
                      placeholder="Write a reminder…"
                      className="flex-1 min-w-0 bg-transparent border-0 outline-none text-[14px] py-1.5 placeholder:text-[#c8b598]"
                      style={{
                        color: "#2d2926",
                        textDecoration: item.done ? "line-through" : "none",
                      }}
                    />
                    <button
                      type="button"
                      onClick={() => void deleteItem(item)}
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
              onClick={() => void addItem()}
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
