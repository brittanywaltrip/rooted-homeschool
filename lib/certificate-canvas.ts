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

  // Corner leaf ornaments (simple triangular leaves)
  drawLeafCorner(ctx, 14, 14, 0);
  drawLeafCorner(ctx, W - 14, 14, 90);
  drawLeafCorner(ctx, W - 14, H - 14, 180);
  drawLeafCorner(ctx, 14, H - 14, 270);

  let y = 160;

  // Academy name
  ctx.fillStyle = "#C4962A";
  ctx.font = '13px "Cormorant Garamond"';
  ctx.letterSpacing = "3px";
  drawCenteredText(ctx, (data.academyName || "Family Academy").toUpperCase(), cx, y);
  ctx.letterSpacing = "0px";
  y += 30;

  // Divider
  drawDivider(ctx, cx, y, 200, "#C4962A", true);
  y += 30;

  // Title
  ctx.fillStyle = "#2D5016";
  ctx.font = '20px "Playfair Display"';
  ctx.letterSpacing = "4px";
  drawCenteredText(ctx, content.certTitle.toUpperCase(), cx, y);
  ctx.letterSpacing = "0px";
  y += 50;

  // "This certifies that"
  ctx.fillStyle = "#7a6f65";
  ctx.font = 'italic 14px "Cormorant Garamond"';
  drawCenteredText(ctx, "This certifies that", cx, y);
  y += 20;

  // Gold line
  drawDivider(ctx, cx, y, 340, "#C4962A");
  y += 20;

  // Hero name
  ctx.fillStyle = "#1a1008";
  ctx.font = 'italic 52px "Playfair Display"';
  drawCenteredText(ctx, content.heroName, cx, y + 40);
  y += 60;

  // Gold line
  drawDivider(ctx, cx, y, 340, "#C4962A");
  y += 40;

  // Body text
  ctx.fillStyle = "#3a3028";
  const bodySize = content.bodyIsEmotional ? 16 : 14;
  ctx.font = `${bodySize}px "Cormorant Garamond"`;
  const bodyLines = wrapText(ctx, content.bodyText, 500);
  for (const line of bodyLines) {
    drawCenteredText(ctx, line, cx, y);
    y += bodySize + 8;
  }

  if (content.note) {
    y += 8;
    ctx.font = 'italic 12px "Cormorant Garamond"';
    ctx.fillStyle = "#8a7558";
    drawCenteredText(ctx, content.note, cx, y);
    y += 20;
  }

  y += 30;

  // Year + date
  ctx.fillStyle = "#8a7558";
  ctx.font = '13px "Cormorant Garamond"';
  ctx.letterSpacing = "2px";
  if (data.schoolYear) drawCenteredText(ctx, `\u2726  ${data.schoolYear}  \u2726`, cx, y);
  y += 20;
  ctx.letterSpacing = "0px";
  ctx.fillStyle = "#b5aca4";
  ctx.font = '12px "Cormorant Garamond"';
  if (data.date) drawCenteredText(ctx, formatDisplayDate(data.date), cx, y);
  y += 50;

  // Signature lines
  drawSigLines(ctx, cx, y, "#C4962A", "#7a6f65");

  // Footer
  ctx.fillStyle = "#c8b898";
  ctx.font = '9px "Cormorant Garamond"';
  drawCenteredText(ctx, "Made with Rooted", cx, H - 30);
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

  let y = 160;

  // Academy
  ctx.fillStyle = "#1A3A2A";
  ctx.font = '13px "Playfair Display"';
  ctx.letterSpacing = "3px";
  drawCenteredText(ctx, (data.academyName || "Family Academy").toUpperCase(), cx, y);
  ctx.letterSpacing = "0px";
  y += 30;

  // Diamond divider
  drawDivider(ctx, cx, y, 200, "#B8860B", true);
  y += 30;

  // Title
  ctx.fillStyle = "#1A3A2A";
  ctx.font = '22px "Playfair Display"';
  ctx.letterSpacing = "4px";
  drawCenteredText(ctx, content.certTitle.toUpperCase(), cx, y);
  ctx.letterSpacing = "0px";
  y += 50;

  // "This certifies that"
  ctx.fillStyle = "#5a5a48";
  ctx.font = 'italic 14px "Cormorant Garamond"';
  drawCenteredText(ctx, "This certifies that", cx, y);
  y += 20;

  drawDivider(ctx, cx, y, 340, "#B8860B");
  y += 20;

  // Hero name
  ctx.fillStyle = "#0a1a0a";
  ctx.font = 'italic 52px "Playfair Display"';
  drawCenteredText(ctx, content.heroName, cx, y + 40);
  y += 60;

  drawDivider(ctx, cx, y, 340, "#B8860B");
  y += 40;

  // Body
  ctx.fillStyle = "#2a2a20";
  const bodySize = content.bodyIsEmotional ? 16 : 13;
  ctx.font = `${bodySize}px "Cormorant Garamond"`;
  const bodyLines = wrapText(ctx, content.bodyText, 500);
  for (const line of bodyLines) {
    drawCenteredText(ctx, line, cx, y);
    y += bodySize + 8;
  }

  if (content.note) {
    y += 8;
    ctx.font = 'italic 12px "Cormorant Garamond"';
    ctx.fillStyle = "#6a6040";
    drawCenteredText(ctx, content.note, cx, y);
    y += 20;
  }

  y += 30;
  ctx.fillStyle = "#5a5a48";
  ctx.font = '13px "Cormorant Garamond"';
  ctx.letterSpacing = "2px";
  if (data.schoolYear) drawCenteredText(ctx, `\u2666  ${data.schoolYear}  \u2666`, cx, y);
  y += 20;
  ctx.letterSpacing = "0px";
  ctx.fillStyle = "#b5aca4";
  ctx.font = '12px "Cormorant Garamond"';
  if (data.date) drawCenteredText(ctx, formatDisplayDate(data.date), cx, y);
  y += 50;

  drawSigLines(ctx, cx, y, "#B8860B", "#5a5a48");

  ctx.fillStyle = "#b8a888";
  ctx.font = '9px "Cormorant Garamond"';
  drawCenteredText(ctx, "Made with Rooted", cx, H - 30);
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

  let y = 180;

  // Academy
  ctx.fillStyle = "#C4613A";
  ctx.font = '300 10px "Jost"';
  ctx.letterSpacing = "5px";
  drawCenteredText(ctx, (data.academyName || "Family Academy").toUpperCase(), cx, y);
  ctx.letterSpacing = "0px";
  y += 30;

  // Thin divider
  drawDivider(ctx, cx, y, 120, "#e0d8d0");
  y += 20;

  // Title
  ctx.fillStyle = "#C4613A";
  ctx.font = '300 11px "Jost"';
  ctx.letterSpacing = "5px";
  drawCenteredText(ctx, content.certTitle.toUpperCase(), cx, y);
  ctx.letterSpacing = "0px";
  y += 60;

  // Hero name — dominant
  ctx.fillStyle = "#2C2520";
  ctx.font = 'italic 56px "Cormorant Garamond"';
  drawCenteredText(ctx, content.heroName, cx, y + 30);
  y += 70;

  // Thin divider
  drawDivider(ctx, cx, y, 80, "#e0d8d0");
  y += 50;

  // Body
  ctx.fillStyle = "#7a6a5e";
  const bodySize = content.bodyIsEmotional ? 16 : 13;
  ctx.font = `italic ${bodySize}px "Cormorant Garamond"`;
  const bodyLines = wrapText(ctx, content.bodyText, 480);
  for (const line of bodyLines) {
    drawCenteredText(ctx, line, cx, y);
    y += bodySize + 10;
  }

  if (content.note) {
    y += 10;
    ctx.font = 'italic 12px "Cormorant Garamond"';
    ctx.fillStyle = "#a0907e";
    drawCenteredText(ctx, content.note, cx, y);
    y += 20;
  }

  y += 40;
  ctx.fillStyle = "#a0907e";
  ctx.font = '300 10px "Jost"';
  ctx.letterSpacing = "2px";
  if (data.schoolYear) drawCenteredText(ctx, data.schoolYear, cx, y);
  y += 18;
  ctx.letterSpacing = "0px";
  if (data.date) drawCenteredText(ctx, formatDisplayDate(data.date), cx, y);

  ctx.fillStyle = "#c0b8b0";
  ctx.font = '300 9px "Jost"';
  drawCenteredText(ctx, "Made with Rooted", cx, H - 30);
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
