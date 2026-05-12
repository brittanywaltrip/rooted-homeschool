"use client";

import type { PlanV2Appointment, PlanV2Child, PlanV2Lesson } from "./types";
import { resolveChildColor } from "./colors";

/* DailyPrintSheet. Single-day printable, portrait letter. Pure
 * presentational. Hidden on screen, made visible only when the parent
 * sets body.print-mode-daily. The container's class plan-print-sheet is
 * what the print-isolation CSS keys off; do not rename without updating
 * the rule in app/globals.css. */

const INK = "#1a2c22";
const MUTED = "#555";
const HAIRLINE = "#ede9e1";
const RULE = "#d5d0c8";
const SUMMARY_BG = "#f8f6f1";
const SUMMARY_BORDER = "#e8e3d9";
const NOTE_BG = "#f4faf4";
const NOTE_BORDER = "#5c7f63";

type Goal = { id: string; total_lessons: number | null };

export interface DailyPrintSheetProps {
  date: Date;
  childLabel: string;          // kept for backwards-compat; not rendered in the new design
  familyName: string;
  lessons: PlanV2Lesson[];
  appointments: PlanV2Appointment[];
  kids: PlanV2Child[];
  curriculumGoals: Goal[];
  /** Optional Today-page list — kept on the prop shape so the Today
   *  integration doesn't break if it's revived later. Not rendered in
   *  the new design. */
  dailyListItems?: { id: string; text: string; done: boolean }[];
}

function lessonSubject(l: PlanV2Lesson): string {
  return l.subjects?.name ?? "Lesson";
}

function lessonTitleText(l: PlanV2Lesson): string {
  if (l.title && l.title.trim().length > 0) return l.title;
  if (l.lesson_number) return `Lesson ${l.lesson_number}`;
  return "Lesson";
}

