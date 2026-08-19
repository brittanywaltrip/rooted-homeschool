"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Search, X } from "lucide-react";
import { supabase } from "@/lib/supabase";
import type { PlanV2Child, PlanV2Lesson } from "./types";

/* ============================================================================
 * LessonSearchModal: find a lesson anywhere in the family's history.
 *
 * The Plan calendar only ever loads a 42-day window (usePlanV2Data), and
 * expanding a curriculum shows only the rows that happen to fall inside it.
 * There was no other way to look a lesson up, so families concluded lessons
 * had been deleted. This queries the lessons table with NO DATE RANGE at all,
 * which is the whole point: the rows people cannot find are precisely the ones
 * outside the current window.
 *
 * Three kinds of row are deliberately INCLUDED rather than filtered out,
 * because each one is a reason a lesson looks lost:
 *   - lessons under an archived ("Mark as finished") curriculum, which
 *     usePlanV2Data explicitly hides from the calendar
 *   - lessons with no scheduled_date AND no date, which render nowhere in the
 *     app today (the orphan-cleanup trigger clears both caches, see migration
 *     20260730100000_orphan_cleanup_clear_date_caches.sql)
 *   - completed history far outside the visible window
 * Each gets a muted tag so the family can see WHY it was not on the calendar.
 *
 * Read-only. Selecting a row hands the lesson back to the parent, which owns
 * the calendar navigation.
 * ==========================================================================*/

/** A lesson row plus the goal fields the search needs for grouping + tagging. */
export type LessonSearchResult = Omit<PlanV2Lesson, "curriculum_goals"> & {
  curriculum_goals?: {
    subject_label: string | null;
    curriculum_name: string | null;
    archived: boolean | null;
  } | null;
};

export interface LessonSearchModalProps {
  isOpen: boolean;
  onClose: () => void;
  effectiveUserId: string | undefined;
  childrenList: PlanV2Child[];
  /** Parent decides what "jump" means (month/week/focus) and owns the notice
   *  shown when the lesson has no date to jump to. */
  onJumpToLesson: (lesson: LessonSearchResult) => void;
}

const DEBOUNCE_MS = 250;
const RESULT_LIMIT = 50;
const NO_GOAL_GROUP = "One-off lessons";

