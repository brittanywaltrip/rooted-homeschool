import { defineConfig, devices } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

// Load .env.local for local runs so PLAYWRIGHT_EMAIL / _PASSWORD /
// Supabase keys are available without installing dotenv. CI injects
// these via GitHub Actions secrets, so the file is absent there — noop.
{
  const envFile = path.join(__dirname, ".env.local");
  if (fs.existsSync(envFile)) {
    for (const line of fs.readFileSync(envFile, "utf8").split("\n")) {
      const m = line.match(/^([A-Z0-9_]+)\s*=\s*(.*)$/);
      if (!m) continue;
      const key = m[1];
      let val = m[2].trim();
      if (val.startsWith('"') && val.endsWith('"')) val = val.slice(1, -1);
      if (!(key in process.env)) process.env[key] = val;
    }
  }
}

const STAGING_URL =
  "https://rooted-homeschool-git-staging-brittanywaltrips-projects.vercel.app";

const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? STAGING_URL;
const isCI = !!process.env.CI;

export const STORAGE_STATE = path.join(
  __dirname,
  "tests/e2e/.auth/user.json"
);

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  workers: 1,
  forbidOnly: isCI,
  retries: isCI ? 2 : 0,
  reporter: [
    ["list"],
    ["html", { open: "never", outputFolder: "playwright-report" }],
  ],
  timeout: 60_000,
  expect: { timeout: 10_000 },

  use: {
    baseURL,
    headless: isCI,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
    extraHTTPHeaders: process.env.VERCEL_AUTOMATION_BYPASS_SECRET
      ? {
          "x-vercel-protection-bypass":
            process.env.VERCEL_AUTOMATION_BYPASS_SECRET,
          "x-vercel-set-bypass-cookie": "true",
        }
      : undefined,
  },

  projects: [
    {
      name: "setup",
      testMatch: /.*\.setup\.ts/,
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        storageState: STORAGE_STATE,
      },
      dependencies: ["setup"],
    },
    {
      name: "firefox",
      use: {
        ...devices["Desktop Firefox"],
        storageState: STORAGE_STATE,
      },
      dependencies: ["setup"],
    },
    {
      name: "webkit",
      use: {
        ...devices["Desktop Safari"],
        storageState: STORAGE_STATE,
      },
      dependencies: ["setup"],
    },
  ],
});
