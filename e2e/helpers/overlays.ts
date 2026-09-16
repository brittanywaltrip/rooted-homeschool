/**
 * Getting past what Today puts on top of itself.
 *
 * WHAT ACTUALLY GOES WRONG. A second or two after /dashboard renders, the
 * missed-lesson recovery sheet (MissedLessonRecoveryModal) mounts with a
 * full-screen `fixed inset-0 bg-black/40` overlay above everything. Any click
 * aimed at the page underneath is then refused with "subtree intercepts
 * pointer events", and Playwright RETRIES a click until its timeout. With no
 * explicit timeout that is the whole test budget: a helper in the screenshots
 * spec sat for 240 seconds this way, and the failure it finally reported was a
 * meaningless "Target page, context or browser has been closed".
 *
 * Two earlier guesses about this, both written down and both WRONG, corrected
 * here so nobody spends the hour again:
 *   - getByRole is not slow on Today. Measured against staging: getByRole
 *     count 3ms, aria snapshot 5ms, on a 437-node document.
 *   - goto's default `load` wait is not a trap either. It resolves in about a
 *     second; readyState reaches "complete".
 * The overlay was the whole of it.
 *
 * So: dismiss the sheet before touching the page, and never issue a click
 * without a timeout. playwright.config.ts sets a global actionTimeout as the
 * backstop for the second half of that.
 */
import { expect, type Page } from '@playwright/test'

/** The recovery sheet, by the id its heading carries. */
const MISSED_LESSON_SHEET = '[role="dialog"][aria-labelledby="missed-recovery-title"]'

/**
 * Close the missed-lesson recovery sheet if this load raised one.
 *
 * `waitMs` is how long to give it to appear: it mounts after the lesson data
 * arrives, so a check that runs the instant the greeting renders can miss it
 * and let the overlay block the next click. Returns true when one was closed.
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
 * covering: navigate, wait for the greeting, dismiss the sheet, and assert no
 * scrim is left. Every spec that taps something on Today should start here.
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
