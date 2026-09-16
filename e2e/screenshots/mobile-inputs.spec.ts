/**
 * Phone screenshots of every surface with a text box in it, for eyeballing the
 * 16px input rule (CC #15).
 *
 * NOT part of the gate. The `mobile-screenshots` project is only added to
 * playwright.config.ts when MOBILE_SCREENSHOTS=1, and the gate projects ignore
 * this directory, so no plain `npx playwright test` can pick it up.
 *
 *   MOBILE_SCREENSHOTS=1 SHOT_PREFIX=before npx playwright test --project=mobile-screenshots
 *   MOBILE_SCREENSHOTS=1 SHOT_PREFIX=after  npx playwright test --project=mobile-screenshots
 *
 * Writes e2e/screenshots/out/<prefix>-<surface>.png (gitignored).
 *
 * In the `after` run it also measures the thing the pictures cannot: the
 * computed size of a focused text box. Safari and the Android WebView zoom a
 * focused box under 16px and never zoom back out, which is what
 * `maximumScale: 1` was banning zoom to avoid. With the boxes at 16px the ban
 * is gone and the viewport must still sit at scale 1 after focus.
 *
 * Today covers itself a second after it renders: the missed-lesson recovery
 * sheet mounts a full-screen scrim and blocks every tap until it is closed, so
 * every navigation here goes through gotoAppPage (e2e/helpers/overlays.ts).
 * Two things previously blamed for stalls in this spec were measured and
 * cleared: getByRole is fast on Today (3ms on a 437-node document), and goto's
 * default `load` wait resolves in about a second.
 */
import { test, expect, type Page, type Route } from '@playwright/test'
import { resolve } from 'node:path'

import { gotoAppPage } from '../helpers/overlays'

const PREFIX = process.env.SHOT_PREFIX ?? 'after'
// Absolute: Playwright resolves a relative screenshot path against the working
// directory, so running from e2e/ would write a second out/ tree that
// .gitignore does not cover.
const OUT = resolve(__dirname, 'out')
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
  await page.screenshot({ path: resolve(OUT, `${PREFIX}-${name}.png`), timeout: 30_000 })
}

/**
 * Focus the first text box on the page and measure it.
 *
 * THE FONT SIZE IS THE REAL CHECK. Desktop Chromium's phone emulation does not
 * implement mobile Safari's focus auto-zoom, so visualViewport.scale stays 1
 * here whatever the font size is: that assertion is a canary for a future
 * engine that does emulate it, not proof of anything today. What actually
 * decides whether a real phone zooms is the computed size of the focused box,
 * which is asserted, and asserted only after proving focus really landed on a
 * text box. An unasserted pass is worse than no test.
 */
async function expectNoZoomOnFocus(page: Page, name: string): Promise<void> {
  if (!CHECK_ZOOM) return
  const box = page
    .locator('input:not([type=checkbox]):not([type=radio]):not([type=range]):not([type=file]), textarea, select')
    .first()
  expect(await box.count(), `${name}: expected a text box on this surface`).toBeGreaterThan(0)
  await box.focus()
  await page.waitForTimeout(400)
  const zoom = await page.evaluate(() => ({
    scale: window.visualViewport?.scale ?? 1,
    fontSize: document.activeElement
      ? parseFloat(getComputedStyle(document.activeElement as Element).fontSize)
      : 0,
    tag: document.activeElement?.tagName ?? '',
  }))
  expect(zoom.tag, `${name}: focus must land on the text box, not ${zoom.tag}`).toMatch(
    /INPUT|TEXTAREA|SELECT/,
  )
  expect(zoom.fontSize, `${name}: a focused text box is at least 16px`).toBeGreaterThanOrEqual(16)
  expect(zoom.scale, `${name}: focusing a text box must not zoom the page`).toBe(1)
}

// Serial. Five phone contexts against one staging preview, each loading the
// dashboard or the builder, is enough parallel load to time a test out: the
// pace-control test failed that way once in a five-worker run and passed alone
// in 7.5s. These are screenshots, so wall-clock is not worth a flake.
test.describe.configure({ mode: 'serial' })

