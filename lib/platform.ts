"use client";

import { useSyncExternalStore } from "react";

/**
 * Synchronous one-shot check for callbacks / event handlers that can't use
 * the React hook below. Returns false during SSR. Safe to call inside a
 * useEffect or an onClick.
 */
export function isNativeApp(): boolean {
  if (typeof window === "undefined") return false;
  const cap = (window as unknown as {
    Capacitor?: { isNativePlatform?: () => boolean };
  }).Capacitor;
  return cap?.isNativePlatform?.() === true;
}

// useSyncExternalStore needs a stable subscribe. The Capacitor flag is set
// once before our JS boots and never changes, so the subscription is a no-op
// that returns its unsubscribe immediately. Defined at module scope so React
// doesn't see a new function on every render and trigger re-subscribes.
const noopSubscribe = () => () => {};

/**
 * Returns true when running inside a Capacitor native shell (iOS / Android),
 * false on web. SSR / first paint returns false so the server-rendered HTML
 * always matches the web case; the native value flips in after hydration.
 *
 * Why this exists: Apple App Store Guideline 3.1.1 forbids in-app links to
 * external payment. Call sites that currently link to /upgrade or invoke
 * Stripe checkout must render plain text on native and the existing
 * button / link on web. See UpgradeBanner, ExportGateModal, pricing page,
 * settings subscription section, Today page banners, printables, yearbook
 * reader paywall, and the PlanV2 print dialog.
 */
export function useIsNativeApp(): boolean {
  return useSyncExternalStore(noopSubscribe, isNativeApp, () => false);
}
