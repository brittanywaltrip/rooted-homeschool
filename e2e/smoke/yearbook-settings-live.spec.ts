/**
 * The real jsonb compare-and-swap on profiles.yearbook_settings, checked
 * against rooted-staging through the signed-in adapter the editor uses
 * (lib/yearbook-settings-save.ts). The browser specs answer settings writes
 * themselves, so this is the one place PostgREST's `eq.<json>` and `is.null`
 * guards meet a real database.
 *
 * WRITES ONLY rooted.e2e's OWN profiles.yearbook_settings, on rooted-staging,
 * and puts back its exact original value afterwards:
 *   - refuses unless the connection target is rooted-staging (ROOTED_ENV and
 *     the project ref read from NEXT_PUBLIC_SUPABASE_URL), so a local run
 *     against production skips without touching anything;
 *   - signs in with the suite's own credentials and asserts the session is the
 *     designated e2e account before the first write;
 *   - restores the original in a finally, re-reads it, and fails loudly with
 *     the original value in the message if the restore cannot be confirmed.
 */
import { test, expect } from '@playwright/test'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'

import { profileSettingsDb, saveSettingKey, sameSettings, type SettingsDb, type SettingsRecord } from '../../lib/yearbook-settings-save'
import { assertIsTestAccount, currentProjectRef } from '../test-account'

const STAGING_REF = 'cvgqovweybggrqakhdtd'

async function signIn(): Promise<{ client: SupabaseClient; userId: string }> {
  const client = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const { data, error } = await client.auth.signInWithPassword({
    email: process.env.PLAYWRIGHT_EMAIL!,
    password: process.env.PLAYWRIGHT_PASSWORD!,
  })
  if (error || !data.user) throw new Error(`sign-in failed: ${error?.message ?? 'no user'}`)
  return { client, userId: data.user.id }
}

/** The raw stored value (SQL NULL → null), read as the signed-in family. */
async function readRaw(client: SupabaseClient, userId: string): Promise<SettingsRecord | null> {
  const { data, error } = await client.from('profiles').select('yearbook_settings').eq('id', userId).single()
  if (error) throw error
  return ((data as { yearbook_settings: SettingsRecord | null }).yearbook_settings) ?? null
}

/** A plain write for test setup and restore only. The app never does this. */
async function setRaw(client: SupabaseClient, userId: string, value: SettingsRecord | null): Promise<void> {
  const { data, error } = await client.from('profiles').update({ yearbook_settings: value }).eq('id', userId).select('id')
  if (error) throw error
  if (!data || data.length !== 1) throw new Error('setup write matched no profile')
}

test.describe('Yearbook settings: live jsonb guard on rooted-staging', () => {
  test.describe.configure({ mode: 'serial' })

  test('null, key order, stale and type guards, and a two-session race, on rooted.e2e only', async () => {
    const onStaging = process.env.ROOTED_ENV === 'staging' && currentProjectRef() === STAGING_REF
    test.skip(!onStaging, `live check runs only on rooted-staging (ref ${currentProjectRef() ?? 'unknown'})`)

    // The fallback that wrote unconditionally is gone, in the adapter and in
    // saveSettingKey, before anything here writes.
    const src = readFileSync(path.resolve(__dirname, '../../lib/yearbook-settings-save.ts'), 'utf8')
    expect(src.includes('db.write('), 'saveSettingKey has no unconditional write').toBe(false)

    const a = await signIn()
    const b = await signIn() // a second session: "another tab"
    assertIsTestAccount(a.userId, 'yearbook settings live check', { projectRef: STAGING_REF })
    expect(b.userId).toBe(a.userId)
    const db = profileSettingsDb(a.client, a.userId)
    const dbB = profileSettingsDb(b.client, b.userId)
    expect(Object.keys(db).sort(), 'the adapter offers guarded writes only').toEqual(['read', 'swap'])

    const original = await readRaw(a.client, a.userId)
    console.log(`[yearbook-settings-live] rooted.e2e original yearbook_settings: ${JSON.stringify(original)}`)

    let restoreError: unknown = null
    try {
      // 1. SQL NULL: the is.null guard.
      await setRaw(a.client, a.userId, null)
      expect(await db.read()).toBeNull()
      expect(await db.swap(null, { theme: 'garden' })).toEqual({ theme: 'garden' })
      expect(await db.swap(null, { theme: 'heirloom' }), 'is.null matches nothing once a value is stored').toBeNull()
      expect(await db.read()).toEqual({ theme: 'garden' })

      // 2. Key order: stored in one order, guarded with the reverse.
      const ordered = { theme: 'garden', show_letter: false, show_books_section: true, show_family_chapter: true }
      expect(await db.swap({ theme: 'garden' }, ordered)).not.toBeNull()
      const reversed = { show_family_chapter: true, show_books_section: true, show_letter: false, theme: 'garden' }
      const swapped = await db.swap(reversed, { ...ordered, theme: 'gallery' })
      expect(swapped, 'eq.<json> matches regardless of key order').not.toBeNull()
      expect(swapped?.theme).toBe('gallery')

      // 3. A stale guard and a type-only difference match nothing and change nothing.
      expect(await db.swap(ordered, { ...ordered, theme: 'heirloom' }), 'stale guard').toBeNull()
      expect(await db.swap({ ...ordered, theme: 'gallery', show_letter: 'false' }, { ...ordered, theme: 'heirloom' }),
        'false and "false" differ').toBeNull()
      expect((await db.read())?.theme).toBe('gallery')

      // 4. saveSettingKey with the other session saving an unrelated key mid-write.
      let interfered = false
      const racing: SettingsDb = {
        read: () => db.read(),
        async swap(expected, next) {
          if (!interfered) {
            interfered = true
            await saveSettingKey(dbB, 'show_books_section', false)
          }
          return db.swap(expected, next)
        },
      }
      const saved = await saveSettingKey(racing, 'theme', 'heirloom')
      const after = await db.read()
      expect(after?.show_books_section, "the other session's choice survives").toBe(false)
      expect(after?.theme).toBe('heirloom')
      expect(saved.theme).toBe('heirloom')
      expect(after?.show_letter, 'unrelated keys kept').toBe(false)
      expect(after?.show_family_chapter).toBe(true)
    } finally {
      try {
        await setRaw(a.client, a.userId, original)
        const back = await readRaw(a.client, a.userId)
        if (!sameSettings(back, original)) {
          throw new Error(`read back ${JSON.stringify(back)}`)
        }
        console.log('[yearbook-settings-live] restored rooted.e2e yearbook_settings to its original value')
      } catch (e) {
        restoreError = e
        console.error(`[yearbook-settings-live] RESTORE FAILED. Put this back by hand: ${JSON.stringify(original)}`, e)
      }
      await a.client.auth.signOut().catch(() => {})
      await b.client.auth.signOut().catch(() => {})
    }
    expect(restoreError, `RESTORE FAILED; original yearbook_settings was ${JSON.stringify(original)}`).toBeNull()
  })
})
