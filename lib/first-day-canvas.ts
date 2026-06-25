import {
  FIRST_DAY_BRANDING,
  type FirstDayFieldKey,
  type FirstDayTheme,
} from "@/lib/first-day-themes";

// ─── Font loading ────────────────────────────────────────────────────────────
// Reuse the serif already shipped for certificates so the values match the art.

let fontLoaded = false;

async function loadFrameFont() {
  if (fontLoaded) return;
  const faces = [
    new FontFace("Playfair Display", "url(/fonts/PlayfairDisplay-Regular.woff2)"),
    new FontFace("Playfair Display", "url(/fonts/PlayfairDisplay-Bold.woff2)", { weight: "700" }),
  ];
  const loaded = await Promise.allSettled(faces.map((f) => f.load()));
  loaded.forEach((r) => { if (r.status === "fulfilled") document.fonts.add(r.value); });
  fontLoaded = true;
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    // Same-origin frame + data-URL photos never taint the canvas, but set this
    // so any future remote photo source stays exportable.
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Failed to load image: ${src}`));
    img.src = src;
  });
}

export interface PhotoTransform {
  /** Pan as a fraction of the arch box (-0.5..0.5); 0 = centered. */
  offsetXPct: number;
  offsetYPct: number;
  /** Zoom multiplier on top of cover-fit (1 = cover). */
  zoom: number;
}

export interface FirstDayRenderInput {
  theme: FirstDayTheme;
  photoSrc: string;
  transform: PhotoTransform;
  values: Record<FirstDayFieldKey, string>;
}

/**
 * Composite the First Day Photo at the frame's full resolution:
 *   1. child's photo drawn into the arch bounding box (cover-fit + pan/zoom),
 *   2. the frame PNG on top (its opaque area masks the photo to the arch),
 *   3. the six field values on their lines,
 *   4. the "Created with Rooted Homeschool App" branding footer.
 * Returns a high-resolution PNG Blob.
 */
export async function renderFirstDayFrame({ theme, photoSrc, transform, values }: FirstDayRenderInput): Promise<Blob> {
  await loadFrameFont();
  const [photo, frame] = await Promise.all([loadImage(photoSrc), loadImage(theme.src)]);

  const W = theme.naturalWidth;
  const H = theme.naturalHeight;
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d")!;

  // 1) Photo into the arch box, cover-fit then user pan/zoom, clipped to the box.
  const ax = theme.arch.xPct * W;
  const ay = theme.arch.yPct * H;
  const aw = theme.arch.wPct * W;
  const ah = theme.arch.hPct * H;

  ctx.save();
  ctx.beginPath();
  ctx.rect(ax, ay, aw, ah);
  ctx.clip();
  const coverScale = Math.max(aw / photo.width, ah / photo.height) * Math.max(1, transform.zoom);
  const drawW = photo.width * coverScale;
  const drawH = photo.height * coverScale;
  const dx = ax + (aw - drawW) / 2 + transform.offsetXPct * aw;
  const dy = ay + (ah - drawH) / 2 + transform.offsetYPct * ah;
  ctx.drawImage(photo, dx, dy, drawW, drawH);
  ctx.restore();

  // 2) Frame art on top — masks the photo to the arch and supplies all baked text.
  ctx.drawImage(frame, 0, 0, W, H);

  // 3) The six values on their lines.
  ctx.fillStyle = theme.textColor;
  ctx.textBaseline = "alphabetic";
  for (const f of theme.fields) {
    const text = (values[f.key] || "").trim();
    if (!text) continue;
    const maxWidth = f.maxWidthPct * W;
    let size = f.fontPx;
    ctx.font = `${size}px "${theme.fontFamily}"`;
    while (size > 9 && ctx.measureText(text).width > maxWidth) {
      size -= 1;
      ctx.font = `${size}px "${theme.fontFamily}"`;
    }
    ctx.textAlign = f.align;
    ctx.fillText(text, f.xPct * W, f.yPct * H);
  }

  // 4) Branding footer — every shared image carries "Rooted Homeschool App".
  //    The frame art leaves the bottom margin blank for this. Spelled exactly
  //    per the wording rule. Remove this block only if the art itself is later
  //    updated to bake the branding in.
  ctx.fillStyle = "#9aa896";
  ctx.textAlign = "center";
  ctx.font = `${Math.round(W * 0.02)}px "${theme.fontFamily}"`;
  ctx.fillText(FIRST_DAY_BRANDING, W / 2, H * 0.972);

  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("Canvas toBlob failed"))),
      "image/png",
    );
  });
}
