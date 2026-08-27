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

import {
  preparePhoto,
  PhotoReadError,
  MEMORY_MAX_DIMENSION,
  COVER_MAX_DIMENSION,
} from './photo-pipeline.ts'

// Canvas size recorded by the stub below, so a test can read back the target
// preparePhoto actually scaled to.
let lastCanvasSize: { width: number; height: number } | null = null

/**
 * Minimum viable stand-ins for the browser bits preparePhoto uses, so the
 * scale calculation can be tested under plain node. Returns a restore function
 * that puts the globals back, keeping the decode-failure tests above honest.
 */
function stubBrowserImagePipeline(width: number, height: number): () => void {
  const g = globalThis as Record<string, unknown>
  const hadBitmap = 'createImageBitmap' in g
  const hadDocument = 'document' in g
  const priorBitmap = g.createImageBitmap
  const priorDocument = g.document

  g.createImageBitmap = async () => ({ width, height, close: () => {} })
  g.document = {
    createElement: () => ({
      width: 0,
      height: 0,
      getContext: () => ({ drawImage: () => {} }),
      toBlob: function (cb: (blob: Blob) => void) {
        lastCanvasSize = { width: this.width, height: this.height }
        cb(new Blob([new Uint8Array([1])], { type: 'image/jpeg' }))
      },
    }),
  }

  return () => {
    lastCanvasSize = null
    if (hadBitmap) g.createImageBitmap = priorBitmap
    else delete g.createImageBitmap
    if (hadDocument) g.document = priorDocument
    else delete g.document
  }
}

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
  // Since the HEIC fallback widened, this also walks the converter path before
  // giving up, so the timeout covers both the decode and the conversion.
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

test('preparePhoto: a non-HEIC undecodable file keeps the generic message after the widened fallback fails', { timeout: 10000 }, async () => {
  // A generic filename and mime type is exactly what the Android Google Photos
  // picker hands back, so the converter is attempted even though nothing here
  // announces itself as HEIC. When the conversion fails too, the family must
  // see the generic message, not camera-settings advice that does not apply.
  const bytes = new Uint8Array(512)
  for (let i = 0; i < bytes.length; i++) bytes[i] = (i * 91 + 7) % 256
  const file = new File([bytes], 'download', { type: 'application/octet-stream' })

  const err = await rejection(preparePhoto(file))

  assert.ok(err instanceof PhotoReadError, `expected PhotoReadError, got ${String(err)}`)
  assert.match(err.userMessage, /couldn't read that photo/)
  assert.doesNotMatch(err.userMessage, /HEIC/)
})

test('preparePhoto: an undecodable HEIC rejects with the HEIC guidance, not the generic message', { timeout: 40000 }, async () => {
  const file = new File([new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8])], 'IMG_0042.HEIC', { type: 'image/heic' })

  const err = await rejection(preparePhoto(file))

  assert.ok(err instanceof PhotoReadError, `expected PhotoReadError, got ${String(err)}`)
  assert.match(err.userMessage, /HEIC/)
})

// ── Print-resolution caps ───────────────────────────────────────────────────
//
// The two caps exist because Lulu prints at 300 PPI: pixels / 300 = printed
// inches. They are asserted by value because the numbers ARE the contract —
// dropping either one back toward the old 1200px silently reintroduces soft
// prints, and the original file is never kept to re-render from.

test('the two caps are the print budgets the book pages need at 300 PPI', () => {
  assert.equal(MEMORY_MAX_DIMENSION, 2400, 'memory photos must cover an 8in page placement')
  assert.equal(COVER_MAX_DIMENSION, 3000, 'a casewrap front panel is 10in incl. the 0.75in wrap')
  assert.ok(COVER_MAX_DIMENSION > MEMORY_MAX_DIMENSION, 'the cover prints larger than a page photo')
})

test('preparePhoto: an explicitly passed maxDimension is what the canvas is sized to', { timeout: 5000 }, async () => {
  // node --test has no DOM, so the decode and encode steps are stubbed with the
  // smallest fakes preparePhoto actually touches. What is under test is only
  // the scale calculation: the caller's maxDimension, not MEMORY_MAX_DIMENSION,
  // must bound the longest side, and the RETURNED width/height must stay the
  // natural size regardless.
  const NATURAL_WIDTH = 4000
  const NATURAL_HEIGHT = 3000
  const restore = stubBrowserImagePipeline(NATURAL_WIDTH, NATURAL_HEIGHT)

  try {
    const file = new File([new Uint8Array([1, 2, 3, 4])], 'wide.jpg', { type: 'image/jpeg' })

    const cover = await preparePhoto(file, COVER_MAX_DIMENSION)
    assert.deepEqual(lastCanvasSize, { width: 3000, height: 2250 }, 'longest side capped at the passed value')
    assert.equal(cover.width, NATURAL_WIDTH, 'returned width is the natural width, not the capped one')
    assert.equal(cover.height, NATURAL_HEIGHT, 'returned height is the natural height, not the capped one')

    await preparePhoto(file, 800)
    assert.deepEqual(lastCanvasSize, { width: 800, height: 600 }, 'an arbitrary smaller cap is honoured too')

    await preparePhoto(file)
    assert.deepEqual(lastCanvasSize, { width: 2400, height: 1800 }, 'omitting it falls back to MEMORY_MAX_DIMENSION')

    await preparePhoto(file, 99999)
    assert.deepEqual(
      lastCanvasSize,
      { width: NATURAL_WIDTH, height: NATURAL_HEIGHT },
      'a cap above the natural size never upscales',
    )
  } finally {
    restore()
  }
})
