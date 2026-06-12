import { test, expect, type Page, type Route } from '@playwright/test';

/* Regression guard for commit c857e31 — "fix(onboarding): idempotent children
 * step". The bug: on the onboarding kids step, going forward to the school-year
 * step and then pressing Back and Continue again re-ran the children save, which
 * blindly re-INSERTed each child and hit a 409 on the (user_id, name_key) /
 * (user_id, lower(name)) unique indexes — surfacing "Something went wrong" and,
 * on indexes that didn't exist yet, a duplicated child. The fix made the save
 * idempotent: it fetches existing children and UPDATEs matches (by stored id,
 * then by name_key/name) instead of inserting again.
 *
 * Why this spec mocks the network instead of driving the real flow like the
 * other smoke specs:
 *   - The shared test account is already onboarded. global-setup.ts THROWS if
 *     login lands on /onboarding, and app/onboarding/page.tsx redirects an
 *     onboarded user straight to /dashboard — so the real account can never
 *     reach the kids step.
 *   - A fresh signup can't finish in CI either: signup now flips to a
 *     check-your-email state (commit 804e8a1) that needs inbox access.
 * So we render the REAL onboarding component (served from staging, real client
 * code executing) and intercept only the Supabase REST + profile API calls. The
 * children endpoint faithfully simulates the unique index: a duplicate INSERT
 * returns Postgres 23505 / HTTP 409, exactly as the live DB would. A regression
 * back to the blind-insert loop therefore reproduces the 409 here and fails the
 * test; the shipped idempotent code UPDATEs instead and stays green.
 *
 * No real account data is mutated: profile reads/writes, the children table, and
 * the school-year insert are all intercepted, so nothing reaches the live DB. */

// Install the network interceptors and return the in-memory children "table"
// plus a conflict flag the assertions read. Routes must be registered before
// the first navigation so the onboarding mount reads see them.
async function stubOnboardingBackend(page: Page) {
  // The simulated children rows. Mirrors the columns the client selects
  // (id, name, name_key) and enforces the (user_id, name_key) unique index.
  const childStore: { id: string; name: string; name_key: string }[] = [];
  const state = { sawConflict: false };
  let idCounter = 0;

  // Profile read at mount: onboarded:false keeps the page from redirecting to
  // /dashboard. first_name is left null so the test owns the value it types.
  await page.route('**/rest/v1/profiles*', async (route: Route) => {
    if (route.request().method() === 'GET') {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          onboarded: false,
          first_name: null,
          last_name: null,
          display_name: null,
          state: null,
          family_photo_url: null,
        }),
      });
    }
    return route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
  });

  // Steps 1-3 (name, location, about) persist via this API route. Swallow it so
  // the real test account's profile is never touched.
  await page.route('**/api/profile/update', (route: Route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '{}' }),
  );

  // The children table: GET returns the store, POST enforces the unique index
  // (409 on duplicate name_key), PATCH updates in place. This is the surface the
  // fix changed behavior against.
  await page.route('**/rest/v1/children*', async (route: Route) => {
    const req = route.request();
    const method = req.method();

    if (method === 'GET') {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(childStore),
      });
    }

    if (method === 'POST') {
      let row = JSON.parse(req.postData() || '{}');
      if (Array.isArray(row)) row = row[0] ?? {};
      const nameKey: string = row.name_key;
      // Duplicate INSERT on an existing name_key → the same 23505 / 409 the
      // live unique index throws. This is the regression being guarded.
      if (childStore.some((c) => c.name_key === nameKey)) {
        state.sawConflict = true;
        return route.fulfill({
          status: 409,
          contentType: 'application/json',
          body: JSON.stringify({
            code: '23505',
            message:
              'duplicate key value violates unique constraint "children_user_id_name_key_key"',
          }),
        });
      }
      const created = { id: `child-${++idCounter}`, name: row.name, name_key: nameKey };
      childStore.push(created);
      // .insert(...).select("id").single() expects a single object back.
      return route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify({ id: created.id }),
      });
    }

    if (method === 'PATCH') {
      // .update(payload).eq("id", targetId) → PATCH ?id=eq.<id>, no body return.
      const idParam = new URL(req.url()).searchParams.get('id') ?? '';
      const id = idParam.replace(/^eq\./, '');
      let patch = JSON.parse(req.postData() || '{}');
      if (Array.isArray(patch)) patch = patch[0] ?? {};
      const target = childStore.find((c) => c.id === id);
      if (target && patch.name) target.name = patch.name;
      return route.fulfill({ status: 204, body: '' });
    }

    return route.fallback();
  });

  return { childStore, state };
}

