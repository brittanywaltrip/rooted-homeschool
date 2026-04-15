/**
 * Shared PDF generation utility using jsPDF direct drawing.
 * No html2canvas — all content drawn via jsPDF API.
 */

import type { jsPDF } from "jspdf";

// ─── Colors ──────────────────────────────────────────────────────────────────

const C = {
  green:    [61, 92, 66] as [number, number, number],    // #3d5c42
  greenLt:  [92, 127, 99] as [number, number, number],   // #5c7f63
  dark:     [45, 41, 38] as [number, number, number],     // #2d2926
  muted:    [122, 111, 101] as [number, number, number],  // #7a6f65
  light:    [181, 172, 164] as [number, number, number],  // #b5aca4
  border:   [232, 226, 217] as [number, number, number],  // #e8e2d9
  bg:       [253, 252, 248] as [number, number, number],  // #fdfcf8
  headerBg: [245, 242, 238] as [number, number, number],  // #f5f2ee
  white:    [255, 255, 255] as [number, number, number],
  gold:     [196, 146, 42] as [number, number, number],   // #c4922a
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Strip non-ASCII / control characters that jsPDF's default font can't render */
const safe = (s: unknown): string =>
  String(s ?? "")
    .replace(/[\u2018\u2019\u201A]/g, "'")
    .replace(/[\u201C\u201D\u201E]/g, '"')
    .replace(/[\u2013\u2014]/g, "-")
    .replace(/[\u00B7\u2022\u2023\u25E6]/g, "-")
    .replace(/[\u2026]/g, "...")
    .replace(/[\u00A0]/g, " ")
    .replace(/[^\x20-\x7E]/g, "");

export function fmtMins(m: number): string {
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  const r = m % 60;
  return r > 0 ? `${h}h ${r}m` : `${h}h`;
}

function setColor(doc: jsPDF, c: [number, number, number]) {
  doc.setTextColor(c[0], c[1], c[2]);
}

function fillRect(doc: jsPDF, x: number, y: number, w: number, h: number, c: [number, number, number]) {
  doc.setFillColor(c[0], c[1], c[2]);
  doc.rect(x, y, w, h, "F");
}

function drawLine(doc: jsPDF, x1: number, y1: number, x2: number, y2: number, c: [number, number, number] = C.border, width = 0.01) {
  doc.setDrawColor(c[0], c[1], c[2]);
  doc.setLineWidth(width);
  doc.line(x1, y1, x2, y2);
}

/** Safe text output — pre-splits to prevent jsPDF internal splitter recursion */
function txt(doc: jsPDF, s: string, x: number, y: number, opts?: { align?: "center" | "right" | "left" }) {
  const cleaned = safe(s);
  const lines = doc.splitTextToSize(cleaned, CW_INNER);
  doc.text(lines, x, y, opts);
}

/** Wrap text to fit within maxW and return lines */
function wrapText(doc: jsPDF, text: string, maxW: number): string[] {
  return doc.splitTextToSize(safe(text), maxW);
}

// Page dimensions (letter, inches)
const PW = 8.5;
const PH = 11;
const MX = 0.75; // margin X
const MY = 0.6;  // margin Y
const CW_INNER = PW - 2 * MX; // content width

// ─── Footer ──────────────────────────────────────────────────────────────────

function drawFooter(doc: jsPDF, familyName: string, dateGen: string) {
  const disclaimer = "This report is generated from activity logged in Rooted and is provided as a personal record-keeping tool. Homeschool reporting requirements vary by state. Please consult your state's homeschool laws for official compliance requirements.";
  const pageCount = doc.getNumberOfPages();
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i);
    doc.setFontSize(7);
    setColor(doc, C.light);
    txt(doc,`Page ${i} of ${pageCount}`, PW - MX, PH - 0.3, { align: "right" });
    txt(doc,`Generated ${dateGen} | ${familyName} | rootedhomeschoolapp.com`, MX, PH - 0.3);
    doc.setFontSize(7);
    const discLines = doc.splitTextToSize(safe(disclaimer), CW_INNER);
    doc.text(discLines, PW / 2, PH - 0.15, { align: "center" });
  }
}

