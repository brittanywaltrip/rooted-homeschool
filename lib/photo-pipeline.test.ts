// Regression tests for the "Saving..." spinner that never stopped.
//
// A real family on Android Chrome picked a cloud-only Google Photos image, the
// picker handed back a zero-byte file, and the old compressImage() returned a
// promise that could only ever resolve. Nothing uploaded, nothing was logged,
// and the spinner ran until the tab was closed.
//
// Every test here sets a hard node:test timeout, so a regression to the
// hanging behaviour FAILS the suite instead of stalling it. These run under
// plain node with no DOM, so the createImageBitmap / new Image() decode path
// is unavailable, which is exactly the "browser cannot decode this" case.

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { preparePhoto, PhotoReadError } from './photo-pipeline.ts'

async function rejection(promise: Promise<unknown>): Promise<unknown> {
  return promise.then(
    () => { throw new Error('expected preparePhoto to reject, it resolved') },
    (err) => err,
  )
}

test('preparePhoto: a zero-byte file rejects with PhotoReadError in well under a second', { timeout: 1000 }, async () => {
  const started = Date.now()
  const err = await rejection(preparePhoto(new File([], 'cloud-only.jpg', { type: 'image/jpeg' })))

  assert.ok(err instanceof PhotoReadError, `expected PhotoReadError, got ${String(err)}`)
  assert.match(err.userMessage, /didn't come through/)
  assert.match(err.userMessage, /Google Photos or iCloud/)
  assert.ok(Date.now() - started < 1000, 'zero-byte rejection must be immediate, not timeout-driven')
})

test('preparePhoto: an undecodable file rejects with PhotoReadError rather than hanging', { timeout: 5000 }, async () => {
  const garbage = new Uint8Array(1024)
  for (let i = 0; i < garbage.length; i++) garbage[i] = (i * 37 + 11) % 256
  const file = new File([garbage], 'not-really-a-photo.jpg', { type: 'image/jpeg' })

  const err = await rejection(preparePhoto(file))

  assert.ok(err instanceof PhotoReadError, `expected PhotoReadError, got ${String(err)}`)
  assert.match(err.userMessage, /couldn't read that photo/)
})

test('preparePhoto: a file over the 50MB cap rejects with the size message', { timeout: 5000 }, async () => {
  // Sparse-ish: one real chunk repeated is enough to clear the byte cap.
  const chunk = new Uint8Array(1024 * 1024)
  const parts = Array.from({ length: 51 }, () => chunk)
  const file = new File(parts, 'huge.jpg', { type: 'image/jpeg' })

  const err = await rejection(preparePhoto(file))

  assert.ok(err instanceof PhotoReadError, `expected PhotoReadError, got ${String(err)}`)
  assert.match(err.userMessage, /too large to upload/)
})

test('preparePhoto: an undecodable HEIC rejects with the HEIC guidance, not the generic message', { timeout: 40000 }, async () => {
  const file = new File([new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8])], 'IMG_0042.HEIC', { type: 'image/heic' })

  const err = await rejection(preparePhoto(file))

  assert.ok(err instanceof PhotoReadError, `expected PhotoReadError, got ${String(err)}`)
  assert.match(err.userMessage, /HEIC/)
})
