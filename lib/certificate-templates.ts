export type CertificateStyle = "garden" | "heritage" | "artisan";
export type CertificateType =
  | "graduation"
  | "subject_mastery"
  | "reading_achievement"
  | "weekly_win"
  | "streak_award"
  | "first_day"
  | "bookworm"
  | "explorer"
  | "artist"
  | "daily_champion"
  | "you_started"
  | "you_captured_it"
  | "you_read_together"
  | "you_took_them_there"
  | "one_whole_week"
  | "one_whole_month"
  | "100_days_strong"
  | "memory_keeper"
  | "story_keeper"
  | "you_did_that"
  | "founding_homeschooler"
  | "custom";

export const AWARD_META: Record<
  CertificateType,
  { emoji: string; label: string; isEducator: boolean; unlockHint: string }
> = {
  graduation: {
    emoji: "🎓",
    label: "Graduation Certificate",
    isEducator: false,
    unlockHint: "Complete a grade level",
  },
  subject_mastery: {
    emoji: "⭐",
    label: "Subject Mastery",
    isEducator: false,
    unlockHint: "Master a subject",
  },
  reading_achievement: {
    emoji: "📚",
    label: "Reading Achievement",
    isEducator: false,
    unlockHint: "Complete a book",
  },
  weekly_win: {
    emoji: "🏅",
    label: "Weekly Win",
    isEducator: false,
    unlockHint: "Complete a full week of learning",
  },
  streak_award: {
    emoji: "🔥",
    label: "Learning Streak",
    isEducator: false,
    unlockHint: "Maintain a multi-day learning streak",
  },
  first_day: {
    emoji: "🌱",
    label: "First Day of School",
    isEducator: false,
    unlockHint: "Log your child's first day",
  },
  bookworm: {
    emoji: "🐛",
    label: "Bookworm Award",
    isEducator: false,
    unlockHint: "Complete your first book",
  },
  explorer: {
    emoji: "🗺️",
    label: "Explorer Award",
    isEducator: false,
    unlockHint: "Complete your first field trip",
  },
  artist: {
    emoji: "🎨",
    label: "Artist Award",
    isEducator: false,
    unlockHint: "Create your first artwork",
  },
  daily_champion: {
    emoji: "🏆",
    label: "Daily Champion",
    isEducator: false,
    unlockHint: "Complete every lesson in a day",
  },
  you_started: {
    emoji: "🌟",
    label: "You Started",
    isEducator: true,
    unlockHint: "Begin your homeschool journey",
  },
  you_captured_it: {
    emoji: "📷",
    label: "Memory Capturer",
    isEducator: true,
    unlockHint: "Begin preserving memories",
  },
  you_read_together: {
    emoji: "📖",
    label: "Read Together",
    isEducator: true,
    unlockHint: "Log a read-aloud book",
  },
  you_took_them_there: {
    emoji: "🚌",
    label: "First Field Trip",
    isEducator: true,
    unlockHint: "Log your first field trip",
  },
  one_whole_week: {
    emoji: "📅",
    label: "One Whole Week",
    isEducator: true,
    unlockHint: "Complete a full week of homeschooling",
  },
  one_whole_month: {
    emoji: "🗓️",
    label: "One Whole Month",
    isEducator: true,
    unlockHint: "Complete 30 school days",
  },
  "100_days_strong": {
    emoji: "💯",
    label: "100 Days Strong",
    isEducator: true,
    unlockHint: "Log 100 days of learning",
  },
  memory_keeper: {
    emoji: "🧺",
    label: "Memory Keeper",
    isEducator: true,
    unlockHint: "Preserve memories for your academy",
  },
  story_keeper: {
    emoji: "📜",
    label: "Story Keeper",
    isEducator: true,
    unlockHint: "Build a treasure of memories",
  },
  you_did_that: {
    emoji: "✨",
    label: "You Did That",
    isEducator: true,
    unlockHint: "Guide a child through a grade",
  },
  founding_homeschooler: {
    emoji: "🏡",
    label: "Founding Homeschooler",
    isEducator: true,
    unlockHint: "Join as an early homeschooler",
  },
  custom: {
    emoji: "🎁",
    label: "Custom Award",
    isEducator: false,
    unlockHint: "Create a custom certificate",
  },
};

