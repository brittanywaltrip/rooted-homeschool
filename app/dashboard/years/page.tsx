"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { createSupabaseBrowserClient } from "@/lib/supabase-browser";
import { getGrowthStage } from "@/app/lib/garden-stages";
import { loadLeafCounts } from "@/app/lib/garden-leaves";
import { selectAllRows } from "@/lib/supabase-all-rows";
import { schoolDaysBetween } from "@/app/lib/scheduler";
import { DEFAULT_SCHOOL_DAYS, PAST_YEAR_SOURCE, daysAttendedProblem, schoolDaysInRangeHint } from "@/app/lib/past-year-dates";
import { RespreadRefused, RespreadUndoFailed, respreadPastYear } from "@/app/lib/past-year-respread";
import { captureSupabaseError } from "@/lib/sentry-error";

type SchoolYear = {
  id: string;
  name: string;
  start_date: string;
  end_date: string;
  status: string;
  days_attended: number | null;
};

/**
 * A year filed through Add a past year: every lesson it holds is tagged
 * past_year. Only these get the days Edit, because a year the family lived in
 * Rooted keeps the days they actually logged.
 */
type FiledYearSummary = {
  lessons: number;
  hours: number;
  days: number;
  /** Every school day between the year's dates on its school days: the field's ceiling. */
  schoolDaysInRange: number;
  schoolDays: string[];
};

async function loadFiledYears(
  supabase: ReturnType<typeof createSupabaseBrowserClient>,
  userId: string,
  closed: SchoolYear[],
): Promise<Record<string, FiledYearSummary>> {
  const out: Record<string, FiledYearSummary> = {};
  await Promise.all(
    // Per year: a failed read hides only that year's day count, never the rest.
    closed.map((y) => loadOne(y).catch(() => undefined)),
  );
  return out;

  async function loadOne(y: SchoolYear): Promise<void> {
      const head = { count: "exact" as const, head: true };
      const [filedRes, otherRes] = await Promise.all([
        supabase.from("lessons").select("id", head).eq("user_id", userId).eq("school_year_id", y.id).eq("scheduled_source", PAST_YEAR_SOURCE),
        supabase.from("lessons").select("id", head).eq("user_id", userId).eq("school_year_id", y.id)
          .or(`scheduled_source.is.null,scheduled_source.neq.${PAST_YEAR_SOURCE}`),
      ]);
      if (filedRes.error || otherRes.error) return;
      if ((filedRes.count ?? 0) === 0 || (otherRes.count ?? 0) > 0) return;
      const [rows, { data: goal }] = await Promise.all([
        selectAllRows<{ date: string | null; minutes_spent: number | null }>((from, to) =>
          supabase.from("lessons").select("date, minutes_spent").eq("user_id", userId).eq("school_year_id", y.id).order("id").range(from, to)),
        supabase.from("curriculum_goals").select("school_days").eq("user_id", userId).eq("school_year_id", y.id).limit(1).maybeSingle(),
      ]);
      const schoolDays = ((goal as { school_days: string[] | null } | null)?.school_days ?? null) || DEFAULT_SCHOOL_DAYS;
      // A lesson with no minutes logged counts 30, the default Reports uses
      // for hours, so this card and Reports agree about the same year.
      const minutes = rows.reduce((m, r) => m + (r.minutes_spent ?? 30), 0);
      out[y.id] = {
        lessons: rows.length,
        hours: Math.round((minutes / 60) * 10) / 10,
        // days_attended is the number asked for since September 2026. A year
        // filed before that has none, and its lessons sit on every school day.
        days: y.days_attended ?? new Set(rows.map((r) => r.date).filter(Boolean)).size,
        schoolDaysInRange: schoolDaysBetween(y.start_date, y.end_date, schoolDays).length,
        schoolDays,
      };
  }
}

/** One child's finished tree for one closed year. */
type FinishedTree = { childId: string; name: string; leaves: number; badges: number };

/**
 * The shape the close route writes into school_year_archives.per_child_data.
 * Read, not guessed: app/api/school-year/close/route.ts, step 3.
 */
type ArchivedChild = { child_id?: string; child_name?: string };

/**
 * Last year's finished trees, per closed year.
 *
 * A child's tree starts over each school year, so the tree a family grew last
 * year has to live somewhere: here. The close route's garden_snapshot is a
 * per-curriculum progress list (goal, lessons, percent), not a tree, so the
 * tree is counted from the archived year's own dates with the same leaf rule
 * the Garden uses (app/lib/garden-leaves.ts) and drawn with the same stage
 * table. per_child_data says which children the year belonged to. A year with
 * no archive row (closed before the archive step existed, or filed through
 * "Add a past year") shows without trees.
 */
