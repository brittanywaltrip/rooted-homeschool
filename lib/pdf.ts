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

/** Wrap text to fit within maxW and return lines */
function wrapText(doc: jsPDF, text: string, maxW: number): string[] {
  return doc.splitTextToSize(text, maxW);
}

// Page dimensions (letter, inches)
const PW = 8.5;
const PH = 11;
const MX = 0.75; // margin X
const MY = 0.6;  // margin Y
const CW_INNER = PW - 2 * MX; // content width

// ─── Footer ──────────────────────────────────────────────────────────────────

function drawFooter(doc: jsPDF, familyName: string, dateGen: string) {
  const pageCount = doc.getNumberOfPages();
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i);
    doc.setFontSize(7);
    setColor(doc, C.light);
    doc.text(`Page ${i} of ${pageCount}`, PW - MX, PH - 0.3, { align: "right" });
    doc.text(`Generated ${dateGen} | ${familyName} | rootedhomeschoolapp.com`, MX, PH - 0.3);
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
    books: string[];
    fieldTrips: { title: string; duration: number | null }[];
    wins: string[];
    badges: string[];
  }[];
  dailyLog: {
    dateLabel: string;
    entries: { subject: string; description: string; minutes: number; type: string; estimated: boolean }[];
  }[];
};

export function generateProgressReport(doc: jsPDF, data: ReportData) {
  let y = 0;

  // ── Page 1: Cover ────────────────────────────────────────────────────────
  // Green header block
  fillRect(doc, 0, 0, PW, 2.2, C.green);
  doc.setFontSize(20);
  setColor(doc, C.white);
  doc.setFontSize(18);
  doc.text(data.familyName || "Family Academy", PW / 2, 0.9, { align: "center" });
  doc.setFontSize(10);
  doc.text(`Annual Progress Report | ${data.schoolYear}`, PW / 2, 1.45, { align: "center" });
  doc.setFontSize(8);
  doc.text(`Generated ${data.dateGenerated}`, PW / 2, 1.75, { align: "center" });

  // Family Summary
  y = 2.6;
  doc.setFontSize(13);
  setColor(doc, C.dark);
  doc.text("Family Summary", MX, y);
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
    doc.text(s.l, cx, y + 0.17, { align: "center" });
    doc.setFontSize(14);
    setColor(doc, C.green);
    doc.text(s.v, cx, y + 0.42, { align: "center" });
  });

  y += 0.7;
  doc.setFontSize(7);
  setColor(doc, C.light);
  doc.text("* Hours marked with an asterisk are estimated from default lesson time settings.", MX, y);

  // ── Per-child sections ───────────────────────────────────────────────────
  y += 0.5;

  for (const child of data.children) {
    // Check if we need a new page
    if (y > PH - 3) {
      doc.addPage();
      y = MY;
    }

    // Child name header
    fillRect(doc, MX, y, CW_INNER, 0.35, C.greenLt);
    doc.setFontSize(12);
    setColor(doc, C.white);
    doc.text(child.name, MX + 0.2, y + 0.24);
    y += 0.5;

    // Stats row
    doc.setFontSize(8);
    setColor(doc, C.muted);
    doc.text("Hours", MX, y);
    doc.text("Lessons", MX + 1.8, y);
    doc.text("School Days", MX + 3.6, y);
    y += 0.15;
    doc.setFontSize(14);
    setColor(doc, C.green);
    doc.text(child.totalHours, MX, y + 0.05);
    doc.text(String(child.totalLessons), MX + 1.8, y + 0.05);
    doc.text(String(child.schoolDays), MX + 3.6, y + 0.05);
    y += 0.35;

    // Subject table
    if (child.subjects.length > 0) {
      // Header
      fillRect(doc, MX, y, CW_INNER, 0.25, C.headerBg);
      doc.setFontSize(7);
      setColor(doc, C.muted);
      doc.text("SUBJECT", MX + 0.1, y + 0.17);
      doc.text("LESSONS", MX + 4.5, y + 0.17, { align: "right" });
      doc.text("HOURS", PW - MX - 0.1, y + 0.17, { align: "right" });
      y += 0.25;

      for (const sub of child.subjects) {
        if (y > PH - 1) { doc.addPage(); y = MY; }
        drawLine(doc, MX, y, PW - MX, y, C.border, 0.003);
        doc.setFontSize(9);
        setColor(doc, C.dark);
        doc.text(sub.name, MX + 0.1, y + 0.17);
        doc.text(String(sub.count), MX + 4.5, y + 0.17, { align: "right" });
        doc.text(`${sub.hours}${sub.estimated ? "*" : ""}`, PW - MX - 0.1, y + 0.17, { align: "right" });
        y += 0.22;
      }
      drawLine(doc, MX, y, PW - MX, y, C.border, 0.003);
      y += 0.15;
    }

    // Lists
    const drawList = (title: string, items: string[]) => {
      if (items.length === 0) return;
      if (y > PH - 1) { doc.addPage(); y = MY; }
      doc.setFontSize(7);
      setColor(doc, C.muted);
      doc.text(`${title} (${items.length})`.toUpperCase(), MX, y + 0.1);
      y += 0.2;
      for (const item of items) {
        if (y > PH - 0.5) { doc.addPage(); y = MY; }
        doc.setFontSize(8);
        setColor(doc, C.dark);
        const lines = wrapText(doc, `· ${item}`, CW_INNER - 0.2);
        for (const line of lines) {
          doc.text(line, MX + 0.1, y + 0.1);
          y += 0.14;
        }
      }
      y += 0.1;
    };

    drawList("Books Read", child.books);
    drawList("Field Trips & Projects", child.fieldTrips.map(t => `${t.title}${t.duration ? ` — ${t.duration} min` : ""}`));
    drawList("Wins & Milestones", child.wins);
    drawList("Badges Earned", child.badges);

    y += 0.3;
  }

  // ── Daily Activity Log ───────────────────────────────────────────────────
  if (data.dailyLog.length > 0) {
    doc.addPage();
    y = MY;

    doc.setFontSize(13);
    setColor(doc, C.dark);
    doc.text("Daily Activity Log", MX, y + 0.1);
    y += 0.25;
    doc.setFontSize(8);
    setColor(doc, C.muted);
    doc.text("For state record-keeping purposes", MX, y + 0.1);
    y += 0.35;

    // Table header
    fillRect(doc, MX, y, CW_INNER, 0.22, C.headerBg);
    doc.setFontSize(6.5);
    setColor(doc, C.muted);
    doc.text("DATE", MX + 0.1, y + 0.15);
    doc.text("SUBJECT", MX + 1.5, y + 0.15);
    doc.text("DESCRIPTION", MX + 3, y + 0.15);
    doc.text("MIN", PW - MX - 0.6, y + 0.15, { align: "right" });
    doc.text("TYPE", PW - MX - 0.1, y + 0.15, { align: "right" });
    y += 0.22;

    let totalLogMins = 0;

    for (const day of data.dailyLog) {
      // Date header row
      if (y > PH - 0.8) {
        doc.addPage();
        y = MY;
        // Re-draw table header
        fillRect(doc, MX, y, CW_INNER, 0.22, C.headerBg);
        doc.setFontSize(6.5);
        setColor(doc, C.muted);
        doc.text("DATE", MX + 0.1, y + 0.15);
        doc.text("SUBJECT", MX + 1.5, y + 0.15);
        doc.text("DESCRIPTION", MX + 3, y + 0.15);
        doc.text("MIN", PW - MX - 0.6, y + 0.15, { align: "right" });
        doc.text("TYPE", PW - MX - 0.1, y + 0.15, { align: "right" });
        y += 0.22;
      }

      for (const e of day.entries) {
        if (y > PH - 0.6) {
          doc.addPage();
          y = MY;
          fillRect(doc, MX, y, CW_INNER, 0.22, C.headerBg);
          doc.setFontSize(6.5);
          setColor(doc, C.muted);
          doc.text("DATE", MX + 0.1, y + 0.15);
          doc.text("SUBJECT", MX + 1.5, y + 0.15);
          doc.text("DESCRIPTION", MX + 3, y + 0.15);
          doc.text("MIN", PW - MX - 0.6, y + 0.15, { align: "right" });
          doc.text("TYPE", PW - MX - 0.1, y + 0.15, { align: "right" });
          y += 0.22;
        }
        drawLine(doc, MX, y, PW - MX, y, C.border, 0.002);
        doc.setFontSize(7);
        setColor(doc, C.muted);
        doc.text(day.dateLabel, MX + 0.1, y + 0.13);
        setColor(doc, C.dark);
        doc.text(e.subject.substring(0, 18), MX + 1.5, y + 0.13);
        doc.text(e.description.substring(0, 35), MX + 3, y + 0.13);
        doc.text(`${e.minutes}${e.estimated ? "*" : ""}`, PW - MX - 0.6, y + 0.13, { align: "right" });
        setColor(doc, C.muted);
        doc.text(e.type, PW - MX - 0.1, y + 0.13, { align: "right" });
        y += 0.18;
        totalLogMins += e.minutes;
      }
    }

    y += 0.2;
    doc.setFontSize(8);
    setColor(doc, C.muted);
    doc.text(`Total logged: ${fmtMins(totalLogMins)} across ${data.dailyLog.length} school days`, MX, y + 0.1);
  }

  // Watermark
  if (data.showWatermark) {
    const lastPage = doc.getNumberOfPages();
    doc.setPage(lastPage);
    doc.setFontSize(8);
    setColor(doc, C.light);
    doc.text("Made with Rooted", PW / 2, PH - 0.6, { align: "center" });
  }

  // Footer on all pages
  drawFooter(doc, data.familyName || "Family Academy", data.dateGenerated);
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
    doc.text(d.schoolName || "Family Academy", cx, 3.2, { align: "center" });
    // Title
    doc.setFontSize(22);
    setColor(doc, C.green);
    doc.text(d.certTitle.toUpperCase(), cx, 3.8, { align: "center" });
    // "This certifies that"
    doc.setFontSize(12);
    setColor(doc, C.muted);
    doc.text("This certifies that", cx, 4.4, { align: "center" });
    // Gold line
    drawLine(doc, cx - 2, 4.6, cx + 2, 4.6, C.gold, 0.01);
    // Child name
    doc.setFontSize(32);
    setColor(doc, C.dark);
    doc.text(d.childName || "Student Name", cx, 5.3, { align: "center" });
    // Gold line
    drawLine(doc, cx - 2, 5.5, cx + 2, 5.5, C.gold, 0.01);
    // Accomplishment
    doc.setFontSize(13);
    setColor(doc, C.dark);
    const lines = wrapText(doc, d.accomplishment, 5.5);
    lines.forEach((line, i) => doc.text(line, cx, 6.2 + i * 0.22, { align: "center" }));
    // Year + date
    const yAfter = 6.2 + lines.length * 0.22 + 0.6;
    doc.setFontSize(10);
    setColor(doc, C.muted);
    doc.text(`*  ${d.schoolYear}  *`, cx, yAfter, { align: "center" });
    doc.setFontSize(9);
    setColor(doc, C.light);
    doc.text(today, cx, yAfter + 0.25, { align: "center" });
  } else if (d.style === 2) {
    // Modern Clean — sans-serif, green header
    fillRect(doc, 0, 0, PW, 2.5, C.green);
    doc.setFontSize(10);
    setColor(doc, C.white);
    doc.text((d.schoolName || "Family Academy").toUpperCase(), cx, 1.0, { align: "center" });
    doc.setFontSize(24);
    doc.text(d.certTitle.toUpperCase(), cx, 1.8, { align: "center" });

    // Content
    doc.setFontSize(11);
    setColor(doc, C.muted);
    doc.text("PRESENTED TO", cx, 3.5, { align: "center" });
    doc.setFontSize(36);
    setColor(doc, C.dark);
    doc.text(d.childName || "Student Name", cx, 4.4, { align: "center" });
    // Green accent line
    fillRect(doc, cx - 0.5, 4.6, 1, 0.04, C.greenLt);
    // Accomplishment
    doc.setFontSize(14);
    setColor(doc, C.dark);
    const lines2 = wrapText(doc, d.accomplishment, 5.5);
    lines2.forEach((line, i) => doc.text(line, cx, 5.3 + i * 0.25, { align: "center" }));
    const yA2 = 5.3 + lines2.length * 0.25 + 0.7;
    doc.setFontSize(10);
    setColor(doc, C.light);
    doc.text(d.schoolYear, cx, yA2, { align: "center" });
    doc.setFontSize(9);
    doc.text(today, cx, yA2 + 0.2, { align: "center" });
  } else {
    // Botanical Natural — serif, soft green header
    fillRect(doc, 0, 0, PW, 1.8, C.greenLt);
    doc.setFontSize(18);
    setColor(doc, C.white);
    doc.text(d.schoolName || "Family Academy", cx, 0.8, { align: "center" });
    doc.setFontSize(16);
    doc.text(d.certTitle, cx, 1.3, { align: "center" });

    fillRect(doc, 0, 1.8, PW, PH - 1.8, C.bg);
    doc.setFontSize(11);
    setColor(doc, C.muted);
    doc.text("This certificate is presented to", cx, 3.2, { align: "center" });
    doc.setFontSize(32);
    setColor(doc, C.dark);
    doc.text(d.childName || "Student Name", cx, 4.1, { align: "center" });
    doc.setFontSize(16);
    doc.text("~ ~ ~", cx, 4.6, { align: "center" });
    doc.setFontSize(13);
    setColor(doc, C.dark);
    const lines3 = wrapText(doc, d.accomplishment, 5.5);
    lines3.forEach((line, i) => doc.text(line, cx, 5.3 + i * 0.24, { align: "center" }));
    const yA3 = 5.3 + lines3.length * 0.24 + 0.6;
    drawLine(doc, cx - 1.2, yA3, cx + 1.2, yA3, C.light, 0.01);
    doc.setFontSize(10);
    setColor(doc, C.muted);
    doc.text(d.schoolYear, cx, yA3 + 0.3, { align: "center" });
    doc.setFontSize(9);
    setColor(doc, C.light);
    doc.text(today, cx, yA3 + 0.5, { align: "center" });
  }

  if (d.showWatermark) {
    doc.setFontSize(8);
    setColor(doc, C.light);
    doc.text("Made with Rooted", cx, PH - 0.5, { align: "center" });
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
  doc.text("HOMESCHOOL ID", x + w / 2, y + 0.22, { align: "center" });
  doc.setFontSize(5.5);
  doc.text(d.schoolYear, x + w / 2, y + 0.4, { align: "center" });

  // Fields
  const fieldY = y + headerH + 0.2;
  doc.setFontSize(6);
  setColor(doc, C.muted);
  doc.text("NAME", x + 0.15, fieldY);
  doc.setFontSize(10);
  setColor(doc, C.dark);
  doc.text(d.name || "Name", x + 0.15, fieldY + 0.18);

  doc.setFontSize(6);
  setColor(doc, C.muted);
  doc.text("TITLE", x + 0.15, fieldY + 0.45);
  doc.setFontSize(8);
  setColor(doc, C.dark);
  doc.text(d.title || "Parent / Teacher", x + 0.15, fieldY + 0.6);

  doc.setFontSize(6);
  setColor(doc, C.muted);
  doc.text("SCHOOL", x + 0.15, fieldY + 0.85);
  doc.setFontSize(8);
  setColor(doc, C.dark);
  doc.text(d.schoolName || "Family Academy", x + 0.15, fieldY + 1.0);

  if (d.showWatermark) {
    doc.setFontSize(5);
    setColor(doc, C.light);
    doc.text("Made with Rooted", x + w - 0.15, y + h - 0.1, { align: "right" });
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