export interface CertContent {
  heroName: string;
  certTitle: string;
  bodyText: string;
  bodyIsEmotional?: boolean;
  note?: string;
  awardTitle?: string;
}

export function resolveCertContent(
  type: string,
  data: Record<string, string>
): CertContent {
  switch (type) {
    case "graduation":
      return {
        heroName: data.childName ?? "",
        certTitle: "Graduation Certificate",
        bodyText: `${data.childName} has successfully completed ${data.grade} at ${data.academyName}`,
      };
    case "subject_mastery":
      return {
        heroName: data.childName ?? "",
        certTitle: "Subject Mastery",
        bodyText: `${data.childName} has demonstrated mastery of ${data.subjectName} at ${data.academyName}`,
      };
    case "reading_achievement":
      return {
        heroName: data.childName ?? "",
        certTitle: "Reading Achievement",
        bodyText: `${data.childName} has completed reading ${data.bookTitle}`,
      };
    case "weekly_win":
      return {
        heroName: data.childName ?? "",
        certTitle: "Weekly Win",
        bodyText: `${data.childName} completed ${data.daysCompleted} days of learning ${data.weekRange}`,
        note: data.note,
      };
    case "streak_award":
      return {
        heroName: data.childName ?? "",
        certTitle: "Learning Streak Award",
        bodyText: `${data.childName} achieved a ${data.streakDays}-day learning streak at ${data.academyName}`,
      };
    case "first_day":
      return {
        heroName: data.childName ?? "",
        certTitle: "First Day of School",
        bodyText: `${data.childName} began their learning journey at ${data.academyName}`,
      };
    case "bookworm":
      return {
        heroName: data.childName ?? "",
        certTitle: "Bookworm Award",
        bodyText: `${data.childName} completed their first book: ${data.bookTitle}`,
      };
    case "explorer":
      return {
        heroName: data.childName ?? "",
        certTitle: "Explorer Award",
        bodyText: `${data.childName} completed their first field trip with ${data.academyName}`,
      };
    case "artist":
      return {
        heroName: data.childName ?? "",
        certTitle: "Artist Award",
        bodyText: `${data.childName} created their first piece of artwork at ${data.academyName}`,
      };
    case "daily_champion":
      return {
        heroName: data.childName ?? "",
        certTitle: "Daily Champion",
        bodyText: `${data.childName} completed every lesson on ${data.date} at ${data.academyName}`,
      };
    case "you_started":
      return {
        heroName: data.educatorName ?? "",
        certTitle: "You Started",
        bodyText: `${data.educatorName} began the beautiful work of teaching ${data.academyName}`,
      };
    case "you_captured_it":
      return {
        heroName: data.educatorName ?? "",
        certTitle: "Memory Capturer",
        bodyText: `${data.educatorName} began preserving the memories of ${data.academyName}`,
      };
    case "you_read_together":
      return {
        heroName: data.educatorName ?? "",
        certTitle: "Read Together",
        bodyText: `${data.educatorName} read ${data.bookTitle} together with ${data.academyName}`,
      };
    case "you_took_them_there":
      return {
        heroName: data.educatorName ?? "",
        certTitle: "First Field Trip",
        bodyText: `${data.educatorName} took ${data.academyName} on their first learning adventure`,
      };
    case "one_whole_week":
      return {
        heroName: data.educatorName ?? "",
        certTitle: "One Whole Week",
        bodyText: `${data.educatorName} completed a full week of homeschooling with ${data.academyName}`,
      };
    case "one_whole_month":
      return {
        heroName: data.educatorName ?? "",
        certTitle: "One Whole Month",
        bodyText: `${data.educatorName} completed 30 school days with ${data.academyName}`,
      };
    case "100_days_strong":
      return {
        heroName: data.educatorName ?? "",
        certTitle: "100 Days Strong",
        bodyText: `${data.educatorName} has shown up for ${data.totalDays} days of learning with ${data.academyName}`,
      };
    case "memory_keeper":
      return {
        heroName: data.educatorName ?? "",
        certTitle: "Memory Keeper",
        bodyText: `${data.educatorName} has preserved ${data.memoryCount} memories for ${data.academyName}`,
      };
    case "story_keeper":
      return {
        heroName: data.educatorName ?? "",
        certTitle: "Story Keeper",
        bodyText: `${data.educatorName} has built a treasure of ${data.memoryCount} memories for ${data.academyName}`,
      };
    case "you_did_that":
      return {
        heroName: data.educatorName ?? "",
        certTitle: "You Did That",
        bodyText: `${data.educatorName} guided ${data.childName} through ${data.grade} at ${data.academyName}`,
      };
    case "founding_homeschooler":
      return {
        heroName: data.educatorName ?? "",
        certTitle: "Founding Homeschooler",
        bodyText: `${data.educatorName} chose to keep their children close and teach them with intention. That is not small.`,
        bodyIsEmotional: true,
      };
    case "custom":
      return {
        heroName: data.recipientName ?? "",
        certTitle: data.awardTitle ?? "Certificate of Achievement",
        bodyText: data.awardText ?? "",
        awardTitle: data.awardTitle,
      };
    default:
      return {
        heroName: data.childName ?? data.educatorName ?? data.recipientName ?? "",
        certTitle: "Certificate of Achievement",
        bodyText: "",
      };
  }
}

