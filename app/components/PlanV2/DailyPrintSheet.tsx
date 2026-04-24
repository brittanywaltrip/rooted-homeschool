"use client";

import type { PlanV2Appointment, PlanV2Child, PlanV2Lesson } from "./types";
import { CheckCircle, CornerLeaves, DateCircle, InlineLeaf, SectionDivider } from "./print-decorations";

/* ============================================================================
 * DailyPrintSheet — single-day printable, portrait letter.
 *
 * Pure presentational. Hidden on screen, made visible only when the parent
 * sets `body.print-mode-daily`. The container's class `plan-print-sheet` is
 * what the print-isolation CSS keys off; do not rename without updating
 * the rule in PlanV2/index.tsx.
 * ==========================================================================*/

const PAPER_BG = "#FAF7F0";
const INK = "#2d2926";
const MUTED = "#7a6f65";
const BRAND = "#3d5c42";

export interface DailyPrintSheetProps {
  date: Date;
  childLabel: string;        // "Justin's Plan" or "All Kids"
  lessons: PlanV2Lesson[];
  appointments: PlanV2Appointment[];
  kids: PlanV2Child[];
}

function formatTime(t: string | null): string {
  if (!t) return "";
  const [h, m] = t.split(":").map(Number);
  const h12 = ((h + 11) % 12) + 1;
  const suf = h >= 12 ? "PM" : "AM";
  return m === 0 ? `${h12} ${suf}` : `${h12}:${String(m).padStart(2, "0")} ${suf}`;
}

function lessonTitle(l: PlanV2Lesson): string {
  if (l.title && l.title.trim().length > 0) return l.title;
  if (l.lesson_number) return `Lesson ${l.lesson_number}`;
  return "Lesson";
}

export default function DailyPrintSheet(props: DailyPrintSheetProps) {
  const { date, childLabel, lessons, appointments, kids } = props;
  const childById = new Map(kids.map((k) => [k.id, k]));

  const dayName = date.toLocaleDateString("en-US", { weekday: "long" });
  const monthYear = date.toLocaleDateString("en-US", { month: "long", year: "numeric" });

  return (
    <div
      className="plan-print-sheet"
      style={{
        position: "relative",
        width: "8.5in",
        minHeight: "11in",
        background: PAPER_BG,
        color: INK,
        padding: "0.55in 0.6in",
        boxSizing: "border-box",
        fontFamily: "'Cormorant Garamond', Georgia, serif",
        overflow: "hidden",
      }}
    >
      <CornerLeaves position="top-right" />
      <CornerLeaves position="bottom-left" />

      {/* Date heading */}
      <header style={{ display: "flex", alignItems: "center", gap: 18, marginBottom: 12 }}>
        <DateCircle dateNumber={date.getDate()} size={92} />
        <div>
          <p
            className="font-handwritten"
            style={{ fontSize: 38, lineHeight: 1, color: BRAND, margin: 0 }}
          >
            {dayName}
          </p>
          <p
            className="font-handwritten"
            style={{ fontSize: 22, color: MUTED, margin: "4px 0 0", lineHeight: 1 }}
          >
            {monthYear}
          </p>
        </div>
      </header>

      <p
        className="font-handwritten"
        style={{ fontSize: 30, color: INK, margin: "10px 0 0", lineHeight: 1 }}
      >
        {childLabel}
      </p>

      <SectionDivider />

      {/* Lessons */}
      <section style={{ marginBottom: 16 }}>
        <SectionLabel text="Today's Lessons" />
        {lessons.length === 0 ? (
          <p style={{ fontSize: 14, color: MUTED, fontStyle: "italic", margin: "6px 0 0" }}>
            Free day — nothing scheduled.
          </p>
        ) : (
          <ul style={{ listStyle: "none", padding: 0, margin: "8px 0 0" }}>
            {lessons.map((l) => {
              const child = l.child_id ? childById.get(l.child_id) : undefined;
              const subject = l.subjects?.name;
              return (
                <li
                  key={l.id}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                    padding: "8px 0",
                    borderBottom: `0.5px dashed ${MUTED}`,
                  }}
                >
                  <CheckCircle filled={l.completed} size={20} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <p
                      style={{
                        margin: 0,
                        fontSize: 17,
                        color: INK,
                        textDecoration: l.completed ? "line-through" : "none",
                      }}
                    >
                      {lessonTitle(l)}
                    </p>
                    <p style={{ margin: "1px 0 0", fontSize: 12, color: MUTED }}>
                      {subject ? <span>{subject} · </span> : null}
                      {child ? child.name : null}
                    </p>
                  </div>
                  {l.minutes_spent != null ? (
                    <span style={{ fontSize: 12, color: MUTED, fontVariantNumeric: "tabular-nums" }}>
                      {l.minutes_spent}m
                    </span>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {/* Appointments */}
      {appointments.length > 0 ? (
        <section style={{ marginBottom: 16 }}>
          <SectionLabel text="Appointments" />
          <ul style={{ listStyle: "none", padding: 0, margin: "8px 0 0" }}>
            {appointments.map((a) => (
              <li
                key={`${a.id}-${a.instance_date}`}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  padding: "8px 0",
                  borderBottom: `0.5px dashed ${MUTED}`,
                }}
              >
                <span style={{ fontSize: 18 }}>{a.emoji ?? "📍"}</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <p style={{ margin: 0, fontSize: 16, color: INK }}>{a.title}</p>
                  {a.location ? (
                    <p style={{ margin: "1px 0 0", fontSize: 12, color: MUTED }}>{a.location}</p>
                  ) : null}
                </div>
                <span
                  className="font-handwritten"
                  style={{ fontSize: 18, color: BRAND }}
                >
                  {a.time ? formatTime(a.time) : "All day"}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {/* Notes */}
      <section>
        <SectionLabel text="Notes" />
        <div style={{ marginTop: 10 }}>
          {Array.from({ length: 8 }).map((_, i) => (
            <div
              key={i}
              style={{
                borderBottom: `0.5px solid ${MUTED}40`,
                height: 26,
              }}
            />
          ))}
        </div>
      </section>

      {/* Footer */}
      <footer
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          bottom: "0.35in",
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

function SectionLabel({ text }: { text: string }) {
  return (
    <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
      <InlineLeaf size={16} />
      <p
        className="font-handwritten"
        style={{
          margin: 0,
          fontSize: 26,
          color: BRAND,
          lineHeight: 1,
        }}
      >
        {text}
      </p>
    </div>
  );
}
