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

// Subscribe to the standalone display-mode media query so the value stays
// correct if the context ever changes under us. matchMedia is unavailable
// during SSR, hence the guard.
const standaloneQuery = () =>
  typeof window !== "undefined" && typeof window.matchMedia === "function"
    ? window.matchMedia("(display-mode: standalone)")
    : null;

function subscribeStandalone(onChange: () => void): () => void {
  const mq = standaloneQuery();
  if (!mq) return () => {};
  mq.addEventListener("change", onChange);
  return () => mq.removeEventListener("change", onChange);
}

/**
 * True when the current context CANNOT complete a third-party OAuth round
 * trip, because the browser that leaves for Google or Apple is not the
 * browser that comes back.
 *
 * Two such contexts:
 *   1. The Capacitor iOS/Android shell. capacitor.config.ts only allows
 *      navigation to rootedhomeschoolapp.com, so Capacitor's navigation
 *      delegate cancels the trip to accounts.google.com and reopens it in
 *      the system browser (WebViewDelegationHandler.swift). The PKCE code
 *      verifier was written into the WebView's cookie jar and stays there.
 *      There are no Universal Links and no custom URL scheme, so the
 *      callback cannot re-enter the app either.
 *   2. A home-screen PWA on iOS, which likewise does not share a cookie jar
 *      with the browser view that handles the cross-origin leg.
 *
 * Measured cost of not doing this: between May 1 and Aug 17 2026, iOS
 * "Safari" (which is where both of these masquerade in analytics) failed
 * 19.4% of OAuth attempts, against 1.0% for the self-contained Facebook
 * in-app browser. 48 families never signed up.
 *
 * SSR and first paint return false so plain web keeps its buttons with no
 * flash; the native value flips in after hydration.
 *
 * When this is true, offer email + password instead. Do NOT simply remove
 * the buttons app-wide: on real web Safari, OAuth works fine and is the
 * preferred path.
 */
export function useIsOAuthHandoffContext(): boolean {
  const isNative = useIsNativeApp();
  const isStandalone = useSyncExternalStore(
    subscribeStandalone,
    () =>
      standaloneQuery()?.matches === true ||
      // iOS Safari's legacy home-screen flag, still the only signal on
      // some versions.
      (typeof navigator !== "undefined" &&
        (navigator as unknown as { standalone?: boolean }).standalone === true),
    () => false,
  );
  return isNative || isStandalone;
}
