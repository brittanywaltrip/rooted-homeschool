// The Monday email's copy, both versions, word for word, and the proof that an
// empty memoriesLine leaves nothing behind.

import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  renderTemplate,
  weeklyFullHtml,
  weeklyFullText,
  weeklyQuietHtml,
  weeklyQuietText,
  WEEKLY_BUTTON,
  WEEKLY_FULL_BODY,
  WEEKLY_FULL_VARIABLES,
  WEEKLY_QUIET_BODY,
  WEEKLY_QUIET_SUBJECT,
  WEEKLY_QUIET_VARIABLES,
} from './publish-weekly-summary-templates.ts'

test('full: the approved body, in order, with the button and the signature', () => {
  assert.deepEqual([...WEEKLY_FULL_BODY], ['Hi {{{firstName}}},', '{{{lessonsLine}}}{{{memoriesLine}}}', '{{{gardenLine}}}'])
  const html = weeklyFullHtml()
  let at = -1
  for (const para of WEEKLY_FULL_BODY) {
    const i = html.indexOf(`<p>${para}</p>`)
    assert.ok(i > at, `html carries ${para} in order`)
    at = i
  }
  assert.ok(html.includes(`>${WEEKLY_BUTTON}</a>`) && html.includes('href="{{{todayUrl}}}"'))
  assert.ok(html.includes('Brittany<br /><span style="color:#7a6f65;">Rooted Homeschool</span>'))
  assert.ok(html.includes('732 S 6th Street, STE N, Las Vegas, NV 89101'))
  assert.ok(html.includes('href="{{{unsubscribeUrl}}}"'))
  assert.ok(weeklyFullText().includes('Open Today: {{{todayUrl}}}'))
})

test('full: the retired copy and the retired variables are gone', () => {
  for (const body of [weeklyFullHtml(), weeklyFullText()]) {
    assert.ok(!body.includes('Every memory you capture'))
    assert.ok(!body.includes("Keep going. You're doing something beautiful."))
    assert.ok(!body.includes('{{{weeklySummary}}}'))
    assert.ok(!body.includes('{{{memoriesUrl}}}'))
  }
})

test('quiet: the approved body, and its own subject', () => {
  assert.deepEqual(
    [...WEEKLY_QUIET_BODY],
    [
      'Hi {{{firstName}}},',
      "Nothing was checked off in Rooted last week, and that's fine. Your plan is right where you left it, and Today will show what's next without making you catch up.",
      '{{{gardenLine}}}',
    ],
  )
  assert.equal(WEEKLY_QUIET_SUBJECT, 'A quiet week is still a week')
  const html = weeklyQuietHtml()
  for (const para of WEEKLY_QUIET_BODY) assert.ok(html.includes(`<p>${para}</p>`))
  assert.ok(!html.includes('{{{lessonsLine}}}') && !html.includes('{{{memoriesLine}}}'))
  assert.ok(weeklyQuietText().includes('Open Today: {{{todayUrl}}}'))
})

test('no em dashes, and every variable used is declared', () => {
  for (const [body, vars] of [
    [weeklyFullHtml() + weeklyFullText(), WEEKLY_FULL_VARIABLES],
    [weeklyQuietHtml() + weeklyQuietText(), WEEKLY_QUIET_VARIABLES],
  ] as const) {
    assert.ok(!body.includes('—'), 'no em dashes')
    const used = new Set([...body.matchAll(/\{\{\{(\w+)\}\}\}/g)].map((m) => m[1]))
    assert.deepEqual([...used].sort(), vars.map((v) => v.key).sort())
  }
})

test('a family with no memories gets no stray space and no empty line', () => {
  const filled = {
    firstName: 'Sam',
    lessonsLine: 'Last week Zoe finished 9 lessons.',
    memoriesLine: ' You captured 2 photos.',
    gardenLine: "Zoe's tree is Growing, 4 leaves from Young Tree.",
    todayUrl: 'https://rootedhomeschoolapp.com/dashboard',
    unsubscribeUrl: 'https://example.com/u',
  }
  const withMemories = renderTemplate(weeklyFullHtml(), filled)
  assert.ok(withMemories.includes('<p>Last week Zoe finished 9 lessons. You captured 2 photos.</p>'))

  const without = renderTemplate(weeklyFullHtml(), { ...filled, memoriesLine: '' })
  assert.ok(without.includes('<p>Last week Zoe finished 9 lessons.</p>'), 'the paragraph ends at the full stop')
  assert.ok(!/ <\/p>/.test(without), 'no space before a closing tag')
  assert.ok(!/  /.test(without.replace(/\n/g, '')), 'no doubled space anywhere')

  const textWithout = renderTemplate(weeklyFullText(), { ...filled, memoriesLine: '' })
  assert.ok(textWithout.includes('Last week Zoe finished 9 lessons.\n'))
  for (const line of textWithout.split('\n')) {
    assert.equal(line, line.trimEnd(), `line ends clean: ${JSON.stringify(line)}`)
  }
})
