"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ChevronLeft, ChevronRight, Download, Lock } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { usePartner } from "@/lib/partner-context";
import PageHero from "@/app/components/PageHero";
import { canExport } from "@/lib/user-access";

/* ============================================================================
 * Year Planner printable — horizontal 12-month wall calendar (Letter landscape).
 *
 * Design brief (Amanda): kids reference a printed year at a glance. Rows =
 * months JAN-DEC, columns = days 1-31, cells encode school-day / weekend /
 * vacation / appointment / birthday / today. Toggles persist in localStorage
 * so a parent's preferences survive page reloads.
 *
 * "Download as PDF" uses window.print() + a print-only CSS isolation block
 * that hides everything except .year-planner-print. This matches the yearbook
 * PDF approach — no jsPDF dependency, no html2canvas — so what the parent
 * sees in the preview is exactly what the printer gets.
 *
 * Free users see the on-screen preview (so the value is obvious) but the
 * Download button routes to /upgrade instead of invoking window.print().
 * Print isolation means Ctrl+P bypasses are cosmetic — all the real UI is
 * hidden by visibility: hidden, not display: none, so layout doesn't jump.
 * ========================================================================== */

const MONTH_LABELS = [
  "JAN", "FEB", "MAR", "APR", "MAY", "JUN",
  "JUL", "AUG", "SEP", "OCT", "NOV", "DEC",
];

// Color palette — tuned to match the brand amber/green and print well.
const COLOR_WEEKEND = "#efece6";
const COLOR_SCHOOL = "#ffffff";
const COLOR_BORDER = "#e8e2d9";
const COLOR_MONTH_LABEL = "#7a6f65";
const COLOR_VACATION = "#f3d7a0"; // --g-gold territory
const COLOR_VACATION_BORDER = "#d9b670";
const COLOR_APPT_DOT = "#7a60a8";
const COLOR_TODAY_OUTLINE = "#2D5A3D";

type VacationBlock = {
  id: string;
  name: string;
  start_date: string;
  end_date: string;
};

type Appointment = {
  id: string;
  title: string;
  instance_date: string;
};

type Child = {
  id: string;
  name: string;
  color: string | null;
  birthday: string | null;
};

type Toggles = {
  mutedWeekends: boolean;
  showVacations: boolean;
  showAppointments: boolean;
  showBirthdays: boolean;
};

const TOGGLE_STORAGE_KEY = "rooted_year_planner_toggles_v1";
const DEFAULT_TOGGLES: Toggles = {
  mutedWeekends: true,
  showVacations: true,
  showAppointments: false,
  showBirthdays: true,
};

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

function toDateStr(y: number, m0: number, d: number): string {
  return `${y}-${pad2(m0 + 1)}-${pad2(d)}`;
}

function daysInMonth(year: number, m0: number): number {
  return new Date(year, m0 + 1, 0).getDate();
}

function weekdayLetter(year: number, m0: number, d: number): string {
  // Sun=S, Mon=M, Tue=T, Wed=W, Thu=T, Fri=F, Sat=S
  const dow = new Date(year, m0, d).getDay();
  return ["S", "M", "T", "W", "T", "F", "S"][dow];
}

function isWeekend(year: number, m0: number, d: number): boolean {
  const dow = new Date(year, m0, d).getDay();
  return dow === 0 || dow === 6;
}

function loadToggles(): Toggles {
  if (typeof window === "undefined") return DEFAULT_TOGGLES;
  try {
    const raw = window.localStorage.getItem(TOGGLE_STORAGE_KEY);
    if (!raw) return DEFAULT_TOGGLES;
    const parsed = JSON.parse(raw) as Partial<Toggles>;
    return { ...DEFAULT_TOGGLES, ...parsed };
  } catch {
    return DEFAULT_TOGGLES;
  }
}

function saveToggles(t: Toggles) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(TOGGLE_STORAGE_KEY, JSON.stringify(t));
  } catch {
    /* quota / private mode — preferences just won't persist */
  }
}

