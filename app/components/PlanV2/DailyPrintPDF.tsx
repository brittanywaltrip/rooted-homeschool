import { Document, Image, Page, StyleSheet, Text, View } from "@react-pdf/renderer";
import { ensureFontsRegistered } from "./pdf-fonts";
import type { PlanV2Appointment, PlanV2Child, PlanV2Lesson } from "./types";

/* DailyPrintPDF. React-PDF Document for the Daily plan sheet. Replaces
 * the window.print()-based DailyPrintSheet for the daily path. Hardcoded
 * colors per the migration spec since CSS variables don't apply inside
 * React-PDF documents. */

ensureFontsRegistered();

const COLORS = {
  deepGreen: "#1a2c22",
  brandGreen: "#2D5A3D",
  accentGreen: "#5c7f63",
  warmWhite: "#F8F7F4",
  noteGreen: "#d4edda",
  noteText: "#155724",
  inkMuted: "#7a6f65",
  hairline: "#ede9e1",
  rule: "#d5d0c8",
  white: "#ffffff",
} as const;

type Goal = { id: string; total_lessons: number | null };

export interface DailyPrintPDFProps {
  date: Date;
  familyName: string;
  lessons: PlanV2Lesson[];
  appointments: PlanV2Appointment[];
  kids: PlanV2Child[];
  curriculumGoals: Goal[];
}

const styles = StyleSheet.create({
  page: {
    backgroundColor: COLORS.white,
    paddingTop: 36,
    paddingBottom: 56,
    paddingHorizontal: 42,
    fontFamily: "Helvetica",
    fontSize: 10,
    color: COLORS.deepGreen,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingBottom: 8,
    borderBottomWidth: 1.5,
    borderBottomColor: COLORS.deepGreen,
    borderBottomStyle: "solid",
  },
  logo: { width: 80, height: 26, objectFit: "contain" },
  headerTitle: {
    fontFamily: "Cormorant",
    fontSize: 18,
    fontWeight: 700,
    color: COLORS.deepGreen,
    textAlign: "center",
    flexGrow: 1,
    marginHorizontal: 12,
  },
  headerDate: {
    fontSize: 11,
    color: COLORS.accentGreen,
    textAlign: "right",
    minWidth: 130,
  },
  summaryPill: {
    marginTop: 12,
    alignSelf: "flex-start",
    backgroundColor: COLORS.brandGreen,
    color: COLORS.white,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
    fontSize: 9,
    fontWeight: 700,
  },
  kidSection: { marginTop: 14 },
  kidBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 4,
    paddingHorizontal: 8,
    borderRadius: 4,
  },
  kidName: {
    fontSize: 11,
    fontWeight: 700,
    color: COLORS.white,
    letterSpacing: 1,
    textTransform: "uppercase",
  },
  kidCount: { fontSize: 9, color: COLORS.white },
  lessonRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
    paddingVertical: 5,
    paddingLeft: 10,
    borderBottomWidth: 0.5,
    borderBottomColor: COLORS.hairline,
    borderBottomStyle: "solid",
  },
  checkbox: {
    width: 12,
    height: 12,
    borderWidth: 2,
    borderColor: COLORS.brandGreen,
    borderStyle: "solid",
    marginTop: 2,
  },
  lessonBody: { flex: 1 },
  lessonRowTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "baseline" },
  subject: { fontSize: 11, fontWeight: 700, color: COLORS.deepGreen },
  progress: { fontSize: 9, color: COLORS.inkMuted },
  lessonTitle: { fontSize: 9, color: COLORS.inkMuted, marginTop: 1 },
  noteCallout: {
    marginTop: 4,
    padding: 5,
    backgroundColor: COLORS.noteGreen,
    borderLeftWidth: 2,
    borderLeftColor: COLORS.brandGreen,
    borderLeftStyle: "solid",
    fontSize: 9,
    fontStyle: "italic",
    color: COLORS.noteText,
  },
  emptyState: { fontSize: 10, color: COLORS.inkMuted, fontStyle: "italic", paddingVertical: 6, paddingLeft: 10 },
  appts: { marginTop: 14 },
  apptHeader: { fontSize: 10, fontWeight: 700, color: COLORS.brandGreen, textTransform: "uppercase", letterSpacing: 1 },
  apptRow: { flexDirection: "row", paddingVertical: 3, borderBottomWidth: 0.5, borderBottomColor: COLORS.hairline, borderBottomStyle: "solid" },
  apptTitle: { flex: 1, fontSize: 10, color: COLORS.deepGreen },
  apptMeta: { fontSize: 9, color: COLORS.inkMuted },
  notesSection: { marginTop: 22, paddingTop: 8, borderTopWidth: 1, borderTopColor: COLORS.hairline, borderTopStyle: "solid" },
  notesLabel: { fontFamily: "Cormorant", fontSize: 12, fontWeight: 700, color: COLORS.brandGreen },
  notesSublabel: { fontSize: 9, color: COLORS.inkMuted, fontStyle: "italic", marginTop: 2 },
  ruledLine: { borderBottomWidth: 0.5, borderBottomColor: COLORS.rule, borderBottomStyle: "solid", height: 22 },
  footer: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 24,
    textAlign: "center",
    fontSize: 8,
    color: COLORS.accentGreen,
  },
});

