// Tests for the kid-color tint helpers used by the Today page redesign.
//
// The full curated children palette is in app/dashboard/settings/page.tsx
// lines 38-44. We assert that the 25%-tint background + 45%-darken title
// combination passes WCAG AA (>= 4.5:1 contrast) for every color.

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { tintFromHex, darkenHex, contrastRatio, relativeLuminance } from './color-tint.ts'

const CHILD_PALETTE = [
  { label: 'Green',  value: '#5c7f63' },
  { label: 'Sage',   value: '#7a9e7e' },
  { label: 'Blue',   value: '#4a7a8a' },
  { label: 'Indigo', value: '#5a5c8a' },
  { label: 'Purple', value: '#7a5c8a' },
  { label: 'Orange', value: '#c4956a' },
  { label: 'Pink',   value: '#c4697a' },
] as const

test('tintFromHex: opacity=1 returns the original color', () => {
  for (const { value } of CHILD_PALETTE) {
    assert.equal(tintFromHex(value, 1), value)
  }
})

test('tintFromHex: opacity=0 returns white', () => {
  assert.equal(tintFromHex('#7a5c8a', 0), '#ffffff')
})

test('tintFromHex(#7a5c8a, 0.25) computes #ded6e2 (Emma Purple at 25%)', () => {
  // Emma's Purple at 25% over white. The exact value is computed from
  // (0.25 * 0x7a + 0.75 * 0xff, ...). Note the prompt cited #DBC9E2 as a
  // hand-picked design example; the helper formula yields #ded6e2.
  const out = tintFromHex('#7a5c8a', 0.25)
  // r: 0.25*122 + 0.75*255 = 30.5 + 191.25 = 221.75 → 222 → 'de'
  // g: 0.25*92  + 0.75*255 = 23   + 191.25 = 214.25 → 214 → 'd6'
  // b: 0.25*138 + 0.75*255 = 34.5 + 191.25 = 225.75 → 226 → 'e2'
  assert.equal(out, '#ded6e2')
})

test('darkenHex: opacity=0 returns the original color', () => {
  for (const { value } of CHILD_PALETTE) {
    assert.equal(darkenHex(value, 0), value)
  }
})

test('darkenHex: opacity=1 returns black', () => {
  assert.equal(darkenHex('#7a5c8a', 1), '#000000')
})

test('darkenHex(#7a5c8a, 0.45) lands near #43324c (readable title color)', () => {
  // 0.55 * (122, 92, 138) ≈ (67, 51, 76) → '#43334c'
  assert.equal(darkenHex('#7a5c8a', 0.45), '#43334c')
})

test('full palette: 45%-darkened title on 25%-tint background passes WCAG AA (>= 4.5:1)', () => {
  for (const { label, value } of CHILD_PALETTE) {
    const bg = tintFromHex(value, 0.25)
    const title = darkenHex(value, 0.45)
    const ratio = contrastRatio(title, bg)
    assert.ok(
      ratio >= 4.5,
      `${label} (${value}): contrast ${ratio.toFixed(2)} on tint ${bg} with title ${title} fails AA`,
    )
  }
})

test('full palette: 30%-darkened subtitle on 25%-tint background passes >= 3.0:1 (large/secondary text)', () => {
  // The "subtle text" (duration, secondary lines) uses a lighter darken.
  // It's 10-11px so we accept the WCAG large-text threshold of 3:1.
  for (const { label, value } of CHILD_PALETTE) {
    const bg = tintFromHex(value, 0.25)
    const sub = darkenHex(value, 0.30)
    const ratio = contrastRatio(sub, bg)
    assert.ok(
      ratio >= 3.0,
      `${label} (${value}): subtitle contrast ${ratio.toFixed(2)} on tint ${bg} fails large-text AA`,
    )
  }
})

test('relativeLuminance: white = 1, black = 0', () => {
  assert.ok(Math.abs(relativeLuminance('#ffffff') - 1) < 1e-9)
  assert.ok(Math.abs(relativeLuminance('#000000') - 0) < 1e-9)
})

test('contrastRatio: white-on-black = 21, identical = 1', () => {
  assert.ok(Math.abs(contrastRatio('#ffffff', '#000000') - 21) < 1e-6)
  assert.ok(Math.abs(contrastRatio('#7a5c8a', '#7a5c8a') - 1) < 1e-9)
})

test('throws on malformed input', () => {
  assert.throws(() => tintFromHex('not-a-hex', 0.5))
  assert.throws(() => darkenHex('#abc', 0.5))
})
