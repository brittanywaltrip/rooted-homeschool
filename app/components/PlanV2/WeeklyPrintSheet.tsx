"use client";

import type { PlanV2Appointment, PlanV2Child, PlanV2Lesson, PlanV2Vacation } from "./types";
import { resolveChildColor } from "./colors";

/* WeeklyPrintSheet. Landscape letter, day-block layout. Each school day in
 * the week renders as a stacked block with a date pill and per-kid lesson
 * lists. Weekends and break days are skipped per the spec. */

const INK = "#1a2c22";
const MUTED = "#555";
const HAIRLINE = "#ede9e1";
const RULE = "#d5d0c8";
const SUMMARY_BG = "#f8f6f1";
const SUMMARY_BORDER = "#e8e3d9";
const NOTE_BG = "#f4faf4";
const NOTE_BORDER = "#5c7f63";
const DAY_PILL_BG = "#f0ece3";

const DB_DAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]; // Mon=0..Sun=6
const DAY_NAMES_FULL = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

type Goal = { id: string; total_lessons: number | null };

export interface WeeklyPrintSheetProps {
  weekStart: Date; // Monday on or before today (or any week the user navigated to)
  childLabel: string;          // kept for backwards-compat; not rendered
  familyName: string;
  lessons: PlanV2Lesson[];     // already filtered to the week + child filter
  appointments: PlanV2Appointment[];
  kids: PlanV2Child[];
  curriculumGoals: Goal[];
  schoolDays: string[];        // profile.school_days, e.g. ["Mon","Tue","Wed","Thu","Fri"]
  vacationBlocks: PlanV2Vacation[];
}

function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
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

function mondayOf(d: Date): Date {
  const x = new Date(d); x.setHours(0, 0, 0, 0);
  const offset = (x.getDay() + 6) % 7;
  x.setDate(x.getDate() - offset);
  return x;
}

