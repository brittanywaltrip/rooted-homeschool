/* Lightweight haptic feedback. Silent no-op when the platform doesn't expose
 * navigator.vibrate (desktop browsers, iOS Safari, etc.). Failures swallow so
 * a haptic hiccup never blocks a user action. */

export function hapticTap(durationMs: number = 20): void {
  if (typeof navigator === "undefined") return;
  const n = navigator as Navigator & { vibrate?: (pattern: number | number[]) => boolean };
  if (typeof n.vibrate !== "function") return;
  try {
    n.vibrate(durationMs);
  } catch {
    /* swallow — some browsers throw on disallowed contexts */
  }
}