// ─── Progress Report ─────────────────────────────────────────────────────────

export type ReportData = {
  familyName: string;
  schoolYear: string;
  dateGenerated: string;
  showWatermark: boolean;
  summary: {
    totalHours: string;
    curriculumHours?: string;
    activityHours?: string;
    schoolDays: number;
    lessons: number;
    books: number;
    trips: number;
    memories: number;
  };
  children: {
    name: string;
    totalHours: string;
    totalLessons: number;
    schoolDays: number;
    subjects: { name: string; count: number; hours: string; estimated: boolean }[];
    activities?: { name: string; emoji: string; sessions: number; hours: string }[];
    books: string[];
    fieldTrips: { title: string; duration: number | null }[];
    wins: string[];
    badges: string[];
  }[];
  dailyLog: {
    dateLabel: string;
    entries: { childName?: string; subject: string; description: string; minutes: number; type: string; estimated: boolean }[];
  }[];
  showChildColumn?: boolean;
  backfillHours?: number;
};

export function generateProgressReport(doc: jsPDF, data: ReportData) {
  console.log("[PDF v3] Starting generation:", JSON.stringify({ children: data.children.length, dailyLogDays: data.dailyLog.length, lessons: data.summary.lessons }));
  let y = 0;
  const MAX_PAGES = 50;

  function safeAddPage() {
    if (doc.getNumberOfPages() >= MAX_PAGES) {
      console.warn("[PDF] Hit max page limit:", MAX_PAGES);
      return false;
    }
    doc.addPage();
    return true;
  }

  // ── Page 1: Cover ────────────────────────────────────────────────────────
  // Green header block
  fillRect(doc, 0, 0, PW, 2.2, C.green);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(18);
  setColor(doc, C.white);
  txt(doc,data.familyName || "Family Academy", PW / 2, 0.9, { align: "center" });
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  setColor(doc, C.white);
  txt(doc,`Progress Report | ${data.schoolYear}`, PW / 2, 1.45, { align: "center" });
  doc.setFontSize(8);
  setColor(doc, C.white);
  txt(doc,`Generated ${data.dateGenerated}`, PW / 2, 1.75, { align: "center" });

  // Cover disclaimer box
  const coverDisc = "This report is a personal record-keeping tool generated from activity logged in Rooted. Homeschool reporting requirements vary by state -- please consult your state's homeschool laws for compliance requirements.";
  fillRect(doc, MX, 2.35, CW_INNER, 0.45, [240, 238, 234] as unknown as [number, number, number]);
  doc.setFontSize(8);
  doc.setFont("helvetica", "italic");
  setColor(doc, C.light);
  const cdLines = doc.splitTextToSize(safe(coverDisc), CW_INNER - 0.4);
  doc.text(cdLines, PW / 2, 2.52, { align: "center" });
  doc.setFont("helvetica", "normal");

  // Family Summary
  y = 2.95;
  doc.setFontSize(13);
  setColor(doc, C.dark);
  txt(doc,"Family Summary", MX, y);
  y += 0.3;

  const stats = [
    { l: "Total Hours", v: data.summary.totalHours },
    { l: "School Days", v: String(data.summary.schoolDays) },
    { l: "Lessons", v: String(data.summary.lessons) },
    { l: "Books", v: String(data.summary.books) },
    { l: "Trips", v: String(data.summary.trips) },
    { l: "Memories", v: String(data.summary.memories) },
  ];
  const cellW = CW_INNER / stats.length;

  // Draw stats grid
  drawLine(doc, MX, y, PW - MX, y, C.border);
  for (let i = 0; i <= stats.length; i++) {
    drawLine(doc, MX + i * cellW, y, MX + i * cellW, y + 0.55, C.border);
  }
  drawLine(doc, MX, y + 0.55, PW - MX, y + 0.55, C.border);

  stats.forEach((s, i) => {
    const cx = MX + i * cellW + cellW / 2;
    doc.setFontSize(7);
    setColor(doc, C.muted);
    txt(doc,s.l, cx, y + 0.17, { align: "center" });
    doc.setFontSize(14);
    setColor(doc, C.green);
    txt(doc,s.v, cx, y + 0.42, { align: "center" });
  });

  y += 0.7;
  doc.setFontSize(7);
  setColor(doc, C.light);
  txt(doc,"* Hours marked with an asterisk are estimated from default lesson time settings.", MX, y);
  y += 0.15;

  // Curriculum / Activity breakdown
  if (data.summary.curriculumHours || data.summary.activityHours) {
    doc.setFontSize(7);
    setColor(doc, C.muted);
    const parts: string[] = [];
    if (data.summary.curriculumHours) parts.push(`Curriculum: ${data.summary.curriculumHours}`);
    if (data.summary.activityHours) parts.push(`Activities: ${data.summary.activityHours}`);
    txt(doc, parts.join("  |  "), MX, y);
    y += 0.15;
  }

  // Pre-Rooted backfill note
  if (data.backfillHours && data.backfillHours > 0) {
    doc.setFont("helvetica", "italic");
    doc.setFontSize(7);
    setColor(doc, C.muted);
    txt(doc, `Includes ${fmtMins(data.backfillHours)} of pre-Rooted imported data.`, MX, y);
    doc.setFont("helvetica", "normal");
    y += 0.15;
  }

  // ── Per-child sections ───────────────────────────────────────────────────
  y += 0.35;

  for (const child of data.children) {
    // Check if we need a new page
    if (y > PH - 3) {
      if (!safeAddPage()) break;
      y = MY;
    }

    // Child name header
    fillRect(doc, MX, y, CW_INNER, 0.35, C.greenLt);
    doc.setFontSize(12);
    setColor(doc, C.white);
    txt(doc,child.name, MX + 0.2, y + 0.24);
    y += 0.5;

    // Stats row
    doc.setFontSize(8);
    setColor(doc, C.muted);
    txt(doc,"Hours", MX, y);
    txt(doc,"Lessons", MX + 1.8, y);
    txt(doc,"School Days", MX + 3.6, y);
    y += 0.15;
    doc.setFontSize(14);
    setColor(doc, C.green);
    txt(doc,child.totalHours, MX, y + 0.05);
    txt(doc,String(child.totalLessons), MX + 1.8, y + 0.05);
    txt(doc,String(child.schoolDays), MX + 3.6, y + 0.05);
    y += 0.35;

    // Subject table
    if (child.subjects.length > 0) {
      // Header
      fillRect(doc, MX, y, CW_INNER, 0.25, C.headerBg);
      doc.setFontSize(7);
      setColor(doc, C.muted);
      txt(doc,"SUBJECT", MX + 0.1, y + 0.17);
      txt(doc,"LESSONS", MX + 4.5, y + 0.17, { align: "right" });
      txt(doc,"HOURS", PW - MX - 0.1, y + 0.17, { align: "right" });
      y += 0.25;

      for (const sub of child.subjects) {
        if (y > PH - 1) { if (!safeAddPage()) break; y = MY; }
        drawLine(doc, MX, y, PW - MX, y, C.border, 0.003);
        doc.setFontSize(9);
        setColor(doc, C.dark);
        txt(doc,sub.name, MX + 0.1, y + 0.17);
        txt(doc,String(sub.count), MX + 4.5, y + 0.17, { align: "right" });
        txt(doc,`${sub.hours}${sub.estimated ? "*" : ""}`, PW - MX - 0.1, y + 0.17, { align: "right" });
        y += 0.22;
      }
      drawLine(doc, MX, y, PW - MX, y, C.border, 0.003);
      y += 0.15;
    }

    // Activities table
    if (child.activities && child.activities.length > 0) {
      if (y > PH - 1.5) { if (!safeAddPage()) continue; y = MY; }
      doc.setFontSize(7);
      setColor(doc, C.muted);
      txt(doc, "ACTIVITIES", MX, y + 0.1);
      y += 0.2;
      fillRect(doc, MX, y, CW_INNER, 0.25, C.headerBg);
      doc.setFontSize(7);
      setColor(doc, C.muted);
      txt(doc, "ACTIVITY", MX + 0.1, y + 0.17);
      txt(doc, "SESSIONS", MX + 4.5, y + 0.17, { align: "right" });
      txt(doc, "HOURS", PW - MX - 0.1, y + 0.17, { align: "right" });
      y += 0.25;
      for (const act of child.activities) {
        if (y > PH - 1) { if (!safeAddPage()) break; y = MY; }
        drawLine(doc, MX, y, PW - MX, y, C.border, 0.003);
        doc.setFontSize(9);
        setColor(doc, C.dark);
        txt(doc, `${safe(act.emoji)} ${act.name}`, MX + 0.1, y + 0.17);
        txt(doc, String(act.sessions), MX + 4.5, y + 0.17, { align: "right" });
        txt(doc, act.hours, PW - MX - 0.1, y + 0.17, { align: "right" });
        y += 0.22;
      }
      drawLine(doc, MX, y, PW - MX, y, C.border, 0.003);
      y += 0.15;
    }

    // Lists
    const drawList = (title: string, items: string[]) => {
      if (items.length === 0) return;
      if (y > PH - 1) { if (!safeAddPage()) return; y = MY; }
      doc.setFontSize(7);
      setColor(doc, C.muted);
      txt(doc,`${title} (${items.length})`.toUpperCase(), MX, y + 0.1);
      y += 0.2;
      for (const item of items) {
        if (y > PH - 0.5) { if (!safeAddPage()) return; y = MY; }
        doc.setFontSize(8);
        setColor(doc, C.dark);
        const lines = wrapText(doc, `· ${item}`, CW_INNER - 0.2);
        for (const line of lines) {
          txt(doc,line, MX + 0.1, y + 0.1);
          y += 0.14;
        }
      }
      y += 0.1;
    };

    drawList("Books Read", child.books);
    drawList("Field Trips & Projects", child.fieldTrips.map(t => `${t.title}${t.duration ? ` - ${t.duration} min` : ""}`));
    drawList("Wins & Milestones", child.wins);
    drawList("Badges Earned", child.badges);

    y += 0.3;
  }

  // ── Daily Activity Log ───────────────────────────────────────────────────
  if (data.dailyLog.length > 0) {
    if (!safeAddPage()) { drawFooter(doc, data.familyName || "Family Academy", data.dateGenerated); console.log("[PDF] Complete (capped), pages:", doc.getNumberOfPages()); return; }
    y = MY;

    // Column positions shift when showing child column
    const sc = !!data.showChildColumn;
    const colChild = MX + 1.1;
    const colSubj = sc ? MX + 2.1 : MX + 1.5;
    const colDesc = sc ? MX + 3.4 : MX + 3;

    doc.setFontSize(13);
    setColor(doc, C.dark);
    txt(doc,"Daily Activity Log", MX, y + 0.1);
    y += 0.25;
    doc.setFontSize(8);
    setColor(doc, C.muted);
    txt(doc,"For state record-keeping purposes", MX, y + 0.1);
    y += 0.35;

    function drawLogHeader() {
      fillRect(doc, MX, y, CW_INNER, 0.22, C.headerBg);
      doc.setFontSize(6.5);
      setColor(doc, C.muted);
      txt(doc,"DATE", MX + 0.1, y + 0.15);
      if (sc) txt(doc,"CHILD", colChild, y + 0.15);
      txt(doc,"SUBJECT", colSubj, y + 0.15);
      txt(doc,"DESCRIPTION", colDesc, y + 0.15);
      txt(doc,"MIN", PW - MX - 0.6, y + 0.15, { align: "right" });
      txt(doc,"TYPE", PW - MX - 0.1, y + 0.15, { align: "right" });
      y += 0.22;
    }

    drawLogHeader();
    let totalLogMins = 0;

    for (const day of data.dailyLog) {
      if (y > PH - 0.8) { if (!safeAddPage()) break; y = MY; drawLogHeader(); }

      for (const e of day.entries) {
        if (y > PH - 0.6) { if (!safeAddPage()) break; y = MY; drawLogHeader(); }
        drawLine(doc, MX, y, PW - MX, y, C.border, 0.002);
        doc.setFontSize(7);
        setColor(doc, C.muted);
        txt(doc,day.dateLabel, MX + 0.1, y + 0.13);
        if (sc) { setColor(doc, C.dark); txt(doc,(e.childName || "").substring(0, 12), colChild, y + 0.13); }
        setColor(doc, C.dark);
        txt(doc,e.subject.substring(0, 18), colSubj, y + 0.13);
        txt(doc,e.description.substring(0, sc ? 28 : 35), colDesc, y + 0.13);
        txt(doc,`${e.minutes}${e.estimated ? "*" : ""}`, PW - MX - 0.6, y + 0.13, { align: "right" });
        setColor(doc, C.muted);
        txt(doc,e.type, PW - MX - 0.1, y + 0.13, { align: "right" });
        y += 0.18;
        totalLogMins += e.minutes;
      }
    }

    y += 0.2;
    doc.setFontSize(8);
    setColor(doc, C.muted);
    txt(doc,`Total logged: ${fmtMins(totalLogMins)} across ${data.dailyLog.length} school days`, MX, y + 0.1);
  }

  // Watermark
  if (data.showWatermark) {
    const lastPage = doc.getNumberOfPages();
    doc.setPage(lastPage);
    doc.setFontSize(8);
    setColor(doc, C.light);
    txt(doc,"Made with Rooted", PW / 2, PH - 0.6, { align: "center" });
  }

  // Footer on all pages
  drawFooter(doc, data.familyName || "Family Academy", data.dateGenerated);
  console.log("[PDF] Complete, pages:", doc.getNumberOfPages());
}

