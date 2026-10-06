/**
 * Yearbook editor choices: theme, section toggles, Feature / Hide, photo order.
 *
 * These used to write without reading the result, the theme and toggles wrote
 * the editor's whole copy of profiles.yearbook_settings (so two controls or two
 * tabs overwrote each other), and reordering fired its writes from inside a
 * React state updater. lib/yearbook-settings-save.ts, lib/yearbook-photo-saves.ts
 * and lib/save-queue.ts are the rules now; their unit tests pin them in
 * isolation. This spec drives the real page.
 *
 * WRITES NOTHING. Every write is answered in the browser by page.route:
 *   - profiles.yearbook_settings is a small in-test "server" that honours the
 *     compare-and-swap filter the editor sends, so the merge rules are
 *     exercised against the real request shape;
 *   - the yearbook's photos are three fake rows served in place of the real
 *     read, with images from a host that never leaves the browser.
 * The profile read reports the yearbook open, so no check skips because the
 * e2e account's yearbook happens to be closed.
 */
import { test, expect, type Page, type Route } from '@playwright/test'

const EDIT = '/dashboard/memories/yearbook/edit'
const FAKE_IMG_HOST = 'https://yearbook-e2e.invalid'
// A 1x1 PNG.
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkqP9fDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64')

const PHOTO_IDS = ['00000000-0000-4000-8000-0000000000a1', '00000000-0000-4000-8000-0000000000a2', '00000000-0000-4000-8000-0000000000a3']
const PHOTOS = PHOTO_IDS.map((id, i) => ({
  id,
  child_id: null,
  date: `2026-09-0${i + 1}`,
  type: 'photo',
  title: `Fake photo ${i + 1}`,
  caption: null,
  photo_url: `${FAKE_IMG_HOST}/p${i + 1}.png`,
  focal_x: null,
  focal_y: null,
  page_order: i,
  created_at: `2026-09-0${i + 1}T12:00:00Z`,
  featured: false,
}))

type Mode = 'ok' | 'fail' | 'hold'
type Settings = Record<string, unknown> | null

type SettingsWrite = { filter: string | null; next: Record<string, unknown>; route: Route }
type MemoryWrite = { id: string; body: Record<string, unknown>; route: Route }

function sameJson(a: unknown, b: unknown): boolean {
  const canon = (v: unknown): unknown =>
    Array.isArray(v) ? v.map(canon)
      : v && typeof v === 'object'
        ? Object.fromEntries(Object.keys(v as object).sort().map((k) => [k, canon((v as Record<string, unknown>)[k])]))
        : v
  return JSON.stringify(canon(a)) === JSON.stringify(canon(b))
}

