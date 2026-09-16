/**
 * Phone screenshots of every surface with a text box in it, for eyeballing the
 * 16px input rule (CC #15).
 *
 * NOT part of the gate. It lives in its own Playwright project
 * (`mobile-screenshots` in playwright.config.ts, iPhone 14) and the gate
 * projects ignore this directory, so `npm run test:e2e` never runs it.
 *
 *   SHOT_PREFIX=before npx playwright test --project=mobile-screenshots
 *   SHOT_PREFIX=after  npx playwright test --project=mobile-screenshots
 *
 * Writes e2e/screenshots/out/<prefix>-<surface>.png (gitignored).
 *
 * In the `after` run it also proves the thing the pictures cannot: focusing a
 * text box does not zoom the page. Safari and the Android WebView zoom a
 * focused box under 16px and never zoom back out, which is what
 * `maximumScale: 1` was banning zoom to avoid. With the boxes at 16px the ban
 * is gone and the viewport must still sit at scale 1 after focus.
 */
import { test, expect, type Page, type Route } from '@playwright/test'

const PREFIX = process.env.SHOT_PREFIX ?? 'after'
const OUT = 'e2e/screenshots/out'
/** The after run asserts no zoom on focus; the before run cannot (the ban hides it). */
const CHECK_ZOOM = PREFIX !== 'before'

// Every navigation waits for domcontentloaded, not load: the dashboard holds a
// live connection open, so the load event can be minutes away or never, and the
// page is interactive long before it.
async function shot(page: Page, name: string): Promise<void> {
  // A plain wait, not Playwright's animations:'disabled' screenshot option: the
  // Garden's tree animation never settles, and waiting for it hangs the capture.
  await page.waitForTimeout(1_200)
  // Not fullPage: Today and the builder render metres of page on a phone, and a
  // full-page capture of one is slower than the whole test budget. The phone
  // viewport is what a family sees anyway.
  await page.screenshot({ path: `${OUT}/${PREFIX}-${name}.png`, timeout: 30_000 })
}

/**
 * Focus the first text box on the page and read the visual viewport back.
 *
 * scale > 1 means the browser zoomed in to make a small box readable, which on
 * iOS never zooms back out on its own.
 */
async function expectNoZoomOnFocus(page: Page, name: string): Promise<void> {
  if (!CHECK_ZOOM) return
  const box = page
    .locator('input:not([type=checkbox]):not([type=radio]):not([type=range]):not([type=file]), textarea, select')
    .first()
  if ((await box.count()) === 0) return
  await box.focus().catch(() => {})
  await page.waitForTimeout(400)
  const zoom = await page.evaluate(() => ({
    scale: window.visualViewport?.scale ?? 1,
    fontSize: document.activeElement
      ? parseFloat(getComputedStyle(document.activeElement as Element).fontSize)
      : 0,
    tag: document.activeElement?.tagName ?? '',
  }))
  expect(zoom.scale, `${name}: focusing a text box must not zoom the page`).toBe(1)
  if (/INPUT|TEXTAREA|SELECT/.test(zoom.tag)) {
    expect(zoom.fontSize, `${name}: a focused text box is at least 16px`).toBeGreaterThanOrEqual(16)
  }
}

/**
 * Today's missed-lesson recovery sheet covers the page and eats every tap, so
 * close it before touching anything. Same dialog and button the gate's own
 * helper uses (e2e/smoke/flows.spec.ts dismissMissedLessonModal).
 *
 * CSS and text locators for everything else on the dashboard: a getByRole
 * locator has to build an accessibility snapshot, and Today never stays still
 * long enough for one. A getByRole call here sat for a whole 240s test budget
 * without answering count(). Worth chasing separately; it is not what this
 * spec is for.
 */
async function dismissModals(page: Page): Promise<void> {
  const modal = page.locator('[role="dialog"][aria-labelledby="missed-recovery-title"]')
  if (await modal.isVisible({ timeout: 6_000 }).catch(() => false)) {
    await modal.locator('button[aria-label="Close"], button:has-text("Close")').first()
      .click({ timeout: 5_000 })
      .catch(() => {})
    await modal.waitFor({ state: 'hidden', timeout: 5_000 }).catch(() => {})
  }
  const other = page
    .locator('button')
    .filter({ hasText: /^(not now|skip|dismiss|maybe later)$/i })
    .first()
  if ((await other.count()) > 0) await other.click({ timeout: 3_000 }).catch(() => {})
}