// ─── SVG corner ornaments ────────────────────────────────────────────────────

const gardenLeafSVG = `<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 48 48">
  <path d="M4 4 C4 4 20 6 26 16 C20 10 8 12 4 4 Z" fill="#2D5016" opacity="0.7"/>
  <path d="M4 4 C4 4 10 22 22 26 C14 20 6 8 4 4 Z" fill="#2D5016" opacity="0.7"/>
</svg>`;

function gardenCorner(rotation: number): string {
  return `<div style="position:absolute;width:48px;height:48px;${cornerPosition(rotation)}transform:rotate(${rotation}deg);line-height:0;">${gardenLeafSVG}</div>`;
}

const heritageCrossSVG = `<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40" viewBox="0 0 40 40">
  <line x1="20" y1="4" x2="20" y2="16" stroke="#B8860B" stroke-width="1"/>
  <line x1="4" y1="20" x2="16" y2="20" stroke="#B8860B" stroke-width="1"/>
  <rect x="17" y="17" width="6" height="6" fill="none" stroke="#B8860B" stroke-width="0.8" transform="rotate(45 20 20)"/>
</svg>`;

function heritageCorner(rotation: number): string {
  return `<div style="position:absolute;width:40px;height:40px;${cornerPosition(rotation)}transform:rotate(${rotation}deg);line-height:0;">${heritageCrossSVG}</div>`;
}

function cornerPosition(rotation: number): string {
  // 0=TL, 90=TR, 180=BR, 270=BL
  if (rotation === 0) return "top:12px;left:12px;";
  if (rotation === 90) return "top:12px;right:12px;";
  if (rotation === 180) return "bottom:12px;right:12px;";
  return "bottom:12px;left:12px;";
}

// ─── Dividers ────────────────────────────────────────────────────────────────

function gardenDivider(): string {
  return `<div style="display:flex;align-items:center;margin:18px auto;width:60%;gap:0;">
    <div style="flex:1;height:1px;background:#C4962A;"></div>
    <div style="width:5px;height:5px;border-radius:50%;background:#C4962A;margin:0 8px;"></div>
    <div style="flex:1;height:1px;background:#C4962A;"></div>
  </div>`;
}

function heritageDivider(): string {
  return `<div style="display:flex;align-items:center;margin:18px auto;width:60%;gap:0;">
    <div style="flex:1;height:1px;background:#B8860B;"></div>
    <div style="width:6px;height:6px;background:#B8860B;transform:rotate(45deg);margin:0 8px;flex-shrink:0;"></div>
    <div style="flex:1;height:1px;background:#B8860B;"></div>
  </div>`;
}

function artisanDivider(): string {
  return `<div style="margin:16px auto;width:70%;height:1px;background:#e0d8d0;"></div>`;
}