function formatDate(dateStr: string | null | undefined): string {
  if (!dateStr) return "";
  const [y, m, d] = dateStr.split("-").map(Number);
  if (!y || !m || !d) return "";
  return new Date(y, m - 1, d).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export default function LessonSearchModal(props: LessonSearchModalProps) {
  const { isOpen, onClose, effectiveUserId, childrenList, onJumpToLesson } = props;

  const [query, setQuery] = useState("");
  const [results, setResults] = useState<LessonSearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** The query the current `results` came from. Distinguishes "typed nothing
   *  yet" from "searched and found nothing", which need different copy. */
  const [searchedQuery, setSearchedQuery] = useState("");
  const inputRef = useRef<HTMLInputElement | null>(null);
  // Monotonic request id, same guard usePlanV2Data uses: a slow earlier query
  // must never overwrite the results of a newer one.
  const seqRef = useRef(0);

  // No reset-on-open effect: the parent mounts this only while it is open, so
  // every open starts from fresh initial state.
  useEffect(() => {
    const t = setTimeout(() => inputRef.current?.focus(), 20);
    return () => clearTimeout(t);
  }, []);

  const runSearch = useCallback(async (q: string) => {
    if (!effectiveUserId || q.length === 0) {
      setResults([]);
      setSearchedQuery("");
      setLoading(false);
      setError(null);
      return;
    }
    const requestId = ++seqRef.current;
    setLoading(true);
    setError(null);

    // Same lesson columns usePlanV2Data selects, plus the goal's name and
    // archived flag for grouping and the "Finished curriculum" tag.
    let req = supabase
      .from("lessons")
      .select(
        "id, title, lesson_number, completed, child_id, scheduled_date, date, curriculum_goal_id, hours, minutes_spent, notes, scheduled_source, completed_at, subjects(name, color), curriculum_goals(subject_label, curriculum_name, archived)",
      )
      .eq("user_id", effectiveUserId);

    // A bare number is almost always a lesson number, but titles contain
    // digits too ("Chapter 12 review"), so a numeric query matches either.
    // Non-numeric queries only ever touch the title.
    //
    // The .or() string is built by hand, so its values must not contain the
    // commas or parens PostgREST parses. Here they cannot: this branch only
    // runs when the query is /^\d+$/. Anything else goes through .ilike(),
    // where supabase-js does the escaping.
    if (/^\d+$/.test(q)) {
      req = req.or(`lesson_number.eq.${Number(q)},title.ilike.*${q}*`);
    } else {
      req = req.ilike("title", `%${q}%`);
    }

    // NO DATE RANGE FILTER. See the module comment.
    const { data, error: err } = await req
      .order("scheduled_date", { ascending: false, nullsFirst: false })
      .limit(RESULT_LIMIT);

    if (seqRef.current !== requestId) return; // superseded
    if (err) {
      setError("Couldn't search right now. Check your connection and try again.");
      setResults([]);
      setSearchedQuery(q);
      setLoading(false);
      return;
    }
    setResults((data ?? []) as unknown as LessonSearchResult[]);
    setSearchedQuery(q);
    setLoading(false);
  }, [effectiveUserId]);

  // Debounce and search in one effect. The state writes all happen inside the
  // timeout callback rather than the effect body, so typing does not cascade a
  // render per keystroke.
  useEffect(() => {
    const q = query.trim();
    const t = setTimeout(() => { void runSearch(q); }, DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [query, runSearch]);

  const childNameById = useMemo(() => {
    const m = new Map<string, string>();
    for (const c of childrenList) m.set(c.id, c.name);
    return m;
  }, [childrenList]);

  // Group by curriculum, preserving the order results came back in so the
  // most recently scheduled curriculum leads.
  const groups = useMemo(() => {
    const out: { key: string; archived: boolean; rows: LessonSearchResult[] }[] = [];
    const byKey = new Map<string, { key: string; archived: boolean; rows: LessonSearchResult[] }>();
    for (const r of results) {
      const key = r.curriculum_goals?.curriculum_name?.trim() || NO_GOAL_GROUP;
      let g = byKey.get(key);
      if (!g) {
        g = { key, archived: !!r.curriculum_goals?.archived, rows: [] };
        byKey.set(key, g);
        out.push(g);
      }
      g.rows.push(r);
    }
    return out;
  }, [results]);

  if (!isOpen) return null;

  const showEmpty = !loading && !error && searchedQuery.length > 0 && results.length === 0;

  return (
    <>
      <div className="fixed inset-0 bg-black/30 backdrop-blur-sm z-[70]" onClick={onClose} aria-hidden />
      <div className="fixed inset-0 z-[70] flex items-end sm:items-center justify-center sm:p-3 pointer-events-none">
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Find a lesson"
          // Full-height sheet on phones, centered card from sm up. Mirrors
          // AddLessonModal's items-end / sm:items-center handling.
          className="bg-[#fefcf9] w-full max-w-lg pointer-events-auto flex flex-col overflow-hidden rounded-t-2xl sm:rounded-2xl shadow-xl h-[92vh] sm:h-auto sm:max-h-[80vh]"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex items-start justify-between gap-2 px-5 pt-4 pb-2 shrink-0">
            <div className="min-w-0">
              <h2 className="text-base font-bold text-[#2d2926]">Find a lesson</h2>
              <p className="text-xs text-[#7a6f65] mt-0.5">
                Searches everything, including past months and finished curriculums.
              </p>
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close search"
              className="shrink-0 w-8 h-8 flex items-center justify-center rounded-full text-[#b5aca4] hover:bg-[#f0ede8] transition-colors"
            >
              <X size={16} />
            </button>
          </div>

          <div className="px-5 pb-3 shrink-0">
            <div className="relative">
              <Search
                size={15}
                aria-hidden
                className="absolute left-3 top-1/2 -translate-y-1/2 text-[#b5aca4] pointer-events-none"
              />
              <input
                ref={inputRef}
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search lessons by title or number"
                aria-label="Search lessons by title or number"
                className="w-full border border-[#e8e2d9] rounded-xl bg-white pl-9 pr-3 py-2.5 text-sm text-[#2d2926] placeholder:text-[#c4bfb8] focus:outline-none focus:border-[#5c7f63] focus:ring-2 focus:ring-[#5c7f63]/20"
              />
            </div>
          </div>

          <div className="px-5 pb-5 overflow-y-auto flex-1">
            {error ? (
              <p className="text-[12px] text-[#b91c1c] py-3">{error}</p>
            ) : loading ? (
              <p className="text-sm text-[#9a8e84] py-4 text-center">Searching…</p>
            ) : query.trim().length === 0 ? (
              <p className="text-sm text-[#9a8e84] py-4 text-center">
                Type a lesson number, or part of a title.
              </p>
            ) : showEmpty ? (
              <p className="text-sm text-[#9a8e84] py-4 text-center">
                No lessons match that. Try a lesson number, or part of the title.
              </p>
            ) : (
              <div className="space-y-3">
                {results.length === RESULT_LIMIT ? (
                  <p className="text-[11px] text-[#9a8e84]">
                    Showing the first {RESULT_LIMIT} matches. Narrow your search to see more.
                  </p>
                ) : null}
                {groups.map((g) => (
                  <div key={g.key}>
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-[#8B7E74] mb-1.5">
                      {g.key}
                    </p>
                    <ul className="space-y-1">
                      {g.rows.map((l) => {
                        const dateStr = l.scheduled_date ?? l.date;
                        const childName = l.child_id ? childNameById.get(l.child_id) : null;
                        const isArchived = !!l.curriculum_goals?.archived;
                        const offCalendar = !dateStr;
                        const title =
                          l.title && l.title.trim().length > 0
                            ? l.title
                            : l.lesson_number
                              ? `Lesson ${l.lesson_number}`
                              : "Lesson";
                        return (
                          <li key={l.id}>
                            <button
                              type="button"
                              onClick={() => onJumpToLesson(l)}
                              className="w-full text-left flex items-start gap-2 bg-white border border-[#e8e2d9] rounded-lg px-2.5 py-2 hover:bg-[#faf8f4] transition-colors"
                            >
                              <span
                                aria-hidden
                                className="shrink-0 mt-0.5 w-4 h-4 rounded-full border-2 flex items-center justify-center"
                                style={{
                                  borderColor: l.completed ? "#5c7f63" : "#c8bfb5",
                                  backgroundColor: l.completed ? "#5c7f63" : "transparent",
                                }}
                              >
                                {l.completed ? (
                                  <svg viewBox="0 0 8 7" width="7" height="6" fill="none">
                                    <path
                                      d="M1 3.5l1.8 2L7 1"
                                      stroke="white"
                                      strokeWidth="1.5"
                                      strokeLinecap="round"
                                      strokeLinejoin="round"
                                    />
                                  </svg>
                                ) : null}
                              </span>
                              <span className="min-w-0 flex-1">
                                <span className="block text-[12px] font-medium text-[#2d2926] leading-tight break-words">
                                  {title}
                                  {l.completed ? (
                                    <span className="sr-only"> (completed)</span>
                                  ) : null}
                                </span>
                                <span className="block text-[10px] text-[#9a8e84] mt-0.5">
                                  {[
                                    l.lesson_number != null ? `Lesson ${l.lesson_number}` : null,
                                    childName,
                                    dateStr ? formatDate(dateStr) : null,
                                  ]
                                    .filter(Boolean)
                                    .join(" · ")}
                                </span>
                                {isArchived || offCalendar ? (
                                  <span className="flex flex-wrap gap-1 mt-1">
                                    {isArchived ? (
                                      <span className="text-[10px] rounded-full px-1.5 py-0.5 bg-[#f0ede8] text-[#7a6f65]">
                                        Finished curriculum
                                      </span>
                                    ) : null}
                                    {offCalendar ? (
                                      <span className="text-[10px] rounded-full px-1.5 py-0.5 bg-[#f0ede8] text-[#7a6f65]">
                                        Not on the calendar
                                      </span>
                                    ) : null}
                                  </span>
                                ) : null}
                              </span>
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
