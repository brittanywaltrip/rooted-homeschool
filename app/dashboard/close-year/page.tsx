"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { createSupabaseBrowserClient } from "@/lib/supabase-browser";
import { rolloverYearName } from "@/lib/school-year-name";

type SchoolYear = {
  id: string;
  name: string;
  start_date: string;
  end_date: string;
  status: string;
};

type Child = {
  id: string;
  name: string;
  grade_level: string | null;
};

// Display names for the free-text values users have actually entered into
// children.grade_level. Lookups normalize the value with .toLowerCase().trim()
// before checking this map.
const GRADE_DISPLAY: Record<string, string> = {
  "preschool": "Preschool",
  "pre-k": "Pre-K",
  "kindergarten": "Kindergarten",
  "kindy": "Kindergarten",
  "1st grade": "1st Grade",
  "2nd grade": "2nd Grade",
  "3rd grade": "3rd Grade",
  "4th grade": "4th Grade",
  "5th grade": "5th Grade",
  "6th grade": "6th Grade",
  "7th grade": "7th Grade",
  "8th grade": "8th Grade",
  "9th grade": "9th Grade",
  "10th grade": "10th Grade",
  "11th grade": "11th Grade",
  "12th grade": "12th Grade",
  "graduated": "Graduated",
  "1": "1st Grade",
  "2": "2nd Grade",
  "3": "3rd Grade",
  "4": "4th Grade",
  "5": "5th Grade",
  "6": "6th Grade",
  "7": "7th Grade",
  "8": "8th Grade",
  "9": "9th Grade",
  "10": "10th Grade",
  "11": "11th Grade",
  "12": "12th Grade",
  "1st": "1st Grade",
  "2nd": "2nd Grade",
  "3rd": "3rd Grade",
  "4th": "4th Grade",
  "5th": "5th Grade",
  "6th": "6th Grade",
  "7th": "7th Grade",
  "8th": "8th Grade",
  "9th": "9th Grade",
};

function formatMonthYear(iso: string): string {
  const d = new Date(`${iso}T00:00:00`);
  return d.toLocaleDateString("en-US", { month: "short", year: "numeric" });
}

