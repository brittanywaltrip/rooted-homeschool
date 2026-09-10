import * as Sentry from "@sentry/nextjs";
import { sentryEnvironment } from "./lib/sentry-environment";
Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  environment: sentryEnvironment(process.env),
  tracesSampleRate: 0.1,
});
