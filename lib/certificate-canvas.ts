import { resolveCertContent } from "@/lib/certificate-templates";
import type { CertContent } from "@/lib/certificate-templates";

// ─── Font loading ────────────────────────────────────────────────────────────

let fontsLoaded = false;

async function loadFonts() {
  if (fontsLoaded) return;
  const playfair = new FontFace(
    "Playfair Display",
    "url(/fonts/PlayfairDisplay-Regular.woff2)"
  );
  const playfairItalic = new FontFace(
    "Playfair Display",
    "url(/fonts/PlayfairDisplay-Italic.woff2)",
    { style: "italic" }
  );
  const playfairBold = new FontFace(
    "Playfair Display",
    "url(/fonts/PlayfairDisplay-Bold.woff2)",
    { weight: "700" }
  );
  const cormorant = new FontFace(
    "Cormorant Garamond",
    "url(/fonts/CormorantGaramond-Light.woff2)",
    { weight: "300" }
  );
  const cormorantItalic = new FontFace(
    "Cormorant Garamond",
    "url(/fonts/CormorantGaramond-LightItalic.woff2)",
    { weight: "300", style: "italic" }
  );
  const jost = new FontFace(
    "Jost",
    "url(/fonts/Jost-Light.woff2)",
    { weight: "300" }
  );

  const fonts = [playfair, playfairItalic, playfairBold, cormorant, cormorantItalic, jost];
  const loaded = await Promise.allSettled(fonts.map(f => f.load()));
  loaded.forEach((result, i) => {
    if (result.status === "fulfilled") document.fonts.add(result.value);
    else console.warn(`[CertCanvas] Font ${i} failed to load:`, result.reason);
  });
  fontsLoaded = true;
}

// ─── Text helpers ────────────────────────────────────────────────────────────

function wrapText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const words = text.split(" ");
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const test = current ? `${current} ${word}` : word;
    if (ctx.measureText(test).width > maxWidth && current) {
      lines.push(current);
      current = word;
    } else {
      current = test;
    }
  }
  if (current) lines.push(current);
  return lines;
}

function drawCenteredText(ctx: CanvasRenderingContext2D, text: string, x: number, y: number) {
  ctx.textAlign = "center";
  ctx.fillText(text, x, y);
}