async function fakeYearbook(
  page: Page,
  opts: {
    settings: Settings
    settingsMode?: (w: SettingsWrite, n: number) => Mode
    /** Runs just before a settings write is judged, to simulate another tab. */
    beforeSettingsWrite?: (n: number, server: { settings: Settings }) => void
    memoryMode?: (w: MemoryWrite) => Mode
  },
) {
  const server = { settings: opts.settings }
  const settingsWrites: SettingsWrite[] = []
  const memoryWrites: MemoryWrite[] = []
  const heldSettings: (() => Promise<void>)[] = []
  const heldMemory: (() => Promise<void>)[] = []

  page.on('dialog', (d) => { void d.accept().catch(() => {}) })

  await page.route(`${FAKE_IMG_HOST}/**`, (route) => route.fulfill({ status: 200, contentType: 'image/png', body: PNG }))

  const judgeSettings = async (w: SettingsWrite, n: number, fail: boolean) => {
    if (fail) {
      await w.route.fulfill({ status: 500, contentType: 'application/json', body: '{"message":"simulated failure"}' })
      return
    }
    opts.beforeSettingsWrite?.(n, server)
    let match = true
    if (w.filter?.startsWith('eq.')) match = sameJson(server.settings, JSON.parse(w.filter.slice(3)))
    else if (w.filter === 'is.null') match = server.settings === null
    if (!match) {
      await w.route.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
      return
    }
    server.settings = w.next
    await w.route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([{ yearbook_settings: server.settings }]) })
  }

  await page.route(/\/rest\/v1\/(profiles|memories|yearbook_content|monthly_reflections)(\?|$)/, async (route) => {
    const req = route.request()
    const url = new URL(req.url())
    const table = url.pathname.split('/').pop()
    const select = url.searchParams.get('select') ?? ''

    if (table === 'profiles' && req.method() === 'GET') {
      if (select.includes('yearbook_closed_at')) {
        // The page's own profile read: real row, yearbook open, settings from the fake server.
        const res = await route.fetch()
        const json = await res.json()
        const adjust = (r: Record<string, unknown>) => ({ ...r, yearbook_closed_at: null, yearbook_settings: server.settings })
        return route.fulfill({ response: res, json: Array.isArray(json) ? json.map(adjust) : adjust(json) })
      }
      if (select === 'yearbook_settings') {
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ yearbook_settings: server.settings }) })
      }
      return route.continue()
    }
    if (table === 'memories' && req.method() === 'GET') {
      if (url.searchParams.get('include_in_book') === 'eq.true' && select.includes('page_order')) {
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(PHOTOS) })
      }
      return route.continue()
    }
    if (req.method() === 'GET' || req.method() === 'HEAD') return route.continue()

    let body: Record<string, unknown> = {}
    try {
      const parsed = req.postDataJSON()
      body = Array.isArray(parsed) ? parsed[0] : parsed ?? {}
    } catch { /* no body */ }

    if (table === 'profiles' && 'yearbook_settings' in body) {
      const w: SettingsWrite = { filter: url.searchParams.get('yearbook_settings'), next: body.yearbook_settings as Record<string, unknown>, route }
      settingsWrites.push(w)
      const n = settingsWrites.length
      const m = opts.settingsMode?.(w, n) ?? 'ok'
      if (m === 'hold') { heldSettings.push(() => judgeSettings(w, n, false)); return }
      return judgeSettings(w, n, m === 'fail')
    }
    if (table === 'memories') {
      const w: MemoryWrite = { id: (url.searchParams.get('id') ?? '').replace(/^eq\./, ''), body, route }
      memoryWrites.push(w)
      const answer = async (fail: boolean) => fail
        ? route.fulfill({ status: 500, contentType: 'application/json', body: '{"message":"simulated failure"}' })
        : route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([{ id: w.id }]) })
      const m = opts.memoryMode?.(w) ?? 'ok'
      if (m === 'hold') { heldMemory.push(() => answer(false)); return }
      return answer(m === 'fail')
    }
    // Any other write (yearbook_opened_at, content): answered, never sent.
    return route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify([body]) })
  })

  return {
    server,
    settingsWrites,
    memoryWrites,
    releaseSettings: async () => { const f = heldSettings.shift(); await f?.() },
    releaseAllMemory: async () => { while (heldMemory.length) await heldMemory.shift()!() },
    heldMemoryCount: () => heldMemory.length,
  }
}

async function openEditor(page: Page) {
  await page.goto(EDIT)
  const theme = page.getByRole('button', { name: /Heirloom/ })
  await expect(theme).toBeVisible({ timeout: 30_000 })
  await expect(theme, 'the editor must be editable; every check below runs, none skips').toBeEnabled()
}

const themeCard = (page: Page) => page.locator('div.bg-white').filter({ hasText: 'A look for your whole yearbook' })
const sectionToggle = (page: Page, label: string) => page.getByRole('button', { name: new RegExp(label) })
const sectionRow = (page: Page, label: string) => sectionToggle(page, label).locator('xpath=..')
const tile = (page: Page, id: string) => page.locator(`[data-photo-id="${id}"]`)

async function drag(page: Page, fromId: string, toId: string) {
  const a = await tile(page, fromId).boundingBox()
  const b = await tile(page, toId).boundingBox()
  if (!a || !b) throw new Error('photo tile not laid out')
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2)
  await page.mouse.down()
  await page.mouse.move(a.x + a.width / 2 + 12, a.y + a.height / 2, { steps: 4 })
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 12 })
  await page.mouse.up()
}

async function tileOrder(page: Page): Promise<string[]> {
  return page.locator('[data-photo-id]').evaluateAll((els) => els.map((e) => e.getAttribute('data-photo-id') ?? ''))
}

