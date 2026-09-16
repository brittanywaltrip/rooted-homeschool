/**
 * The public page a shared resource link opens (/r/<slug or id>), logged out.
 *
 * Read-only. The resource is looked up at run time with the anon key (the same
 * "Public read active resources" access the page itself uses), so the spec does
 * not depend on any one row staying active: it takes the first active resource
 * that links to an outside site.
 */
import { test, expect } from '@playwright/test'

test.use({ storageState: { cookies: [], origins: [] } })

const env = (k: string) => (process.env[k] ?? '').replace(/^"|"$/g, '')

async function activeExternalResourceId(): Promise<string | null> {
  const url = env('NEXT_PUBLIC_SUPABASE_URL')
  const key = env('NEXT_PUBLIC_SUPABASE_ANON_KEY')
  if (!url || !key) return null
  const res = await fetch(
    `${url}/rest/v1/resources?select=id,url&active=eq.true&url=like.http*&order=sort_order.asc&limit=1`,
    { headers: { apikey: key, Authorization: `Bearer ${key}` } },
  )
  if (!res.ok) return null
  const rows = (await res.json()) as { id: string }[]
  return rows[0]?.id ?? null
}

test.describe('Shared resource page, logged out', () => {
  test('/r/<id> shows the printable button and the Start free link', async ({ page }) => {
    const id = await activeExternalResourceId()
    test.skip(!id, 'NEXT_PUBLIC_SUPABASE_URL / ANON_KEY not set, or no active resource')

    const res = await page.goto(`/r/${id}`, { waitUntil: 'domcontentloaded' })
    expect(res?.status()).toBe(200)
    // Not bounced to a sign-in wall.
    expect(new URL(page.url()).pathname).toBe(`/r/${id}`)

    await expect(page.getByRole('heading', { level: 1 })).toBeVisible({ timeout: 15_000 })
    const printable = page.getByRole('link', { name: 'Get the free printable' })
    await expect(printable).toBeVisible()
    await expect(printable).toHaveAttribute('target', '_blank')
    await expect(printable).toHaveAttribute('href', /^https?:\/\//)

    const startFree = page.getByRole('link', { name: 'Start free' })
    await expect(startFree).toBeVisible()
    await expect(startFree).toHaveAttribute('href', `/signup?from=share&r=${id}`)
    await expect(page.getByText('This came from Rooted Homeschool App.')).toBeVisible()
    await expect(page.getByRole('link', { name: 'Open it' })).toHaveAttribute('href', '/dashboard')
  })

  test('an unknown slug is a 404', async ({ page }) => {
    const res = await page.goto('/r/no-such-resource-here', { waitUntil: 'domcontentloaded' })
    expect(res?.status()).toBe(404)
  })
})