function drawDivider(ctx: CanvasRenderingContext2D, cx: number, y: number, width: number, color: string, withDot = false) {
  const hw = width / 2;
  ctx.strokeStyle = color;
  ctx.lineWidth = 0.5;
  if (withDot) {
    ctx.beginPath();
    ctx.moveTo(cx - hw, y);
    ctx.lineTo(cx - 4, y);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(cx, y, 2, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(cx + 4, y);
    ctx.lineTo(cx + hw, y);
    ctx.stroke();
  } else {
    ctx.beginPath();
    ctx.moveTo(cx - hw, y);
    ctx.lineTo(cx + hw, y);
    ctx.stroke();
  }
}

// ─── Garden style ────────────────────────────────────────────────────────────

function drawGarden(ctx: CanvasRenderingContext2D, content: CertContent, data: Record<string, string>) {
  const W = 816, H = 1056, cx = W / 2;

  // Background
  ctx.fillStyle = "#F7F3E9";
  ctx.fillRect(0, 0, W, H);

  // Outer border
  ctx.strokeStyle = "#2D5016";
  ctx.lineWidth = 2.5;
  ctx.strokeRect(12, 12, W - 24, H - 24);

  // Inner border
  ctx.strokeStyle = "#C4962A";
  ctx.lineWidth = 1;
  ctx.strokeRect(22, 22, W - 44, H - 44);

  // Corner leaf ornaments
  drawLeafCorner(ctx, 14, 14, 0);
  drawLeafCorner(ctx, W - 14, 14, 90);
  drawLeafCorner(ctx, W - 14, H - 14, 180);
  drawLeafCorner(ctx, 14, H - 14, 270);

  // Academy name
  ctx.fillStyle = "#C4962A";
  ctx.font = '18px "Cormorant Garamond"';
  ctx.letterSpacing = "3px";
  drawCenteredText(ctx, (data.academyName || "Family Academy").toUpperCase(), cx, 100);
  ctx.letterSpacing = "0px";

  // Top divider
  drawDivider(ctx, cx, 120, 200, "#C4962A", true);

  // Title
  ctx.fillStyle = "#2D5016";
  ctx.font = '20px "Playfair Display"';
  ctx.letterSpacing = "4px";
  drawCenteredText(ctx, content.certTitle.toUpperCase(), cx, 168);
  ctx.letterSpacing = "0px";

  // Bottom divider
  drawDivider(ctx, cx, 192, 200, "#C4962A", true);

  // "This certifies that"
  ctx.fillStyle = "#7a6f65";
  ctx.font = 'italic 14px "Cormorant Garamond"';
  drawCenteredText(ctx, "This certifies that", cx, 270);

  // Gold line above name
  drawDivider(ctx, cx, 300, 340, "#C4962A");

  // Hero name
  ctx.fillStyle = "#1a1008";
  ctx.font = 'italic 56px "Playfair Display"';
  drawCenteredText(ctx, content.heroName, cx, 380);

  // Gold line below name
  drawDivider(ctx, cx, 400, 340, "#C4962A");

  // Body text
  ctx.fillStyle = "#3a3028";
  const bodySize = content.bodyIsEmotional ? 16 : 14;
  ctx.font = `${bodySize}px "Cormorant Garamond"`;
  const bodyLines = wrapText(ctx, content.bodyText, 500);
  let bodyY = 460;
  for (const line of bodyLines) {
    drawCenteredText(ctx, line, cx, bodyY);
    bodyY += 26;
  }

  if (content.note) {
    bodyY += 10;
    ctx.font = 'italic 12px "Cormorant Garamond"';
    ctx.fillStyle = "#8a7558";
    drawCenteredText(ctx, content.note, cx, bodyY);
  }

  // Year
  ctx.fillStyle = "#8a7558";
  ctx.font = '13px "Cormorant Garamond"';
  ctx.letterSpacing = "2px";
  if (data.schoolYear) drawCenteredText(ctx, `\u2726  ${data.schoolYear}  \u2726`, cx, 546);
  ctx.letterSpacing = "0px";

  // Date
  ctx.fillStyle = "#b5aca4";
  ctx.font = '12px "Cormorant Garamond"';
  if (data.date) drawCenteredText(ctx, formatDisplayDate(data.date), cx, 572);

  // Signature lines
  drawSigLines(ctx, cx, 720, "#C4962A", "#7a6f65");

  // Footer
  ctx.fillStyle = "#c8b898";
  ctx.font = '9px "Cormorant Garamond"';
  drawCenteredText(ctx, "Made with Rooted", cx, 1020);
}

// ─── Heritage style ──────────────────────────────────────────────────────────

function drawHeritage(ctx: CanvasRenderingContext2D, content: CertContent, data: Record<string, string>) {
  const W = 816, H = 1056, cx = W / 2;

  ctx.fillStyle = "#FFFEF7";
  ctx.fillRect(0, 0, W, H);

  // Triple border
  ctx.strokeStyle = "#1A3A2A";
  ctx.lineWidth = 3;
  ctx.strokeRect(10, 10, W - 20, H - 20);

  ctx.strokeStyle = "#B8860B";
  ctx.lineWidth = 0.5;
  ctx.strokeRect(18, 18, W - 36, H - 36);

  ctx.strokeStyle = "#1A3A2A";
  ctx.lineWidth = 1.5;
  ctx.strokeRect(24, 24, W - 48, H - 48);

  // Diamond corners
  drawDiamond(ctx, 30, 30, "#B8860B");
  drawDiamond(ctx, W - 30, 30, "#B8860B");
  drawDiamond(ctx, W - 30, H - 30, "#B8860B");
  drawDiamond(ctx, 30, H - 30, "#B8860B");

  // Academy
  ctx.fillStyle = "#1A3A2A";
  ctx.font = '18px "Playfair Display"';
  ctx.letterSpacing = "3px";
  drawCenteredText(ctx, (data.academyName || "Family Academy").toUpperCase(), cx, 100);
  ctx.letterSpacing = "0px";

  // Diamond divider
  drawDivider(ctx, cx, 120, 200, "#B8860B", true);

  // Title
  ctx.fillStyle = "#1A3A2A";
  ctx.font = '22px "Playfair Display"';
  ctx.letterSpacing = "4px";
  drawCenteredText(ctx, content.certTitle.toUpperCase(), cx, 168);
  ctx.letterSpacing = "0px";

  // Bottom divider
  drawDivider(ctx, cx, 192, 200, "#B8860B", true);

  // "This certifies that"
  ctx.fillStyle = "#5a5a48";
  ctx.font = 'italic 14px "Cormorant Garamond"';
  drawCenteredText(ctx, "This certifies that", cx, 270);

  // Line above name
  drawDivider(ctx, cx, 300, 340, "#B8860B");

  // Hero name
  ctx.fillStyle = "#0a1a0a";
  ctx.font = 'italic 56px "Playfair Display"';
  drawCenteredText(ctx, content.heroName, cx, 380);

  // Line below name
  drawDivider(ctx, cx, 400, 340, "#B8860B");

  // Body
  ctx.fillStyle = "#2a2a20";
  const bodySize = content.bodyIsEmotional ? 16 : 13;
  ctx.font = `${bodySize}px "Cormorant Garamond"`;
  const bodyLines = wrapText(ctx, content.bodyText, 500);
  let bodyY = 460;
  for (const line of bodyLines) {
    drawCenteredText(ctx, line, cx, bodyY);
    bodyY += 26;
  }

  if (content.note) {
    bodyY += 10;
    ctx.font = 'italic 12px "Cormorant Garamond"';
    ctx.fillStyle = "#6a6040";
    drawCenteredText(ctx, content.note, cx, bodyY);
  }

  // Year
  ctx.fillStyle = "#5a5a48";
  ctx.font = '13px "Cormorant Garamond"';
  ctx.letterSpacing = "2px";
  if (data.schoolYear) drawCenteredText(ctx, `\u2666  ${data.schoolYear}  \u2666`, cx, 546);
  ctx.letterSpacing = "0px";

  // Date
  ctx.fillStyle = "#b5aca4";
  ctx.font = '12px "Cormorant Garamond"';
  if (data.date) drawCenteredText(ctx, formatDisplayDate(data.date), cx, 572);

  // Signature lines
  drawSigLines(ctx, cx, 720, "#B8860B", "#5a5a48");

  // Footer
  ctx.fillStyle = "#b8a888";
  ctx.font = '9px "Cormorant Garamond"';
  drawCenteredText(ctx, "Made with Rooted", cx, 1020);
}

// ─── Artisan style ───────────────────────────────────────────────────────────

function drawArtisan(ctx: CanvasRenderingContext2D, content: CertContent, data: Record<string, string>) {
  const W = 816, H = 1056, cx = W / 2;

  ctx.fillStyle = "#FAFAF8";
  ctx.fillRect(0, 0, W, H);

  // Left accent bar
  ctx.fillStyle = "#C4613A";
  ctx.fillRect(0, 0, 8, H);

  // Top accent bar
  ctx.fillRect(0, 0, W, 3);

  // Academy
  ctx.fillStyle = "#C4613A";
  ctx.font = '300 18px "Jost"';
  ctx.letterSpacing = "5px";
  drawCenteredText(ctx, (data.academyName || "Family Academy").toUpperCase(), cx, 80);
  ctx.letterSpacing = "0px";

  // Thin divider
  drawDivider(ctx, cx, 100, 120, "#e0d8d0");

  // Title
  ctx.fillStyle = "#C4613A";
  ctx.font = '300 11px "Jost"';
  ctx.letterSpacing = "5px";
  drawCenteredText(ctx, content.certTitle.toUpperCase(), cx, 130);
  ctx.letterSpacing = "0px";

  // Hero name — dominant
  ctx.fillStyle = "#2C2520";
  ctx.font = 'italic 64px "Cormorant Garamond"';
  drawCenteredText(ctx, content.heroName, cx, 280);

  // Divider under name
  drawDivider(ctx, cx, 310, 80, "#e0d8d0");

  // Body
  ctx.fillStyle = "#7a6a5e";
  const bodySize = content.bodyIsEmotional ? 16 : 13;
  ctx.font = `italic ${bodySize}px "Cormorant Garamond"`;
  const bodyLines = wrapText(ctx, content.bodyText, 480);
  let bodyY = 380;
  for (const line of bodyLines) {
    drawCenteredText(ctx, line, cx, bodyY);
    bodyY += 26;
  }

  if (content.note) {
    bodyY += 10;
    ctx.font = 'italic 12px "Cormorant Garamond"';
    ctx.fillStyle = "#a0907e";
    drawCenteredText(ctx, content.note, cx, bodyY);
  }

  // Year + date
  ctx.fillStyle = "#a0907e";
  ctx.font = '300 10px "Jost"';
  ctx.letterSpacing = "2px";
  if (data.schoolYear) drawCenteredText(ctx, data.schoolYear, cx, 466);
  ctx.letterSpacing = "0px";
  if (data.date) drawCenteredText(ctx, formatDisplayDate(data.date), cx, 486);

  // Signature lines
  drawSigLines(ctx, cx, 700, "#e0d8d0", "#a0907e");

  // Footer
  ctx.fillStyle = "#c0b8b0";
  ctx.font = '300 9px "Jost"';
  drawCenteredText(ctx, "Made with Rooted", cx, 1020);
}

// ─── Shared drawing helpers ──────────────────────────────────────────────────

function drawLeafCorner(ctx: CanvasRenderingContext2D, x: number, y: number, degrees: number) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate((degrees * Math.PI) / 180);
  ctx.globalAlpha = 0.7;
  ctx.fillStyle = "#2D5016";
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.quadraticCurveTo(16, 2, 22, 12);
  ctx.quadraticCurveTo(14, 8, 0, 0);
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.quadraticCurveTo(2, 16, 14, 22);
  ctx.quadraticCurveTo(8, 14, 0, 0);
  ctx.fill();
  ctx.globalAlpha = 1;
  ctx.restore();
}