export default function WeeklyPrintSheet(props: WeeklyPrintSheetProps) {
  const { weekStart, familyName, lessons, appointments, kids, curriculumGoals, schoolDays, vacationBlocks } = props;
  const childIndex = new Map(kids.map((k, i) => [k.id, { child: k, index: i }]));
  const goalById = new Map(curriculumGoals.map((g) => [g.id, g]));

  const start = mondayOf(weekStart);
  const end = new Date(start); end.setDate(end.getDate() + 6);

  const todayStr = ymd(new Date());
  const isInWeek = todayStr >= ymd(start) && todayStr <= ymd(end);

  const headerRange = `Week of ${start.toLocaleDateString("en-US", { month: "short", day: "numeric" })} - ${end.toLocaleDateString("en-US", { month: "short", day: "numeric" })}, ${end.getFullYear()}`;

  // Build the visible day list: 7 days minus weekends (per profile.school_days)
  // and minus break days. School-day check is by 3-letter label (Mon..Sun).
  const schoolDaySet = new Set(schoolDays);
  const isBreakDay = (key: string) =>
    vacationBlocks.some((b) => key >= b.start_date && key <= b.end_date);

  const days: { date: Date; key: string; label: string; isToday: boolean }[] = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(start); d.setDate(start.getDate() + i);
    const key = ymd(d);
    const labelKey = DB_DAY_LABELS[i]; // Mon=0..Sun=6
    if (!schoolDaySet.has(labelKey)) continue;
    if (isBreakDay(key)) continue;
    days.push({
      date: d,
      key,
      label: `${DAY_NAMES_FULL[i]}, ${d.toLocaleDateString("en-US", { month: "short", day: "numeric" })}`,
      isToday: key === todayStr,
    });
  }

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

  const totalLessons = lessons.length;
  const totalKids = kids.length;
  const totalAppts = appointments.length;

  return (
    <div
      className="plan-print-sheet"
      style={{
        position: "relative",
        width: "11in",
        minHeight: "8.5in",
        background: "#ffffff",
        color: INK,
        padding: "0.45in 0.55in 1in",
        boxSizing: "border-box",
        fontFamily: "Arial, Helvetica, sans-serif",
      }}
    >
      <PrintHeader familyName={familyName} dateLabel={headerRange} />
      <PrintSummaryBar lessons={totalLessons} kids={totalKids} appts={totalAppts} />

      {/* Day blocks */}
      <div style={{ marginTop: 16, display: "flex", flexDirection: "column", gap: 14 }}>
        {days.length === 0 ? (
          <p style={{ margin: 0, fontSize: 12, fontStyle: "italic", color: "#aaa" }}>
            No school days this week.
          </p>
        ) : (
          days.map((day) => {
            const dayLessons = lessonsByDay.get(day.key) ?? [];
            const dayAppts = apptsByDay.get(day.key) ?? [];
            // Group by child in kids order
            const byKid = new Map<string, PlanV2Lesson[]>();
            const unassigned: PlanV2Lesson[] = [];
            for (const l of dayLessons) {
              if (l.child_id && childIndex.has(l.child_id)) {
                const arr = byKid.get(l.child_id) ?? [];
                arr.push(l);
                byKid.set(l.child_id, arr);
              } else unassigned.push(l);
            }
            const isInWeekToday = isInWeek && day.isToday;
            return (
              <section key={day.key}>
                {/* Day pill header */}
                <div
                  style={{
                    display: "inline-block",
                    background: DAY_PILL_BG,
                    color: INK,
                    fontSize: 11,
                    fontWeight: 700,
                    letterSpacing: "0.08em",
                    textTransform: "uppercase",
                    borderRadius: 4,
                    padding: "3px 9px",
                  }}
                >
                  {day.label}{isInWeekToday ? " · Today" : ""}
                </div>

                {/* Per-kid blocks */}
                <div style={{ marginTop: 6, paddingLeft: 6 }}>
                  {(() => {
                    const renderedKids: React.ReactNode[] = [];
                    let firstRendered = true;
                    kids.forEach((k, i) => {
                      const items = byKid.get(k.id);
                      if (!items || items.length === 0) return;
                      renderedKids.push(
                        <KidBlock
                          key={k.id}
                          kid={k}
                          color={resolveChildColor(k, i)}
                          dividerAbove={!firstRendered}
                        >
                          {items.map((l) => (
                            <LessonRow
                              key={l.id}
                              lesson={l}
                              color={resolveChildColor(k, i)}
                              totalLessons={l.curriculum_goal_id ? goalById.get(l.curriculum_goal_id)?.total_lessons ?? null : null}
                            />
                          ))}
                        </KidBlock>
                      );
                      firstRendered = false;
                    });
                    if (unassigned.length > 0) {
                      renderedKids.push(
                        <KidBlock
                          key="__unassigned"
                          kid={{ id: "__unassigned", name: "Unassigned", color: null, sort_order: null } as PlanV2Child}
                          color="#7a6f65"
                          dividerAbove={!firstRendered}
                        >
                          {unassigned.map((l) => (
                            <LessonRow
                              key={l.id}
                              lesson={l}
                              color="#7a6f65"
                              totalLessons={l.curriculum_goal_id ? goalById.get(l.curriculum_goal_id)?.total_lessons ?? null : null}
                            />
                          ))}
                        </KidBlock>
                      );
                    }
                    if (renderedKids.length === 0) {
                      return (
                        <p style={{ margin: "6px 0 0", fontSize: 11, fontStyle: "italic", color: "#aaa" }}>
                          Nothing scheduled
                        </p>
                      );
                    }
                    return renderedKids;
                  })()}

                  {/* Inline appointment list under the day */}
                  {dayAppts.length > 0 ? (
                    <div style={{ marginTop: 4, paddingTop: 4, borderTop: `1px solid ${HAIRLINE}` }}>
                      {dayAppts.map((a) => (
                        <p key={`${a.id}-${a.instance_date}`} style={{ margin: "2px 0", fontSize: 10, color: MUTED }}>
                          <span style={{ color: "#5c4a78", fontWeight: 600 }}>📅 {a.title}</span>
                          <span style={{ color: "#aaa" }}>
                            {a.time ? ` · ${a.time}` : ""}{a.location ? ` · ${a.location}` : ""}
                          </span>
                        </p>
                      ))}
                    </div>
                  ) : null}
                </div>
              </section>
            );
          })
        )}
      </div>

      <NotesSection sublabel="For whoever is teaching this week" lineCount={3} />
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

function KidBlock({
  kid, color, dividerAbove, children,
}: {
  kid: PlanV2Child;
  color: string;
  dividerAbove: boolean;
  children: React.ReactNode;
}) {
  return (
    <div style={{ marginTop: dividerAbove ? 4 : 0, paddingTop: dividerAbove ? 4 : 0, borderTop: dividerAbove ? `1px solid ${HAIRLINE}` : "none" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 2 }}>
        <span aria-hidden style={{ width: 8, height: 8, borderRadius: "50%", background: color }} />
        <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color }}>
          {kid.name}
        </span>
      </div>
      <div style={{ paddingLeft: 14 }}>{children}</div>
    </div>
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
    <div style={{ display: "flex", alignItems: "flex-start", gap: 8, padding: "3px 0" }}>
      <span
        aria-hidden
        style={{
          width: 13,
          height: 13,
          border: `1.5px solid ${color}`,
          borderRadius: 3,
          flexShrink: 0,
          marginTop: 1,
        }}
      />
      <div style={{ flex: 1, minWidth: 0 }}>
        <p style={{ margin: 0, fontSize: 12, fontWeight: 700, color: INK }}>{subject}</p>
        <p style={{ margin: "1px 0 0", fontSize: 10, color: MUTED }}>{title}</p>
        {showProgress ? (
          <p style={{ margin: "1px 0 0", fontSize: 9, color: "#aaa" }}>
            Lesson {lesson.lesson_number} of {totalLessons}
          </p>
        ) : null}
        {lesson.notes ? (
          <p
            style={{
              margin: "3px 0 1px",
              padding: "3px 7px",
              fontSize: 10,
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
    <section style={{ marginTop: 18, paddingTop: 8, borderTop: `1px solid ${HAIRLINE}` }}>
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