function todayPrintedLabel(): string {
  return new Date().toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

export default function DailyPrintSheet(props: DailyPrintSheetProps) {
  const { date, familyName, lessons, appointments, kids, curriculumGoals } = props;
  const childIndex = new Map(kids.map((k, i) => [k.id, { child: k, index: i }]));
  const goalById = new Map(curriculumGoals.map((g) => [g.id, g]));

  const dateLabel = date.toLocaleDateString("en-US", {
    weekday: "long", month: "long", day: "numeric", year: "numeric",
  });

  // Group lessons by child, in kids order (kids is sorted by created_at-ish via
  // sort_order in the parent).
  const lessonsByChild = new Map<string, PlanV2Lesson[]>();
  const unassigned: PlanV2Lesson[] = [];
  for (const l of lessons) {
    if (l.child_id && childIndex.has(l.child_id)) {
      const arr = lessonsByChild.get(l.child_id) ?? [];
      arr.push(l);
      lessonsByChild.set(l.child_id, arr);
    } else {
      unassigned.push(l);
    }
  }

  const totalLessons = lessons.length;
  const totalKids = kids.length;
  const totalAppts = appointments.length;

  return (
    <div
      className="plan-print-sheet"
      style={{
        position: "relative",
        width: "8.5in",
        minHeight: "11in",
        background: "#ffffff",
        color: INK,
        padding: "0.55in 0.6in 1in",
        boxSizing: "border-box",
        fontFamily: "Arial, Helvetica, sans-serif",
      }}
    >
      <PrintHeader familyName={familyName} dateLabel={dateLabel} />
      <PrintSummaryBar lessons={totalLessons} kids={totalKids} appts={totalAppts} />

      {/* Per-kid sections */}
      <div style={{ marginTop: 18 }}>
        {kids.map((k, i) => {
          const items = lessonsByChild.get(k.id) ?? [];
          if (items.length === 0) return (
            <KidSection
              key={k.id}
              kid={k}
              color={resolveChildColor(k, i)}
              empty
            />
          );
          return (
            <KidSection key={k.id} kid={k} color={resolveChildColor(k, i)}>
              {items.map((l) => (
                <LessonRow
                  key={l.id}
                  lesson={l}
                  color={resolveChildColor(k, i)}
                  totalLessons={l.curriculum_goal_id ? goalById.get(l.curriculum_goal_id)?.total_lessons ?? null : null}
                />
              ))}
            </KidSection>
          );
        })}
        {unassigned.length > 0 ? (
          <KidSection kid={{ id: "__unassigned", name: "Unassigned", color: null, sort_order: null } as PlanV2Child} color="#7a6f65">
            {unassigned.map((l) => (
              <LessonRow
                key={l.id}
                lesson={l}
                color="#7a6f65"
                totalLessons={l.curriculum_goal_id ? goalById.get(l.curriculum_goal_id)?.total_lessons ?? null : null}
              />
            ))}
          </KidSection>
        ) : null}
      </div>

      {/* Appointments — short list under the per-kid sections, only if any */}
      {appointments.length > 0 ? (
        <div style={{ marginTop: 18 }}>
          <p style={{ margin: 0, fontSize: 10, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: NOTE_BORDER }}>
            Appointments
          </p>
          <ul style={{ listStyle: "none", padding: 0, margin: "6px 0 0" }}>
            {appointments.map((a) => (
              <li key={`${a.id}-${a.instance_date}`} style={{ display: "flex", alignItems: "baseline", gap: 8, padding: "4px 0", borderBottom: `0.5px solid ${HAIRLINE}` }}>
                <span style={{ fontSize: 12, color: INK }}>{a.emoji ?? "📍"}</span>
                <span style={{ flex: 1, fontSize: 12, color: INK }}>{a.title}</span>
                <span style={{ fontSize: 11, color: MUTED, fontVariantNumeric: "tabular-nums" }}>
                  {a.time ?? "All day"}{a.location ? ` · ${a.location}` : ""}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <NotesSection
        sublabel="For whoever is teaching today"
        lineCount={4}
      />
      <PrintFooter />
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
        fontFamily: "Arial, Helvetica, sans-serif",
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

function KidSection({
  kid, color, empty, children,
}: {
  kid: PlanV2Child;
  color: string;
  empty?: boolean;
  children?: React.ReactNode;
}) {
  return (
    <section style={{ marginBottom: 14 }}>
      <header
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          paddingBottom: 4,
          borderBottom: `1.5px solid ${color}`,
        }}
      >
        <span aria-hidden style={{ width: 10, height: 10, borderRadius: "50%", background: color }} />
        <span style={{ fontSize: 12, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color }}>
          {kid.name}
        </span>
      </header>
      <div style={{ paddingLeft: 18, paddingTop: 6 }}>
        {empty ? (
          <p style={{ margin: 0, fontSize: 11, fontStyle: "italic", color: "#aaa" }}>
            Nothing scheduled
          </p>
        ) : children}
      </div>
    </section>
  );
}

function LessonRow({
  lesson, color, totalLessons,
}: {
  lesson: PlanV2Lesson;
  color: string;
  totalLessons: number | null;
}) {
  const subject = lessonSubject(lesson);
  const title = lessonTitleText(lesson);
  const showProgress = lesson.lesson_number != null && totalLessons != null && totalLessons > 0;
  return (
    <div style={{ display: "flex", alignItems: "flex-start", gap: 8, padding: "4px 0", borderBottom: `0.5px solid ${HAIRLINE}` }}>
      <span
        aria-hidden
        style={{
          width: 13,
          height: 13,
          border: `1.5px solid ${color}`,
          borderRadius: 3,
          flexShrink: 0,
          marginTop: 2,
        }}
      />
      <div style={{ flex: 1, minWidth: 0 }}>
        <p style={{ margin: 0, fontSize: 13, fontWeight: 700, color: INK }}>{subject}</p>
        <p style={{ margin: "1px 0 0", fontSize: 11, color: MUTED }}>{title}</p>
        {showProgress ? (
          <p style={{ margin: "1px 0 0", fontSize: 10, color: "#aaa" }}>
            Lesson {lesson.lesson_number} of {totalLessons}
          </p>
        ) : null}
        {lesson.notes ? (
          <p
            style={{
              margin: "4px 0 2px",
              padding: "4px 8px",
              fontSize: 11,
              fontStyle: "italic",
              fontFamily: "Georgia, serif",
              color: NOTE_BORDER,
              background: NOTE_BG,
              borderLeft: `2px solid ${NOTE_BORDER}`,
            }}
          >
            {lesson.notes}
          </p>
        ) : null}
      </div>
    </div>
  );
}

function NotesSection({ sublabel, lineCount }: { sublabel: string; lineCount: number }) {
  return (
    <section style={{ marginTop: 22, paddingTop: 10, borderTop: `1px solid ${HAIRLINE}` }}>
      <p style={{ margin: 0, fontSize: 10, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: NOTE_BORDER }}>
        Notes
      </p>
      <p style={{ margin: "2px 0 0", fontSize: 10, fontStyle: "italic", color: "#aaa" }}>
        {sublabel}
      </p>
      <div style={{ marginTop: 10 }}>
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
        bottom: "0.4in",
        textAlign: "center",
        fontSize: 10,
        color: "#aaa",
        fontFamily: "Arial, Helvetica, sans-serif",
      }}
    >
      rootedhomeschoolapp.com · printed {todayPrintedLabel()}
    </footer>
  );
}
