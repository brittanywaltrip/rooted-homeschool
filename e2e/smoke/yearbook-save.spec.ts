/**
 * Yearbook editor saves: "Saved" only after a confirmed write.
 *
 * The editor used to ignore the result of every yearbook_content upsert, so a
 * refused write still showed "✓ Saved", two writes for one field could land in
 * either order, leaving the page dropped text still waiting on its debounce,
 * and "Save all changes" reported success no matter what. lib/save-queue.ts is
 * the rule now; lib/save-queue.test.ts pins it in isolation. This spec drives
 * the real page.
 *
 * WRITES NOTHING. Every write the editor makes (yearbook_content,
 * monthly_reflections, memories, profiles) is answered in the browser by
 * page.route and never reaches Supabase, so there is no fixture to seed and
 * nothing to clean up, and it cannot touch another session's data on the
 * shared e2e account. Reads are real.
 */
import { test, expect, type Page, type Route, type Request } from '@playwright/test'

const EDIT = '/dashboard/memories/yearbook/edit'
const LETTER = 'textarea[placeholder="Dear future us…"]'

type Mode = 'ok' | 'fail' | 'hold'

type Write = { table: string; body: Record<string, unknown>; request: Request; route: Route }

/**
 * Answer every write the editor makes. `mode(write)` decides each one:
 *   ok   → 201 with the row PostgREST would return
 *   fail → 500, the shape of a refused write
 *   hold → left pending until the test calls `release`
 */
async function interceptWrites(page: Page, mode: (w: Write) => Mode = () => 'ok') {
  const writes: Write[] = []
  const held: Write[] = []

  const answer = async (w: Write, m: Exclude<Mode, 'hold'>) => {
    if (m === 'fail') {
      await w.route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({ code: 'XX000', message: 'simulated failure', details: null, hint: null }),
      })
      return
    }
    await w.route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify([w.body]) })
  }

  await page.route(/\/rest\/v1\/(yearbook_content|monthly_reflections|memories|profiles)(\?|$)/, async (route) => {
    const req = route.request()
    if (req.method() === 'GET' || req.method() === 'HEAD') return route.continue()
    const table = new URL(req.url()).pathname.split('/').pop() ?? ''
    let body: Record<string, unknown> = {}
    try {
      const parsed = req.postDataJSON()
      body = Array.isArray(parsed) ? parsed[0] : parsed ?? {}
    } catch { /* PATCH without a body */ }
    const w: Write = { table, body, request: req, route }
    writes.push(w)
    const m = mode(w)
    if (m === 'hold') { held.push(w); return }
    await answer(w, m)
  })

  return {
    writes,
    held,
    /** Writes to yearbook_content for one content_type, in the order sent. */
    contentWrites: (contentType: string) =>
      writes.filter((w) => w.table === 'yearbook_content' && w.body.content_type === contentType),
    release: async (w: Write, m: Exclude<Mode, 'hold'> = 'ok') => {
      held.splice(held.indexOf(w), 1)
      await answer(w, m)
    },
  }
}

async function openEditor(page: Page) {
  await page.goto(EDIT)
  const letter = page.locator(LETTER)
  await expect(letter).toBeVisible({ timeout: 30_000 })
  test.skip(await letter.isDisabled(), 'the e2e account yearbook is closed (read only)')
  return letter
}

