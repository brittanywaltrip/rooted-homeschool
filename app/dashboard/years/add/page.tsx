"use client";

// Add a past year: file a school year the family finished before they found
// Rooted, without touching the year they are in.
//
// Everything this page writes belongs to a school year inserted with status
// 'archived' and to goals inserted with archived = true, so the Today
// projector, the queue reconciler and the catch-up flows never see any of it.
// The rows are the same shape as the Schedule Builder's start-date backfill
// (completed history, is_backfill, noon UTC completed_at), built by the pure
// helpers in app/lib/past-year-dates.ts, and written from the browser under
// the family's own session and RLS. No API route is involved: a lesson is
// completed by a person or not at all (Invariant 15), and this is a person
// saying what their family did last year.
//
// Writes run in order: the year, then each goal with its lessons in batches
// of 500, then the optional note. If any batch fails, everything this run
// inserted is deleted again and the family sees one sentence, never a partial
// year. Nothing about the active year is read for writing.

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import { usePartner } from "@/lib/partner-context";
import { useSessionUser } from "@/lib/session-context";
import { capitalizeName, childNameKey } from "@/lib/utils";
import { captureSupabaseError } from "@/lib/sentry-error";
import { todayLocalDateStr } from "@/app/components/WhenPicker";
import { schoolDaysBetween } from "@/app/lib/scheduler";
import {
  DEFAULT_SCHOOL_DAYS,
  batches,
  buildPastYearGoal,
  buildPastYearLessons,
  defaultYearName,
  pastYearProblem,
  pastYearReviewSentence,
  rowProblem,
  summarizePastYear,
  usableRows,
  type ExistingYear,
  type PastYearRow,
} from "@/app/lib/past-year-dates";

const DAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

// Same palette Settings offers when a child is added there.
const CHILD_COLORS = [
  { label: "Green",  value: "#5c7f63" },
  { label: "Sage",   value: "#7a9e7e" },
  { label: "Blue",   value: "#4a7a8a" },
  { label: "Indigo", value: "#5a5c8a" },
  { label: "Purple", value: "#7a5c8a" },
  { label: "Orange", value: "#c4956a" },
  { label: "Pink",   value: "#c4697a" },
];

type Child = { id: string; name: string; color: string | null; sort_order: number | null };

/** A row as typed: numbers stay strings until the review step parses them. */
type DraftRow = {
  localId: string;
  childId: string;
  curriculumName: string;
  subjectLabel: string;
  total: string;
  completed: string;
  completedTouched: boolean;
  minutes: string;
};

const inputClass =
  "w-full px-3 py-2.5 rounded-xl border border-[#e8e2d9] bg-white text-sm text-[#2d2926] placeholder-[#c8bfb5] focus:outline-none focus:border-[#5c7f63] focus:ring-1 focus:ring-[#5c7f63]/20";
const labelClass = "text-xs font-medium text-[#7a6f65] block mb-1";
const cardClass = "bg-[#fefcf9] border border-[#e8e2d9] rounded-2xl p-5 space-y-4";
const primaryButton = "w-full text-white rounded-xl py-3 font-medium text-center flex items-center justify-center gap-2";
const secondaryButton = "text-sm text-[#5c7f63] hover:underline";

function newRow(childId: string): DraftRow {
  return { localId: crypto.randomUUID(), childId, curriculumName: "", subjectLabel: "", total: "", completed: "", completedTouched: false, minutes: "" };
}

function toInt(s: string): number {
  const n = parseInt(s, 10);
  return Number.isFinite(n) ? n : 0;
}

function toPastYearRow(d: DraftRow): PastYearRow {
  const minutes = d.minutes.trim() === "" ? null : toInt(d.minutes);
  return {
    childId: d.childId,
    curriculumName: d.curriculumName,
    subjectLabel: d.subjectLabel,
    totalLessons: toInt(d.total),
    completedLessons: toInt(d.completed),
    minutesPerLesson: minutes,
  };
}

function Spinner() {
  return (
    <span
      aria-hidden="true"
      className="inline-block w-4 h-4 rounded-full border-2 border-white/40 border-t-white animate-spin"
    />
  );
}