async function loadFinishedTrees(
  supabase: ReturnType<typeof createSupabaseBrowserClient>,
  userId: string,
  closedYearIds: string[],
): Promise<Record<string, FinishedTree[]>> {
  if (closedYearIds.length === 0) return {};
  const [{ data: archives }, { data: badgeRows }, { data: kids }] = await Promise.all([
    supabase
      .from("school_year_archives")
      .select("school_year_id, start_date, end_date, per_child_data")
      .eq("user_id", userId)
      .in("school_year_id", closedYearIds),
    supabase
      .from("badges")
      .select("school_year_id, child_id")
      .eq("user_id", userId)
      .in("school_year_id", closedYearIds),
    supabase.from("children").select("id, name").eq("user_id", userId),
  ]);
  const nameById: Record<string, string> = {};
  for (const k of (kids ?? []) as { id: string; name: string }[]) nameById[k.id] = k.name;

  const out: Record<string, FinishedTree[]> = {};
  await Promise.all(
    ((archives ?? []) as { school_year_id: string; start_date: string; end_date: string; per_child_data: unknown }[]).map(async (a) => {
      const counts = await loadLeafCounts(supabase, userId, { start: a.start_date, end: a.end_date });
      const badgesByChild: Record<string, number> = {};
      for (const b of (badgeRows ?? []) as { school_year_id: string; child_id: string | null }[]) {
        if (b.school_year_id === a.school_year_id && b.child_id) badgesByChild[b.child_id] = (badgesByChild[b.child_id] ?? 0) + 1;
      }
      const listed = (Array.isArray(a.per_child_data) ? (a.per_child_data as ArchivedChild[]) : [])
        .filter((c) => typeof c.child_id === "string")
        .map((c) => ({ id: c.child_id as string, name: c.child_name || nameById[c.child_id as string] || "" }));
      // An archive whose per-child step failed still has leaves to show.
      const childList = listed.length > 0
        ? listed
        : Object.keys(counts).filter((id) => nameById[id]).map((id) => ({ id, name: nameById[id] }));
      out[a.school_year_id] = childList
        .filter((c) => c.name)
        .map((c) => ({ childId: c.id, name: c.name, leaves: counts[c.id] ?? 0, badges: badgesByChild[c.id] ?? 0 }));
    }),
  );
  return out;
}

function formatMonthYear(iso: string): string {
  const d = new Date(`${iso}T00:00:00`);
  return d.toLocaleDateString("en-US", { month: "short", year: "numeric" });
}

