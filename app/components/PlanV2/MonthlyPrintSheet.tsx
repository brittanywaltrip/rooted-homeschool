"use client";

import type { PlanV2Appointment, PlanV2Child, PlanV2Lesson, PlanV2Vacation } from "./types";
import { resolveChildColor } from "./colors";
import { tintFromHex, darkenHex } from "@/lib/color-tint";

/* MonthlyPrintSheet. Landscape letter, Mon-Fri grid with a left
 * week-label column. One row per week of the focused month (4-6 rows).
 * Cells show kid-color pills, plus appointment + break pills. Today's
 * cell gets a brand-green border. Legend below the grid. */

const INK = "#1a2c22";
const MUTED = "#555";
const HAIRLINE = "#ede9e1";
const RULE = "#d5d0c8";
const SUMMARY_BG = "#f8f6f1";
const SUMMARY_BORDER = "#e8e3d9";
const NOTE_BORDER = "#5c7f63";
const HEADER_BG = "#1a2c22";
const HEADER_TEXT = "#ffffff";
const APPT_BG = "#e8eef9";
const APPT_TEXT = "#234277";
const BREAK_BG = "#fef3da";
const BREAK_TEXT = "#7a4a1a";
const TODAY_BORDER = "#2D5A3D";

type Goal = { id: string; total_lessons: number | null };

export interface MonthlyPrintSheetProps {
  monthStart: Date;
  childLabel: string;          // kept for backwards-compat; not rendered
  familyName: string;
  lessons: PlanV2Lesson[];
  appointments: PlanV2Appointment[];
  vacationBlocks: PlanV2Vacation[];
  kids: PlanV2Child[];
  curriculumGoals: Goal[];
}

