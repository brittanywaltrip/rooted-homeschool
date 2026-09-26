/**
 * Defensive cleanup for overlays when navigating to Today.
 *
 * Before the on-demand catch-up change, the missed-lesson recovery sheet
 * mounted after /dashboard loaded, covered the page and intercepted clicks.
 * A screenshot helper once spent 240 seconds retrying beneath it. Today now
 * opens the sheet only when the family taps its notice. Keep this helper for
 * older deployments and tests that explicitly opened the sheet.
 *
 * Two earlier guesses about this, both written down and both WRONG, corrected
 * here so nobody spends the hour again:
 *   - getByRole is not slow on Today. Measured against staging: getByRole
 *     count 3ms, aria snapshot 5ms, on a 437-node document.
 *   - goto's default `load` wait is not a trap either. It resolves in about a
 *     second; readyState reaches "complete".
 * The overlay was the whole of it.
 *
 * Never issue a click without a timeout: playwright.config.ts sets a global
 * actionTimeout as the backstop.
 */
import { expect, type Page } from '@playwright/test'

/** The recovery sheet, by the id its heading carries. */
const MISSED_LESSON_SHEET = '[role="dialog"][aria-labelledby="missed-recovery-title"]'

/**
 * Close the missed-lesson recovery sheet if one is already open.
 *
 * `waitMs` keeps the old call shape. Returns true when one was closed.
 */
export async function dismissMissedLessonSheet(page: Page, waitMs = 6_000): Promise<boolean> {
  const sheet = page.locator(MISSED_LESSON_SHEET)
  if (!(await sheet.isVisible({ timeout: waitMs }).catch(() => false))) return false
  const close = sheet.locator('button[aria-label="Close"], button:has-text("Close")').first()
  await close.click({ timeout: 10_000 })
  await expect(sheet).toBeHidden({ timeout: 10_000 })
  return true
}

/** True while anything is covering the page and eating taps. */
export async function hasBlockingOverlay(page: Page): Promise<boolean> {
  return page.evaluate(() =>
    [...document.querySelectorAll('body *')].some((el) => {
      const cs = getComputedStyle(el)
      if (cs.position !== 'fixed' || cs.pointerEvents === 'none') return false
      const r = el.getBoundingClientRect()
      // Full-bleed and above the app chrome: the recovery sheet's scrim shape.
      return r.width >= window.innerWidth * 0.98 && r.height >= window.innerHeight * 0.9 && Number(cs.zIndex) >= 50
    }),
  )
}

/**
 * Open /dashboard (or another app path) and hand back a page nothing is
 * covering: navigate, wait for the greeting, close an already-open sheet and
 * assert no scrim is left. Every spec that taps Today can start here.
 */
export async function gotoAppPage(
  page: Page,
  path: string,
  opts: { expectGreeting?: boolean } = {},
): Promise<void> {
  // domcontentloaded, not because `load` hangs (it does not) but because the
  // assertions below are the real readiness signal and there is no reason to
  // wait on subresources first.
  await page.goto(path, { waitUntil: 'domcontentloaded' })
  if (opts.expectGreeting !== false && /\/dashboard(\?|$)/.test(path)) {
    await expect(page.getByText(/Good morning|Good afternoon|Good evening/i).first()).toBeVisible({
      timeout: 30_000,
    })
  }
  await dismissMissedLessonSheet(page)
  expect(
    await hasBlockingOverlay(page),
    'an overlay is still covering the page; every click from here would retry until the test budget ran out',
  ).toBe(false)
}