test.describe('ONBOARDING. Kids step is idempotent across Back/Continue (c857e31)', () => {
  test('re-submitting the kids step after Back does not 409 or duplicate the child', async ({
    page,
  }) => {
    const { childStore, state } = await stubOnboardingBackend(page);

    // Independent guard: catch any 409 to the children endpoint regardless of
    // how the mock is wired, so the assertion fails loudly on a real regression.
    let conflictResponseSeen = false;
    page.on('response', (res) => {
      if (res.status() === 409 && /\/rest\/v1\/children/.test(res.url())) {
        conflictResponseSeen = true;
      }
    });

    await page.goto('/onboarding');

    // Step 0 — name. Its presence confirms we were NOT redirected to /dashboard
    // (i.e. the onboarded:false stub took effect).
    await expect(
      page.getByRole('heading', { name: /what.?s your name/i }),
    ).toBeVisible({ timeout: 20_000 });
    await page.getByPlaceholder('First name').fill('Playwright');
    await page.getByRole('button', { name: /Continue/ }).click();

    // Step 1 — location. United States is the default; no state is required.
    await expect(
      page.getByRole('heading', { name: /Where are you homeschooling/i }),
    ).toBeVisible({ timeout: 10_000 });
    await page.getByRole('button', { name: /Continue/ }).click();

    // Step 2 — about. Continue is disabled until one experience + one goal are
    // chosen, so pick both before advancing.
    await expect(
      page.getByRole('heading', { name: /About your homeschool/i }),
    ).toBeVisible({ timeout: 10_000 });
    await page.getByRole('button', { name: 'Just starting' }).click();
    await page.getByRole('button', { name: 'Planning our days' }).click();
    await page.getByRole('button', { name: /Continue/ }).click();

    // Step 3 — kids. Add one child and continue. This is the first save.
    await expect(
      page.getByRole('heading', { name: /Add your children/i }),
    ).toBeVisible({ timeout: 10_000 });
    await page.getByPlaceholder("Child's name").fill('Testchild');
    await page.getByRole('button', { name: /Continue/ }).click();

    // We advanced to the school-year step → the first save succeeded and created
    // exactly one child.
    const schoolYearHeading = page.getByRole('heading', {
      name: /When does your school year run/i,
    });
    await expect(schoolYearHeading).toBeVisible({ timeout: 10_000 });
    expect(childStore.length, 'first save should create exactly one child').toBe(1);
    expect(state.sawConflict, 'first save must not 409').toBe(false);

    // Reproduce the bug: Back to the kids step, then Continue again. The child
    // row (and its persisted id) survives in component state, so the second save
    // must UPDATE rather than re-INSERT.
    await page.getByRole('button', { name: /Back/ }).click();
    await expect(
      page.getByRole('heading', { name: /Add your children/i }),
    ).toBeVisible({ timeout: 10_000 });
    // The previously entered name is still there (no reset, no doubling).
    await expect(page.getByPlaceholder("Child's name")).toHaveValue('Testchild');

    await page.getByRole('button', { name: /Continue/ }).click();

    // Success signal: we advanced to the school-year step again. A 409 would
    // have set the error and kept us on the kids step.
    await expect(schoolYearHeading).toBeVisible({ timeout: 10_000 });

    // The fix's guarantees, asserted directly:
    expect(state.sawConflict, 'second save must not 409 on the unique index').toBe(false);
    expect(conflictResponseSeen, 'no 409 response to /rest/v1/children').toBe(false);
    expect(childStore.length, 're-submitting must not duplicate the child').toBe(1);

    // The error banner must never have surfaced.
    await expect(page.getByText(/Something went wrong/i)).toHaveCount(0);
  });
});