function drawDiamond(ctx: CanvasRenderingContext2D, x: number, y: number, color: string) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(Math.PI / 4);
  ctx.strokeStyle = color;
  ctx.lineWidth = 0.8;
  ctx.strokeRect(-4, -4, 8, 8);
  // Cross lines
  ctx.beginPath();
  ctx.moveTo(0, -8);
  ctx.lineTo(0, -3);
  ctx.moveTo(0, 3);
  ctx.lineTo(0, 8);
  ctx.moveTo(-8, 0);
  ctx.lineTo(-3, 0);
  ctx.moveTo(3, 0);
  ctx.lineTo(8, 0);
  ctx.stroke();
  ctx.restore();
}

function drawSigLines(ctx: CanvasRenderingContext2D, cx: number, y: number, lineColor: string, textColor: string) {
  const gap = 80;
  ctx.strokeStyle = lineColor;
  ctx.lineWidth = 0.5;

  // Educator line
  ctx.beginPath();
  ctx.moveTo(cx - gap - 65, y);
  ctx.lineTo(cx - gap + 65, y);
  ctx.stroke();
  ctx.fillStyle = textColor;
  ctx.font = '10px "Cormorant Garamond"';
  ctx.textAlign = "center";
  ctx.fillText("Educator", cx - gap, y + 14);

  // Date line
  ctx.beginPath();
  ctx.moveTo(cx + gap - 65, y);
  ctx.lineTo(cx + gap + 65, y);
  ctx.stroke();
  ctx.fillText("Date", cx + gap, y + 14);
}

