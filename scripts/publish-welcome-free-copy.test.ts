// The welcome email's two corrected sentences, and the numbers in them.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { TRIAL_DAYS } from '../lib/user-access.ts'
import {
  rewriteWelcomeHtml,
  rewriteWelcomeText,
  WELCOME_NEW_ACCESS_SENTENCE,
  WELCOME_NEW_FOOTER,
  WELCOME_OLD_ACCESS_SENTENCE,
  WELCOME_OLD_FOOTER_HTML,
  WELCOME_OLD_FOOTER_TEXT,
} from './publish-welcome-free-copy.ts'

const repo = (p: string) => readFileSync(resolve(import.meta.dirname, '..', p), 'utf8')

test('the rewrite swaps both sentences and leaves everything else alone', () => {
  const html = `<p>Hi there, welcome home.</p><p>${WELCOME_OLD_ACCESS_SENTENCE} Here's the fastest way:</p><p style="x">${WELCOME_OLD_FOOTER_HTML}</p><p>footer</p>`
  const out = rewriteWelcomeHtml(html)
  assert.ok(out.includes(WELCOME_NEW_ACCESS_SENTENCE) && out.includes(WELCOME_NEW_FOOTER))
  assert.ok(!out.includes(WELCOME_OLD_ACCESS_SENTENCE) && !out.includes(WELCOME_OLD_FOOTER_HTML))
  assert.ok(out.includes('<p>Hi there, welcome home.</p>') && out.includes("Here's the fastest way:") && out.includes('<p>footer</p>'))

  const text = `Hi there\n\n${WELCOME_OLD_ACCESS_SENTENCE} Here's what you can do:\n\n${WELCOME_OLD_FOOTER_TEXT}\n\nRooted`
  const outText = rewriteWelcomeText(text)
  assert.ok(outText.includes(WELCOME_NEW_ACCESS_SENTENCE) && outText.includes(WELCOME_NEW_FOOTER))
  assert.ok(outText.includes('https://rootedhomeschoolapp.com/upgrade'), 'the text keeps a tappable upgrade link')
  assert.ok(outText.startsWith('Hi there') && outText.endsWith('Rooted'))
})

test('a body that does not carry the old sentence exactly once is refused, never half-edited', () => {
  assert.throws(() => rewriteWelcomeHtml('<p>nothing to replace</p>'), /not found/)
  assert.throws(
    () => rewriteWelcomeHtml(`<p>${WELCOME_OLD_ACCESS_SENTENCE}</p><p>${WELCOME_OLD_ACCESS_SENTENCE}</p>`),
    /more than once/,
  )
})

test('numbers: the welcome copy matches the code too', () => {
  assert.equal(TRIAL_DAYS, 30)
  assert.match(WELCOME_NEW_ACCESS_SENTENCE, /You have 30 days of Rooted\+/)
  assert.match(WELCOME_NEW_FOOTER, /After your 30 days/)

  const photoCap = repo('app/lib/integrity-checks.ts').match(/FREE_PHOTO_LIMIT = (\d+)/)?.[1]
  assert.equal(photoCap, '50')
  assert.match(WELCOME_NEW_FOOTER, /up to 50 photos/)

  const upgrade = repo('app/upgrade/page.tsx')
  assert.ok(upgrade.includes('$9.99') && upgrade.includes('$59'))
  assert.match(WELCOME_NEW_FOOTER, /\$9\.99 a month or \$59 a year/)

  for (const s of [WELCOME_NEW_ACCESS_SENTENCE, WELCOME_NEW_FOOTER]) {
    assert.ok(!s.includes('—'), 'no em dashes')
  }
})
