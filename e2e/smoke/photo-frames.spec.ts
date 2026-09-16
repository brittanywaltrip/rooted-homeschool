/**
 * Photo Frames (CC #18): the picker, ?theme=, a frame with no fields, and the
 * real export.
 *
 * Nothing here writes to the database. The page reads the account's children
 * for autofill and that is all; the export is a download, never a Memories save.
 *
 * The photo is made in the test (a solid colour PNG from sharp): the e2e account
 * has no fixture photo, and a flat colour is what makes the pixel checks exact.
 */
import { test, expect, type Page } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import sharp from 'sharp'

import { gotoAppPage } from '../helpers/overlays'

const PATH = '/dashboard/printables/first-day'
const PHOTO_RGB = { r: 230, g: 20, b: 200 }

async function solidPhoto(): Promise<Buffer> {
  return sharp({ create: { width: 900, height: 700, channels: 3, background: PHOTO_RGB } })
    .png()
    .toBuffer()
}

async function openEditor(page: Page, query = ''): Promise<void> {
  await gotoAppPage(page, `${PATH}${query}`, { expectGreeting: false })
  await expect(page.getByRole('heading', { name: 'Photo Frames' }).first()).toBeVisible({ timeout: 20_000 })
}

function frameButton(page: Page, label: string) {
  return page.getByRole('group', { name: 'Frame' }).getByRole('button', { name: label, exact: true })
}

async function addPhoto(page: Page): Promise<void> {
  // Scoped to main: the dashboard layout has its own quick-photo file inputs.
  await page.getByRole('main').locator('input[type="file"]').setInputFiles({
    name: 'solid.png',
    mimeType: 'image/png',
    buffer: await solidPhoto(),
  })
  await expect(page.locator('img[src^="data:"]').first()).toBeVisible({ timeout: 20_000 })
}

test.describe('Photo Frames', () => {
  test('?theme=fall preselects the fall frame and shows no text inputs', async ({ page }) => {
    await openEditor(page, '?theme=fall')
    await expect(frameButton(page, "It's Fall Y'all")).toHaveAttribute('aria-pressed', 'true', { timeout: 10_000 })
    await expect(frameButton(page, 'Eucalyptus')).toHaveAttribute('aria-pressed', 'false')
    await expect(page.locator('img[src="/frames/fall-yall.png"]').last()).toBeVisible()
    // Gone, not disabled: no text box, no grade select, no child picker.
    await expect(page.locator('input[type="text"]')).toHaveCount(0)
    await expect(page.locator('select')).toHaveCount(0)
  })

  test('?theme=fallCamp preselects Fall Camp', async ({ page }) => {
    await openEditor(page, '?theme=fallCamp')
    await expect(frameButton(page, 'Fall Camp')).toHaveAttribute('aria-pressed', 'true', { timeout: 10_000 })
  })

  test('an unknown ?theme= falls back to the default frame, with its inputs', async ({ page }) => {
    await openEditor(page, '?theme=nope')
    await expect(frameButton(page, 'Eucalyptus')).toHaveAttribute('aria-pressed', 'true', { timeout: 10_000 })
    await expect(page.getByText('Goal this year')).toBeVisible()
    await expect(page.locator('input[type="text"]')).toHaveCount(5)
  })

  test('switching frames keeps the photo, its zoom and its position', async ({ page }) => {
    await openEditor(page, '?theme=fall')
    await expect(frameButton(page, "It's Fall Y'all")).toHaveAttribute('aria-pressed', 'true', { timeout: 10_000 })
    await addPhoto(page)
    const zoom = page.getByLabel('Zoom')
    await zoom.fill('2')
    const photo = page.locator('img[src^="data:"]').first()
    const src = await photo.getAttribute('src')

    await frameButton(page, 'Fall Camp').click()
    await expect(frameButton(page, 'Fall Camp')).toHaveAttribute('aria-pressed', 'true')
    await expect(zoom).toHaveValue('2')
    await expect(photo).toHaveAttribute('src', src!)

    await frameButton(page, 'Eucalyptus').click()
    await expect(zoom).toHaveValue('2')
    await expect(page.locator('img[src^="data:"]').first()).toHaveAttribute('src', src!)

    // The pick is remembered for the next visit without a query string.
    await openEditor(page)
    await expect(frameButton(page, 'Eucalyptus')).toHaveAttribute('aria-pressed', 'true', { timeout: 10_000 })
    await frameButton(page, 'Fall Camp').click()
    await openEditor(page)
    await expect(frameButton(page, 'Fall Camp')).toHaveAttribute('aria-pressed', 'true', { timeout: 10_000 })
  })

  test('the fall export is 1374x1145, the photo fills the opening, the corner is not photo', async ({ page }) => {
    await openEditor(page, '?theme=fall')
    await expect(frameButton(page, "It's Fall Y'all")).toHaveAttribute('aria-pressed', 'true', { timeout: 10_000 })
    await addPhoto(page)

    const [download] = await Promise.all([
      page.waitForEvent('download', { timeout: 30_000 }),
      page.getByRole('button', { name: /Download PNG/ }).click(),
    ])
    // No name field on this frame, so the file is just the theme's slug.
    expect(download.suggestedFilename()).toBe('fall.png')
    const buf = await readFile((await download.path())!)

    const { data, info } = await sharp(buf).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
    expect(info.width).toBe(1374)
    expect(info.height).toBe(1145)
    const px = (x: number, y: number) => {
      const i = (y * info.width + x) * info.channels
      return { r: data[i], g: data[i + 1], b: data[i + 2], a: data[i + 3] }
    }
    const isPhoto = (p: { r: number; g: number; b: number; a: number }) =>
      p.a > 240 &&
      Math.abs(p.r - PHOTO_RGB.r) < 24 &&
      Math.abs(p.g - PHOTO_RGB.g) < 24 &&
      Math.abs(p.b - PHOTO_RGB.b) < 24

    // Middle of the measured opening (x 222 to 1156, y 302 to 980).
    const inside = px(687, 640)
    expect(isPhoto(inside), `opening pixel ${JSON.stringify(inside)}`).toBe(true)
    const corner = px(60, 60)
    expect(isPhoto(corner), `corner pixel ${JSON.stringify(corner)}`).toBe(false)

    // The branding line is cream (#f3ead9) on the wood. Count cream pixels in
    // the line's band (baseline y 1045, text about 27px tall, centred) in the
    // export and in the bare frame art: the export must add a clear number.
    const frame = await sharp(resolve(__dirname, '../../public/frames/fall-yall.png'))
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true })
    const creamIn = (buf: Buffer, channels: number, width: number) => {
      let n = 0
      for (let y = 1020; y <= 1050; y++) {
        for (let x = 440; x <= 935; x++) {
          const i = (y * width + x) * channels
          if (Math.abs(buf[i] - 0xf3) < 28 && Math.abs(buf[i + 1] - 0xea) < 28 && Math.abs(buf[i + 2] - 0xd9) < 28) n++
        }
      }
      return n
    }
    const added = creamIn(data, info.channels, info.width) - creamIn(frame.data, frame.info.channels, frame.info.width)
    expect(added, 'cream branding pixels added on the wood').toBeGreaterThan(300)
  })
})
