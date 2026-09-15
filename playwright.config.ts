import { defineConfig } from '@playwright/test';
import path from 'node:path';

// Tests run against a deployed environment (staging by default).
// Override with PLAYWRIGHT_BASE_URL=http://localhost:3000 for local runs.
const BASE_URL =
  process.env.PLAYWRIGHT_BASE_URL ||
  'https://rooted-homeschool-git-staging-brittanywaltrips-projects.vercel.app';

// Auth state captured by global-setup. Tests that need a signed-in user
// reference this via test.use({ storageState: STORAGE_STATE }) — see
// e2e/smoke/*.spec.ts. Auth tests run with no storageState so they
// observe the unauthenticated experience.
const STORAGE_STATE = path.resolve(__dirname, 'e2e/.auth/user.json');

export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  retries: 1,
  // Global setup signs in once via @supabase/ssr (no bypass route),
  // installs the Supabase auth cookies into a Playwright context, and
  // writes storageState to e2e/.auth/user.json (gitignored).
  globalSetup: require.resolve('./e2e/global-setup.ts'),
  use: {
    baseURL: BASE_URL,
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'chromium',
      // Everything except the curriculum-writing specs below.
      grepInvert: /@curriculum-writes/,
      use: {
        browserName: 'chromium',
        // Default storageState for tests that need it. Auth tests opt out
        // explicitly with test.use({ storageState: { cookies: [], origins: [] } }).
        storageState: STORAGE_STATE,
      },
    },
    {
      // Specs that create or rebuild a curriculum on the shared test account
      // and assert its lesson dates. Any Today load in another spec reconciles
      // every goal on the account, so these must never overlap one: they run
      // after the whole 'chromium' project has finished. See CURRICULUM_WRITES
      // in e2e/smoke/critical-paths.spec.ts.
      name: 'curriculum-writes',
      grep: /@curriculum-writes/,
      dependencies: ['chromium'],
      use: {
        browserName: 'chromium',
        storageState: STORAGE_STATE,
      },
    },
  ],
});

export { STORAGE_STATE, BASE_URL };
