// Pure hex-color blend helpers used by the Today page kid-section tinting.
// Inputs are 6-digit `#rrggbb` strings (the format children.color uses).
// Outputs are the same format. No alpha channel.
//
// The two operations are blends against pure white (tint, lightens) and
// pure black (darken). Both take an `opacity` in [0, 1] meaning "how much
// of the original color to keep" — i.e. tintFromHex(c, 0.25) returns a
// color that is 25% c and 75% white. darkenHex(c, 0.45) returns a color
// that is 55% c and 45% black.
//
// Designed for Brittany's curated children palette (mid-saturation jewel
// tones, no yellows). The 25% tint + 45% darken pair is verified to pass
// WCAG AA 4.5:1 contrast for that palette.

function parseHex(hex: string): [number, number, number] {
  const m = hex.replace("#", "").match(/.{2}/g);
  if (!m || m.length !== 3) throw new Error(`invalid hex: ${hex}`);
  return [parseInt(m[0], 16), parseInt(m[1], 16), parseInt(m[2], 16)];
}

function toHex(r: number, g: number, b: number): string {
  return `#${[r, g, b].map((n) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, "0")).join("")}`;
}

/**
 * Blend `hex` with white at the given opacity. opacity=1 returns the
 * original color; opacity=0 returns white.
 */
export function tintFromHex(hex: string, opacity: number): string {
  const [r, g, b] = parseHex(hex);
  const tr = r * opacity + 255 * (1 - opacity);
  const tg = g * opacity + 255 * (1 - opacity);
  const tb = b * opacity + 255 * (1 - opacity);
  return toHex(tr, tg, tb);
}

/**
 * Blend `hex` with black at the given opacity. opacity=0 returns the
 * original color; opacity=1 returns black. (Note the inverted meaning vs
 * tintFromHex — opacity here is "how much black to mix in", matching the
 * intuition "darken by 45%".)
 */
export function darkenHex(hex: string, opacity: number): string {
  const [r, g, b] = parseHex(hex);
  return toHex(r * (1 - opacity), g * (1 - opacity), b * (1 - opacity));
}

/**
 * Compute relative luminance of a color per WCAG 2.x.
 * Used by the test suite to assert contrast on the curated palette.
 */
export function relativeLuminance(hex: string): number {
  const [r, g, b] = parseHex(hex).map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/**
 * WCAG contrast ratio between two hex colors. 1 = identical, 21 = max.
 * AA body text requires >= 4.5.
 */
export function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const lighter = Math.max(la, lb);
  const darker = Math.min(la, lb);
  return (lighter + 0.05) / (darker + 0.05);
}