// ─── Style renderers ─────────────────────────────────────────────────────────

function renderGarden(content: CertContent, data: Record<string, string>): string {
  const { heroName, certTitle, bodyText, bodyIsEmotional, note } = content;
  const fontsImport = `@import url('https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,400;0,700;1,400&family=Cormorant+Garamond:ital,wght@0,300;1,300&display=swap');`;

  const bodyFontSize = bodyIsEmotional ? "16px" : "14px";
  const bodyPadding = bodyIsEmotional ? "0 60px" : "0 48px";
  const bodyMargin = bodyIsEmotional ? "28px 0" : "20px 0";

  const noteHtml = note
    ? `<p style="font-family:'Cormorant Garamond',serif;font-style:italic;font-size:12px;color:#5a4a38;margin-top:14px;padding:${bodyPadding};">${note}</p>`
    : "";

  const dateHtml = data.date
    ? `<p style="font-family:'Cormorant Garamond',serif;font-size:12px;color:#3a3028;margin-top:8px;">${data.date}</p>`
    : "";

  const schoolYearHtml = data.schoolYear
    ? `<p style="font-family:'Cormorant Garamond',serif;font-size:11px;color:#7a6a58;margin-top:4px;">${data.schoolYear}</p>`
    : "";

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1.0"/>
<title>${certTitle}</title>
<style>
${fontsImport}
* { margin:0; padding:0; box-sizing:border-box; }
@page { size: 8.5in 11in; margin: 0; }
body {
  width: 816px;
  height: 1056px;
  background: #F7F3E9;
  display: flex;
  align-items: center;
  justify-content: center;
  font-family: 'Cormorant Garamond', serif;
  overflow: hidden;
}
</style>
</head>
<body>
<div style="position:relative;width:776px;height:1016px;background:#F7F3E9;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;">

  <!-- Outer border -->
  <div style="position:absolute;inset:0;border:2.5px solid #2D5016;pointer-events:none;"></div>
  <!-- Gap -->
  <div style="position:absolute;inset:8.5px;border:1px solid #C4962A;pointer-events:none;"></div>

  <!-- Corner ornaments -->
  ${gardenCorner(0)}
  ${gardenCorner(90)}
  ${gardenCorner(180)}
  ${gardenCorner(270)}

  <!-- Content -->
  <div style="padding:80px 60px;display:flex;flex-direction:column;align-items:center;width:100%;">

    <!-- Academy name -->
    <p style="font-family:'Playfair Display',serif;font-size:10px;text-transform:uppercase;letter-spacing:0.2em;color:#C4962A;margin-bottom:24px;">${data.academyName ?? ""}</p>

    ${gardenDivider()}

    <!-- Certificate title -->
    <h2 style="font-family:'Playfair Display',serif;font-size:20px;text-transform:uppercase;letter-spacing:0.12em;color:#2D5016;margin-bottom:32px;">${certTitle}</h2>

    <!-- Hero name -->
    <h1 style="font-family:'Playfair Display',serif;font-style:italic;font-size:52px;font-weight:400;color:#1a1008;line-height:1.1;margin-bottom:32px;padding:0 24px;">${heroName}</h1>

    ${gardenDivider()}

    <!-- Body text -->
    <p style="font-family:'Cormorant Garamond',serif;font-size:${bodyFontSize};color:#3a3028;line-height:1.7;margin:${bodyMargin};padding:${bodyPadding};">${bodyText}</p>

    ${noteHtml}

    ${gardenDivider()}

    ${dateHtml}
    ${schoolYearHtml}

  </div>

  <!-- Footer -->
  <p style="position:absolute;bottom:24px;font-family:'Cormorant Garamond',serif;font-size:9px;color:#c8b898;letter-spacing:0.08em;">Made with Rooted</p>
</div>
</body>
</html>`;
}

function renderHeritage(content: CertContent, data: Record<string, string>): string {
  const { heroName, certTitle, bodyText, bodyIsEmotional } = content;
  const fontsImport = `@import url('https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,400;0,700;1,400&family=Cormorant+Garamond:ital,wght@0,300;1,300&display=swap');`;

  const bodyFontSize = bodyIsEmotional ? "16px" : "13px";
  const bodyPadding = bodyIsEmotional ? "0 60px" : "0 48px";
  const bodyMargin = bodyIsEmotional ? "28px 0" : "20px 0";

  const dateHtml = data.date
    ? `<p style="font-family:'Cormorant Garamond',serif;font-size:12px;color:#2a2a20;margin-top:8px;">${data.date}</p>`
    : "";

  const schoolYearHtml = data.schoolYear
    ? `<p style="font-family:'Cormorant Garamond',serif;font-size:11px;color:#6a6a50;margin-top:4px;">${data.schoolYear}</p>`
    : "";

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1.0"/>
<title>${certTitle}</title>
<style>
${fontsImport}
* { margin:0; padding:0; box-sizing:border-box; }
@page { size: 8.5in 11in; margin: 0; }
body {
  width: 816px;
  height: 1056px;
  background: #FFFEF7;
  display: flex;
  align-items: center;
  justify-content: center;
  font-family: 'Cormorant Garamond', serif;
  overflow: hidden;
}
</style>
</head>
<body>
<div style="position:relative;width:776px;height:1016px;background:#FFFEF7;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;">

  <!-- Triple border: outer 3px, gap 5px, middle 0.5px, gap 5px, inner 1.5px -->
  <div style="position:absolute;inset:0;border:3px solid #1A3A2A;pointer-events:none;"></div>
  <div style="position:absolute;inset:8px;border:0.5px solid #B8860B;pointer-events:none;"></div>
  <div style="position:absolute;inset:13.5px;border:1.5px solid #1A3A2A;pointer-events:none;"></div>

  <!-- Corner ornaments -->
  ${heritageCorner(0)}
  ${heritageCorner(90)}
  ${heritageCorner(180)}
  ${heritageCorner(270)}

  <!-- Content -->
  <div style="padding:80px 60px;display:flex;flex-direction:column;align-items:center;width:100%;">

    <!-- Academy name -->
    <p style="font-family:'Playfair Display',serif;font-size:10px;font-variant:small-caps;letter-spacing:0.18em;color:#1A3A2A;margin-bottom:24px;">${data.academyName ?? ""}</p>

    ${heritageDivider()}

    <!-- Certificate title -->
    <h2 style="font-family:'Playfair Display',serif;font-size:22px;font-variant:small-caps;letter-spacing:0.1em;color:#1A3A2A;margin-bottom:32px;">${certTitle}</h2>

    <!-- Hero name -->
    <h1 style="font-family:'Playfair Display',serif;font-style:italic;font-size:52px;font-weight:400;color:#0a1a0a;line-height:1.1;margin-bottom:32px;padding:0 24px;">${heroName}</h1>

    ${heritageDivider()}

    <!-- Body text -->
    <p style="font-family:'Cormorant Garamond',serif;font-size:${bodyFontSize};color:#2a2a20;line-height:1.75;margin:${bodyMargin};padding:${bodyPadding};">${bodyText}</p>

    ${heritageDivider()}

    ${dateHtml}
    ${schoolYearHtml}

    <!-- Signature lines -->
    <div style="display:flex;gap:48px;margin-top:48px;justify-content:center;">
      <div style="text-align:center;">
        <div style="width:130px;height:1px;background:#1A3A2A;margin-bottom:6px;"></div>
        <p style="font-family:'Cormorant Garamond',serif;font-size:10px;letter-spacing:0.1em;text-transform:uppercase;color:#2a2a20;">Educator</p>
      </div>
      <div style="text-align:center;">
        <div style="width:130px;height:1px;background:#1A3A2A;margin-bottom:6px;"></div>
        <p style="font-family:'Cormorant Garamond',serif;font-size:10px;letter-spacing:0.1em;text-transform:uppercase;color:#2a2a20;">Date</p>
      </div>
    </div>

  </div>

  <!-- Footer -->
  <p style="position:absolute;bottom:24px;font-family:'Cormorant Garamond',serif;font-size:9px;color:#b8a888;letter-spacing:0.08em;">Made with Rooted</p>
</div>
</body>
</html>`;
}

