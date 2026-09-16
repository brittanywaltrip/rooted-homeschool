import { defineConfig, devices } from '@playwright/test';
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

// The phone-screenshot project is OPT IN. A bare `npx playwright test` runs
// every configured project, and these specs load /dashboard on the shared e2e
// account: a Today load reconciles every goal, which is the overlap the
// curriculum-writes teardown ordering exists to prevent. So the project is not
// even in the config unless MOBILE_SCREENSHOTS=1 asks for it.
const WANT_SCREENSHOTS = process.env.MOBILE_SCREENSHOTS === '1';

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
      // The phone screenshots are a look-at-it tool, not a gate. See the
      // mobile-screenshots project at the bottom.
      testIgnore: /screenshots\//,
      // Run the curriculum-writing specs AFTER this project, as its teardown.
      // A teardown project still runs when tests here fail, where a project
      // that lists this one in `dependencies` would be skipped as "did not
      // run", hiding a curriculum regression behind an unrelated failure.
      teardown: 'curriculum-writes',
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
      // after the whole 'chromium' project has finished (it is that project's
      // teardown). See CURRICULUM_WRITES in e2e/smoke/critical-paths.spec.ts.
      name: 'curriculum-writes',
      grep: /@curriculum-writes/,
      testIgnore: /screenshots\//,
      use: {
        browserName: 'chromium',
        storageState: STORAGE_STATE,
      },
    },
    // Phone screenshots for eyeballing input sizing (CC #15). Present only when
    // MOBILE_SCREENSHOTS=1:
    //   MOBILE_SCREENSHOTS=1 SHOT_PREFIX=before npx playwright test --project=mobile-screenshots
    ...(WANT_SCREENSHOTS
      ? [
          {
            name: 'mobile-screenshots',
            testMatch: /screenshots\/.*\.spec\.ts/,
            // Several navigations per test on a phone viewport; the gate's 30s
            // is not enough, and this project never blocks a deploy.
            timeout: 240_000,
            use: {
              ...devices['iPhone 14'],
              // The iPhone preset would bring webkit with it, and CI (and the
              // repo's install step) only installs chromium. Chromium's phone
              // emulation is what the other projects run anyway.
              browserName: 'chromium' as const,
              storageState: STORAGE_STATE,
            },
          },
        ]
      : []),
  ],
});

export { STORAGE_STATE, BASE_URL };
