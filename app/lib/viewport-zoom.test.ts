// The root viewport may not ban zoom, and touch text boxes must be 16px.
//
// CC #11 set maximumScale: 1 to stop iOS zooming in on a focused text box. iOS
// ignores it for pinch; Android Chrome and the Android WebView do not, so it
// took pinch-zoom away from Android users with low vision and fixed nothing for
// anyone else. The cause, text boxes under 16px, is fixed in app/globals.css.
// These two guards go together: drop the CSS rule and the iOS zoom comes back,
// re-add maximumScale and Android loses pinch again.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const repo = (p: string) => readFileSync(resolve(import.meta.dirname, '..', '..', p), 'utf8')

test('the viewport export sets width and initial scale, and bans nothing', () => {
  const layout = repo('app/layout.tsx')
  const block = layout.slice(layout.indexOf('export const viewport'))
  const body = block.slice(0, block.indexOf('};') + 2)
  assert.match(body, /width: "device-width"/)
  assert.match(body, /initialScale: 1/)
  assert.ok(!body.includes('maximumScale'), 'maximumScale bans pinch-zoom on Android')
  assert.ok(!body.includes('userScalable'), 'userScalable does the same, harder')
  assert.ok(!body.includes('minimumScale'))
})

test('touch-screen text boxes are 16px, which is what stops the focus zoom', () => {
  const globals = repo('app/globals.css')
  const at = globals.indexOf('@media (pointer: coarse)')
  assert.ok(at > 0, 'the coarse-pointer rule exists')
  const block = globals.slice(at, globals.indexOf('}\n}', at) + 3)
  assert.match(block, /font-size: 16px/)
  assert.ok(block.includes('textarea'))
  assert.ok(block.includes('select'))
  for (const excluded of ['checkbox', 'radio', 'range', 'file']) {
    assert.ok(block.includes(':not([type="' + excluded + '"])'), excluded + ' keeps its own size')
  }
})

test('16px is a floor: an input deliberately set larger keeps its size', () => {
  // The first cut of this used a plain `input.text-lg`, which scores (0,1,1)
  // against the base rule's (0,4,1) because every :not() carries its argument's
  // specificity. The emoji box in the activity setup sheet measured 16px on a
  // phone as a result. The chain has to be repeated, so the test pins it.
  const globals = repo('app/globals.css')
  const at = globals.indexOf('@media (pointer: coarse)')
  const block = globals.slice(at, globals.indexOf('}\n}', at) + 3)
  for (const size of ['text-lg', 'text-xl', 'text-2xl']) {
    assert.ok(
      block.includes(`input.${size}:not([type="checkbox"]):not([type="radio"]):not([type="range"]):not([type="file"])`),
      `${size} must out-specify the base rule, not just name the class`,
    )
  }
  assert.match(block, /font-size: 1\.125rem/)
})