function formatDisplayDate(d: string): string {
  if (!d) return "";
  try {
    return new Date(d + "T12:00:00").toLocaleDateString("en-US", {
      month: "long", day: "numeric", year: "numeric",
    });
  } catch {
    return d;
  }
}

// ─── Public API ──────────────────────────────────────────────────────────────

export async function drawCertificatePDF(
  type: string,
  style: string,
  data: Record<string, string>,
  filename?: string,
) {
  await loadFonts();

  const content = resolveCertContent(type, data);

  const SCALE = 3;
  const canvas = document.createElement("canvas");
  canvas.width = 816 * SCALE;
  canvas.height = 1056 * SCALE;
  const ctx = canvas.getContext("2d")!;
  ctx.scale(SCALE, SCALE);

  switch (style) {
    case "heritage":
      drawHeritage(ctx, content, data);
      break;
    case "artisan":
      drawArtisan(ctx, content, data);
      break;
    default:
      drawGarden(ctx, content, data);
  }

  const imgData = canvas.toDataURL("image/png", 1.0);
  const { jsPDF } = await import("jspdf");
  const pdf = new jsPDF({ orientation: "portrait", unit: "in", format: [8.5, 11] });
  pdf.addImage(imgData, "PNG", 0, 0, 8.5, 11);

  const safeName = (filename || `${content.heroName || "certificate"}-${type}`)
    .replace(/[^a-z0-9]/gi, "-").toLowerCase();
  pdf.save(`${safeName}.pdf`);
}

// ─── ID Card drawing ─────────────────────────────────────────────────────────

interface IdCardData {
  schoolName: string;
  name: string;
  title: string;
  schoolYear: string;
  state: string;
  showWatermark: boolean;
  photoDataUrl?: string | null;
  back?: { include: boolean; address: string; websiteOrEmail: string; note: string };
}

