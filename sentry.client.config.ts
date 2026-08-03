import * as Sentry from "@sentry/nextjs";
Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  environment: process.env.NODE_ENV,
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