function lessonSubject(l: PlanV2Lesson): string {
  return l.subjects?.name ?? "Lesson";
}
function lessonTitleText(l: PlanV2Lesson): string {
  if (l.title && l.title.trim().length > 0) return l.title;
  if (l.lesson_number) return `Lesson ${l.lesson_number}`;
  return "Lesson";
}
function fallbackKidColor(idx: number): string {
  const palette = ["#5c7f63", "#7a9e7e", "#4a7a8a", "#5a5c8a", "#c4956a", "#c4697a"];
  return palette[idx % palette.length];
}
function formatTime(t: string | null): string {
  if (!t) return "All day";
  const [h, m] = t.split(":").map(Number);
  const h12 = ((h + 11) % 12) + 1;
  const suf = h >= 12 ? "PM" : "AM";
  return m === 0 ? `${h12} ${suf}` : `${h12}:${String(m).padStart(2, "0")} ${suf}`;
}

function logoSrc(): string {
  if (typeof window !== "undefined") return `${window.location.origin}/rooted-logo-nav.png`;
  return "/rooted-logo-nav.png";
}

export default function DailyPrintPDF(props: DailyPrintPDFProps) {
  const { date, familyName, lessons, appointments, kids, curriculumGoals } = props;
  const goalById = new Map(curriculumGoals.map((g) => [g.id, g]));

  const dateLabel = date.toLocaleDateString("en-US", {
    weekday: "long", month: "long", day: "numeric", year: "numeric",
  });

  const lessonsByChild = new Map<string, PlanV2Lesson[]>();
  const unassigned: PlanV2Lesson[] = [];
  for (const l of lessons) {
    if (l.child_id) {
      const arr = lessonsByChild.get(l.child_id) ?? [];
      arr.push(l);
      lessonsByChild.set(l.child_id, arr);
    } else {
      unassigned.push(l);
    }
  }

  const summary = `${kids.length} ${kids.length === 1 ? "kid" : "kids"}  ·  ${lessons.length} ${lessons.length === 1 ? "lesson" : "lessons"}${
    appointments.length > 0 ? `  ·  ${appointments.length} ${appointments.length === 1 ? "appointment" : "appointments"}` : ""
  }`;

  return (
    <Document title={`Rooted Daily ${dateLabel}`} author="Rooted Homeschool">
      <Page size="LETTER" style={styles.page}>
        {/* Header */}
        <View style={styles.header}>
          {/* eslint-disable-next-line jsx-a11y/alt-text -- Image is from @react-pdf/renderer, not the DOM */}
          <Image src={logoSrc()} style={styles.logo} />
          <Text style={styles.headerTitle}>{familyName}</Text>
          <Text style={styles.headerDate}>{dateLabel}</Text>
        </View>

        {/* Summary pill */}
        <Text style={styles.summaryPill}>{summary}</Text>

        {/* Per-kid sections */}
        {kids.map((kid, idx) => {
          const items = lessonsByChild.get(kid.id) ?? [];
          const color = kid.color ?? fallbackKidColor(idx);
          return (
            <View key={kid.id} style={styles.kidSection}>
              <View style={[styles.kidBar, { backgroundColor: color }]}>
                <Text style={styles.kidName}>{kid.name}</Text>
                <Text style={styles.kidCount}>
                  {items.length} {items.length === 1 ? "lesson" : "lessons"}
                </Text>
              </View>
              {items.length === 0 ? (
                <Text style={styles.emptyState}>Nothing scheduled</Text>
              ) : (
                items.map((l) => {
                  const subject = lessonSubject(l);
                  const title = lessonTitleText(l);
                  const total = l.curriculum_goal_id
                    ? goalById.get(l.curriculum_goal_id)?.total_lessons ?? null
                    : null;
                  const showProgress = l.lesson_number != null && total != null && total > 0;
                  return (
                    <View key={l.id} style={styles.lessonRow}>
                      <View style={styles.checkbox} />
                      <View style={styles.lessonBody}>
                        <View style={styles.lessonRowTop}>
                          <Text style={styles.subject}>{subject}</Text>
                          {showProgress ? (
                            <Text style={styles.progress}>
                              Lesson {l.lesson_number} of {total}
                            </Text>
                          ) : null}
                        </View>
                        <Text style={styles.lessonTitle}>{title}</Text>
                        {l.notes ? <Text style={styles.noteCallout}>{l.notes}</Text> : null}
                      </View>
                    </View>
                  );
                })
              )}
            </View>
          );
        })}

        {/* Unassigned lessons (rare; rendered without a colored kid bar) */}
        {unassigned.length > 0 ? (
          <View style={styles.kidSection}>
            <View style={[styles.kidBar, { backgroundColor: COLORS.inkMuted }]}>
              <Text style={styles.kidName}>Unassigned</Text>
              <Text style={styles.kidCount}>
                {unassigned.length} {unassigned.length === 1 ? "lesson" : "lessons"}
              </Text>
            </View>
            {unassigned.map((l) => {
              const subject = lessonSubject(l);
              const title = lessonTitleText(l);
              return (
                <View key={l.id} style={styles.lessonRow}>
                  <View style={styles.checkbox} />
                  <View style={styles.lessonBody}>
                    <Text style={styles.subject}>{subject}</Text>
                    <Text style={styles.lessonTitle}>{title}</Text>
                    {l.notes ? <Text style={styles.noteCallout}>{l.notes}</Text> : null}
                  </View>
                </View>
              );
            })}
          </View>
        ) : null}

        {/* Appointments (only if any) */}
        {appointments.length > 0 ? (
          <View style={styles.appts}>
            <Text style={styles.apptHeader}>Appointments</Text>
            {appointments.map((a) => (
              <View key={`${a.id}-${a.instance_date}`} style={styles.apptRow}>
                <Text style={styles.apptTitle}>{a.title}</Text>
                <Text style={styles.apptMeta}>
                  {formatTime(a.time)}
                  {a.location ? ` · ${a.location}` : ""}
                </Text>
              </View>
            ))}
          </View>
        ) : null}

        {/* Notes section — 4 ruled lines */}
        <View style={styles.notesSection}>
          <Text style={styles.notesLabel}>Notes</Text>
          <Text style={styles.notesSublabel}>For whoever is teaching</Text>
          <View style={{ marginTop: 8 }}>
            {Array.from({ length: 4 }).map((_, i) => (
              <View key={i} style={styles.ruledLine} />
            ))}
          </View>
        </View>

        {/* Footer */}
        <Text style={styles.footer} fixed>
          rootedhomeschoolapp.com
        </Text>
      </Page>
    </Document>
  );
}