test.describe('phone screenshots of every surface with a text box', () => {
  test('today, and the edit lesson sheet', async ({ page }) => {
    await gotoAppPage(page, '/dashboard')
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
    await gotoAppPage(page, '/dashboard/plan/schedule')
    await expect(page.getByRole('heading', { name: /Your Schedule/i }).first()).toBeVisible({
      timeout: 30_000,
    })
    const expander = page.locator('[aria-expanded="false"]').first()
    if ((await expander.count()) > 0) await expander.click({ timeout: 5_000 }).catch(() => {})
    await shot(page, 'builder')
    await expectNoZoomOnFocus(page, 'builder')
  })

  /**
   * The curriculum row's pace control, in its three states (CC #16), including
   * the numeral badge a chip wears when its day differs (squared off in #16b).
   *
   * Nothing is saved: the spec drives the form and screenshots it, and never
   * touches Preview or Save, so the e2e account's stored schedule is untouched.
   *
   * Written to work against BOTH the old row and the new one, so the before and
   * after runs are the same script: the expander link only exists after the
   * change, and the per-day steppers are found by an aria-label that matches
   * either the old short day name or the new spelled-out one.
   */
  test('the curriculum pace control', async ({ page }) => {
    await gotoAppPage(page, '/dashboard/plan/schedule')
    await expect(page.getByRole('heading', { name: /Your Schedule/i }).first()).toBeVisible({
      timeout: 30_000,
    })
    // Scroll the first curriculum row's controls into view. NOT a click on
    // [aria-expanded="false"]: on this page that matches the row's "More
    // actions" kebab first, whose open state drops a full-screen backdrop over
    // everything, which is what made this test fail before.
    //
    // Put the control in frame BY HAND. scrollIntoViewIfNeeded was satisfied
    // while the row sat under the sticky header and the promo banner, and
    // scrollIntoView({ block: 'center' }) did nothing here either, so the
    // collapsed shot kept catching the page header. window.scrollBy off the
    // element's own rect, then an assertion that it really is in frame, so this
    // fails loudly instead of quietly photographing the wrong thing.
    const schoolDays = page.getByText('School days').first()
    await schoolDays.waitFor({ state: 'visible', timeout: 15_000 })
    for (let attempt = 0; attempt < 3; attempt++) {
      const box = await schoolDays.boundingBox()
      if (box && box.y > 60 && box.y < 400) break
      await schoolDays.evaluate((el) => {
        const r = el.getBoundingClientRect()
        window.scrollBy(0, r.top - 140)
      })
      await page.waitForTimeout(500)
    }
    const framed = await schoolDays.boundingBox()
    expect(framed, 'the School days row must be in frame before the shot').not.toBeNull()
    expect(framed!.y, 'the School days row is above the fold in the capture').toBeLessThan(500)

    // (a) every day the same, list collapsed.
    await shot(page, 'badge-same')

    // (b) Wednesday heavier than the rest.
    const openPerDay = page.locator('button', { hasText: /Different on some days\?/i }).first()
    if ((await openPerDay.count()) > 0) await openPerDay.click({ timeout: 5_000 })
    await page.waitForTimeout(400)
    const wedUp = page.locator('[aria-label="One more lesson on Wednesday"], [aria-label="One more lesson on Wed"]').first()
    if ((await wedUp.count()) > 0) await wedUp.click({ timeout: 5_000 })
    await page.waitForTimeout(400)
    await shot(page, 'badge-varies')

    // (c) a day set to 0, which the scheduler honours as "skip this day".
    const tueDown = page.locator('[aria-label="One fewer lesson on Tuesday"], [aria-label="One fewer lesson on Tue"]').first()
    if ((await tueDown.count()) > 0) await tueDown.click({ timeout: 5_000 })
    await page.waitForTimeout(400)
    await shot(page, 'badge-zero')
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
