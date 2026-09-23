/**
 * Stored but not attached: the Quick photo save when Storage keeps the photo
 * and the answer never comes back.
 *
 * Production, 2026-09-11 and 2026-09-22: a photo was written to memory-photos,
 * no response to its upload was logged, and no memory row followed. The retry
 * then wrote a second copy at a new path. lib/photo-pipeline.ts now asks
 * Storage whether the object landed before retrying (PR #95).
 *
 * This reproduces that shape on a real deployment. The upload request is sent
 * to Storage for real (route.fetch), so the object is stored, and then the
 * browser is told the request failed (route.abort), so the page never sees the
 * answer. What a family must get: one memory, one file, and no "Upload failed".
 *
 * Synthetic data only: a generated flat-colour PNG on the e2e account. The
 * teardown removes exactly the memory rows and objects this test created,
 * scoped by the guarded test user id and the paths the test itself saw.
 */
import { test, expect, type Request } from '@playwright/test'
import sharp from 'sharp'

import { adminClient, requireTestUserId } from '../admin'
import { gotoAppPage } from '../helpers/overlays'

const BUCKET = 'memory-photos'

async function syntheticPhoto(): Promise<Buffer> {
  return sharp({ create: { width: 640, height: 480, channels: 3, background: { r: 40, g: 120, b: 90 } } })
    .png()
    .toBuffer()
}

/** `/storage/v1/object/memory-photos/<path>` → `<path>`, for uploads only. */
function uploadPath(url: string): string | null {
  const m = new URL(url).pathname.match(/\/storage\/v1\/object\/memory-photos\/(.+)$/)
  return m ? decodeURIComponent(m[1]) : null
}

test.describe('Photo upload recovery', () => {
  const createdPaths = new Set<string>()
  const createdMemoryIds = new Set<string>()

  test.afterEach(async () => {
    const sb = adminClient()
    if (!sb) return
    const uid = await requireTestUserId('photo upload recovery teardown')
    // Only paths this test uploaded, and only inside the test account's folder.
    const own = [...createdPaths].filter((p) => p.startsWith(`${uid}/`))
    if (createdMemoryIds.size > 0) {
      await sb.from('memories').delete().eq('user_id', uid).in('id', [...createdMemoryIds])
    }
    // Also any memory pointing at one of those files, so a test that failed
    // before it read the row back still leaves nothing behind.
    for (const p of own) {
      await sb.from('memories').delete().eq('user_id', uid).like('photo_url', `%${p.split('/').pop()}%`)
    }
    if (own.length > 0) await sb.storage.from(BUCKET).remove(own)
    createdPaths.clear()
    createdMemoryIds.clear()
  })

  test('Storage keeps the photo but the answer is lost: one memory, one file, no failure message', async ({ page }) => {
    const sb = adminClient()
    test.skip(!sb, 'needs SUPABASE_SERVICE_ROLE_KEY to prove what Storage and the memories table hold')
    const uid = await requireTestUserId('photo upload recovery')
    const startedAt = new Date(Date.now() - 5_000).toISOString()

    let uploadPosts = 0
    let storedStatus: number | null = null
    const verifyRequests: string[] = []
    page.on('request', (req: Request) => {
      if (/\/storage\/v1\/object\/info\/memory-photos\//.test(req.url())) verifyRequests.push(req.url())
    })

    await page.route('**/storage/v1/object/memory-photos/**', async (route) => {
      const req = route.request()
      if (req.method() !== 'POST') return route.continue()
      uploadPosts++
      const path = uploadPath(req.url())
      if (path) createdPaths.add(path)
      if (uploadPosts === 1) {
        // Deliver it to Storage for real, then withhold the answer.
        const response = await route.fetch()
        storedStatus = response.status()
        return route.abort('failed')
      }
      return route.continue()
    })

    const failures: string[] = []
    page.on('console', (msg) => {
      if (/Upload failed|upload not confirmed|got no answer/i.test(msg.text())) failures.push(msg.text())
    })

    await gotoAppPage(page, '/dashboard/memories', { expectGreeting: false })
    await expect(page.locator('[data-fab-trigger]')).toBeVisible({ timeout: 20_000 })

    // The Quick photo gallery input lives in the dashboard layout, outside main.
    await page.locator('input[type="file"][multiple][accept="image/*"]').first().setInputFiles({
      name: 'image.jpg',
      mimeType: 'image/png',
      buffer: await syntheticPhoto(),
    })

    const save = page.getByRole('button', { name: 'Save 🌱', exact: true })
    await expect(save).toBeVisible({ timeout: 10_000 })
    await save.click()

    await expect(page.getByText(/Memory saved/)).toBeVisible({ timeout: 60_000 })
    await expect(page.getByText(/Upload failed/i)).toHaveCount(0)

    expect(storedStatus, 'the withheld upload really reached Storage and was stored').toBe(200)
    expect(uploadPosts, 'no second upload: the pipeline verified the first one instead').toBe(1)
    expect(verifyRequests.length, 'the pipeline asked Storage before deciding').toBeGreaterThanOrEqual(1)
    expect(failures, 'no Upload failed warning in the console').toEqual([])

    // What Storage holds: exactly one new object for this save, at the path the
    // page tried to upload. Other specs run in parallel on the same account, so
    // only this test's file name counts (preparePhoto writes image.jpg).
    const { data: objects, error: listErr } = await sb!.storage
      .from(BUCKET)
      .list(uid, { limit: 100, sortBy: { column: 'created_at', order: 'desc' } })
    expect(listErr).toBeNull()
    const fresh = (objects ?? [])
      .filter((o) => (o.created_at ?? '') >= startedAt && o.name.endsWith('-image.jpg'))
      .map((o) => `${uid}/${o.name}`)
    for (const p of fresh) createdPaths.add(p)
    expect(createdPaths.size, 'the page uploaded to exactly one path').toBe(1)
    const storedPath = [...createdPaths][0]
    expect(fresh, 'one file, no duplicate copy').toEqual([storedPath])

    // What the memories table holds: exactly one memory pointing at that file.
    const fileName = storedPath.split('/').pop()!
    const { data: rows, error: rowsErr } = await sb!
      .from('memories')
      .select('id, type, photo_url')
      .eq('user_id', uid)
      .gte('created_at', startedAt)
      .like('photo_url', `%${fileName}%`)
    expect(rowsErr).toBeNull()
    for (const r of rows ?? []) createdMemoryIds.add(r.id as string)
    expect(rows?.length, 'one memory, attached to the stored photo').toBe(1)
    expect(rows![0].type).toBe('photo')

    // And the family sees it: exactly one tile for that file in Memories.
    await gotoAppPage(page, '/dashboard/memories', { expectGreeting: false })
    await expect(page.locator(`img[src*="${encodeURIComponent(fileName)}"]`)).toHaveCount(1, { timeout: 20_000 })
  })
})