test.describe('phone screenshots of every surface with a text box', () => {
  test('today, and the edit lesson sheet', async ({ page }) => {
    await page.goto('/dashboard', { waitUntil: 'domcontentloaded' })
    await expect(page.getByText(/Good morning|Good afternoon|Good evening/i).first()).toBeVisible({
      timeout: 30_000,
    })
    await dismissModals(page)
    await shot(page, 'today')

    // The Edit lesson sheet. Its button is in the card's EXPANDED action row
    // (TodayItemCard.renderLessonActions), so tap the lesson card first.
    const card = page.locator('[aria-label="Edit this lesson"]')
    if ((await card.count()) === 0) {
      // The card's own expand toggle (TodayItemCard: the title button).
      const lesson = page.locator('button.flex-1.text-left').first()
      if ((await lesson.count()) > 0) await lesson.click({ timeout: 5_000 }).catch(() => {})
      await page.waitForTimeout(500)
    }
    const edit = page.locator('[aria-label="Edit this lesson"]').first()
    if ((await edit.count()) > 0) {
      await edit.click()
      await expect(page.getByText('Edit lesson').first()).toBeVisible({ timeout: 15_000 })
      await shot(page, 'edit-lesson')
      await expectNoZoomOnFocus(page, 'edit-lesson')
    } else {
      test.info().annotations.push({ type: 'note', description: 'no lesson card on Today to edit' })
    }
  })

  test('the memory capture sheet', async ({ page }) => {
    // /dashboard?capture=1 opens the memory picker; the Win tile is the one
    // with a text box in it.
    await page.goto('/dashboard?capture=1', { waitUntil: 'domcontentloaded' })
    await expect(page.getByText(/Good morning|Good afternoon|Good evening/i).first()).toBeVisible({
      timeout: 30_000,
    })
    // ?capture=1 opens the picker on mount (dashboard/page.tsx). The Win tile
    // leads to the form with the text box in it; if it is not there, the picker
    // itself is still the surface worth looking at.
    await page.waitForTimeout(1_500)
    const win = page.locator('button').filter({ hasText: /Celebrate a win/i }).first()
    if ((await win.count()) > 0) await win.click({ timeout: 5_000 }).catch(() => {})
    await shot(page, 'capture-sheet')
    await expectNoZoomOnFocus(page, 'capture-sheet')
  })

  test('the schedule builder with a curriculum row expanded', async ({ page }) => {
    // Its per-day count boxes and the lessons-per-day stepper are the narrowest
    // inputs in the app, so they are where a 16px font shows first.
    await page.goto('/dashboard/plan/schedule', { waitUntil: 'domcontentloaded' })
    await expect(page.getByRole('heading', { name: /Your Schedule/i }).first()).toBeVisible({
      timeout: 30_000,
    })
    const expander = page.locator('[aria-expanded="false"]').first()
    if ((await expander.count()) > 0) await expander.click().catch(() => {})
    await shot(page, 'builder')
    await expectNoZoomOnFocus(page, 'builder')
  })

  test('login', async ({ page }) => {
    await page.context().clearCookies()
    await page.goto('/login', { waitUntil: 'domcontentloaded' })
    await expect(page.locator('#login-email')).toBeVisible({ timeout: 20_000 })
    await shot(page, 'login')
    await expectNoZoomOnFocus(page, 'login')
  })

  test('onboarding, the child name step', async ({ page }) => {
    // The shared account is onboarded, so /onboarding redirects to /dashboard.
    // Stub the profile read (onboarded:false) and swallow the writes, the same
    // shape e2e/smoke/onboarding.spec.ts uses, so nothing real is touched.
    await page.route('**/rest/v1/profiles*', (route: Route) =>
      route.request().method() === 'GET'
        ? route.fulfill({
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
          })
        : route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }),
    )
    await page.route('**/api/profile/update', (route: Route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: '{}' }),
    )
    await page.route('**/rest/v1/children*', (route: Route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }),
    )

    await page.goto('/onboarding', { waitUntil: 'domcontentloaded' })
    await expect(page.getByRole('heading', { name: /what.?s your name/i })).toBeVisible({
      timeout: 30_000,
    })
    await page.getByPlaceholder('First name').fill('Playwright')
    await page.getByRole('button', { name: /Continue/ }).click()
    await expect(page.getByRole('heading', { name: /Where are you homeschooling/i })).toBeVisible({
      timeout: 15_000,
    })
    await page.getByRole('button', { name: /Continue/ }).click()
    await expect(page.getByRole('heading', { name: /About your homeschool/i })).toBeVisible({
      timeout: 15_000,
    })
    await page.getByRole('button', { name: 'Just starting' }).click()
    await page.getByRole('button', { name: 'Planning our days' }).click()
    await page.getByRole('button', { name: /Continue/ }).click()
    await expect(page.getByRole('heading', { name: /Add your children/i })).toBeVisible({
      timeout: 15_000,
    })
    await shot(page, 'onboarding-child')
    await expectNoZoomOnFocus(page, 'onboarding-child')
  })
})