test.describe('Yearbook editor saving', () => {
  test('a refused write never shows Saved, keeps the text, and Try again saves it', async ({ page }) => {
    let failing = true
    const net = await interceptWrites(page, (w) =>
      w.table === 'yearbook_content' && w.body.content_type === 'letter_from_home' && failing ? 'fail' : 'ok')
    const letter = await openEditor(page)
    const card = letter.locator('xpath=..')

    const text = `Dear future us, failure check ${Date.now()}`
    await letter.fill(text)

    await expect(card.getByRole('alert')).toContainText("Didn't save", { timeout: 10_000 })
    await expect(card.getByText('✓ Saved')).toHaveCount(0)
    await expect(letter).toHaveValue(text)
    expect(net.contentWrites('letter_from_home').length).toBe(1)

    failing = false
    await card.getByRole('button', { name: 'Try again' }).click()
    await expect(card.getByText('✓ Saved')).toBeVisible({ timeout: 10_000 })
    const writes = net.contentWrites('letter_from_home')
    expect(writes.length).toBe(2)
    expect(writes[1].body.content).toBe(text)
    await expect(letter).toHaveValue(text)
  })

  test('rapid edits: one write in flight per field, and the newest text is written last', async ({ page }) => {
    const net = await interceptWrites(page, (w) =>
      w.table === 'yearbook_content' && w.body.content_type === 'letter_from_home' ? 'hold' : 'ok')
    const letter = await openEditor(page)
    const card = letter.locator('xpath=..')

    await letter.fill('Dear')
    await expect.poll(() => net.contentWrites('letter_from_home').length, { timeout: 10_000 }).toBe(1)

    // Keep typing while "Dear" is still on the wire, past the debounce.
    await letter.fill('Dear future us')
    await page.waitForTimeout(1_500)
    expect(net.contentWrites('letter_from_home').length, 'the newer text waits for the older write').toBe(1)
    await expect(card.getByText('✓ Saved')).toHaveCount(0)

    await net.release(net.held[0])
    await expect.poll(() => net.contentWrites('letter_from_home').length, { timeout: 10_000 }).toBe(2)
    await expect(card.getByText('✓ Saved'), 'the older confirmation is not shown for the newer text').toHaveCount(0)

    const [first, second] = net.contentWrites('letter_from_home')
    expect(first.body.content).toBe('Dear')
    expect(second.body.content).toBe('Dear future us')
    await net.release(net.held[0])
    await expect(card.getByText('✓ Saved')).toBeVisible({ timeout: 10_000 })
  })

  test('leaving by a link writes text still waiting on its debounce before navigating', async ({ page }) => {
    const net = await interceptWrites(page)
    const letter = await openEditor(page)

    const text = `Typed and left at once ${Date.now()}`
    await letter.fill(text)
    // Well inside the 800ms debounce.
    await page.getByRole('link', { name: /Back to yearbook/ }).click()

    await expect(page).not.toHaveURL(/\/yearbook\/edit/, { timeout: 15_000 })
    const writes = net.contentWrites('letter_from_home')
    expect(writes.length).toBe(1)
    expect(writes[0].body.content).toBe(text)
  })

  test('leaving while a write fails stays on the page with the text and says so', async ({ page }) => {
    await interceptWrites(page, (w) => (w.table === 'yearbook_content' ? 'fail' : 'ok'))
    const letter = await openEditor(page)

    const text = `Do not lose me ${Date.now()}`
    await letter.fill(text)
    await page.getByRole('link', { name: /Back to yearbook/ }).click()

    await expect(page.getByRole('button', { name: 'Leave without saving' })).toBeVisible({ timeout: 10_000 })
    await expect(page).toHaveURL(/\/yearbook\/edit/)
    await expect(letter).toHaveValue(text)
  })

  test('Save all changes reports a failed field and does not open the reader', async ({ page }) => {
    const net = await interceptWrites(page, (w) =>
      w.table === 'yearbook_content' && w.body.content_type === 'family_name' ? 'fail' : 'ok')
    await openEditor(page)

    await page.getByRole('button', { name: 'Save all changes' }).click()
    await expect(page.getByText("1 change didn't save.").first()).toBeVisible({ timeout: 30_000 })
    await page.waitForTimeout(2_000)
    await expect(page).toHaveURL(/\/yearbook\/edit/)
    await expect(page.getByText('All changes saved ✓')).toHaveCount(0)
    expect(net.contentWrites('family_name').length).toBeGreaterThanOrEqual(1)
    expect(net.contentWrites('letter_from_home').length).toBeGreaterThanOrEqual(1)
  })

  test('Save all changes opens the reader only after every write is confirmed', async ({ page }) => {
    const net = await interceptWrites(page)
    await openEditor(page)

    await page.getByRole('button', { name: 'Save all changes' }).click()
    await expect(page.getByText('All changes saved ✓')).toBeVisible({ timeout: 30_000 })
    await expect(page).toHaveURL(/\/yearbook\/read/, { timeout: 15_000 })
    expect(net.contentWrites('family_name').length).toBe(1)
  })

  test('a monthly answer that fails to save says so and keeps the text', async ({ page }) => {
    await interceptWrites(page, (w) => (w.table === 'monthly_reflections' ? 'fail' : 'ok'))
    await openEditor(page)

    const month = page.locator('input[placeholder="In your own words…"]').first()
    const text = `Apples ${Date.now()}`
    await month.fill(text)
    await expect(month.locator('xpath=..').getByRole('alert')).toContainText("Didn't save", { timeout: 10_000 })
    await expect(month).toHaveValue(text)
  })
})
