// The win-back copy is the approved copy, byte for byte, in both parts.
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { winbackHtml, winbackText, WINBACK_PARAGRAPHS, WINBACK_VARIABLES } from './publish-winback-template.ts'

const APPROVED = [
  'Hi {{{firstName}}},',
  "It's been a couple of weeks since {{{who}}} last checked something off in Rooted. No pressure at all. Homeschool weeks get away from everyone, and your plan is right where you left it.",
  "When you're ready, Today will show what's next and skip over what you missed. Nothing to reset.",
  "If something about Rooted got in the way, reply to this email and tell me. I read every one and I'm the one who fixes it.",
]

test('copy: every approved paragraph, in order, in the html and the text', () => {
  assert.deepEqual([...WINBACK_PARAGRAPHS], APPROVED)
  const html = winbackHtml()
  const text = winbackText()
  let at = -1
  for (const p of APPROVED) {
    const i = html.indexOf(`<p>${p}</p>`)
    assert.ok(i > at, `html carries "${p.slice(0, 30)}" in order`)
    at = i
    assert.ok(text.includes(p))
  }
  assert.ok(html.includes('>Open Rooted</a>') && html.includes('href="{{{dashboardUrl}}}"'))
  assert.ok(html.includes('Brittany<br /><span style="color:#7a6f65;">Rooted Homeschool</span>'))
  assert.ok(html.includes('732 S 6th Street, STE N, Las Vegas, NV 89101'))
  assert.ok(html.includes('https://rootedhomeschoolapp.com/unsubscribe?email={{{email}}}'))
  assert.ok(!html.includes('stopped logging memories'))
})

test('copy: no em dashes, and every variable the copy uses is declared', () => {
  assert.ok(!winbackHtml().includes('—') && !winbackText().includes('—'))
  const used = new Set([...(winbackHtml() + winbackText()).matchAll(/\{\{\{(\w+)\}\}\}/g)].map((m) => m[1]))
  assert.deepEqual([...used].sort(), WINBACK_VARIABLES.map((v) => v.key).sort())
})