export default function AddPastYearPage() {
  const router = useRouter();
  const sessionUser = useSessionUser();
  const { isPartner } = usePartner();
  const today = useMemo(() => todayLocalDateStr(), []);

  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [loading, setLoading] = useState(true);
  const [children, setChildren] = useState<Child[]>([]);
  const [existingYears, setExistingYears] = useState<ExistingYear[]>([]);

  // Step 1
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [yearName, setYearName] = useState("");
  const [nameTouched, setNameTouched] = useState(false);
  const [schoolDays, setSchoolDays] = useState<string[]>(DEFAULT_SCHOOL_DAYS);

  // Step 2
  const [rows, setRows] = useState<DraftRow[]>([]);
  const [note, setNote] = useState("");
  const [addingChildFor, setAddingChildFor] = useState(false);
  const [newChildName, setNewChildName] = useState("");
  const [newChildColor, setNewChildColor] = useState(CHILD_COLORS[0].value);
  const [childSaving, setChildSaving] = useState(false);

  // Step 3
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const userId = sessionUser?.id ?? null;
  const activeYear = existingYears.find((y) => y.status === "active") ?? null;

  useEffect(() => {
    document.title = "Add a past year · Rooted";
  }, []);

  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    (async () => {
      const [kidsRes, yearsRes] = await Promise.all([
        supabase.from("children").select("id, name, color, sort_order").eq("user_id", userId).eq("archived", false).order("sort_order"),
        supabase.from("school_years").select("id, name, start_date, end_date, status").eq("user_id", userId).order("start_date", { ascending: false }),
      ]);
      if (cancelled) return;
      const kids = ((kidsRes.data ?? []) as Child[]).map((c) => ({ ...c, name: capitalizeName(c.name) }));
      setChildren(kids);
      setRows(kids.map((k) => newRow(k.id)));
      setExistingYears((yearsRes.data ?? []) as ExistingYear[]);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [userId]);

  // The name follows the dates until the family types their own.
  useEffect(() => {
    if (nameTouched) return;
    if (/^\d{4}-\d{2}-\d{2}$/.test(startDate) && /^\d{4}-\d{2}-\d{2}$/.test(endDate)) {
      setYearName(defaultYearName(startDate, endDate));
    }
  }, [startDate, endDate, nameTouched]);

  const toggleDay = (d: string) =>
    setSchoolDays((prev) => (prev.includes(d) ? prev.filter((x) => x !== d) : DAY_LABELS.filter((x) => prev.includes(x) || x === d)));

  const patchRow = (localId: string, patch: Partial<DraftRow>) =>
    setRows((prev) => prev.map((r) => (r.localId === localId ? { ...r, ...patch } : r)));

  const onTotalChange = (r: DraftRow, value: string) => {
    // Completed is prefilled equal to total until the family edits it.
    patchRow(r.localId, r.completedTouched ? { total: value } : { total: value, completed: value });
  };

  // ── Step gates. A tap that cannot proceed says why; nothing is disabled. ──
  const step1Problem = (): string | null => {
    if (!yearName.trim()) return "Give the year a name.";
    if (schoolDays.length === 0) return "Pick at least one school day.";
    return pastYearProblem(startDate, endDate, existingYears, today);
  };

  const step2Problem = (): string | null => {
    const parsed = rows.map(toPastYearRow);
    for (const r of parsed) {
      const p = rowProblem(r);
      if (p) return p;
    }
    if (usableRows(parsed).length === 0) return "Add at least one curriculum with lessons completed, or go back.";
    return null;
  };

  const goTo = (next: 1 | 2 | 3) => {
    setError(null);
    setStep(next);
    if (typeof window !== "undefined") window.scrollTo({ top: 0 });
  };

  const continueFrom1 = () => {
    const p = step1Problem();
    if (p) { setError(p); return; }
    goTo(2);
  };

  const continueFrom2 = () => {
    const p = step2Problem();
    if (p) { setError(p); return; }
    goTo(3);
  };

  // ── Inline add child, the Settings pattern ────────────────────────────────
  const addChild = async () => {
    if (!userId) return;
    const name = newChildName.trim();
    if (!name) { setError("Give the child a name."); return; }
    setChildSaving(true);
    setError(null);
    const maxOrder = children.reduce((m, c) => Math.max(m, c.sort_order ?? 0), 0);
    const { data, error: insErr } = await supabase
      .from("children")
      .insert({
        user_id: userId,
        name: capitalizeName(name),
        color: newChildColor,
        archived: false,
        sort_order: maxOrder + 1,
        name_key: childNameKey(name),
      })
      .select("id, name, color, sort_order")
      .single();
    setChildSaving(false);
    if (insErr || !data) {
      captureSupabaseError("Add child failed (past year)", insErr ?? new Error("no row"), { tags: { flow: "add_past_year" } });
      setError(/duplicate|unique/i.test(insErr?.message ?? "") ? `You already have a child named ${capitalizeName(name)}.` : "That child didn't save. Try again?");
      return;
    }
    const child = data as Child;
    setChildren((prev) => [...prev, child]);
    setRows((prev) => [...prev, newRow(child.id)]);
    setNewChildName("");
    setAddingChildFor(false);
    window.dispatchEvent(new Event("rooted:children-updated"));
  };

  // ── The writes ───────────────────────────────────────────────────────────
  const rollback = useCallback(async (yearId: string) => {
    if (!userId) return;
    // Lessons first, then goals, then the year: each delete is scoped to the
    // year this run created, so nothing else of the family's can be touched.
    await supabase.from("lessons").delete().eq("user_id", userId).eq("school_year_id", yearId);
    await supabase.from("curriculum_goals").delete().eq("user_id", userId).eq("school_year_id", yearId);
    await supabase.from("school_years").delete().eq("user_id", userId).eq("id", yearId);
  }, [userId]);

  async function addThisYear() {
    if (busy || !userId) return;
    const p1 = step1Problem();
    const p2 = step2Problem();
    if (p1 || p2) { setError(p1 ?? p2); return; }
    setBusy(true);
    setError(null);

    const name = yearName.trim();
    const usable = usableRows(rows.map(toPastYearRow));
    let yearId: string | null = null;
    try {
      // 1. The year, archived from the first write. Never 'active' or 'upcoming'.
      const { data: year, error: yearErr } = await supabase
        .from("school_years")
        .insert({ user_id: userId, name, start_date: startDate, end_date: endDate, status: "archived" })
        .select("id")
        .single();
      if (yearErr || !year) throw yearErr ?? new Error("school_years insert returned no row");
      yearId = (year as { id: string }).id;

      const daysInYear = schoolDaysBetween(startDate, endDate, schoolDays);

      // 2 and 3. Each goal, then its lessons in batches of 500.
      for (const row of usable) {
        const goal = buildPastYearGoal({ userId, schoolYearId: yearId, yearName: name, yearStart: startDate, yearEnd: endDate, schoolDays, row });
        const { data: inserted, error: goalErr } = await supabase.from("curriculum_goals").insert(goal).select("id").single();
        if (goalErr || !inserted) throw goalErr ?? new Error("curriculum_goals insert returned no row");
        const goalId = (inserted as { id: string }).id;
        const lessons = buildPastYearLessons({
          userId, schoolYearId: yearId, yearName: name, goalId, childId: row.childId,
          curriculumName: row.curriculumName, completedLessons: row.completedLessons,
          minutesPerLesson: row.minutesPerLesson, schoolDaysInYear: daysInYear,
        });
        for (const batch of batches(lessons)) {
          const { error: lessonErr } = await supabase.from("lessons").insert(batch);
          if (lessonErr) throw lessonErr;
        }
      }

      // 4. The optional note: one win, dated on the year's end date.
      if (note.trim()) {
        const { error: memErr } = await supabase.from("memories").insert({
          user_id: userId,
          child_id: null,
          type: "win",
          title: note.trim(),
          date: endDate,
          // A note about a whole year belongs in the book, like any win.
          include_in_book: true,
        });
        if (memErr) throw memErr;
      }

      router.push(`/dashboard/year-end/${yearId}?added=${encodeURIComponent(name)}`);
    } catch (e) {
      captureSupabaseError("Add a past year failed", e, { tags: { flow: "add_past_year" }, extra: { yearId, rows: usable.length } });
      if (yearId) {
        try { await rollback(yearId); } catch (rollbackErr) {
          captureSupabaseError("Add a past year rollback failed", rollbackErr, { tags: { flow: "add_past_year" }, extra: { yearId } });
        }
      }
      setError("That didn't save. Nothing was added. Try again?");
      setBusy(false);
    }
  }

  const childNames = useMemo(() => Object.fromEntries(children.map((c) => [c.id, c.name])), [children]);
  const parsedRows = rows.map(toPastYearRow);
  const summary = summarizePastYear(parsedRows);

  if (isPartner) {
    return (
      <div style={{ background: "#F8F7F4", minHeight: "100vh" }}>
        <div className="max-w-3xl mx-auto px-4 sm:px-6 py-8 sm:py-10">
          <p className="text-sm text-[#7a6f65]">Only the family's main account can add a past year.</p>
        </div>
      </div>
    );
  }

  return (
    <div style={{ background: "#F8F7F4", minHeight: "100vh" }}>
      <div className="max-w-3xl mx-auto px-4 sm:px-6 py-8 sm:py-10 space-y-6">
        <div>
          <Link href="/dashboard/years" className="text-sm" style={{ color: "var(--g-accent)" }}>
            Back to Years
          </Link>
          <p className="text-[11px] font-semibold uppercase tracking-wide text-[#8B7E74] mt-4 mb-1">Step {step} of 3</p>
          <h1 className="text-2xl sm:text-3xl mb-1" style={{ fontFamily: "Lora, serif", color: "var(--g-deep)", fontWeight: 500 }}>
            {step === 1 ? "Add a past year" : step === 2 ? "What you did that year" : "Review and add"}
          </h1>
          <p className="text-sm" style={{ color: "#7a6f65" }}>
            {step === 1
              ? "Homeschooled before you found Rooted? Add that year so it counts on reports and transcripts. Your current year stays exactly as it is."
              : step === 2
              ? "For each child, the curricula you used and how far you got. A row with no name or no lessons completed is simply skipped."
              : "Read it over. Tap the button when it looks right."}
          </p>
        </div>

        {loading ? (
          <p className="text-sm text-[#7a6f65]">Loading...</p>
        ) : step === 1 ? (
          <>
            <div className={cardClass}>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className={labelClass}>Start date</label>
                  <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className={inputClass} />
                </div>
                <div>
                  <label className={labelClass}>End date</label>
                  <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} className={inputClass} />
                </div>
              </div>
              <div>
                <label className={labelClass}>Year name</label>
                <input
                  type="text"
                  value={yearName}
                  onChange={(e) => { setNameTouched(true); setYearName(e.target.value); }}
                  placeholder="e.g. 2025-2026"
                  className={inputClass}
                />
              </div>
              <div>
                <p className={labelClass}>School days</p>
                <div className="flex flex-wrap gap-1.5">
                  {DAY_LABELS.map((d) => {
                    const on = schoolDays.includes(d);
                    return (
                      <button
                        key={d}
                        type="button"
                        onClick={() => toggleDay(d)}
                        aria-pressed={on}
                        className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${on ? "bg-[#5c7f63] text-white border-[#5c7f63]" : "bg-white text-[#7a6f65] border-[#e8e2d9]"}`}
                      >
                        {d}
                      </button>
                    );
                  })}
                </div>
              </div>
              {activeYear && (
                <p className="text-xs text-[#7a6f65]">
                  Your current year, {activeYear.name}, starts {new Date(activeYear.start_date + "T12:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}. The past year has to end before that.
                </p>
              )}
            </div>
            {error && <p className="text-sm text-[#a94442]" role="alert">{error}</p>}
            <button type="button" onClick={continueFrom1} className={primaryButton} style={{ background: "var(--g-brand)" }}>
              Continue
            </button>
          </>
        ) : step === 2 ? (
          <>
            {children.length === 0 && (
              <p className="text-sm text-[#7a6f65]">Add a child to file their year.</p>
            )}
            {children.map((child) => {
              const childRows = rows.filter((r) => r.childId === child.id);
              return (
                <div key={child.id} className="space-y-3">
                  <h2 className="text-base" style={{ fontFamily: "Lora, serif", color: "var(--g-deep)", fontWeight: 500 }}>
                    {child.name}
                  </h2>
                  {childRows.map((r) => (
                    <div key={r.localId} className={cardClass}>
                      <div className="flex items-start gap-2">
                        <div className="flex-1 space-y-2">
                          <input
                            type="text"
                            value={r.curriculumName}
                            onChange={(e) => patchRow(r.localId, { curriculumName: e.target.value })}
                            placeholder="Curriculum, e.g. Math Mammoth 1"
                            className={inputClass}
                          />
                          <input
                            type="text"
                            value={r.subjectLabel}
                            onChange={(e) => patchRow(r.localId, { subjectLabel: e.target.value })}
                            placeholder="Subject (e.g. Math)"
                            className={inputClass}
                          />
                        </div>
                        <button
                          type="button"
                          onClick={() => setRows((prev) => prev.filter((x) => x.localId !== r.localId))}
                          aria-label="Remove this curriculum"
                          className="text-[#b5aca4] hover:text-[#7a6f65] text-xl leading-none px-1"
                        >
                          ×
                        </button>
                      </div>
                      <div className="grid grid-cols-3 gap-2">
                        <div>
                          <label className={labelClass}>Total lessons</label>
                          <input type="number" inputMode="numeric" min={1} value={r.total} onChange={(e) => onTotalChange(r, e.target.value)} className={inputClass} placeholder="e.g. 160" />
                        </div>
                        <div>
                          <label className={labelClass}>Completed</label>
                          <input type="number" inputMode="numeric" min={0} value={r.completed} onChange={(e) => patchRow(r.localId, { completed: e.target.value, completedTouched: true })} className={inputClass} placeholder="e.g. 160" />
                        </div>
                        <div>
                          <label className={labelClass}>Minutes each</label>
                          <input type="number" inputMode="numeric" min={1} value={r.minutes} onChange={(e) => patchRow(r.localId, { minutes: e.target.value })} className={inputClass} placeholder="optional" />
                        </div>
                      </div>
                    </div>
                  ))}
                  <button type="button" onClick={() => setRows((prev) => [...prev, newRow(child.id)])} className={secondaryButton}>
                    + Add curriculum for {child.name}
                  </button>
                </div>
              );
            })}

            <div className={cardClass}>
              {addingChildFor ? (
                <div className="space-y-3">
                  <div>
                    <label className={labelClass}>Child's name</label>
                    <input type="text" value={newChildName} onChange={(e) => setNewChildName(e.target.value)} className={inputClass} placeholder="e.g. Kelly" autoFocus />
                  </div>
                  <div>
                    <p className={labelClass}>Color</p>
                    <div className="flex flex-wrap gap-1.5">
                      {CHILD_COLORS.map((c) => (
                        <button
                          key={c.value}
                          type="button"
                          onClick={() => setNewChildColor(c.value)}
                          aria-pressed={newChildColor === c.value}
                          className={`px-3 py-1.5 rounded-lg text-xs font-medium border ${newChildColor === c.value ? "text-white border-transparent" : "bg-white text-[#7a6f65] border-[#e8e2d9]"}`}
                          style={newChildColor === c.value ? { backgroundColor: c.value } : undefined}
                        >
                          {c.label}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="flex gap-3">
                    <button type="button" onClick={addChild} className="text-sm font-medium text-white rounded-xl px-4 py-2 flex items-center gap-2" style={{ background: "var(--g-brand)" }}>
                      {childSaving && <Spinner />}
                      {childSaving ? "Adding…" : "Add child"}
                    </button>
                    <button type="button" onClick={() => { setAddingChildFor(false); setNewChildName(""); }} className={secondaryButton}>
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <button type="button" onClick={() => setAddingChildFor(true)} className={secondaryButton}>
                  + Add a child
                </button>
              )}
            </div>

            <div className={cardClass}>
              <label className={labelClass}>A note about the year (optional)</label>
              <textarea
                value={note}
                onChange={(e) => setNote(e.target.value)}
                rows={3}
                placeholder="Anything worth remembering. It is saved as a win dated on the last day of the year."
                className={inputClass}
              />
            </div>

            {error && <p className="text-sm text-[#a94442]" role="alert">{error}</p>}
            <div className="space-y-3">
              <button type="button" onClick={continueFrom2} className={primaryButton} style={{ background: "var(--g-brand)" }}>
                Continue
              </button>
              <button type="button" onClick={() => goTo(1)} className={`${secondaryButton} block mx-auto`}>
                Back
              </button>
            </div>
          </>
        ) : (
          <>
            <div className={cardClass}>
              <p className="text-base leading-relaxed text-[#2d2926]">
                {pastYearReviewSentence({
                  yearName: yearName.trim(), start: startDate, end: endDate, schoolDays,
                  rows: parsedRows, childNames, activeYearName: activeYear?.name ?? null,
                })}
              </p>
              {note.trim() && (
                <p className="text-sm text-[#7a6f65]">
                  Your note is saved as a win dated {new Date(endDate + "T12:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}.
                </p>
              )}
              <p className="text-xs text-[#7a6f65]">
                {yearName.trim()}: {summary.lessons.toLocaleString("en-US")} lessons, {summary.subjects} {summary.subjects === 1 ? "subject" : "subjects"}, {summary.children} {summary.children === 1 ? "child" : "children"}.
              </p>
            </div>
            {error && <p className="text-sm text-[#a94442]" role="alert">{error}</p>}
            <div className="space-y-3">
              <button
                type="button"
                onClick={addThisYear}
                aria-busy={busy}
                className={primaryButton}
                style={{ background: "var(--g-brand)", opacity: busy ? 0.85 : 1 }}
              >
                {busy && <Spinner />}
                {busy ? "Adding…" : "Add this year"}
              </button>
              {!busy && (
                <button type="button" onClick={() => goTo(2)} className={`${secondaryButton} block mx-auto`}>
                  Back
                </button>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