function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function todayPrintedLabel(): string {
  return new Date().toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function mondayOf(d: Date): Date {
  const x = new Date(d); x.setHours(0, 0, 0, 0);
  const offset = (x.getDay() + 6) % 7;
  x.setDate(x.getDate() - offset);
  return x;
}

const HEADERS = ["Mon", "Tue", "Wed", "Thu", "Fri"];
const GOAL_PLACEHOLDER: Goal[] = []; // typing convenience; not used directly

export default function MonthlyPrintSheet(props: MonthlyPrintSheetProps) {
  const { monthStart, familyName, lessons, appointments, vacationBlocks, kids } = props;
  // Suppress unused-var lint for the goal placeholder if the import happens to be removed.
  void GOAL_PLACEHOLDER;
  const childIndex = new Map(kids.map((k, i) => [k.id, { child: k, index: i }]));

  const monthLabel = monthStart.toLocaleDateString("en-US", { month: "long", year: "numeric" });

  // Build week rows: Mon-Fri only. Start from the Monday on or before the
  // 1st of the month; stop after the row whose Monday is past the last day
  // of the month.
  const year = monthStart.getFullYear();
  const month = monthStart.getMonth();
  const lastDayOfMonth = new Date(year, month + 1, 0).getDate();

  const weeks: { weekLabel: string; cells: { date: Date; key: string; isCurrentMonth: boolean; isToday: boolean }[] }[] = [];
  const cursor = mondayOf(new Date(year, month, 1));
  const todayStr = ymd(new Date());
  while (true) {
    const cells: typeof weeks[number]["cells"] = [];
    for (let i = 0; i < 5; i++) {
      const d = new Date(cursor); d.setDate(cursor.getDate() + i);
      cells.push({
        date: d,
        key: ymd(d),
        isCurrentMonth: d.getMonth() === month,
        isToday: ymd(d) === todayStr,
      });
    }
    const weekLabel = cursor.toLocaleDateString("en-US", { month: "short", day: "numeric" });
    weeks.push({ weekLabel, cells });
    cursor.setDate(cursor.getDate() + 7);
    // Stop when the new Monday is past the last day of the month.
    if (cursor.getMonth() !== month && cursor.getDate() > lastDayOfMonth + 6) break;
    if (weeks.length >= 6) break;
  }

  // Bucket lessons + appointments + breaks per day key.
  const lessonsByDay = new Map<string, PlanV2Lesson[]>();
  for (const l of lessons) {
    const k = l.scheduled_date ?? l.date;
    if (!k) continue;
    const arr = lessonsByDay.get(k) ?? [];
    arr.push(l);
    lessonsByDay.set(k, arr);
  }
  const apptsByDay = new Map<string, PlanV2Appointment[]>();
  for (const a of appointments) {
    const arr = apptsByDay.get(a.instance_date) ?? [];
    arr.push(a);
    apptsByDay.set(a.instance_date, arr);
  }
  const breakFor = (dateStr: string) =>
    vacationBlocks.find((b) => dateStr >= b.start_date && dateStr <= b.end_date) ?? null;

  const totalLessons = lessons.length;
  const totalKids = kids.length;
  const totalAppts = appointments.length;

  // Per-cell kid bucketing: lessons grouped by child_id within each day.
  function kidPillsForDay(dateStr: string): { kidId: string; kidName: string; color: string; subjectIfOne: string | null; count: number }[] {
    const day = lessonsByDay.get(dateStr) ?? [];
    const byKid = new Map<string, PlanV2Lesson[]>();
    for (const l of day) {
      const id = l.child_id ?? "__unassigned";
      const arr = byKid.get(id) ?? [];
      arr.push(l);
      byKid.set(id, arr);
    }
    return Array.from(byKid.entries()).map(([id, items]) => {
      const ctx = id === "__unassigned" ? null : childIndex.get(id);
      const color = ctx ? resolveChildColor(ctx.child, ctx.index) : "#7a6f65";
      const kidName = ctx?.child.name ?? "?";
      const subjectIfOne = items.length === 1 ? (items[0].subjects?.name ?? null) : null;
      return { kidId: id, kidName, color, subjectIfOne, count: items.length };
    });
  }

  return (
    <div
      className="plan-print-sheet"
      style={{
        position: "relative",
        width: "11in",
        minHeight: "8.5in",
        background: "#ffffff",
        color: INK,
        padding: "0.4in 0.5in 1in",
        boxSizing: "border-box",
        fontFamily: "Arial, Helvetica, sans-serif",
      }}
    >
      <PrintHeader familyName={familyName} dateLabel={monthLabel} />
      <PrintSummaryBar lessons={totalLessons} kids={totalKids} appts={totalAppts} />

      {/* Calendar grid: [week-label col] + Mon..Fri */}
      <div style={{ marginTop: 14 }}>
        <div
          role="table"
          style={{
            display: "grid",
            gridTemplateColumns: "0.55in repeat(5, 1fr)",
            gap: 2,
          }}
        >
          {/* Header row */}
          <div style={{ background: HEADER_BG, color: HEADER_TEXT, fontSize: 10, fontWeight: 700, textAlign: "center", padding: "5px 0", letterSpacing: "0.08em", textTransform: "uppercase", borderRadius: 3 }}>
            Week
          </div>
          {HEADERS.map((h) => (
            <div
              key={h}
              style={{
                background: HEADER_BG,
                color: HEADER_TEXT,
                fontSize: 10,
                fontWeight: 700,
                textAlign: "center",
                padding: "5px 0",
                letterSpacing: "0.08em",
                textTransform: "uppercase",
                borderRadius: 3,
              }}
            >
              {h}
            </div>
          ))}

          {/* Week rows */}
          {weeks.map((w) => (
            <WeekRowFragment key={w.weekLabel} weekLabel={w.weekLabel}>
              {w.cells.map((c) => {
                const br = breakFor(c.key);
                const pills = kidPillsForDay(c.key);
                const dayAppts = apptsByDay.get(c.key) ?? [];
                return (
                  <DayCell
                    key={c.key}
                    date={c.date}
                    isCurrentMonth={c.isCurrentMonth}
                    isToday={c.isToday}
                    isBreak={!!br}
                    breakName={br?.name ?? null}
                    pills={pills}
                    appts={dayAppts}
                  />
                );
              })}
            </WeekRowFragment>
          ))}
        </div>
      </div>

      {/* Legend */}
      <div
        style={{
          marginTop: 12,
          padding: "8px 12px",
          background: SUMMARY_BG,
          border: `1px solid ${SUMMARY_BORDER}`,
          borderRadius: 6,
          display: "flex",
          flexWrap: "wrap",
          gap: 14,
          fontSize: 10,
          color: MUTED,
        }}
      >
        {kids.map((k, i) => {
          const color = resolveChildColor(k, i);
          return (
            <div key={k.id} style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
              <span aria-hidden style={{ width: 9, height: 9, borderRadius: "50%", background: color }} />
              <span style={{ color: INK, fontWeight: 600 }}>{k.name}</span>
            </div>
          );
        })}
        <div style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
          <span aria-hidden style={{ width: 9, height: 9, borderRadius: 2, background: APPT_BG, border: `1px solid ${APPT_TEXT}` }} />
          <span style={{ color: INK, fontWeight: 600 }}>Appointment</span>
        </div>
        <div style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
          <span aria-hidden style={{ width: 9, height: 9, borderRadius: 2, background: BREAK_BG, border: `1px solid ${BREAK_TEXT}` }} />
          <span style={{ color: INK, fontWeight: 600 }}>Break</span>
        </div>
      </div>

      <NotesSection sublabel="For whoever is teaching this month" lineCount={3} />
      <PrintFooter />
    </div>
  );
}

// ── Cell + row fragments ────────────────────────────────────────────────────

function WeekRowFragment({ weekLabel, children }: { weekLabel: string; children: React.ReactNode }) {
  return (
    <>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#faf8f4",
          border: `1px solid ${HAIRLINE}`,
          borderRadius: 4,
          fontSize: 9,
          color: MUTED,
          padding: "4px 0",
          fontWeight: 600,
        }}
      >
        {weekLabel}
      </div>
      {children}
    </>
  );
}