function renderArtisan(content: CertContent, data: Record<string, string>): string {
  const { heroName, certTitle, bodyText, bodyIsEmotional, note } = content;
  const fontsImport = `@import url('https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,300;0,600;1,300&family=Jost:wght@300;400&display=swap');`;

  const bodyFontSize = bodyIsEmotional ? "16px" : "13px";
  const bodyPadding = bodyIsEmotional ? "0 80px" : "0 64px";
  const bodyMargin = bodyIsEmotional ? "32px 0" : "20px 0";

  const noteHtml = note
    ? `<p style="font-family:'Cormorant Garamond',serif;font-style:italic;font-size:12px;color:#9a8a7e;margin-top:16px;padding:${bodyPadding};">${note}</p>`
    : "";

  const dateHtml = data.date
    ? `<p style="font-family:'Jost',sans-serif;font-weight:300;font-size:11px;color:#7a6a5e;margin-top:10px;letter-spacing:0.06em;">${data.date}</p>`
    : "";

  const schoolYearHtml = data.schoolYear
    ? `<p style="font-family:'Jost',sans-serif;font-weight:300;font-size:10px;color:#9a8a7e;margin-top:4px;letter-spacing:0.06em;">${data.schoolYear}</p>`
    : "";

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1.0"/>
<title>${certTitle}</title>
<style>
${fontsImport}
* { margin:0; padding:0; box-sizing:border-box; }
@page { size: 8.5in 11in; margin: 0; }
body {
  width: 816px;
  height: 1056px;
  background: #FAFAF8;
  display: flex;
  align-items: center;
  justify-content: center;
  font-family: 'Cormorant Garamond', serif;
  overflow: hidden;
}
</style>
</head>
<body>
<div style="position:relative;width:816px;height:1056px;background:#FAFAF8;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;">

  <!-- Left accent bar -->
  <div style="position:absolute;top:0;left:0;width:8px;height:100%;background:#C4613A;"></div>
  <!-- Top accent bar -->
  <div style="position:absolute;top:0;left:0;width:100%;height:3px;background:#C4613A;"></div>

  <!-- Content -->
  <div style="padding:80px 60px 80px 68px;display:flex;flex-direction:column;align-items:center;width:100%;">

    <!-- Academy name -->
    <p style="font-family:'Jost',sans-serif;font-weight:300;font-size:10px;text-transform:uppercase;letter-spacing:0.3em;color:#C4613A;margin-bottom:32px;">${data.academyName ?? ""}</p>

    ${artisanDivider()}

    <!-- Certificate title -->
    <h2 style="font-family:'Jost',sans-serif;font-weight:300;font-size:11px;text-transform:uppercase;letter-spacing:0.25em;color:#C4613A;margin-bottom:40px;">${certTitle}</h2>

    <!-- Hero name -->
    <h1 style="font-family:'Cormorant Garamond',serif;font-style:italic;font-size:56px;font-weight:300;color:#2C2520;line-height:1.05;margin-bottom:40px;padding:0 24px;">${heroName}</h1>

    ${artisanDivider()}

    <!-- Body text -->
    <p style="font-family:'Cormorant Garamond',serif;font-style:italic;font-size:${bodyFontSize};color:#7a6a5e;line-height:1.75;margin:${bodyMargin};padding:${bodyPadding};">${bodyText}</p>

    ${noteHtml}

    ${dateHtml}
    ${schoolYearHtml}

  </div>

  <!-- Footer -->
  <p style="position:absolute;bottom:24px;font-family:'Jost',sans-serif;font-weight:300;font-size:9px;color:#c0b8b0;letter-spacing:0.1em;">Made with Rooted</p>
</div>
</body>
</html>`;
}

// ─── Main export ─────────────────────────────────────────────────────────────

export function generateCertificateHTML(
  type: string,
  style: string,
  data: Record<string, string>
): string {
  const content = resolveCertContent(type, data);

  switch (style as CertificateStyle) {
    case "heritage":
      return renderHeritage(content, data);
    case "artisan":
      return renderArtisan(content, data);
    case "garden":
    default:
      return renderGarden(content, data);
  }
}