export default function YearPlannerPage() {
  const partnerCtx = usePartner();
  const [year, setYear] = useState<number>(() => new Date().getFullYear());
  const [toggles, setToggles] = useState<Toggles>(DEFAULT_TOGGLES);
  const [togglesLoaded, setTogglesLoaded] = useState(false);

  const [isPro, setIsPro] = useState<boolean | null>(null);
  const [trialStartedAt, setTrialStartedAt] = useState<string | null>(null);
  const [children, setChildren] = useState<Child[]>([]);
  const [vacationBlocks, setVacationBlocks] = useState<VacationBlock[]>([]);
  const [appointments, setAppointments] = useState<Appointment[]>([]);

  const todayStr = useMemo(() => {
    const d = new Date();
    return toDateStr(d.getFullYear(), d.getMonth(), d.getDate());
  }, []);

  // Load toggles once on mount. Reading localStorage must happen post-hydration
  // (SSR returns DEFAULT_TOGGLES so the server markup matches the first client
  // render). The subsequent setState is the canonical localStorage-hydrate
  // pattern and is intentional here.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setToggles(loadToggles());
    setTogglesLoaded(true);
  }, []);

  // Persist toggle changes — but not before first load, to avoid overwriting
  // the stored value with DEFAULT_TOGGLES on initial mount.
  useEffect(() => {
    if (!togglesLoaded) return;
    saveToggles(toggles);
  }, [toggles, togglesLoaded]);

  useEffect(() => {
    document.title = "Year Planner — Rooted";
  }, []);

  // ── Profile + children (one-time, not year-dependent) ────────────────────
  useEffect(() => {
    async function loadProfileAndKids() {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;
      const uid = partnerCtx.effectiveUserId || session.user.id;

      const [{ data: profile }, { data: kids }] = await Promise.all([
        supabase
          .from("profiles")
          .select("is_pro, trial_started_at")
          .eq("id", uid)
          .maybeSingle(),
        supabase
          .from("children")
          .select("id, name, color, birthday")
          .eq("user_id", uid)
          .eq("archived", false)
          .order("sort_order"),
      ]);

      setIsPro((profile as { is_pro?: boolean } | null)?.is_pro ?? false);
      setTrialStartedAt((profile as { trial_started_at?: string } | null)?.trial_started_at ?? null);
      setChildren(((kids ?? []) as Child[]));
    }
    loadProfileAndKids();
  }, [partnerCtx.effectiveUserId]);

  // ── Year-scoped data (vacation_blocks + appointments) ────────────────────
  useEffect(() => {
    async function loadYear() {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;
      const uid = partnerCtx.effectiveUserId || session.user.id;
      const startStr = `${year}-01-01`;
      const endStr = `${year}-12-31`;

      // Vacation blocks that OVERLAP this year (not just fully contained).
      const { data: vacs } = await supabase
        .from("vacation_blocks")
        .select("id, name, start_date, end_date")
        .eq("user_id", uid)
        .lte("start_date", endStr)
        .gte("end_date", startStr)
        .order("start_date");
      setVacationBlocks((vacs ?? []) as VacationBlock[]);

      // Appointments for the year via the existing expanded-recurring endpoint.
      try {
        const token = session.access_token;
        const res = await fetch(`/api/appointments?date=${startStr}&end=${endStr}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (res.ok) {
          const rows = (await res.json()) as Appointment[];
          setAppointments(Array.isArray(rows) ? rows : []);
        } else {
          setAppointments([]);
        }
      } catch {
        setAppointments([]);
      }
    }
    loadYear();
  }, [partnerCtx.effectiveUserId, year]);

  // ── Derived lookup maps keyed by YYYY-MM-DD for O(1) cell rendering ──────
  const vacationByDate = useMemo<Map<string, VacationBlock>>(() => {
    const map = new Map<string, VacationBlock>();
    if (vacationBlocks.length === 0) return map;
    for (const v of vacationBlocks) {
      // Expand each block day by day across the overlap with this year.
      const first = v.start_date > `${year}-01-01` ? v.start_date : `${year}-01-01`;
      const last = v.end_date < `${year}-12-31` ? v.end_date : `${year}-12-31`;
      const [fy, fm, fd] = first.split("-").map(Number);
      const [ly, lm, ld] = last.split("-").map(Number);
      const cursor = new Date(fy, fm - 1, fd);
      const end = new Date(ly, lm - 1, ld);
      while (cursor <= end) {
        const key = toDateStr(cursor.getFullYear(), cursor.getMonth(), cursor.getDate());
        if (!map.has(key)) map.set(key, v);
        cursor.setDate(cursor.getDate() + 1);
      }
    }
    return map;
  }, [vacationBlocks, year]);

  const appointmentsByDate = useMemo<Map<string, Appointment[]>>(() => {
    const map = new Map<string, Appointment[]>();
    for (const a of appointments) {
      const key = a.instance_date;
      const bucket = map.get(key);
      if (bucket) bucket.push(a);
      else map.set(key, [a]);
    }
    return map;
  }, [appointments]);

  // Birthdays are year-agnostic — render on matching month+day regardless of
  // the birth year. Key format: MM-DD.
  const birthdaysByMonthDay = useMemo<Map<string, Child[]>>(() => {
    const map = new Map<string, Child[]>();
    for (const c of children) {
      if (!c.birthday) continue;
      const parts = c.birthday.split("-");
      if (parts.length !== 3) continue;
      const key = `${parts[1]}-${parts[2]}`;
      const bucket = map.get(key);
      if (bucket) bucket.push(c);
      else map.set(key, [c]);
    }
    return map;
  }, [children]);

  const canDownload = canExport({ is_pro: isPro, trial_started_at: trialStartedAt });

  const handlePrint = useCallback(() => {
    if (!canDownload) return;
    // Add a class while printing so our @media print rules know we're the
    // active print target (lets other pages keep their own print rules).
    document.body.classList.add("year-planner-printing");
    const cleanup = () => {
      document.body.classList.remove("year-planner-printing");
      window.removeEventListener("afterprint", cleanup);
    };
    window.addEventListener("afterprint", cleanup);
    window.print();
  }, [canDownload]);

  function updateToggle<K extends keyof Toggles>(key: K, value: Toggles[K]) {
    setToggles((prev) => ({ ...prev, [key]: value }));
  }

  return (
    <>
      <PageHero
        overline="Your Family's"
        title="Year Planner"
        subtitle="A one-page wall calendar — your breaks, birthdays, and school days at a glance."
      />

      {/* Print-only CSS. Lives in the page so the @page rule only applies
          when the year planner is the mounted route — other printables keep
          portrait, etc. */}
      <style
        dangerouslySetInnerHTML={{
          __html: `
@media print {
  body.year-planner-printing * { visibility: hidden !important; }
  body.year-planner-printing .year-planner-print,
  body.year-planner-printing .year-planner-print * { visibility: visible !important; }
  body.year-planner-printing .year-planner-print {
    position: absolute !important;
    left: 0 !important;
    top: 0 !important;
    width: 100% !important;
    margin: 0 !important;
    padding: 0 !important;
    background: #ffffff !important;
  }
  body.year-planner-printing .year-planner-print * {
    -webkit-print-color-adjust: exact !important;
    print-color-adjust: exact !important;
  }
  body.year-planner-printing { background: #ffffff !important; }
  @page { size: letter landscape; margin: 0.3in; }
}
`,
        }}
      />

      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-8 space-y-6">
        {/* Top controls — year selector + download */}
        <section className="flex flex-wrap items-center gap-3 no-print">
          <Link
            href="/dashboard/printables"
            className="text-xs font-semibold text-[#7a6f65] hover:text-[#2d2926] transition-colors"
          >
            ← All printables
          </Link>
          <div className="flex-1" />
          <div className="flex items-center gap-1.5 bg-white border border-[#e8e5e0] rounded-xl px-2 py-1.5">
            <button
              type="button"
              onClick={() => setYear((y) => y - 1)}
              aria-label="Previous year"
              className="w-7 h-7 flex items-center justify-center rounded-lg text-[#5c7f63] hover:bg-[#f0ede8] transition-colors"
            >
              <ChevronLeft size={16} />
            </button>
            <span className="text-sm font-semibold text-[#2d2926] tabular-nums min-w-[56px] text-center">
              {year}
            </span>
            <button
              type="button"
              onClick={() => setYear((y) => y + 1)}
              aria-label="Next year"
              className="w-7 h-7 flex items-center justify-center rounded-lg text-[#5c7f63] hover:bg-[#f0ede8] transition-colors"
            >
              <ChevronRight size={16} />
            </button>
          </div>

          {canDownload ? (
            <button
              type="button"
              onClick={handlePrint}
              className="flex items-center gap-1.5 text-xs font-semibold bg-[#2D5A3D] hover:opacity-90 text-white px-3.5 py-2 rounded-xl transition-colors shadow-sm"
            >
              <Download size={13} /> Download as PDF
            </button>
          ) : (
            <Link
              href="/upgrade"
              title="Founding Family"
              aria-label="Download as PDF — Upgrade to Founding Family"
              className="flex items-center gap-1.5 text-xs font-semibold bg-[#c4bfb8] text-white px-3.5 py-2 rounded-xl opacity-80 hover:opacity-100 transition-opacity cursor-pointer"
            >
              <Lock size={12} /> Download as PDF
            </Link>
          )}
        </section>

        {/* Toggle panel */}
        <section className="bg-white border border-[#e8e5e0] rounded-2xl p-4 no-print">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-[#8B7E74] mb-2">
            Show on calendar
          </p>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            <ToggleChip
              label="Muted weekends"
              checked={toggles.mutedWeekends}
              onChange={(v) => updateToggle("mutedWeekends", v)}
            />
            <ToggleChip
              label="Vacation blocks"
              checked={toggles.showVacations}
              onChange={(v) => updateToggle("showVacations", v)}
            />
            <ToggleChip
              label="Appointments"
              checked={toggles.showAppointments}
              onChange={(v) => updateToggle("showAppointments", v)}
            />
            <ToggleChip
              label="Birthdays"
              checked={toggles.showBirthdays}
              onChange={(v) => updateToggle("showBirthdays", v)}
            />
          </div>
        </section>

        {/* On-screen preview + printable node share the same markup — the
            .year-planner-print class is what the print CSS isolates. A thin
            outer wrapper provides rounded corners + shadow for the preview,
            but those collapse to none on print via the isolation rules. */}
        <section className="bg-white border border-[#e8e5e0] rounded-2xl p-4 overflow-x-auto">
          <div className="year-planner-print min-w-[780px]">
            <h2
              className="text-center text-[18px] font-bold tracking-[0.14em] mb-3"
              style={{ color: "#2d2926", fontFamily: "Georgia, serif" }}
            >
              {year} YEAR PLANNER
            </h2>
            <YearGrid
              year={year}
              toggles={toggles}
              todayStr={todayStr}
              vacationByDate={vacationByDate}
              appointmentsByDate={appointmentsByDate}
              birthdaysByMonthDay={birthdaysByMonthDay}
            />
            <Legend toggles={toggles} />
          </div>
        </section>

        {/* Guidance for free users — hidden on print regardless */}
        {!canDownload && isPro !== null ? (
          <section className="no-print rounded-2xl p-4 border text-sm flex items-start gap-3" style={{ background: "#fffbf0", borderColor: "#f0dda8" }}>
            <span className="text-base leading-none mt-0.5">🌿</span>
            <div className="flex-1 min-w-0">
              <p className="font-semibold text-[#7a4a1a] mb-1">Preview only for free accounts</p>
              <p className="text-xs text-[#7a4a1a]/80 leading-relaxed">
                Founding Family members can download a print-ready PDF wall calendar.{" "}
                <Link href="/upgrade" className="font-semibold underline underline-offset-2">
                  Upgrade to Founding Family
                </Link>
                .
              </p>
            </div>
          </section>
        ) : null}
      </div>
    </>
  );
}

function ToggleChip({
  label, checked, onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label
      className="flex items-center gap-2 text-xs text-[#2d2926] bg-[#fefcf9] border rounded-lg px-3 py-2 cursor-pointer select-none transition-colors"
      style={{ borderColor: checked ? "#5c7f63" : "#e8e2d9" }}
    >
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="w-3.5 h-3.5 rounded accent-[#5c7f63]"
      />
      <span className="font-medium truncate">{label}</span>
    </label>
  );
}

function Legend({ toggles }: { toggles: Toggles }) {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 justify-center mt-3 text-[10px]" style={{ color: COLOR_MONTH_LABEL }}>
      {toggles.showVacations ? (
        <LegendSwatch color={COLOR_VACATION} borderColor={COLOR_VACATION_BORDER} label="Break / vacation" />
      ) : null}
      {toggles.mutedWeekends ? (
        <LegendSwatch color={COLOR_WEEKEND} borderColor={COLOR_BORDER} label="Weekend" />
      ) : null}
      {toggles.showAppointments ? (
        <span className="flex items-center gap-1">
          <span
            aria-hidden
            className="inline-block w-1.5 h-1.5 rounded-full"
            style={{ background: COLOR_APPT_DOT }}
          />
          Appointment
        </span>
      ) : null}
      {toggles.showBirthdays ? (
        <span className="flex items-center gap-1">
          <span aria-hidden>🎂</span> Birthday
        </span>
      ) : null}
      <span className="flex items-center gap-1">
        <span
          aria-hidden
          className="inline-block w-3 h-3 rounded-sm"
          style={{ background: "#ffffff", border: `1.5px solid ${COLOR_TODAY_OUTLINE}` }}
        />
        Today
      </span>
    </div>
  );
}

function LegendSwatch({ color, borderColor, label }: { color: string; borderColor: string; label: string }) {
  return (
    <span className="flex items-center gap-1">
      <span
        aria-hidden
        className="inline-block w-3 h-3 rounded-sm"
        style={{ background: color, border: `1px solid ${borderColor}` }}
      />
      {label}
    </span>
  );
}

function YearGrid(props: {
  year: number;
  toggles: Toggles;
  todayStr: string;
  vacationByDate: Map<string, VacationBlock>;
  appointmentsByDate: Map<string, Appointment[]>;
  birthdaysByMonthDay: Map<string, Child[]>;
}) {
  const { year, toggles, todayStr, vacationByDate, appointmentsByDate, birthdaysByMonthDay } = props;

  // Grid: 12 month rows × 32 columns (1 label + 31 days). We always render
  // 31 day cells and blank out the ones that don't exist in shorter months,
  // so column alignment stays perfect across rows.
  return (
    <div
      role="table"
      aria-label={`${year} Year Planner grid`}
      style={{
        display: "grid",
        gridTemplateColumns: "48px repeat(31, minmax(18px, 1fr))",
        gap: "2px",
        background: "#ffffff",
      }}
    >
      {/* Header row — blank corner + day numbers 1..31 */}
      <div aria-hidden />
      {Array.from({ length: 31 }, (_, i) => i + 1).map((d) => (
        <div
          key={`hd-${d}`}
          style={{
            fontSize: 9,
            fontWeight: 700,
            color: COLOR_MONTH_LABEL,
            textAlign: "center",
            letterSpacing: "0.03em",
            padding: "2px 0",
          }}
        >
          {d}
        </div>
      ))}

      {MONTH_LABELS.map((label, m0) => {
        const dim = daysInMonth(year, m0);
        return (
          <MonthRow
            key={label}
            label={label}
            year={year}
            m0={m0}
            dim={dim}
            toggles={toggles}
            todayStr={todayStr}
            vacationByDate={vacationByDate}
            appointmentsByDate={appointmentsByDate}
            birthdaysByMonthDay={birthdaysByMonthDay}
          />
        );
      })}
    </div>
  );
}

function MonthRow(props: {
  label: string;
  year: number;
  m0: number;
  dim: number;
  toggles: Toggles;
  todayStr: string;
  vacationByDate: Map<string, VacationBlock>;
  appointmentsByDate: Map<string, Appointment[]>;
  birthdaysByMonthDay: Map<string, Child[]>;
}) {
  const { label, year, m0, dim, toggles, todayStr, vacationByDate, appointmentsByDate, birthdaysByMonthDay } = props;
  return (
    <>
      <div
        role="rowheader"
        style={{
          fontSize: 10,
          fontWeight: 700,
          color: "#2d2926",
          letterSpacing: "0.08em",
          display: "flex",
          alignItems: "center",
          justifyContent: "flex-end",
          paddingRight: 6,
          background: "#faf8f4",
          borderRadius: 4,
        }}
      >
        {label}
      </div>
      {Array.from({ length: 31 }, (_, i) => i + 1).map((d) => {
        if (d > dim) {
          // Blank placeholder — keeps columns aligned without rendering a cell.
          return <div key={`${label}-${d}`} aria-hidden style={{ background: "transparent" }} />;
        }
        const dateStr = toDateStr(year, m0, d);
        const weekend = isWeekend(year, m0, d);
        const vac = toggles.showVacations ? vacationByDate.get(dateStr) : undefined;
        const weekdayCh = weekdayLetter(year, m0, d);
        const isToday = dateStr === todayStr;
        const appts = toggles.showAppointments ? appointmentsByDate.get(dateStr) : undefined;
        const bdays = toggles.showBirthdays
          ? birthdaysByMonthDay.get(`${pad2(m0 + 1)}-${pad2(d)}`)
          : undefined;

        const background = vac
          ? COLOR_VACATION
          : weekend && toggles.mutedWeekends
            ? COLOR_WEEKEND
            : COLOR_SCHOOL;
        const borderColor = vac
          ? COLOR_VACATION_BORDER
          : COLOR_BORDER;

        const ariaParts = [`${label} ${d}`, weekdayCh];
        if (vac) ariaParts.push(`break: ${vac.name}`);
        if (appts && appts.length > 0) ariaParts.push(`${appts.length} appointment${appts.length === 1 ? "" : "s"}`);
        if (bdays && bdays.length > 0) ariaParts.push(`${bdays.map((b) => b.name).join(", ")} birthday`);
        if (isToday) ariaParts.push("today");

        return (
          <div
            key={`${label}-${d}`}
            role="cell"
            aria-label={ariaParts.join(", ")}
            style={{
              position: "relative",
              background,
              border: isToday
                ? `1.5px solid ${COLOR_TODAY_OUTLINE}`
                : `1px solid ${borderColor}`,
              borderRadius: 3,
              minHeight: 26,
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              padding: "2px 1px",
              overflow: "hidden",
            }}
          >
            <span style={{ fontSize: 8, color: "#9a8e84", lineHeight: 1 }}>{weekdayCh}</span>
            <span
              style={{
                fontSize: 10,
                fontWeight: vac ? 700 : 500,
                color: vac ? "#7a4a1a" : "#2d2926",
                lineHeight: 1.1,
              }}
            >
              {bdays && bdays.length > 0 ? "🎂" : d}
            </span>
            {appts && appts.length > 0 ? (
              <span
                aria-hidden
                style={{
                  position: "absolute",
                  top: 2,
                  right: 2,
                  width: 4,
                  height: 4,
                  borderRadius: "50%",
                  background: COLOR_APPT_DOT,
                }}
              />
            ) : null}
          </div>
        );
      })}
    </>
  );
}
