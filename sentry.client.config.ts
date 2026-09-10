import * as Sentry from "@sentry/nextjs";
import { isHeadlessUserAgent } from "./lib/sentry-scope";
Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  // Computed in next.config.ts from VERCEL_ENV: "production", "preview:<branch>"
  // (staging shows as "preview:staging") or "development". NODE_ENV is
  // "production" on every Vercel build, so it could never tell them apart.
  environment: process.env.NEXT_PUBLIC_SENTRY_ENVIRONMENT ?? "development",
  tracesSampleRate: 0.1,
  replaysOnErrorSampleRate: 1.0,
  replaysSessionSampleRate: 0.0,
  integrations: [Sentry.replayIntegration()],
  // Third-party browser noise, not app bugs:
  //  - "Lock was stolen by another request" comes from the Web Locks API when
  //    a second tab takes the lock (Supabase auth uses it).
  //  - the @context / toLowerCase throw comes from injected extension code.
  ignoreErrors: [
    "Lock was stolen by another request",
    /@context.*toLowerCase/,
  ],
});

// The Playwright suite runs HeadlessChrome against staging and hits the login
// page before it ever reaches the dashboard, so this tag is set at init, on the
// global scope, and every event from the run carries it. The account_kind and
// user tags need a session and are set by app/dashboard/layout.tsx.
if (typeof navigator !== "undefined" && isHeadlessUserAgent(navigator.userAgent)) {
  Sentry.getGlobalScope().setTag("e2e", "true");
}