// ─── Certificate ─────────────────────────────────────────────────────────────

export type CertData = {
  schoolName: string;
  childName: string;
  certTitle: string;
  accomplishment: string;
  schoolYear: string;
  showWatermark: boolean;
  style: 1 | 2 | 3;
};

export function generateCertificate(doc: jsPDF, d: CertData) {
  const cx = PW / 2;
  const today = new Date().toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });

  if (d.style === 1) {
    // Classic Elegant — serif, gold border, cream background
    fillRect(doc, 0, 0, PW, PH, C.bg);
    // Green outer border
    doc.setDrawColor(C.green[0], C.green[1], C.green[2]);
    doc.setLineWidth(0.08);
    doc.rect(0.1, 0.1, PW - 0.2, PH - 0.2);
    // Gold inner border
    doc.setDrawColor(C.gold[0], C.gold[1], C.gold[2]);
    doc.setLineWidth(0.02);
    doc.rect(0.3, 0.3, PW - 0.6, PH - 0.6);
    // Corner ornaments
    const corners = [[0.15, 0.15], [PW - 0.55, 0.15], [0.15, PH - 0.55], [PW - 0.55, PH - 0.55]];
    doc.setLineWidth(0.02);
    corners.forEach(([cx2, cy]) => {
      doc.line(cx2, cy, cx2 + 0.4, cy);
      doc.line(cx2, cy, cx2, cy + 0.4);
    });

    // School name
    doc.setFontSize(10);
    setColor(doc, C.gold);
    txt(doc,d.schoolName || "Family Academy", cx, 3.2, { align: "center" });
    // Title
    doc.setFontSize(22);
    setColor(doc, C.green);
    txt(doc,d.certTitle.toUpperCase(), cx, 3.8, { align: "center" });
    // "This certifies that"
    doc.setFontSize(12);
    setColor(doc, C.muted);
    txt(doc,"This certifies that", cx, 4.4, { align: "center" });
    // Gold line
    drawLine(doc, cx - 2, 4.6, cx + 2, 4.6, C.gold, 0.01);
    // Child name
    doc.setFontSize(32);
    setColor(doc, C.dark);
    txt(doc,d.childName || "Student Name", cx, 5.3, { align: "center" });
    // Gold line
    drawLine(doc, cx - 2, 5.5, cx + 2, 5.5, C.gold, 0.01);
    // Accomplishment
    doc.setFontSize(13);
    setColor(doc, C.dark);
    const lines = wrapText(doc, d.accomplishment, 5.5);
    lines.forEach((line, i) => txt(doc, line, cx, 6.2 + i * 0.22, { align: "center" }));
    // Year + date
    const yAfter = 6.2 + lines.length * 0.22 + 0.6;
    doc.setFontSize(10);
    setColor(doc, C.muted);
    txt(doc,`*  ${d.schoolYear}  *`, cx, yAfter, { align: "center" });
    doc.setFontSize(9);
    setColor(doc, C.light);
    txt(doc,today, cx, yAfter + 0.25, { align: "center" });
  } else if (d.style === 2) {
    // Modern Clean — sans-serif, green header
    fillRect(doc, 0, 0, PW, 2.5, C.green);
    doc.setFontSize(10);
    setColor(doc, C.white);
    txt(doc,(d.schoolName || "Family Academy").toUpperCase(), cx, 1.0, { align: "center" });
    doc.setFontSize(24);
    txt(doc,d.certTitle.toUpperCase(), cx, 1.8, { align: "center" });

    // Content
    doc.setFontSize(11);
    setColor(doc, C.muted);
    txt(doc,"PRESENTED TO", cx, 3.5, { align: "center" });
    doc.setFontSize(36);
    setColor(doc, C.dark);
    txt(doc,d.childName || "Student Name", cx, 4.4, { align: "center" });
    // Green accent line
    fillRect(doc, cx - 0.5, 4.6, 1, 0.04, C.greenLt);
    // Accomplishment
    doc.setFontSize(14);
    setColor(doc, C.dark);
    const lines2 = wrapText(doc, d.accomplishment, 5.5);
    lines2.forEach((line, i) => txt(doc, line, cx, 5.3 + i * 0.25, { align: "center" }));
    const yA2 = 5.3 + lines2.length * 0.25 + 0.7;
    doc.setFontSize(10);
    setColor(doc, C.light);
    txt(doc,d.schoolYear, cx, yA2, { align: "center" });
    doc.setFontSize(9);
    txt(doc,today, cx, yA2 + 0.2, { align: "center" });
  } else {
    // Botanical Natural — serif, soft green header
    fillRect(doc, 0, 0, PW, 1.8, C.greenLt);
    doc.setFontSize(18);
    setColor(doc, C.white);
    txt(doc,d.schoolName || "Family Academy", cx, 0.8, { align: "center" });
    doc.setFontSize(16);
    txt(doc,d.certTitle, cx, 1.3, { align: "center" });

    fillRect(doc, 0, 1.8, PW, PH - 1.8, C.bg);
    doc.setFontSize(11);
    setColor(doc, C.muted);
    txt(doc,"This certificate is presented to", cx, 3.2, { align: "center" });
    doc.setFontSize(32);
    setColor(doc, C.dark);
    txt(doc,d.childName || "Student Name", cx, 4.1, { align: "center" });
    doc.setFontSize(16);
    txt(doc,"~ ~ ~", cx, 4.6, { align: "center" });
    doc.setFontSize(13);
    setColor(doc, C.dark);
    const lines3 = wrapText(doc, d.accomplishment, 5.5);
    lines3.forEach((line, i) => txt(doc, line, cx, 5.3 + i * 0.24, { align: "center" }));
    const yA3 = 5.3 + lines3.length * 0.24 + 0.6;
    drawLine(doc, cx - 1.2, yA3, cx + 1.2, yA3, C.light, 0.01);
    doc.setFontSize(10);
    setColor(doc, C.muted);
    txt(doc,d.schoolYear, cx, yA3 + 0.3, { align: "center" });
    doc.setFontSize(9);
    setColor(doc, C.light);
    txt(doc,today, cx, yA3 + 0.5, { align: "center" });
  }

  if (d.showWatermark) {
    doc.setFontSize(8);
    setColor(doc, C.light);
    txt(doc,"Made with Rooted", cx, PH - 0.5, { align: "center" });
  }
}