export default function YearsArchivePage() {
  const supabase = useMemo(() => createSupabaseBrowserClient(), []);
  const [years, setYears] = useState<SchoolYear[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [trees, setTrees] = useState<Record<string, FinishedTree[]>>({});
  const [filed, setFiled] = useState<Record<string, FiledYearSummary>>({});
  const [userId, setUserId] = useState<string | null>(null);
  const [editingYearId, setEditingYearId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const [editBusy, setEditBusy] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);
  const [editNote, setEditNote] = useState<Record<string, string>>({});

  useEffect(() => {
    let cancelled = false;
    async function load() {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        if (!cancelled) {
          setYears([]);
          setLoading(false);
        }
        return;
      }
      const { data } = await supabase
        .from("school_years")
        .select("id, name, start_date, end_date, status, days_attended")
        .eq("user_id", user.id)
        .order("start_date", { ascending: false });
      if (cancelled) return;
      const loaded = (data as SchoolYear[] | null) ?? [];
      setYears(loaded);
      setUserId(user.id);
      setLoading(false);
      // The list paints first; the trees and filed-year counts fill in behind it.
      const closed = loaded.filter((y) => y.status !== "active");
      const closedIds = closed.map((y) => y.id);
      const [finished, filedYears] = await Promise.all([
        loadFinishedTrees(supabase, user.id, closedIds).catch(() => ({})),
        loadFiledYears(supabase, user.id, closed).catch(() => ({})),
      ]);
      if (!cancelled) {
        setTrees(finished);
        setFiled(filedYears);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [supabase]);

  const allYears = years ?? [];
  const hasClosedYears = allYears.some((y) => y.status !== "active");

  const openEdit = (y: SchoolYear) => {
    setEditingYearId(y.id);
    setEditValue(String(filed[y.id]?.days ?? ""));
    setEditError(null);
  };

  const saveDays = async (y: SchoolYear) => {
    const summary = filed[y.id];
    if (!userId || !summary || editBusy) return;
    const problem = daysAttendedProblem(editValue, summary.schoolDaysInRange);
    if (problem) { setEditError(problem); return; }
    const requested = Number(editValue.trim());
    setEditBusy(true);
    setEditError(null);
    try {
      const filledDays = await respreadPastYear(supabase, userId, y, requested);
      setFiled((prev) => ({ ...prev, [y.id]: { ...summary, days: filledDays } }));
      setYears((prev) => (prev ?? []).map((row) => (row.id === y.id ? { ...row, days_attended: filledDays } : row)));
      setEditNote((prev) => ({
        ...prev,
        [y.id]: filledDays < requested
          ? `Your lessons fill ${filledDays} of the ${requested} days, so Reports counts ${filledDays} days present.`
          : "",
      }));
      setEditingYearId(null);
    } catch (e) {
      if (e instanceof RespreadRefused) {
        setEditError(e.message);
      } else {
        captureSupabaseError("Years: change a filed year's days failed", e instanceof RespreadUndoFailed ? e.original : e, {
          tags: { flow: "past_year_days", undo_failed: String(e instanceof RespreadUndoFailed) },
          extra: { yearId: y.id, requested },
        });
        setEditError(
          e instanceof RespreadUndoFailed
            ? "That didn't save, and Rooted couldn't fully undo it. Please email hello@rootedhomeschoolapp.com and we'll put it right."
            : "That didn't save. Nothing was changed. Try again?",
        );
      }
    } finally {
      setEditBusy(false);
    }
  };

  return (
    <div style={{ background: "#F8F7F4", minHeight: "100vh" }}>
      <div className="max-w-2xl mx-auto px-6 pt-8 pb-12">
        <Link
          href="/dashboard/plan"
          className="text-sm text-[#5c7f63] hover:underline inline-block mb-6"
        >
          Back to Plan
        </Link>

        <p className="text-[11px] font-semibold uppercase tracking-wide text-[#8B7E74] mb-3">
          Past Years
        </p>
        <h1
          className="text-3xl text-[#1a2c22] mb-2"
          style={{ fontFamily: "'Cormorant Garamond', Georgia, serif" }}
        >
          Your archived years
        </h1>
        <p className="text-sm text-[#8B7E74] mb-6">
          Every year you close lives here, with the trees your children grew that year. Tap one to revisit the keepsake.
        </p>

        <Link
          href="/dashboard/years/add"
          className="block bg-[#fefcf9] border border-[#e8e2d9] rounded-2xl p-5 mb-6 hover:opacity-90 transition-opacity"
        >
          <p className="text-base font-medium text-[#1a2c22]">Add a past year</p>
          <p className="text-sm text-[#8B7E74] mt-1">
            Homeschooled before you found Rooted? Add that year so it counts on reports and transcripts. Your current year stays exactly as it is.
          </p>
        </Link>

        {loading ? (
          <p className="text-sm text-[#7a6f65]">Loading...</p>
        ) : !hasClosedYears ? (
          <div className="bg-[#fefcf9] border border-[#e8e2d9] rounded-2xl p-8 text-center">
            <p className="text-base text-[#2D2A26]">No archived years yet.</p>
            <p className="text-sm text-[#8B7E74] mt-2">
              When you close a school year, it will appear here.
            </p>
          </div>
        ) : (
          <ul className="space-y-3">
            {allYears.map((y) => {
              const isActive = y.status === "active";
              const badgeClass = isActive
                ? "bg-[#e8f0e9] text-[#2D5A3D] border-[#b8d0bc]"
                : "bg-[#f0ede8] text-[#5c5248] border-[#d4cfc9]";
              const yearTrees = isActive ? [] : trees[y.id] ?? [];
              // The header and the trees link to the keepsake. A filed year's day
              // count sits outside the link, because it holds its own controls.
              const summary = (
                <>
                  <div className="flex items-center gap-4">
                    <div className="flex-1 min-w-0">
                      <p className="text-base font-medium text-[#1a2c22]">{y.name}</p>
                      <p className="text-xs text-[#8B7E74] mt-0.5">
                        {formatMonthYear(y.start_date)} to {formatMonthYear(y.end_date)}
                      </p>
                    </div>
                    <span
                      className={`text-[10px] font-bold uppercase tracking-wider rounded-full px-3 py-1 border shrink-0 ${badgeClass}`}
                    >
                      {isActive ? "Active" : "Closed"}
                    </span>
                  </div>
                  {yearTrees.length > 0 && (
                    <ul className="flex flex-wrap gap-2 mt-3 pt-3 border-t border-[#efe9e0]">
                      {yearTrees.map((t) => {
                        const stage = getGrowthStage(t.leaves);
                        return (
                          <li
                            key={t.childId}
                            className="flex items-center gap-2 bg-white border border-[#e8e2d9] rounded-xl px-3 py-1.5 min-w-0"
                          >
                            <span className="text-xl leading-none" aria-hidden>{stage.emoji}</span>
                            <span className="min-w-0">
                              <span className="block text-xs font-medium text-[#2d2926] truncate">
                                {t.name} · {stage.name}
                              </span>
                              <span className="block text-[11px] text-[#7a6f65]">
                                {t.leaves} {t.leaves === 1 ? "leaf" : "leaves"}
                                {t.badges > 0 ? ` · ${t.badges} ${t.badges === 1 ? "badge" : "badges"}` : ""}
                              </span>
                            </span>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </>
              );
              const daysBlock = (
                <>
                  {!isActive && filed[y.id] && (() => {
                    const f = filed[y.id];
                    const editing = editingYearId === y.id;
                    const problem = editing ? daysAttendedProblem(editValue, f.schoolDaysInRange) : null;
                    return (
                      <div className="mt-3 pt-3 border-t border-[#efe9e0]">
                        {editing ? (
                          <div className="space-y-2">
                            <label className="text-xs font-medium text-[#7a6f65] block" htmlFor={`days-${y.id}`}>
                              About how many days did you school?
                            </label>
                            <div className="flex items-center gap-2 flex-wrap">
                              <input
                                id={`days-${y.id}`}
                                type="number"
                                inputMode="numeric"
                                min={1}
                                max={f.schoolDaysInRange}
                                value={editValue}
                                placeholder={String(f.schoolDaysInRange)}
                                onChange={(e) => { setEditValue(e.target.value); setEditError(null); }}
                                className="w-[110px] px-3 py-2 rounded-xl border border-[#e8e2d9] bg-white text-sm text-[#2d2926] focus:outline-none focus:border-[#5c7f63]"
                                aria-invalid={!!problem}
                                aria-describedby={`days-hint-${y.id}`}
                              />
                              <span className="text-sm text-[#7a6f65]">days</span>
                              <button
                                type="button"
                                onClick={() => { void saveDays(y); }}
                                disabled={editBusy || !!problem}
                                className="text-sm font-medium text-white rounded-xl px-4 py-2 disabled:opacity-60"
                                style={{ background: "var(--g-brand)" }}
                              >
                                {editBusy ? "Saving…" : "Save"}
                              </button>
                              {!editBusy && (
                                <button type="button" onClick={() => setEditingYearId(null)} className="text-sm text-[#5c7f63] hover:underline">
                                  Cancel
                                </button>
                              )}
                            </div>
                            <p id={`days-hint-${y.id}`} className={`text-xs ${problem ? "text-[#a94442]" : "text-[#7a6f65]"}`}>
                              {problem ?? schoolDaysInRangeHint(f.schoolDaysInRange, f.schoolDays)}
                            </p>
                            {editError && <p className="text-xs text-[#a94442]" role="alert">{editError}</p>}
                          </div>
                        ) : (
                          <div className="flex items-center gap-3 flex-wrap">
                            <p className="text-xs text-[#5c5248]">
                              {f.lessons.toLocaleString("en-US")} {f.lessons === 1 ? "lesson" : "lessons"} · {f.hours} {f.hours === 1 ? "hour" : "hours"} · {f.days} {f.days === 1 ? "day" : "days"}
                            </p>
                            <button type="button" onClick={() => openEdit(y)} className="text-xs font-medium text-[#5c7f63] hover:underline">
                              Edit days
                            </button>
                            {editNote[y.id] && <p className="text-xs text-[#7a6f65] w-full">{editNote[y.id]}</p>}
                          </div>
                        )}
                      </div>
                    );
                  })()}
                </>
              );
              return (
                <li key={y.id}>
                  <div className="bg-[#fefcf9] border border-[#e8e2d9] rounded-2xl p-5">
                    {isActive ? (
                      summary
                    ) : (
                      <Link
                        href={`/dashboard/year-end/${y.id}`}
                        className="block hover:opacity-90 transition-opacity"
                      >
                        {summary}
                      </Link>
                    )}
                    {daysBlock}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
