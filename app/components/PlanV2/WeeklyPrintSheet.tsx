"use client";

import type { PlanV2Appointment, PlanV2Child, PlanV2Lesson } from "./types";
import { CheckCircle, CornerLeaves, InlineLeaf, SectionDivider } from "./print-decorations";
import { resolveChildColor } from "./colors";

/* ============================================================================
 * WeeklyPrintSheet — 7-day teacher-book layout, landscape letter.
 *
 * Sunday on the left, Saturday on the right (matches MonthGrid + WeekStrip).
 * Each column shows date header, lessons grouped by child color, then
 * appointments. Light "Week of …" summary bar at the top.
 * ==========================================================================*/

const PAPER_BG = "#FAF7F0";
const INK = "#2d2926";
const MUTED = "#7a6f65";
const BRAND = "#3d5c42";

export interface WeeklyPrintSheetProps {
  weekStart: Date; // Sunday
  childLabel: string;
  lessons: PlanV2Lesson[];        // Already filtered to the week + child filter
  appointments: PlanV2Appointment[];
  kids: PlanV2Child[];
}

function toDateStr(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function formatTime(t: string | null): string {
  if (!t) return "all day";
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

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export default function WeeklyPrintSheet(props: WeeklyPrintSheetProps) {
  const { weekStart, childLabel, lessons, appointments, kids } = props;
  const childById = new Map(kids.map((k, i) => [k.id, { child: k, index: i }]));

  // Build the 7 day cells.
  const days: { date: Date; dateStr: string }[] = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(weekStart.getFullYear(), weekStart.getMonth(), weekStart.getDate() + i);
    days.push({ date: d, dateStr: toDateStr(d) });
  }

  // Bucket lessons + appointments by date string.
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

  const weekEnd = days[6].date;
  const weekLabel = `${weekStart.toLocaleDateString("en-US", { month: "short", day: "numeric" })} – ${weekEnd.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}`;

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
        <div>
          <p
            className="font-handwritten"
            style={{ fontSize: 36, lineHeight: 1, color: BRAND, margin: 0 }}
          >
            Week of {weekLabel}
          </p>
          <p
            className="font-handwritten"
            style={{ fontSize: 22, color: MUTED, margin: "4px 0 0", lineHeight: 1 }}
          >
            {childLabel}
          </p>
        </div>
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
          <span style={{ fontSize: 12, color: MUTED, fontVariantNumeric: "tabular-nums" }}>
            {lessons.length} lesson{lessons.length === 1 ? "" : "s"} · {appointments.length} appt
            {appointments.length === 1 ? "" : "s"}
          </span>
        </div>
      </header>

      <SectionDivider />

      {/* 7 day columns */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(7, 1fr)",
          gap: 6,
          marginTop: 6,
        }}
      >
        {days.map(({ date, dateStr }, i) => {
          const dayLessons = (lessonsByDay.get(dateStr) ?? []).slice().sort((a, b) => {
            const ca = a.child_id ?? "";
            const cb = b.child_id ?? "";
            return ca.localeCompare(cb);
          });
          const dayAppts = apptsByDay.get(dateStr) ?? [];
          return (
            <div
              key={dateStr}
              style={{
                background: "#ffffff",
                border: `0.5px solid ${MUTED}50`,
                borderRadius: 8,
                padding: "8px 6px 10px",
                minHeight: "6.5in",
                display: "flex",
                flexDirection: "column",
                gap: 6,
              }}
            >
              {/* Day header */}
              <div style={{ textAlign: "center" }}>
                <p
                  className="font-handwritten"
                  style={{ fontSize: 18, lineHeight: 1, color: BRAND, margin: 0 }}
                >
                  {DAY_NAMES[i]}
                </p>
                <p style={{ fontSize: 22, fontWeight: 600, lineHeight: 1, margin: "2px 0 0", color: INK }}>
                  {date.getDate()}
                </p>
              </div>

              <div style={{ borderTop: `0.5px dashed ${MUTED}80`, marginTop: 2 }} />

              {/* Lessons */}
              <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                {dayLessons.length === 0 ? (
                  <p style={{ fontSize: 10, color: `${MUTED}90`, fontStyle: "italic", textAlign: "center", margin: "8px 0" }}>
                    free day
                  </p>
                ) : (
                  dayLessons.map((l) => {
                    const meta = l.child_id ? childById.get(l.child_id) : undefined;
                    const childColor = resolveChildColor(meta?.child ?? null, meta?.index ?? 0);
                    return (
                      <div
                        key={l.id}
                        style={{
                          display: "flex",
                          alignItems: "flex-start",
                          gap: 4,
                          paddingLeft: 4,
                          borderLeft: `2px solid ${childColor}`,
                        }}
                      >
                        <div style={{ marginTop: 1 }}>
                          <CheckCircle filled={l.completed} size={12} color={BRAND} />
                        </div>
                        <p
                          style={{
                            margin: 0,
                            fontSize: 11,
                            lineHeight: 1.25,
                            color: INK,
                            textDecoration: l.completed ? "line-through" : "none",
                            wordBreak: "break-word",
                          }}
                        >
                          {lessonTitle(l)}
                        </p>
                      </div>
                    );
                  })
                )}
              </div>

              {/* Appointments */}
              {dayAppts.length > 0 ? (
                <>
                  <div style={{ borderTop: `0.5px dashed ${MUTED}40`, marginTop: 2 }} />
                  <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                    {dayAppts.map((a) => (
                      <div
                        key={`${a.id}-${a.instance_date}`}
                        style={{
                          display: "flex",
                          alignItems: "baseline",
                          gap: 4,
                          fontSize: 10,
                          color: "#5c4a78",
                        }}
                      >
                        <span style={{ fontSize: 9, color: BRAND, fontVariantNumeric: "tabular-nums" }}>
                          {formatTime(a.time)}
                        </span>
                        <span style={{ flex: 1, minWidth: 0, lineHeight: 1.2 }}>
                          {a.title}
                        </span>
                      </div>
                    ))}
                  </div>
                </>
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