test.describe('Yearbook editor choices', () => {
  test('a theme that fails to save keeps the chosen theme, says so, and Try again saves only the theme', async ({ page }) => {
    const net = await fakeYearbook(page, { settings: { theme: 'garden', show_letter: false }, settingsMode: (_w, n) => (n === 1 ? 'fail' : 'ok') })
    await openEditor(page)

    await page.getByRole('button', { name: /Heirloom/ }).click()
    const card = themeCard(page)
    await expect(card.getByRole('alert')).toContainText("Didn't save", { timeout: 10_000 })
    await expect(card.getByText('✓ Saved')).toHaveCount(0)
    await expect(page.getByRole('button', { name: /Heirloom/ }), 'her choice stays selected').toContainText('✓')
    expect(net.server.settings).toEqual({ theme: 'garden', show_letter: false })

    await card.getByRole('button', { name: 'Try again' }).click()
    await expect(card.getByText('✓ Saved')).toBeVisible({ timeout: 10_000 })
    expect(net.server.settings, 'only the theme changed; the letter stays off').toEqual({ theme: 'heirloom', show_letter: false })
    await expect(sectionToggle(page, 'Letter from home')).toHaveAttribute('aria-pressed', 'false')
  })

  test('rapid section toggles: one write in flight, and the last choice is what is stored', async ({ page }) => {
    const net = await fakeYearbook(page, { settings: {}, settingsMode: (_w, n) => (n === 1 ? 'hold' : 'ok') })
    await openEditor(page)
    const letter = sectionToggle(page, 'Letter from home')
    await expect(letter).toHaveAttribute('aria-pressed', 'true')

    await letter.click() // off
    await expect.poll(() => net.settingsWrites.length, { timeout: 10_000 }).toBe(1)
    expect(net.settingsWrites[0].next).toEqual({ show_letter: false })

    // While "off" is held on the wire: on, off, on.
    await letter.click()
    await letter.click()
    await letter.click()
    await expect(letter).toHaveAttribute('aria-pressed', 'true')
    await page.waitForTimeout(1_000)
    expect(net.settingsWrites.length, 'the next write waits for the held one').toBe(1)

    await net.releaseSettings()
    await expect.poll(() => net.settingsWrites.length, { timeout: 10_000 }).toBe(2)
    await expect(sectionRow(page, 'Letter from home').getByText('✓ Saved')).toBeVisible({ timeout: 10_000 })
    expect(net.settingsWrites[1].next).toEqual({ show_letter: true })
    expect(net.server.settings).toEqual({ show_letter: true })
    await expect(letter).toHaveAttribute('aria-pressed', 'true')
  })

  test('two tabs: settings another tab saved, even mid-write, are kept and shown', async ({ page }) => {
    const net = await fakeYearbook(page, {
      settings: { theme: 'garden', show_books_section: true },
      beforeSettingsWrite: (n, server) => {
        // The other tab turns the family chapter off just as this write arrives.
        if (n === 1) server.settings = { ...(server.settings ?? {}), show_family_chapter: false }
      },
    })
    await openEditor(page)
    // Meanwhile the other tab had already turned the books section off.
    net.server.settings = { ...(net.server.settings ?? {}), show_books_section: false }

    await page.getByRole('button', { name: /The Gallery/ }).click()
    await expect(themeCard(page).getByText('✓ Saved')).toBeVisible({ timeout: 10_000 })

    expect(net.server.settings).toEqual({ theme: 'gallery', show_books_section: false, show_family_chapter: false })
    expect(net.settingsWrites.length, 'the first conditional write lost the race and was redone').toBe(2)
    expect(net.settingsWrites[0].filter?.startsWith('eq.')).toBe(true)
    // The editor now shows what is confirmed, including the other tab's choices.
    await expect(sectionToggle(page, 'Books sections')).toHaveAttribute('aria-pressed', 'false')
    await expect(sectionToggle(page, 'Our family chapter')).toHaveAttribute('aria-pressed', 'false')
  })

  test('Feature: a failed save keeps the choice in Photo options and Try again saves it', async ({ page }) => {
    let failFeature = true
    const net = await fakeYearbook(page, {
      settings: {},
      memoryMode: (w) => ('featured' in w.body && failFeature ? 'fail' : 'ok'),
    })
    await openEditor(page)

    await tile(page, PHOTO_IDS[0]).click()
    const feature = page.getByRole('button', { name: /Feature: its own full page/ })
    await feature.click()
    const modal = feature.locator('xpath=..')
    await expect(modal.getByRole('alert')).toContainText("Didn't save", { timeout: 10_000 })
    await expect(feature, 'her choice stays on').toContainText('On')

    failFeature = false
    await modal.getByRole('button', { name: 'Try again' }).click()
    await expect(modal.getByText('✓ Saved')).toBeVisible({ timeout: 10_000 })
    const writes = net.memoryWrites.filter((w) => 'featured' in w.body)
    expect(writes.length).toBe(2)
    expect(writes[1]).toMatchObject({ id: PHOTO_IDS[0], body: { featured: true } })
  })

  test('Hide: rapid taps become one write of the final choice', async ({ page }) => {
    const net = await fakeYearbook(page, { settings: {} })
    await openEditor(page)

    await tile(page, PHOTO_IDS[1]).click()
    const hide = page.getByRole('button', { name: /Hide from book|Hidden from book/ })
    await hide.click() // hidden
    await hide.click() // visible again
    await hide.click() // hidden
    await expect(hide).toContainText('Hidden')
    await expect(hide.locator('xpath=..').getByText('✓ Saved')).toBeVisible({ timeout: 10_000 })
    const writes = net.memoryWrites.filter((w) => 'include_in_book' in w.body)
    expect(writes.length).toBe(1)
    expect(writes[0]).toMatchObject({ id: PHOTO_IDS[1], body: { include_in_book: false } })
  })

  test('photo order: a failed row keeps her order on screen, and Try again rewrites the whole chapter', async ({ page }) => {
    let failOnce = true
    const net = await fakeYearbook(page, {
      settings: {},
      memoryMode: (w) => {
        if ('page_order' in w.body && w.id === PHOTO_IDS[1] && failOnce) { failOnce = false; return 'fail' }
        return 'ok'
      },
    })
    await openEditor(page)
    expect(await tileOrder(page)).toEqual(PHOTO_IDS)

    await drag(page, PHOTO_IDS[0], PHOTO_IDS[2])
    const expected = [PHOTO_IDS[1], PHOTO_IDS[2], PHOTO_IDS[0]]
    await expect.poll(() => tileOrder(page)).toEqual(expected)
    const group = page.locator('div').filter({ has: page.locator(`[data-photo-id="${PHOTO_IDS[0]}"]`) }).filter({ hasText: 'Family' }).last()
    await expect(group.getByRole('alert')).toContainText("Didn't save", { timeout: 10_000 })
    expect(await tileOrder(page), 'her order stays on screen').toEqual(expected)

    await group.getByRole('button', { name: 'Try again' }).click()
    await expect(group.getByText('✓ Saved')).toBeVisible({ timeout: 10_000 })
    const last = net.memoryWrites.filter((w) => 'page_order' in w.body).slice(-3)
    expect(Object.fromEntries(last.map((w) => [w.id, w.body.page_order]))).toEqual({
      [PHOTO_IDS[1]]: 0, [PHOTO_IDS[2]]: 1, [PHOTO_IDS[0]]: 2,
    })
  })

  test('photo order: a second drag while the first is saving is written after it, and its order wins', async ({ page }) => {
    let hold = true
    const net = await fakeYearbook(page, { settings: {}, memoryMode: (w) => ('page_order' in w.body && hold ? 'hold' : 'ok') })
    await openEditor(page)

    await drag(page, PHOTO_IDS[0], PHOTO_IDS[2]) // a2, a3, a1
    await expect.poll(() => net.heldMemoryCount(), { timeout: 10_000 }).toBe(3)
    await drag(page, PHOTO_IDS[1], PHOTO_IDS[0]) // a3, a1, a2
    const final = [PHOTO_IDS[2], PHOTO_IDS[0], PHOTO_IDS[1]]
    await expect.poll(() => tileOrder(page)).toEqual(final)
    await page.waitForTimeout(1_000)
    expect(net.memoryWrites.filter((w) => 'page_order' in w.body).length, 'the newer order waits for the older writes').toBe(3)

    hold = false
    await net.releaseAllMemory()
    await expect.poll(() => net.memoryWrites.filter((w) => 'page_order' in w.body).length, { timeout: 10_000 }).toBe(6)
    const last = net.memoryWrites.filter((w) => 'page_order' in w.body).slice(-3)
    expect(Object.fromEntries(last.map((w) => [w.id, w.body.page_order]))).toEqual({
      [PHOTO_IDS[2]]: 0, [PHOTO_IDS[0]]: 1, [PHOTO_IDS[1]]: 2,
    })
  })

  test('the reader does not open over a setting that did not save', async ({ page }) => {
    await fakeYearbook(page, { settings: { theme: 'garden' }, settingsMode: () => 'fail' })
    await openEditor(page)

    await page.getByRole('button', { name: /Heirloom/ }).click()
    await expect(themeCard(page).getByRole('alert')).toContainText("Didn't save", { timeout: 10_000 })
    await page.getByRole('link', { name: /Back to yearbook/ }).click()
    await expect(page.getByRole('button', { name: 'Leave without saving' })).toBeVisible({ timeout: 10_000 })
    await expect(page).toHaveURL(/\/yearbook\/edit/)
  })
})