function drawPersonPlaceholder(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number) {
  ctx.fillStyle = "#e8e2d9";
  ctx.fillRect(x, y, w, h);
  // Simple person silhouette
  const cx = x + w / 2, cy = y + h * 0.38;
  ctx.fillStyle = "#c4bfb8";
  ctx.beginPath();
  ctx.arc(cx, cy, w * 0.18, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(cx, cy + w * 0.42, w * 0.28, w * 0.22, 0, Math.PI, 0, true);
  ctx.fill();
}

async function drawPhotoOrPlaceholder(ctx: CanvasRenderingContext2D, photoDataUrl: string | null | undefined, x: number, y: number, w: number, h: number, circular = false) {
  if (photoDataUrl) {
    const img = new Image();
    img.src = photoDataUrl;
    await new Promise<void>((resolve) => { img.onload = () => resolve(); img.onerror = () => resolve(); });
    if (circular) {
      ctx.save();
      ctx.beginPath();
      ctx.ellipse(x + w / 2, y + h / 2, w / 2, h / 2, 0, 0, Math.PI * 2);
      ctx.clip();
      ctx.drawImage(img, x, y, w, h);
      ctx.restore();
    } else {
      ctx.drawImage(img, x, y, w, h);
    }
  } else {
    if (circular) {
      ctx.save();
      ctx.beginPath();
      ctx.ellipse(x + w / 2, y + h / 2, w / 2, h / 2, 0, 0, Math.PI * 2);
      ctx.clip();
      drawPersonPlaceholder(ctx, x, y, w, h);
      ctx.restore();
      ctx.strokeStyle = "#c4bfb8";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.ellipse(x + w / 2, y + h / 2, w / 2, h / 2, 0, 0, Math.PI * 2);
      ctx.stroke();
    } else {
      drawPersonPlaceholder(ctx, x, y, w, h);
    }
  }
}

async function drawIdCardGarden(ctx: CanvasRenderingContext2D, data: IdCardData) {
  const W = 336, H = 192;

  // Background
  ctx.fillStyle = "#F7F3E9";
  ctx.fillRect(0, 0, W, H);

  // Outer border
  ctx.strokeStyle = "#2D5016";
  ctx.lineWidth = 2;
  ctx.strokeRect(1, 1, W - 2, H - 2);

  // Inner border
  ctx.strokeStyle = "#C4962A";
  ctx.lineWidth = 0.5;
  ctx.strokeRect(5, 5, W - 10, H - 10);

  // Header bar
  ctx.fillStyle = "#2D5016";
  ctx.fillRect(6, 6, W - 12, 28);
  ctx.fillStyle = "#C4962A";
  ctx.font = '10px "Cormorant Garamond"';
  ctx.textAlign = "center";
  ctx.letterSpacing = "1.5px";
  ctx.fillText((data.schoolName || "Family Academy").toUpperCase(), W / 2, 24);
  ctx.letterSpacing = "0px";

  // Photo
  const photoX = 14, photoY = 44, photoW = 64, photoH = 80;
  ctx.strokeStyle = "#C4962A";
  ctx.lineWidth = 0.5;
  ctx.setLineDash([3, 2]);
  if (!data.photoDataUrl) ctx.strokeRect(photoX, photoY, photoW, photoH);
  ctx.setLineDash([]);
  await drawPhotoOrPlaceholder(ctx, data.photoDataUrl, photoX, photoY, photoW, photoH);

  // Text right of photo
  const tx = 90;
  ctx.textAlign = "left";

  // Name
  ctx.fillStyle = "#1a1008";
  ctx.font = 'italic 22px "Playfair Display"';
  ctx.fillText(data.name || "Your Name", tx, 68);

  // Gold divider
  ctx.strokeStyle = "#C4962A";
  ctx.lineWidth = 0.5;
  ctx.setLineDash([]);
  ctx.beginPath();
  ctx.moveTo(tx, 76);
  ctx.lineTo(tx + 160, 76);
  ctx.stroke();

  // Title
  ctx.fillStyle = "#2D5016";
  ctx.font = '11px "Cormorant Garamond"';
  ctx.letterSpacing = "1px";
  ctx.fillText(data.title.toUpperCase(), tx, 92);
  ctx.letterSpacing = "0px";

  // State + role
  ctx.fillStyle = "#7a6a5e";
  ctx.font = '11px "Cormorant Garamond"';
  ctx.fillText([data.state, data.schoolYear].filter(Boolean).join(" | "), tx, 110);

  // Year
  ctx.fillStyle = "#9a8868";
  ctx.font = '10px "Cormorant Garamond"';

  // Footer bar
  ctx.fillStyle = "#2D5016";
  ctx.fillRect(6, H - 22, W - 12, 16);
  if (data.showWatermark) {
    ctx.fillStyle = "#C4962A";
    ctx.font = '8px "Cormorant Garamond"';
    ctx.textAlign = "center";
    ctx.fillText("Made with Rooted", W / 2, H - 10);
  }
}

async function drawIdCardHeritage(ctx: CanvasRenderingContext2D, data: IdCardData) {
  const W = 336, H = 192;

  ctx.fillStyle = "#FFFEF7";
  ctx.fillRect(0, 0, W, H);

  // Double border
  ctx.strokeStyle = "#1A3A2A";
  ctx.lineWidth = 2;
  ctx.strokeRect(1, 1, W - 2, H - 2);
  ctx.strokeStyle = "#B8860B";
  ctx.lineWidth = 0.5;
  ctx.strokeRect(5, 5, W - 10, H - 10);

  // Academy
  ctx.fillStyle = "#1A3A2A";
  ctx.font = '10px "Playfair Display"';
  ctx.textAlign = "center";
  ctx.letterSpacing = "1.5px";
  ctx.fillText((data.schoolName || "Family Academy").toUpperCase(), W / 2, 22);
  ctx.letterSpacing = "0px";

  // Divider
  ctx.strokeStyle = "#B8860B";
  ctx.lineWidth = 0.5;
  ctx.beginPath();
  ctx.moveTo(W / 2 - 60, 28);
  ctx.lineTo(W / 2 + 60, 28);
  ctx.stroke();

  // Photo — circular with gold border
  const photoCx = 52, photoCy = 90, photoR = 32;
  await drawPhotoOrPlaceholder(ctx, data.photoDataUrl, photoCx - photoR, photoCy - photoR * 1.1, photoR * 2, photoR * 2.2, true);
  ctx.strokeStyle = "#B8860B";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.ellipse(photoCx, photoCy, photoR, photoR * 1.1, 0, 0, Math.PI * 2);
  ctx.stroke();

  // Text right of photo
  const tx = 96;
  ctx.textAlign = "left";

  ctx.fillStyle = "#0a1a0a";
  ctx.font = 'italic 22px "Playfair Display"';
  ctx.fillText(data.name || "Your Name", tx, 72);

  ctx.strokeStyle = "#B8860B";
  ctx.lineWidth = 0.5;
  ctx.beginPath();
  ctx.moveTo(tx, 80);
  ctx.lineTo(tx + 150, 80);
  ctx.stroke();

  ctx.fillStyle = "#1A3A2A";
  ctx.font = '11px "Cormorant Garamond"';
  ctx.letterSpacing = "1px";
  ctx.fillText(data.title.toUpperCase(), tx, 96);
  ctx.letterSpacing = "0px";

  ctx.fillStyle = "#5a5a48";
  ctx.font = '11px "Cormorant Garamond"';
  ctx.fillText([data.state, data.schoolYear].filter(Boolean).join(" | "), tx, 114);

  // Footer
  if (data.showWatermark) {
    ctx.fillStyle = "#b8a888";
    ctx.font = '8px "Cormorant Garamond"';
    ctx.textAlign = "center";
    ctx.fillText("Made with Rooted", W / 2, H - 10);
  }
}

async function drawIdCardArtisan(ctx: CanvasRenderingContext2D, data: IdCardData) {
  const W = 336, H = 192;

  ctx.fillStyle = "#FAFAF8";
  ctx.fillRect(0, 0, W, H);

  // Left accent bar
  ctx.fillStyle = "#C4613A";
  ctx.fillRect(0, 0, 8, H);

  // Top accent
  ctx.fillRect(0, 0, W, 2);

  // Photo
  const photoX = 18, photoY = 28, photoW = 60, photoH = 75;
  await drawPhotoOrPlaceholder(ctx, data.photoDataUrl, photoX, photoY, photoW, photoH);

  const tx = 90;
  ctx.textAlign = "left";

  // Academy
  ctx.fillStyle = "#C4613A";
  ctx.font = '300 8px "Jost"';
  ctx.letterSpacing = "2px";
  ctx.fillText((data.schoolName || "Family Academy").toUpperCase(), tx, 40);
  ctx.letterSpacing = "0px";

  // Name — hero
  ctx.fillStyle = "#2C2520";
  ctx.font = 'italic 22px "Cormorant Garamond"';
  ctx.fillText(data.name || "Your Name", tx, 68);

  // Thin divider
  ctx.strokeStyle = "#e0d8d0";
  ctx.lineWidth = 0.5;
  ctx.beginPath();
  ctx.moveTo(tx, 76);
  ctx.lineTo(tx + 140, 76);
  ctx.stroke();

  // Title
  ctx.fillStyle = "#C4613A";
  ctx.font = '300 9px "Jost"';
  ctx.letterSpacing = "1px";
  ctx.fillText(data.title.toUpperCase(), tx, 92);
  ctx.letterSpacing = "0px";

  // State + year
  ctx.fillStyle = "#7a6a5e";
  ctx.font = 'italic 10px "Cormorant Garamond"';
  ctx.fillText([data.state, data.schoolYear].filter(Boolean).join(" | "), tx, 110);

  // Footer
  if (data.showWatermark) {
    ctx.fillStyle = "#c0b8b0";
    ctx.font = '300 7px "Jost"';
    ctx.textAlign = "center";
    ctx.fillText("Made with Rooted", W / 2, H - 8);
  }
}

// ─── ID Card back drawing ───────────────────────────────────────────────────

function drawIdCardBackGarden(ctx: CanvasRenderingContext2D, data: IdCardData) {
  const W = 336, H = 192;
  ctx.fillStyle = "#F7F3E9";
  ctx.fillRect(0, 0, W, H);
  ctx.strokeStyle = "#2D5016";
  ctx.lineWidth = 2;
  ctx.strokeRect(1, 1, W - 2, H - 2);
  ctx.strokeStyle = "#C4962A";
  ctx.lineWidth = 0.5;
  ctx.strokeRect(5, 5, W - 10, H - 10);

  ctx.textAlign = "center";
  ctx.fillStyle = "#2D5016";
  ctx.font = '12px "Cormorant Garamond"';
  ctx.letterSpacing = "2px";
  ctx.fillText((data.schoolName || "Family Academy").toUpperCase(), W / 2, 50);
  ctx.letterSpacing = "0px";

  drawDivider(ctx, W / 2, 62, 120, "#C4962A");

  let y = 82;
  ctx.fillStyle = "#7a6a5e";
  ctx.font = '10px "Cormorant Garamond"';
  if (data.back?.address) { ctx.fillText(data.back.address, W / 2, y); y += 16; }
  if (data.back?.websiteOrEmail) { ctx.fillText(data.back.websiteOrEmail, W / 2, y); y += 16; }
  if (data.back?.note) {
    ctx.font = 'italic 9px "Cormorant Garamond"';
    ctx.fillStyle = "#b5aca4";
    ctx.fillText(data.back.note, W / 2, y + 8);
  }

  if (data.showWatermark) {
    ctx.fillStyle = "#c8b898";
    ctx.font = '8px "Cormorant Garamond"';
    ctx.fillText("Made with Rooted", W / 2, H - 12);
  }
}

function drawIdCardBackHeritage(ctx: CanvasRenderingContext2D, data: IdCardData) {
  const W = 336, H = 192;
  ctx.fillStyle = "#FFFEF7";
  ctx.fillRect(0, 0, W, H);
  ctx.strokeStyle = "#1A3A2A";
  ctx.lineWidth = 2;
  ctx.strokeRect(1, 1, W - 2, H - 2);
  ctx.strokeStyle = "#B8860B";
  ctx.lineWidth = 0.5;
  ctx.strokeRect(5, 5, W - 10, H - 10);

  ctx.textAlign = "center";
  ctx.fillStyle = "#1A3A2A";
  ctx.font = '12px "Playfair Display"';
  ctx.letterSpacing = "2px";
  ctx.fillText((data.schoolName || "Family Academy").toUpperCase(), W / 2, 50);
  ctx.letterSpacing = "0px";

  drawDivider(ctx, W / 2, 62, 120, "#B8860B");

  let y = 82;
  ctx.fillStyle = "#5a5a48";
  ctx.font = '10px "Cormorant Garamond"';
  if (data.back?.address) { ctx.fillText(data.back.address, W / 2, y); y += 16; }
  if (data.back?.websiteOrEmail) { ctx.fillText(data.back.websiteOrEmail, W / 2, y); y += 16; }
  if (data.back?.note) {
    ctx.font = 'italic 9px "Cormorant Garamond"';
    ctx.fillStyle = "#b5aca4";
    ctx.fillText(data.back.note, W / 2, y + 8);
  }

  if (data.showWatermark) {
    ctx.fillStyle = "#b8a888";
    ctx.font = '8px "Cormorant Garamond"';
    ctx.fillText("Made with Rooted", W / 2, H - 12);
  }
}

function drawIdCardBackArtisan(ctx: CanvasRenderingContext2D, data: IdCardData) {
  const W = 336, H = 192;
  ctx.fillStyle = "#FAFAF8";
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = "#C4613A";
  ctx.fillRect(0, 0, 8, H);
  ctx.fillRect(0, 0, W, 2);

  ctx.textAlign = "center";
  ctx.fillStyle = "#C4613A";
  ctx.font = '300 10px "Jost"';
  ctx.letterSpacing = "3px";
  ctx.fillText((data.schoolName || "Family Academy").toUpperCase(), W / 2, 50);
  ctx.letterSpacing = "0px";

  drawDivider(ctx, W / 2, 62, 80, "#e0d8d0");

  let y = 82;
  ctx.fillStyle = "#7a6a5e";
  ctx.font = 'italic 10px "Cormorant Garamond"';
  if (data.back?.address) { ctx.fillText(data.back.address, W / 2, y); y += 16; }
  if (data.back?.websiteOrEmail) { ctx.fillText(data.back.websiteOrEmail, W / 2, y); y += 16; }
  if (data.back?.note) {
    ctx.font = 'italic 9px "Cormorant Garamond"';
    ctx.fillStyle = "#b5aca4";
    ctx.fillText(data.back.note, W / 2, y + 8);
  }

  if (data.showWatermark) {
    ctx.fillStyle = "#c0b8b0";
    ctx.font = '300 7px "Jost"';
    ctx.fillText("Made with Rooted", W / 2, H - 10);
  }
}

async function drawIdCardBackToCanvas(style: string, data: IdCardData): Promise<HTMLCanvasElement> {
  await loadFonts();
  const SCALE = 3;
  const canvas = document.createElement("canvas");
  canvas.width = 336 * SCALE;
  canvas.height = 192 * SCALE;
  const ctx = canvas.getContext("2d")!;
  ctx.scale(SCALE, SCALE);

  switch (style) {
    case "heritage":
      drawIdCardBackHeritage(ctx, data);
      break;
    case "artisan":
      drawIdCardBackArtisan(ctx, data);
      break;
    default:
      drawIdCardBackGarden(ctx, data);
  }
  return canvas;
}

async function drawIdCardToCanvas(style: string, data: IdCardData): Promise<HTMLCanvasElement> {
  await loadFonts();
  const SCALE = 3;
  const canvas = document.createElement("canvas");
  canvas.width = 336 * SCALE;
  canvas.height = 192 * SCALE;
  const ctx = canvas.getContext("2d")!;
  ctx.scale(SCALE, SCALE);

  switch (style) {
    case "heritage":
      await drawIdCardHeritage(ctx, data);
      break;
    case "artisan":
      await drawIdCardArtisan(ctx, data);
      break;
    default:
      await drawIdCardGarden(ctx, data);
  }
  return canvas;
}

export async function drawIdCardPDF(style: string, data: IdCardData, filename?: string) {
  const canvas = await drawIdCardToCanvas(style, data);
  const imgData = canvas.toDataURL("image/png", 1.0);
  const { jsPDF } = await import("jspdf");
  const pdf = new jsPDF({ orientation: "landscape", unit: "in", format: [3.5, 2] });
  pdf.addImage(imgData, "PNG", 0, 0, 3.5, 2);

  // Add back as page 2
  if (data.back?.include) {
    const backCanvas = await drawIdCardBackToCanvas(style, data);
    const backImg = backCanvas.toDataURL("image/png", 1.0);
    pdf.addPage([3.5, 2], "landscape");
    pdf.addImage(backImg, "PNG", 0, 0, 3.5, 2);
  }

  const safeName = (filename || `${data.name || "id"}-card`).replace(/[^a-z0-9]/gi, "-").toLowerCase();
  pdf.save(`${safeName}.pdf`);
}

export async function drawIdCardPrintSheetPDF(style: string, data: IdCardData) {
  const frontCanvas = await drawIdCardToCanvas(style, data);
  const frontImg = frontCanvas.toDataURL("image/png", 1.0);

  let backImg = "";
  if (data.back?.include) {
    const backCanvas = await drawIdCardBackToCanvas(style, data);
    backImg = backCanvas.toDataURL("image/png", 1.0);
  }

  const printWindow = window.open("", "_blank");
  if (!printWindow) return;

  const backPage = backImg
    ? `<div class="page"><img src="${backImg}" alt="ID Card Back" /></div>`
    : "";

  printWindow.document.write(`<!DOCTYPE html>
<html><head><title>Print ID Card</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  @page { size: letter; margin: 0; }
  body { background: white; }
  .page {
    width: 100vw;
    height: 100vh;
    display: flex;
    align-items: center;
    justify-content: center;
    page-break-after: always;
    break-after: page;
  }
  .page:last-child { page-break-after: auto; break-after: auto; }
  .page img {
    width: 3.375in;
    height: 2.125in;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
</style>
</head><body>
  <div class="page"><img src="${frontImg}" alt="ID Card Front" /></div>
  ${backPage}
<script>
  window.onafterprint = function() { window.close(); };
  setTimeout(function() { window.print(); }, 300);
</script>
</body></html>`);
  printWindow.document.close();
}
