import JsBarcode from "jsbarcode";

/* ID-card helpers. Used by IDCardGenerator and IDCardPDF. The barcode
 * helper requires a browser canvas; both helpers should run from a
 * "use client" component or inside an event handler. */

/**
 * Generate a stable 10-digit ID number from a UUID seed. Same seed
 * always produces the same ID (deterministic).
 */
export function generateIdNumber(seed: string): string {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    const ch = seed.charCodeAt(i);
    hash = (hash << 5) - hash + ch;
    hash = hash & hash; // 32-bit
  }
  return Math.abs(hash).toString().padStart(10, "0").slice(0, 10);
}

/**
 * Render a CODE128 barcode to a canvas and return a PNG data URL.
 * White bars on transparent background — sized for the dark card
 * footer. Browser-only (requires document.createElement).
 */
export function generateBarcodeDataUrl(value: string): string {
  const canvas = document.createElement("canvas");
  JsBarcode(canvas, value, {
    format: "CODE128",
    displayValue: false,
    background: "transparent",
    lineColor: "#ffffff",
    width: 1.5,
    height: 35,
    margin: 0,
  });
  return canvas.toDataURL("image/png");
}

/**
 * Compute initials from a person's name. "Jane Smith" -> "JS".
 * Single-word names return the first character. Empty input returns "?".
 */
export function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].charAt(0).toUpperCase();
  return (parts[0].charAt(0) + parts[parts.length - 1].charAt(0)).toUpperCase();
}

/**
 * Current school year as "YYYY–YYYY". Rolls over on August 1st: from
 * Aug 1 onward we're in the upcoming year ("2026-2027"); before Aug 1
 * we're still in the prior year ("2025-2026").
 */
export function getCurrentSchoolYear(now: Date = new Date()): string {
  const year = now.getFullYear();
  const month = now.getMonth(); // 0-11
  const startYear = month >= 7 ? year : year - 1;
  return `${startYear}–${startYear + 1}`;
}