/** Local calendar date, not UTC, so the default start date is really today. */
function todayLocalIso(): string {
  const d = new Date();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${month}-${day}`;
}

/** The next May 31 on or after today. */
function nextMay31(todayIso: string): string {
  const year = Number(todayIso.slice(0, 4));
  const thisMay = `${year}-05-31`;
  return todayIso <= thisMay ? thisMay : `${year + 1}-05-31`;
}

export default function CloseYearPage() {
  const router = useRouter();
  const supabase = useMemo(() => createSupabaseBrowserClient(), []);
  const [activeYear, setActiveYear] = useState<SchoolYear | null>(null);
  const [children, setChildren] = useState<Child[]>([]);
  const [loading, setLoading] = useState(true);
  const [confirmInput, setConfirmInput] = useState("");
  const [closing, setClosing] = useState(false);
  const [closeError, setCloseError] = useState<string | null>(null);

  // Editable year details. The closing year can be renamed on the way out
  // ("Summer 2026"), and the next year is named and dated right here so the
  // user never lands in a year they didn't choose.
  const [closingYearName, setClosingYearName] = useState("");
  const [newYearName, setNewYearName] = useState("");
  const [newYearStart, setNewYearStart] = useState("");
  const [newYearEnd, setNewYearEnd] = useState("");

  useEffect(() => {
    let cancelled = false;
    async function load() {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        if (!cancelled) setLoading(false);
        return;
      }

      const { data: year } = await supabase
        .from("school_years")
        .select("id, name, start_date, end_date, status")
        .eq("user_id", user.id)
        .eq("status", "active")
        .maybeSingle();

      const { data: kids } = await supabase
        .from("children")
        .select("id, name, grade_level")
        .eq("user_id", user.id)
        .eq("archived", false)
        .order("sort_order", { ascending: true });

      if (cancelled) return;
      const loadedYear = (year as SchoolYear | null) ?? null;
      setActiveYear(loadedYear);
      setChildren((kids as Child[] | null) ?? []);
      if (loadedYear) {
        const today = todayLocalIso();
        setClosingYearName(loadedYear.name);
        setNewYearName(rolloverYearName(loadedYear.name, new Date().getFullYear()));
        setNewYearStart(today);
        setNewYearEnd(nextMay31(today));
      }
      setLoading(false);
    }
    load();
    return () => { cancelled = true; };
  }, [supabase]);

  async function handleClose() {
    if (!activeYear) return;
    setClosing(true);
    setCloseError(null);
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) {
      setCloseError("Please sign in.");
      setClosing(false);
      return;
    }
    try {
      const res = await fetch("/api/school-year/close", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          closingYearName: closingYearName.trim(),
          newYearName: newYearName.trim(),
          newYearStart,
          newYearEnd,
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json?.success) {
        setCloseError(json?.error || "Something went wrong. Please try again.");
        setClosing(false);
        return;
      }
      router.push(`/dashboard/year-end/${json.archivedYearId}`);
    } catch (e) {
      setCloseError(e instanceof Error ? e.message : "Network error. Please try again.");
      setClosing(false);
    }
  }

  if (loading) {
    return (
      <div style={{ background: "#F8F7F4", minHeight: "100vh" }} className="flex items-center justify-center">
        <p className="text-sm text-[#7a6f65]">Loading...</p>
      </div>
    );
  }

  if (!activeYear) {
    return (
      <div style={{ background: "#F8F7F4", minHeight: "100vh" }} className="flex flex-col items-center justify-center px-6 text-center gap-4">
        <p className="text-base text-[#1a2c22]">No active school year to close.</p>
        <Link href="/dashboard/plan" className="text-sm text-[#5c7f63] hover:underline">
          Back to Plan
        </Link>
      </div>
    );
  }

  // Typing CLOSE, not the year name. The old exact-name match compared against
  // stored names containing an en dash (U+2013) that no keyboard types, so the
  // button stayed disabled forever with no explanation.
  const typedClose = confirmInput.trim().toUpperCase() === "CLOSE";
  const datesValid = Boolean(newYearStart) && Boolean(newYearEnd) && newYearEnd > newYearStart;
  const namesValid = closingYearName.trim().length > 0 && newYearName.trim().length > 0;
  const canConfirm = typedClose && datesValid && namesValid && !closing;

  let blockedReason: string | null = null;
  if (!namesValid) blockedReason = "Please give both years a name.";
  else if (!datesValid) blockedReason = "Your next year's end date needs to come after its start date.";

  return (
    <div style={{ background: "#F8F7F4", minHeight: "100vh" }}>
      <section className="bg-[#2D4A35] rounded-b-[24px] py-12 px-6">
        <div className="max-w-2xl mx-auto">
          <Link
            href="/dashboard/plan"
            className="text-[#a89e8f] text-sm hover:text-white transition-colors inline-block mb-6"
          >
            Back to Plan
          </Link>
          <p className="text-[11px] font-semibold uppercase tracking-wide text-[#8B7E74] mb-3">
            Close This School Year
          </p>
          <h1
            className="text-3xl text-[#F8F7F4] mb-2"
            style={{ fontFamily: "'Cormorant Garamond', Georgia, serif" }}
          >
            {closingYearName.trim() || activeYear.name}
          </h1>
          <p className="text-sm text-[#a89e8f]">
            {formatMonthYear(activeYear.start_date)} – {formatMonthYear(activeYear.end_date)}
          </p>
        </div>
      </section>

      <div className="max-w-2xl mx-auto px-6 pb-12">
        <div className="bg-[#fefcf9] border border-[#e8e2d9] rounded-2xl p-5 mt-6">
          <div className="flex flex-col md:flex-row gap-6">
            <div className="flex-1 min-w-0">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-[#8B7E74] mb-2">
                Saved forever
              </p>
              <ul className="space-y-2">
                {[
                  "Your memories and photos",
                  "Yearbook (locked to this year)",
                  "Badges earned",
                  "Curriculum history",
                ].map((s) => (
                  <li key={s} className="flex items-start gap-2">
                    <span className="text-[#5c7f63] text-sm shrink-0">✓</span>
                    <span className="text-sm text-[#2D2A26]">{s}</span>
                  </li>
                ))}
              </ul>
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-[#8B7E74] mb-2">
                Resets for next year
              </p>
              <ul className="space-y-2">
                {[
                  "Curriculum schedule",
                  "Lesson progress",
                  "Garden (grows back from seeds)",
                ].map((s) => (
                  <li key={s} className="flex items-start gap-2">
                    <span className="shrink-0">🌱</span>
                    <span className="text-sm text-[#5c5248]">{s}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
          <p className="text-xs text-[#7a6f65] leading-relaxed mt-5 pt-4 border-t border-[#e8e2d9]">
            Nothing is ever deleted. This year keeps its place in Years, Memories, and
            Transcripts for as long as you have Rooted.
          </p>
        </div>

        <div className="bg-[#fefcf9] border border-[#e8e2d9] rounded-2xl p-5 mt-6">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-[#8B7E74] mb-1">
            The year you&apos;re closing
          </p>
          <p className="text-xs text-[#7a6f65] mb-3">
            Call it whatever it was to your family. This is the name it keeps.
          </p>
          <label htmlFor="closing-year-name" className="block text-xs text-[#7a6f65] mb-1">
            Year name
          </label>
          <input
            id="closing-year-name"
            type="text"
            value={closingYearName}
            onChange={(e) => setClosingYearName(e.target.value)}
            placeholder="e.g. Summer 2026"
            className="w-full border border-[#d4cfc9] rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-[#5c7f63]"
          />
        </div>

        <div className="bg-[#fefcf9] border border-[#e8e2d9] rounded-2xl p-5 mt-4">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-[#8B7E74] mb-1">
            Your next year
          </p>
          <p className="text-xs text-[#7a6f65] mb-3">
            We&apos;ll start this one for you as soon as this year is closed. Name it
            anything: &quot;Kindergarten Year&quot;, &quot;Summer 2026&quot;, &quot;2026-2027&quot;.
          </p>
          <label htmlFor="new-year-name" className="block text-xs text-[#7a6f65] mb-1">
            Year name
          </label>
          <input
            id="new-year-name"
            type="text"
            value={newYearName}
            onChange={(e) => setNewYearName(e.target.value)}
            placeholder="e.g. 2026-2027"
            className="w-full border border-[#d4cfc9] rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-[#5c7f63]"
          />
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-3">
            <div>
              <label htmlFor="new-year-start" className="block text-xs text-[#7a6f65] mb-1">
                Start date
              </label>
              <input
                id="new-year-start"
                type="date"
                value={newYearStart}
                onChange={(e) => setNewYearStart(e.target.value)}
                className="w-full border border-[#d4cfc9] rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-[#5c7f63]"
              />
            </div>
            <div>
              <label htmlFor="new-year-end" className="block text-xs text-[#7a6f65] mb-1">
                End date
              </label>
              <input
                id="new-year-end"
                type="date"
                value={newYearEnd}
                onChange={(e) => setNewYearEnd(e.target.value)}
                className="w-full border border-[#d4cfc9] rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-[#5c7f63]"
              />
            </div>
          </div>
        </div>

        <p className="text-[11px] font-semibold uppercase tracking-wide text-[#8B7E74] mt-8 mb-3">
          Grade Advancement
        </p>
        <div className="space-y-3">
          {children.map((child) => {
            const initial = (child.name || "?").trim().charAt(0).toUpperCase();
            const raw = child.grade_level;
            const normalized = raw ? raw.toLowerCase().trim() : "";
            const mapped = normalized ? GRADE_DISPLAY[normalized] : undefined;
            let gradeLine: string;
            if (!raw || !raw.trim()) {
              gradeLine = "Grade not set -- add it in Settings";
            } else if (mapped) {
              gradeLine = mapped;
            } else {
              gradeLine = raw;
            }
            return (
              <div
                key={child.id}
                className="bg-white border border-[#e8e2d9] rounded-xl p-4 flex items-center gap-3"
              >
                <div className="w-8 h-8 rounded-lg bg-[#e8f0e9] flex items-center justify-center shrink-0">
                  <span className="text-[#2D4A35] text-sm font-bold">{initial}</span>
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-[#2D2A26]">{child.name}</p>
                  <p className="text-xs text-[#7a6f65]">{gradeLine}</p>
                </div>
              </div>
            );
          })}
        </div>

        <div className="mt-8">
          <p className="text-sm text-[#5c5248] mb-3">
            Ready when you are. Type CLOSE to confirm.
          </p>
          <label htmlFor="close-confirm" className="block text-xs text-[#7a6f65] mb-1">
            Type &quot;CLOSE&quot;
          </label>
          <input
            id="close-confirm"
            type="text"
            value={confirmInput}
            onChange={(e) => setConfirmInput(e.target.value)}
            placeholder="CLOSE"
            autoCapitalize="characters"
            autoComplete="off"
            className="w-full border border-[#d4cfc9] rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-[#5c7f63]"
          />
          <button
            type="button"
            onClick={handleClose}
            disabled={!canConfirm}
            className={`w-full py-3 rounded-xl bg-[#2D4A35] text-white text-sm font-medium mt-4 transition-colors ${
              !canConfirm ? "opacity-50 cursor-not-allowed" : "hover:bg-[#1a2c22]"
            }`}
          >
            {closing ? "Closing your year..." : "Close This School Year"}
          </button>
          {blockedReason && (
            <p className="text-xs text-[#7a6f65] mt-2">{blockedReason}</p>
          )}
          {closeError && (
            <p className="text-xs text-red-600 bg-red-50 border border-red-100 rounded-xl px-3 py-2 mt-3">
              {closeError}
            </p>
          )}
        </div>

        <p className="text-center text-[11px] text-[#8B7E74] mt-8 pb-8">
          Past years live in{" "}
          <Link href="/dashboard/years" className="text-[#5c7f63] hover:underline">
            Years
          </Link>
          , and your memories stay right where they are.
        </p>
      </div>
    </div>
  );
}
