// Client-side Sentry bootstrap. @sentry/nextjs v9+ requires this file
// (instrumentation-client.ts) for browser initialization; the legacy
// sentry.client.config.ts is no longer auto-injected by withSentryConfig.
// Without this file, browser errors (like the July 2026 scheduler save
// failures) never reached Sentry at all.
import * as Sentry from "@sentry/nextjs";

import "./sentry.client.config";

// Instruments SPA route changes for tracing (required export in v9+).
export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
