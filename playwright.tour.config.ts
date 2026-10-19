import { defineConfig } from "@playwright/test";

// Public-page checks only. Deliberately separate from the staging suite's
// authenticated global setup and data-writing tests. Never accepts a remote URL.
export default defineConfig({
  testDir: "./app/tour",
  testMatch: "public.spec.ts",
  fullyParallel: true,
  workers: 2,
  retries: 0,
  reporter: "list",
  use: {
    baseURL: "http://127.0.0.1:3100",
    browserName: "chromium",
    storageState: { cookies: [], origins: [] },
    serviceWorkers: "block",
    trace: "off",
    launchOptions: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH
      ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH }
      : undefined,
  },
  webServer: {
    command: "node node_modules/next/dist/bin/next dev --hostname 127.0.0.1 --port 3100",
    url: "http://127.0.0.1:3100/tour",
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      NEXT_TELEMETRY_DISABLED: "1",
      NEXT_PUBLIC_POSTHOG_KEY: "",
      NEXT_PUBLIC_SENTRY_DSN: "",
      SENTRY_AUTH_TOKEN: "",
    },
  },
});