// ─── ID Card ─────────────────────────────────────────────────────────────────

export type IDCardData = {
  schoolName: string;
  name: string;
  title: string;
  schoolYear: string;
  state: string;
  showWatermark: boolean;
  style: 1 | 2 | 3;
};

export function drawIDCardFront(doc: jsPDF, d: IDCardData, x: number, y: number) {
  // 3.5" × 2" card
  const w = 3.5, h = 2;

  // Card outline
  doc.setDrawColor(C.border[0], C.border[1], C.border[2]);
  doc.setLineWidth(0.01);
  doc.rect(x, y, w, h);

  // Green header
  const headerH = 0.55;
  const headerColor = d.style === 1 ? C.green : d.style === 2 ? C.green : C.greenLt;
  fillRect(doc, x, y, w, headerH, headerColor);

  doc.setFontSize(8);
  setColor(doc, C.white);
  txt(doc,"HOMESCHOOL ID", x + w / 2, y + 0.22, { align: "center" });
  doc.setFontSize(5.5);
  txt(doc,d.schoolYear, x + w / 2, y + 0.4, { align: "center" });

  // Fields
  const fieldY = y + headerH + 0.2;
  doc.setFontSize(6);
  setColor(doc, C.muted);
  txt(doc,"NAME", x + 0.15, fieldY);
  doc.setFontSize(10);
  setColor(doc, C.dark);
  txt(doc,d.name || "Name", x + 0.15, fieldY + 0.18);

  doc.setFontSize(6);
  setColor(doc, C.muted);
  txt(doc,"TITLE", x + 0.15, fieldY + 0.45);
  doc.setFontSize(8);
  setColor(doc, C.dark);
  txt(doc,d.title || "Parent / Teacher", x + 0.15, fieldY + 0.6);

  doc.setFontSize(6);
  setColor(doc, C.muted);
  txt(doc,"SCHOOL", x + 0.15, fieldY + 0.85);
  doc.setFontSize(8);
  setColor(doc, C.dark);
  txt(doc,d.schoolName || "Family Academy", x + 0.15, fieldY + 1.0);

  if (d.showWatermark) {
    doc.setFontSize(5);
    setColor(doc, C.light);
    txt(doc,"Made with Rooted", x + w - 0.15, y + h - 0.1, { align: "right" });
  }
}

export function drawIDCardPrintSheet(doc: jsPDF, d: IDCardData) {
  const cardW = 3.5, cardH = 2;
  const cols = 2, rows = 4;
  const marginX = (PW - cols * cardW) / (cols + 1);
  const marginY = (PH - rows * cardH) / (rows + 1);

  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const x = marginX + col * (cardW + marginX);
      const y = marginY + row * (cardH + marginY);
      drawIDCardFront(doc, d, x, y);

      // Crop marks
      doc.setDrawColor(180, 180, 180);
      doc.setLineWidth(0.005);
      const gap = 0.05, tick = 0.12;
      doc.line(x - gap - tick, y, x - gap, y);
      doc.line(x, y - gap - tick, x, y - gap);
      doc.line(x + cardW + gap, y, x + cardW + gap + tick, y);
      doc.line(x + cardW, y - gap - tick, x + cardW, y - gap);
      doc.line(x - gap - tick, y + cardH, x - gap, y + cardH);
      doc.line(x, y + cardH + gap, x, y + cardH + gap + tick);
      doc.line(x + cardW + gap, y + cardH, x + cardW + gap + tick, y + cardH);
      doc.line(x + cardW, y + cardH + gap, x + cardW, y + cardH + gap + tick);
    }
  }
}
