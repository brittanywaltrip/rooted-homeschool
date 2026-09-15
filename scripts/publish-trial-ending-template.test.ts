// The trial-ending copy, and every number in it, checked against the code.
//
// The email tells a mom what she loses on day 31. If a limit moves and the copy
// does not, the email lies to her. So each number is asserted against the thing
// that enforces it, and this test fails before the email can be wrong.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { TRIAL_DAYS } from '../lib/user-access.ts'
import {
  trialEndingHtml,
  trialEndingText,
  TRIAL_ENDING_BEFORE_BUTTON,
  TRIAL_ENDING_AFTER_BUTTON,
  TRIAL_ENDING_BUTTON,
  TRIAL_ENDING_SUBJECT,
  TRIAL_ENDING_VARIABLES,
} from './publish-trial-ending-template.ts'

const repo = (p: string) => readFileSync(resolve(import.meta.dirname, '..', p), 'utf8')

const APPROVED = [
  'Hi {{{firstName}}},',
  "You've had all of Rooted+ for the last few weeks, and it ends on {{{endDate}}}. Here is what that means, plainly.",
  "What stays: your plan, every lesson you've checked off, {{{who}}}'s garden, and every memory you've captured. Nothing is deleted. Today, Plan, and lesson logging keep working exactly as they do now.",
  'What changes on the free plan: the Memories page shows the last 30 days, photos are capped at 50, the yearbook shows the first four spreads, and transcripts, PDF reports, and family sharing are set aside until you upgrade. Everything older stays saved and comes back the moment you do.',
  'If Rooted has earned a spot in your school year, Rooted+ is $9.99 a month or $59 a year.',
  "If not, no hard feelings, and you don't need to do anything. If something got in the way, reply and tell me; I read every one.",
]

test('copy: the approved paragraphs, in order, in the html and the text', () => {
  assert.deepEqual([...TRIAL_ENDING_BEFORE_BUTTON, ...TRIAL_ENDING_AFTER_BUTTON], APPROVED)
  const html = trialEndingHtml()
  const text = trialEndingText()
  let at = -1
  for (const para of APPROVED) {
    const i = html.indexOf(`<p>${para}</p>`)
    assert.ok(i > at, `html carries "${para.slice(0, 32)}" in order`)
    at = i
    assert.ok(text.includes(para))
  }
  assert.ok(html.includes(`>${TRIAL_ENDING_BUTTON}</a>`) && html.includes('href="{{{upgradeUrl}}}"'))
  assert.ok(html.includes('Brittany<br /><span style="color:#7a6f65;">Rooted Homeschool</span>'))
  assert.ok(html.includes('732 S 6th Street, STE N, Las Vegas, NV 89101'))
  assert.ok(html.includes('https://rootedhomeschoolapp.com/unsubscribe?email={{{email}}}'))
  assert.equal(TRIAL_ENDING_SUBJECT, 'Your Rooted+ trial ends {{{endDate}}}')
})

test('copy: no em dashes, and every variable used is declared', () => {
  assert.ok(!trialEndingHtml().includes('—') && !trialEndingText().includes('—'))
  const used = new Set([...(trialEndingHtml() + trialEndingText() + TRIAL_ENDING_SUBJECT).matchAll(/\{\{\{(\w+)\}\}\}/g)].map((m) => m[1]))
  assert.deepEqual([...used].sort(), TRIAL_ENDING_VARIABLES.map((v) => v.key).sort())
})

test('numbers: every figure in the copy is the one the code enforces', () => {
  const body = trialEndingText()

  // 30: the trial length, and the Memories window the free plan falls back to.
  assert.equal(TRIAL_DAYS, 30)
  assert.match(body, /the Memories page shows the last 30 days/)
  const memories = repo('app/dashboard/memories/page.tsx')
  assert.match(memories, /d\.setDate\(d\.getDate\(\) - 30\)/, 'the free Memories window is 30 days')

  // 50: the free photo cap.
  const integrity = repo('app/lib/integrity-checks.ts')
  const photoCap = integrity.match(/FREE_PHOTO_LIMIT = (\d+)/)?.[1]
  assert.equal(photoCap, '50')
  assert.match(body, /photos are capped at 50/)

  // 4: the free yearbook spreads.
  const yearbook = repo('app/dashboard/memories/yearbook/read/page.tsx')
  const spreads = yearbook.match(/FREE_SPREAD_LIMIT = (\d+)/)?.[1]
  assert.equal(spreads, '4')
  assert.match(body, /the yearbook shows the first four spreads/)

  // The prices on the upgrade page.
  const upgrade = repo('app/upgrade/page.tsx')
  assert.ok(upgrade.includes('$9.99'), 'monthly price on the upgrade page')
  assert.ok(upgrade.includes('$59'), 'annual price on the upgrade page')
  assert.match(body, /\$9\.99 a month or \$59 a year/)

  // What the free plan actually loses, per lib/user-access.ts.
  const access = repo('lib/user-access.ts')
  for (const fn of ['canExport', 'canShareFamily', 'canUploadUnlimitedPhotos']) {
    assert.match(access, new RegExp(`export function ${fn}[\\s\\S]*?getUserAccess\\(profile\\) !== 'free'`))
  }
  assert.match(body, /transcripts, PDF reports, and family sharing are set aside/)
})
