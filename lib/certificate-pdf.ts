/**
 * Certificate of Completion — printable PDF for a finished curriculum.
 *
 * Used by the celebration card and the day-of-completion modal. Reuses the
 * same canvas-to-jsPDF pattern as lib/certificate-canvas.ts so styling and
 * Cormorant Garamond fonts stay consistent with the Printables certificates.
 *
 * Standalone — wired into the Plan page in a later integration prompt.
 *
 * Brand notes:
 * - Sage greens: #1a2c22 deep, #2D5A3D brand, #3d5c48 mid, #5c7f63 accent
 * - Warm off-white #F8F7F4 background
 * - Cormorant Garamond serif for the kid's name + program title
 * - NO gold — gold is reserved for paid/Founding Family indicators
 */

let fontsLoaded = false;

async function loadFonts() {
  if (fontsLoaded) return;
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

  const fonts = [cormorant, cormorantItalic, jost];
  const loaded = await Promise.allSettled(fonts.map((f) => f.load()));
  loaded.forEach((result, i) => {
    if (result.status === "fulfilled") document.fonts.add(result.value);
    else console.warn(`[CertificatePDF] Font ${i} failed to load:`, result.reason);
  });
  fontsLoaded = true;
}

export type CertificateOptions = {
  childName: string;
  curriculumName: string;
  /** ISO date string */
  completedDate: string;
  lessonsCount: number;
  weeksSpan: number;
  /** Optional family name — appears small at the bottom */
  familyName?: string;
};

function drawCertificate(
  ctx: CanvasRenderingContext2D,
  opts: CertificateOptions
) {
  // Landscape letter at 96dpi: 1056 × 816
  const W = 1056;
  const H = 816;
  const cx = W / 2;

  // Warm off-white background
  ctx.fillStyle = "#F8F7F4";
  ctx.fillRect(0, 0, W, H);

  // Outer soft border
  ctx.strokeStyle = "#E4E1D8";
  ctx.lineWidth = 2;
  ctx.strokeRect(48, 48, W - 96, H - 96);

  // Inner sage accent border
  ctx.strokeStyle = "#cdd9cb";
  ctx.lineWidth = 1;
  ctx.strokeRect(64, 64, W - 128, H - 128);

  // Decorative leaf at top center
  ctx.fillStyle = "#5c7f63";
  ctx.font = "32px Jost, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";
  ctx.fillText("🌿", cx, 140);

  // Eyebrow
  ctx.fillStyle = "#5c7f63";
  ctx.font = "300 13px Jost, sans-serif";
  ctx.fillText("CERTIFICATE OF COMPLETION", cx, 180);

  // Curriculum name — large display
  ctx.fillStyle = "#1a2c22";
  ctx.font = "italic 300 56px 'Cormorant Garamond', serif";
  wrapAndDraw(ctx, opts.curriculumName, cx, 270, W - 240, 64);

  // "presented to"
  ctx.fillStyle = "#7a6f65";
  ctx.font = "italic 300 18px 'Cormorant Garamond', serif";
  ctx.fillText("presented to", cx, 360);

  // Divider
  ctx.strokeStyle = "#E4E1D8";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(cx - 60, 380);
  ctx.lineTo(cx + 60, 380);
  ctx.stroke();

  // Child's name — hero element
  ctx.fillStyle = "#2D5A3D";
  ctx.font = "italic 300 80px 'Cormorant Garamond', serif";
  ctx.fillText(opts.childName, cx, 470);

  // Program description
  ctx.fillStyle = "#3d5c48";
  ctx.font = "300 18px Jost, sans-serif";
  ctx.fillText(
    `for completing ${opts.lessonsCount} lessons over ${opts.weeksSpan} weeks`,
    cx,
    540
  );

  // Completion date
  const dateLabel = new Date(opts.completedDate).toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });
  ctx.fillStyle = "#7a6f65";
  ctx.font = "300 15px Jost, sans-serif";
  ctx.fillText(dateLabel, cx, 575);

  // Footer
  ctx.fillStyle = "#5c7f63";
  ctx.font = "300 12px Jost, sans-serif";
  const footer = opts.familyName
    ? `The ${opts.familyName} Family · Rooted`
    : "Rooted";
  ctx.fillText(footer, cx, H - 90);
}

function wrapAndDraw(
  ctx: CanvasRenderingContext2D,
  text: string,
  cx: number,
  y: number,
  maxWidth: number,
  lineHeight: number
) {
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

  const startY = y - ((lines.length - 1) * lineHeight) / 2;
  lines.forEach((line, i) => ctx.fillText(line, cx, startY + i * lineHeight));
}

/**
 * Generates the certificate PDF and returns it as a Blob.
 * Caller decides whether to download or open in a print dialog.
 */
export async function generateCertificatePDF(
  opts: CertificateOptions
): Promise<Blob> {
  await loadFonts();

  const SCALE = 3;
  const canvas = document.createElement("canvas");
  canvas.width = 1056 * SCALE;
  canvas.height = 816 * SCALE;
  const ctx = canvas.getContext("2d")!;
  ctx.scale(SCALE, SCALE);

  drawCertificate(ctx, opts);

  const imgData = canvas.toDataURL("image/png", 1.0);
  const { jsPDF } = await import("jspdf");
  const pdf = new jsPDF({ orientation: "landscape", unit: "in", format: [11, 8.5] });
  pdf.addImage(imgData, "PNG", 0, 0, 11, 8.5);

  return pdf.output("blob");
}

/**
 * Convenience helper: trigger a download of the certificate.
 */
export async function downloadCertificate(
  opts: CertificateOptions
): Promise<void> {
  const blob = await generateCertificatePDF(opts);
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  const safeName = `${opts.childName}-${opts.curriculumName}-certificate`
    .replace(/[^a-z0-9]/gi, "-")
    .toLowerCase();
  a.download = `${safeName}.pdf`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
