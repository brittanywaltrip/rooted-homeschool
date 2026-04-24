"use client";

import type { PlanV2Appointment, PlanV2Child, PlanV2Lesson, PlanV2Vacation } from "./types";
import { CornerLeaves, InlineLeaf, SectionDivider } from "./print-decorations";
import { resolveChildColor } from "./colors";

/* ============================================================================
 * MonthlyPrintSheet — landscape letter, 6×7 calendar grid.
 *
 * Each cell shows date + child-color-coded lesson titles + appointment
 * times. Cells outside the focused month render dimmer. Vacation cells
 * get a soft amber fill.
 * ==========================================================================*/

const PAPER_BG = "#FAF7F0";
const INK = "#2d2926";
const MUTED = "#7a6f65";
const BRAND = "#3d5c42";
const VACATION_BG = "#fef9e8";
const VACATION_BORDER = "#f0dda8";

export interface MonthlyPrintSheetProps {
  monthStart: Date;
  childLabel: string;
  lessons: PlanV2Lesson[];
  appointments: PlanV2Appointment[];
  vacationBlocks: PlanV2Vacation[];
  kids: PlanV2Child[];
}

function toDateStr(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function formatTime(t: string | null): string {
  if (!t) return "";
  const [h, m] = t.split(":").map(Number);
  const h12 = ((h + 11) % 12) + 1;
  const suf = h >= 12 ? "p" : "a";
  return m === 0 ? `${h12}${suf}` : `${h12}:${String(m).padStart(2, "0")}${suf}`;
}

function lessonTitle(l: PlanV2Lesson): string {
  if (l.title && l.title.trim().length > 0) return l.title;
  if (l.lesson_number) return `Lesson ${l.lesson_number}`;
  return "Lesson";
}

const HEADERS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export default function MonthlyPrintSheet(props: MonthlyPrintSheetProps) {
  const { monthStart, childLabel, lessons, appointments, vacationBlocks, kids } = props;
  const childById = new Map(kids.map((k, i) => [k.id, { child: k, index: i }]));

  // 6×7 cell grid starting from the Sunday on or before the first of month.
  const year = monthStart.getFullYear();
  const month = monthStart.getMonth();
  const firstOfMonth = new Date(year, month, 1);
  const lead = firstOfMonth.getDay();
  const cells: { date: Date; dateStr: string; isCurrentMonth: boolean }[] = [];
  for (let i = 0; i < 42; i++) {
    const d = new Date(year, month, 1 - lead + i);
    cells.push({
      date: d,
      dateStr: toDateStr(d),
      isCurrentMonth: d.getMonth() === month,
    });
  }

  // Bucket lessons + appointments.
  const lessonsByDay = new Map<string, PlanV2Lesson[]>();
  for (const l of lessons) {
    const d = l.scheduled_date ?? l.date;
    if (!d) continue;
    const arr = lessonsByDay.get(d) ?? [];
    arr.push(l);
    lessonsByDay.set(d, arr);
  }
  const apptsByDay = new Map<string, PlanV2Appointment[]>();
  for (const a of appointments) {
    const arr = apptsByDay.get(a.instance_date) ?? [];
    arr.push(a);
    apptsByDay.set(a.instance_date, arr);
  }

  function vacationFor(dateStr: string): PlanV2Vacation | null {
    return vacationBlocks.find((b) => dateStr >= b.start_date && dateStr <= b.end_date) ?? null;
  }

  const monthLabel = monthStart.toLocaleDateString("en-US", { month: "long", year: "numeric" });

  return (
    <div
      className="plan-print-sheet"
      style={{
        position: "relative",
        width: "11in",
        minHeight: "8.5in",
        background: PAPER_BG,
        color: INK,
        padding: "0.45in 0.5in",
        boxSizing: "border-box",
        fontFamily: "'Cormorant Garamond', Georgia, serif",
        overflow: "hidden",
      }}
    >
      <CornerLeaves position="top-right" />
      <CornerLeaves position="bottom-left" />

      {/* Heading */}
      <header style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 12 }}>
        <p
          className="font-handwritten"
          style={{ fontSize: 44, lineHeight: 1, color: BRAND, margin: 0 }}
        >
          {monthLabel}
        </p>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            background: "#ffffff",
            border: `0.5px solid ${MUTED}80`,
            borderRadius: 999,
            padding: "4px 14px",
          }}
        >
          <InlineLeaf size={14} />
          <span className="font-handwritten" style={{ fontSize: 18, color: MUTED }}>
            {childLabel}
          </span>
        </div>
      </header>

      <SectionDivider />

      {/* Day-of-week headers */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 4, marginTop: 4 }}>
        {HEADERS.map((h) => (
          <div
            key={h}
            className="font-handwritten"
            style={{
              textAlign: "center",
              fontSize: 16,
              color: BRAND,
              padding: "2px 0",
            }}
          >
            {h}
          </div>
        ))}
      </div>

      {/* Cells */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(7, 1fr)",
          gridAutoRows: "minmax(1.05in, 1fr)",
          gap: 3,
          marginTop: 4,
        }}
      >
        {cells.map(({ date, dateStr, isCurrentMonth }) => {
          const dayLessons = lessonsByDay.get(dateStr) ?? [];
          const dayAppts = apptsByDay.get(dateStr) ?? [];
          const vac = vacationFor(dateStr);
          const visiblePillCount = Math.max(0, 4 - Math.min(2, dayAppts.length));
          const visibleLessons = dayLessons.slice(0, visiblePillCount);
          const visibleAppts = dayAppts.slice(0, 2);
          const overflow = dayLessons.length + dayAppts.length - visibleLessons.length - visibleAppts.length;

          const bg = vac ? VACATION_BG : isCurrentMonth ? "#ffffff" : "#fbfaf7";
          const border = vac ? `0.5px solid ${VACATION_BORDER}` : `0.5px solid ${MUTED}40`;

          return (
            <div
              key={dateStr}
              style={{
                background: bg,
                border,
                borderRadius: 6,
                padding: "3px 4px",
                opacity: isCurrentMonth ? 1 : 0.55,
                display: "flex",
                flexDirection: "column",
                gap: 2,
                overflow: "hidden",
              }}
            >
              {/* Date number */}
              <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between" }}>
                <span
                  style={{
                    fontSize: 11,
                    fontWeight: 600,
                    color: isCurrentMonth ? INK : MUTED,
                    fontVariantNumeric: "tabular-nums",
                  }}
                >
                  {date.getDate()}
                </span>
                {vac ? (
                  <span style={{ fontSize: 8, color: "#a07000", fontStyle: "italic" }}>
                    {vac.name}
                  </span>
                ) : null}
              </div>

              {/* Items */}
              {visibleLessons.map((l) => {
                const meta = l.child_id ? childById.get(l.child_id) : undefined;
                const childColor = resolveChildColor(meta?.child ?? null, meta?.index ?? 0);
                return (
                  <div
                    key={l.id}
                    style={{
                      display: "flex",
                      alignItems: "baseline",
                      gap: 3,
                      fontSize: 8,
                      lineHeight: 1.15,
                      color: INK,
                      paddingLeft: 4,
                      borderLeft: `2px solid ${childColor}`,
                      textDecoration: l.completed ? "line-through" : "none",
                    }}
                  >
                    <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {lessonTitle(l)}
                    </span>
                  </div>
                );
              })}
              {visibleAppts.map((a) => (
                <div
                  key={`${a.id}-${a.instance_date}`}
                  style={{
                    display: "flex",
                    alignItems: "baseline",
                    gap: 3,
                    fontSize: 8,
                    lineHeight: 1.15,
                    color: "#5c4a78",
                  }}
                >
                  <span style={{ fontVariantNumeric: "tabular-nums" }}>
                    {a.time ? formatTime(a.time) : "·"}
                  </span>
                  <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {a.title}
                  </span>
                </div>
              ))}
              {overflow > 0 ? (
                <p style={{ margin: 0, fontSize: 7, color: MUTED, textAlign: "right" }}>
                  +{overflow} more
                </p>
              ) : null}
            </div>
          );
        })}
      </div>

      {/* Footer */}
      <footer
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          bottom: "0.25in",
          textAlign: "center",
          fontSize: 9,
          color: MUTED,
          letterSpacing: "0.12em",
          textTransform: "lowercase",
        }}
      >
        rooted.
      </footer>
    </div>
  );
}