function DayCell({
  date, isCurrentMonth, isToday, isBreak, breakName, pills, appts,
}: {
  date: Date;
  isCurrentMonth: boolean;
  isToday: boolean;
  isBreak: boolean;
  breakName: string | null;
  pills: { kidId: string; kidName: string; color: string; subjectIfOne: string | null; count: number }[];
  appts: { id: string; title: string; instance_date: string }[];
}) {
  return (
    <div
      style={{
        background: isBreak ? BREAK_BG : "#ffffff",
        border: isToday ? `1.5px solid ${TODAY_BORDER}` : `1px solid ${HAIRLINE}`,
        borderRadius: 4,
        minHeight: "1.05in",
        padding: "4px 5px",
        opacity: isCurrentMonth ? 1 : 0.45,
        display: "flex",
        flexDirection: "column",
        gap: 2,
        overflow: "hidden",
      }}
    >
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between" }}>
        <span style={{ fontSize: 11, fontWeight: 700, color: isCurrentMonth ? INK : MUTED, fontVariantNumeric: "tabular-nums" }}>
          {date.getDate()}
        </span>
        {isBreak && breakName ? (
          <span style={{ fontSize: 8, color: BREAK_TEXT, fontStyle: "italic" }}>{breakName}</span>
        ) : null}
      </div>
      {pills.map((p) => {
        const bg = tintFromHex(p.color, 0.25);
        const text = darkenHex(p.color, 0.45);
        const label = p.count === 1 && p.subjectIfOne
          ? `${p.kidName}: ${p.subjectIfOne}`
          : `${p.kidName}: ${p.count} lesson${p.count === 1 ? "" : "s"}`;
        return (
          <div
            key={p.kidId}
            style={{
              fontSize: 9,
              fontWeight: 600,
              color: text,
              background: bg,
              padding: "2px 5px",
              borderRadius: 3,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {label}
          </div>
        );
      })}
      {appts.slice(0, 2).map((a) => (
        <div
          key={`${a.id}-${a.instance_date}`}
          style={{
            fontSize: 9,
            fontWeight: 600,
            color: APPT_TEXT,
            background: APPT_BG,
            padding: "2px 5px",
            borderRadius: 3,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          📅 {a.title}
        </div>
      ))}
    </div>
  );
}

// ── Shared print primitives (inlined per sheet) ─────────────────────────────

function PrintHeader({ familyName, dateLabel }: { familyName: string; dateLabel: string }) {
  return (
    <header
      style={{
        display: "flex",
        alignItems: "flex-end",
        justifyContent: "space-between",
        gap: 16,
        paddingBottom: 10,
        borderBottom: `1.5px solid ${INK}`,
      }}
    >
      <img src="/rooted-logo-nav.png" alt="Rooted" style={{ height: 28, width: "auto" }} />
      <div style={{ textAlign: "right" }}>
        <p style={{ margin: 0, fontSize: 10, letterSpacing: "0.1em", textTransform: "uppercase", color: MUTED }}>
          {familyName}
        </p>
        <p style={{ margin: "2px 0 0", fontSize: 13, fontWeight: 600, color: INK }}>
          {dateLabel}
        </p>
      </div>
    </header>
  );
}

function PrintSummaryBar({ lessons, kids, appts }: { lessons: number; kids: number; appts: number }) {
  return (
    <div
      style={{
        marginTop: 12,
        display: "inline-flex",
        alignItems: "center",
        gap: 14,
        background: SUMMARY_BG,
        border: `1px solid ${SUMMARY_BORDER}`,
        borderRadius: 999,
        padding: "5px 14px",
        fontSize: 11,
        color: MUTED,
      }}
    >
      <SummaryItem n={lessons} label={lessons === 1 ? "lesson" : "lessons"} />
      <span aria-hidden style={{ color: "#cfc9c0" }}>·</span>
      <SummaryItem n={kids} label={kids === 1 ? "kid" : "kids"} />
      {appts > 0 ? (
        <>
          <span aria-hidden style={{ color: "#cfc9c0" }}>·</span>
          <SummaryItem n={appts} label={appts === 1 ? "appointment" : "appointments"} />
        </>
      ) : null}
    </div>
  );
}

function SummaryItem({ n, label }: { n: number; label: string }) {
  return (
    <span>
      <strong style={{ color: INK, fontWeight: 700 }}>{n}</strong>{" "}
      {label}
    </span>
  );
}

function NotesSection({ sublabel, lineCount }: { sublabel: string; lineCount: number }) {
  return (
    <section style={{ marginTop: 14, paddingTop: 8, borderTop: `1px solid ${HAIRLINE}` }}>
      <p style={{ margin: 0, fontSize: 10, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: NOTE_BORDER }}>
        Notes
      </p>
      <p style={{ margin: "2px 0 0", fontSize: 10, fontStyle: "italic", color: "#aaa" }}>
        {sublabel}
      </p>
      <div style={{ marginTop: 8 }}>
        {Array.from({ length: lineCount }).map((_, i) => (
          <div key={i} style={{ borderBottom: `0.5px solid ${RULE}`, height: 22 }} />
        ))}
      </div>
    </section>
  );
}

function PrintFooter() {
  return (
    <footer
      style={{
        position: "absolute",
        left: 0,
        right: 0,
        bottom: "0.3in",
        textAlign: "center",
        fontSize: 10,
        color: "#aaa",
      }}
    >
      rootedhomeschoolapp.com · printed {todayPrintedLabel()}
    </footer>
  );
}
