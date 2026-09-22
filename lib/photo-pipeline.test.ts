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
  uploadMemoryPhoto,
  isRetriableUploadFailure,
  verifyUploadedObject,
  redactUploadMessage,
  UploadFailedError,
  withTimeout,
  PhotoReadError,
  MEMORY_MAX_DIMENSION,
  COVER_MAX_DIMENSION,
  MAX_FILE_BYTES,
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

// ── The size ceiling ────────────────────────────────────────────────────────
//
// On 2026-09-08 one family was refused three times in five minutes at 56MB,
// 65MB and 99MB, all ordinary phone photos, all of which this pipeline would
// have written down to 2400px and stored at well under a megabyte. The cap was
// the FIRST thing a picked file met and it was set at 50MB. It is a ceiling
// now, not a cap on photos: it sits above anything a camera produces and stops
// only what is not a photo at all.

/**
 * A File-shaped stand-in with a declared size and no bytes behind it.
 * preparePhoto reads size, name and type before it reads any data, so the
 * ceiling can be tested at 200MB without allocating 200MB.
 */
function fileOfSize(size: number, name: string, type = 'image/jpeg'): File {
  return { size, name, type } as unknown as File
}

test('preparePhoto: a photo over the old 50MB cap is decoded and downscaled, not refused', { timeout: 5000 }, async () => {
  // 65MB, the middle of the three files production turned away.
  const restore = stubBrowserImagePipeline(8000, 6000)
  try {
    const prepared = await preparePhoto(fileOfSize(65_483_225, 'IMG_4821.jpg'))

    assert.deepEqual(lastCanvasSize, { width: 2400, height: 1800 }, 'written down to the memory cap like any other photo')
    assert.equal(prepared.width, 8000, 'the natural width is still what the row records')
    assert.equal(prepared.height, 6000, 'and the natural height')
  } finally {
    restore()
  }
})

test('preparePhoto: the ceiling sits at 200MB, double the largest real photo seen', () => {
  assert.equal(MAX_FILE_BYTES, 200 * 1024 * 1024)
  assert.ok(MAX_FILE_BYTES > 99_912_016, 'above the 99MB file production refused on 2026-09-08')
})

test('preparePhoto: a file over the ceiling rejects, and says what is actually wrong', { timeout: 5000 }, async () => {
  const err = await rejection(preparePhoto(fileOfSize(MAX_FILE_BYTES + 1, 'clip.mov', 'video/quicktime')))

  assert.ok(err instanceof PhotoReadError, `expected PhotoReadError, got ${String(err)}`)
  assert.match(err.userMessage, /bigger than 200 MB/)
  assert.match(err.userMessage, /video or a RAW camera file/)
  assert.doesNotMatch(err.userMessage, /too large to upload/, 'the old copy was wrong: nothing had been uploaded')
  // The Sentry side of the message keeps its shape, so the issue that caught
  // the September refusals stays comparable across this change.
  assert.match(err.message, /over the \d+ cap/)
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

// ── The timeout helper ──────────────────────────────────────────────────────
//
// Everything slow in this file is raced against a timer. The clearTimeout in
// the helper's `finally` is what stops a successful decode from leaving a live
// timer behind for the rest of the timeout; without it a phone is held awake
// long after the save finished. Both branches are checked because the leak is
// just as real on the failure path.

test('withTimeout: a resolved race leaves no timer behind', { timeout: 5000 }, async () => {
  const before = process.getActiveResourcesInfo().filter((r) => r === 'Timeout').length
  const value = await withTimeout(Promise.resolve('done'), 60_000, 'fast work')
  assert.equal(value, 'done')
  const after = process.getActiveResourcesInfo().filter((r) => r === 'Timeout').length
  assert.equal(after, before, 'the 60s timer was cleared, not left running')
})

test('withTimeout: a rejected race leaves no timer behind, and keeps the original error', { timeout: 5000 }, async () => {
  const before = process.getActiveResourcesInfo().filter((r) => r === 'Timeout').length
  const err = await rejection(withTimeout(Promise.reject(new Error('decode blew up')), 60_000, 'failing work'))
  assert.match((err as Error).message, /decode blew up/, 'an error from the work itself propagates unchanged')
  const after = process.getActiveResourcesInfo().filter((r) => r === 'Timeout').length
  assert.equal(after, before, 'the 60s timer was cleared on the failure path too')
})

test('withTimeout: the timeout branch fires and onTimeout replaces the rejection', { timeout: 5000 }, async () => {
  const never = new Promise<never>(() => {})
  const err = await rejection(withTimeout(never, 20, 'stuck work', () => new Error('replaced')))
  assert.match((err as Error).message, /replaced/)
})

// ── The upload retry ────────────────────────────────────────────────────────
//
// Three "Upload failed" reports in 30 days, no retry behind any of them. A
// request that never reached Storage is worth one more try; a request Storage
// answered is not, because the second answer is the same as the first and the
// family waits twice as long to hear it.

test('isRetriableUploadFailure: a request that never got an answer is retried', () => {
  // What supabase-js hands back for a dropped connection: no status at all.
  assert.equal(isRetriableUploadFailure({ message: 'TypeError: Failed to fetch' }), true)
  assert.equal(isRetriableUploadFailure(new Error('Upload failed. Check your connection and try again.')), true)
  assert.equal(isRetriableUploadFailure({ status: 503, message: 'service unavailable' }), true)
  assert.equal(isRetriableUploadFailure({ status: 500, message: 'internal error' }), true)
  assert.equal(isRetriableUploadFailure({ status: 429, message: 'slow down' }), true)
  assert.equal(isRetriableUploadFailure({ status: 408, message: 'request timeout' }), true)
})

test('isRetriableUploadFailure: a rejection the server actually made is not retried', () => {
  assert.equal(isRetriableUploadFailure({ status: 401, message: 'invalid jwt' }), false, 'auth')
  assert.equal(isRetriableUploadFailure({ status: 403, message: 'row-level security' }), false, 'policy')
  assert.equal(isRetriableUploadFailure({ status: 409, message: 'resource already exists' }), false, 'duplicate')
  assert.equal(isRetriableUploadFailure({ status: 413, message: 'payload too large' }), false, 'size')
  assert.equal(isRetriableUploadFailure({ status: 400, message: 'bad request' }), false)
  // statusCode arrives as a string on some storage errors.
  assert.equal(isRetriableUploadFailure({ status: '403', message: 'denied' }), false)
})

// ── Stored but not attached ─────────────────────────────────────────────────
//
// Production evidence, 2026-09-11 and 2026-09-22: the last photo of a Quick
// photo batch was written to memory-photos, the edge logs recorded no response
// to its upload, and no memory row followed. On 09-22 the retry, at a fresh
// path, reached Storage 46 minutes later, leaving two copies and no memory.
// The logs cannot say whether the phone received a response; what they show is
// an object that was stored and never attached. These tests pin the recovery:
// ask Storage before retrying, attach only a verified object, keep one path per
// photo so a late arrival cannot become a second copy.

/**
 * An in-memory Storage for one bucket. `upload` answers from a script:
 *   'ok'       stores the file and answers
 *   'lost'     stores the file, then fails with no status (the answer is lost)
 *   'drop'     stores nothing and fails with no status (never arrived)
 *   an object  a refusal Storage made, returned as the error
 * A path that already holds an object answers 409, like upsert: false does.
 * `info` reads the store unless a scripted answer says otherwise:
 *   'noanswer' throws, as a request that never completes does
 *   'mismatch' reports an object of a different size
 *   an object  returned as the error
 */
type UploadScript = 'ok' | 'lost' | 'drop' | Record<string, unknown>
type InfoScript = 'store' | 'noanswer' | 'mismatch' | Record<string, unknown>

function stubStorage(uploads: UploadScript[], infos: InfoScript[] = []) {
  const store = new Map<string, number>()
  const paths: string[] = []
  const infoCalls: string[] = []
  const client = {
    storage: {
      from() {
        return {
          upload: async (path: string, file: File) => {
            paths.push(path)
            if (store.has(path)) {
              return { data: null, error: { name: 'StorageApiError', status: 409, statusCode: '409', message: 'The resource already exists' } }
            }
            const step = uploads[paths.length - 1] ?? 'ok'
            if (step === 'ok' || step === 'lost') store.set(path, file.size)
            if (step === 'ok') return { data: { path }, error: null }
            if (step === 'lost' || step === 'drop') {
              return { data: null, error: { name: 'StorageUnknownError', message: 'Failed to fetch' } }
            }
            return { data: null, error: step }
          },
          info: async (path: string) => {
            infoCalls.push(path)
            const step = infos[infoCalls.length - 1] ?? 'store'
            if (step === 'noanswer') throw new TypeError('Failed to fetch')
            if (step === 'mismatch') return { data: { name: path, size: 999999 }, error: null }
            if (step !== 'store') return { data: null, error: step }
            if (!store.has(path)) {
              return { data: null, error: { name: 'StorageApiError', status: 400, statusCode: '404', message: 'Object not found' } }
            }
            return { data: { name: path, size: store.get(path) }, error: null }
          },
        }
      },
    },
  }
  return { client, paths, infoCalls, store }
}

const photo = (name: string) => new File([new Uint8Array([1, 2, 3])], name, { type: 'image/jpeg' })

test('uploadMemoryPhoto: a request that never arrived is retried at the SAME path and lands once', { timeout: 20000 }, async () => {
  const restore = stubBrowserImagePipeline(3000, 2000)
  try {
    const { client, paths, infoCalls, store } = stubStorage(['drop', 'ok'])

    const result = await uploadMemoryPhoto(client as never, 'user-1', photo('IMG_1.jpg'))

    assert.equal(paths.length, 2, 'the first attempt got no answer and a second was made')
    assert.equal(paths[0], paths[1], 'one path per photo, so a late arrival cannot become a second copy')
    assert.equal(infoCalls.length, 1, 'Storage was asked before the photo was sent again')
    assert.equal(store.size, 1, 'exactly one object')
    assert.equal(result.width, 3000, 'the natural width still comes back')
    assert.equal(result.height, 2000)
    // signedPhotoUrl cannot load under node --test, so the bare path is stored,
    // which is the already-supported fallback SignedImage re-signs from.
    assert.equal(result.photoUrl, paths[0])
  } finally {
    restore()
  }
})

test('uploadMemoryPhoto: stored-but-unanswered is verified and attached, not reported as failed', { timeout: 20000 }, async () => {
  const restore = stubBrowserImagePipeline(1200, 900)
  try {
    const { client, paths, infoCalls, store } = stubStorage(['lost'])

    const result = await uploadMemoryPhoto(client as never, 'user-1', photo('IMG_2.jpg'))

    assert.equal(paths.length, 1, 'no second upload: Storage confirmed the first one landed')
    assert.equal(infoCalls.length, 1)
    assert.equal(store.size, 1, 'no duplicate object')
    assert.equal(result.photoUrl, paths[0], 'the verified object is the one handed back to attach')
  } finally {
    restore()
  }
})

test('uploadMemoryPhoto: an object whose size does not match is never attached', { timeout: 20000 }, async () => {
  const restore = stubBrowserImagePipeline(1200, 900)
  try {
    // First check: nothing there. Second: something at the path, wrong size.
    const { client } = stubStorage(['drop', 'drop'], ['store', 'mismatch'])

    const err = await rejection(uploadMemoryPhoto(client as never, 'user-1', photo('IMG_3.jpg')))

    assert.ok(err instanceof UploadFailedError)
    assert.equal(err.outcome, 'unverified', 'a mismatch is "could not confirm", never "present"')
    assert.deepEqual(err.diagnostics.verifications, ['absent', 'unverified:size_mismatch'])
  } finally {
    restore()
  }
})

test('uploadMemoryPhoto: "file absent" and "verification failed" are different outcomes', { timeout: 20000 }, async () => {
  const restore = stubBrowserImagePipeline(1200, 900)
  try {
    const absent = stubStorage(['drop', 'drop'])
    const errAbsent = await rejection(uploadMemoryPhoto(absent.client as never, 'user-1', photo('IMG_4a.jpg')))
    assert.ok(errAbsent instanceof UploadFailedError)
    assert.equal(errAbsent.outcome, 'absent', 'Storage looked and there is no object')
    assert.equal(absent.paths.length, 2, 'two attempts, never three')

    const unknown = stubStorage(['drop', 'drop'], ['noanswer', 'noanswer'])
    const errUnknown = await rejection(uploadMemoryPhoto(unknown.client as never, 'user-1', photo('IMG_4b.jpg')))
    assert.ok(errUnknown instanceof UploadFailedError)
    assert.equal(errUnknown.outcome, 'unverified', 'no answer to the check is not proof of absence')
    assert.deepEqual(errUnknown.diagnostics.verifications, ['unverified:no_answer', 'unverified:no_answer'])

    // Both still read as the copy families already know.
    assert.match(errAbsent.message, /Upload failed/)
    assert.match(errUnknown.message, /Upload failed/)
  } finally {
    restore()
  }
})

test('uploadMemoryPhoto: a late arrival is attached once by Try again, not duplicated', { timeout: 20000 }, async () => {
  const restore = stubBrowserImagePipeline(1200, 900)
  try {
    const { client, paths, store } = stubStorage(['drop', 'drop'])
    const picked = photo('IMG_5.jpg')
    const stages: string[] = []

    await rejection(uploadMemoryPhoto(client as never, 'user-1', picked))
    // The request that timed out on the phone reaches Storage afterwards,
    // like the one that arrived 46 minutes late on 2026-09-22.
    store.set(paths[0], 1)

    const result = await uploadMemoryPhoto(client as never, 'user-1', picked, (s) => stages.push(s))

    assert.equal(new Set(paths).size, 1, 'every attempt, across both saves, used one path')
    assert.equal(store.size, 1, 'one object, attached once')
    assert.equal(result.photoUrl, paths[0])
    assert.deepEqual(stages, ['uploading'], 'Try again reuses the encoded bytes rather than decoding again')
  } finally {
    restore()
  }
})

test('uploadMemoryPhoto: once confirmed, the same File saved again gets its own object', { timeout: 20000 }, async () => {
  const restore = stubBrowserImagePipeline(1200, 900)
  try {
    const { client, paths, store } = stubStorage(['ok', 'ok'])
    const picked = photo('IMG_6.jpg')

    const first = await uploadMemoryPhoto(client as never, 'user-1', picked)
    await new Promise((r) => setTimeout(r, 5))
    const second = await uploadMemoryPhoto(client as never, 'user-1', picked)

    // Two memories must never share one object: deleting either would delete
    // the other's photo.
    assert.notEqual(first.photoUrl, second.photoUrl)
    assert.equal(store.size, 2)
    assert.equal(paths.length, 2)
  } finally {
    restore()
  }
})

test('uploadMemoryPhoto: a pending path is never reused for a different family', { timeout: 20000 }, async () => {
  const restore = stubBrowserImagePipeline(1200, 900)
  try {
    const { client, paths } = stubStorage(['drop', 'drop', 'ok'])
    const picked = photo('IMG_7.jpg')

    await rejection(uploadMemoryPhoto(client as never, 'user-1', picked))
    await uploadMemoryPhoto(client as never, 'user-2', picked)

    assert.ok(paths[2].startsWith('user-2/'), 'the second family uploads into its own folder')
  } finally {
    restore()
  }
})

test('uploadMemoryPhoto: a policy rejection is not retried or verified', { timeout: 20000 }, async () => {
  const restore = stubBrowserImagePipeline(1200, 900)
  try {
    const { client, paths, infoCalls } = stubStorage([{ status: 403, message: 'new row violates row-level security policy' }])

    const err = await rejection(uploadMemoryPhoto(client as never, 'user-1', photo('IMG_8.jpg')))

    assert.equal(paths.length, 1, 'asking again would have got the same answer')
    assert.equal(infoCalls.length, 0)
    assert.ok(err instanceof UploadFailedError)
    assert.equal(err.outcome, 'rejected')
    assert.match(err.message, /Upload failed/, 'the family sees the message that already exists')
    assert.equal(((err as Error & { cause?: { status?: number } }).cause ?? {}).status, 403, 'the real reason is attached')
    assert.equal(err.diagnostics.notes[0].status, 403, 'and summarised for Sentry')
  } finally {
    restore()
  }
})

test('verifyUploadedObject: only a 404-shaped answer counts as absent', { timeout: 5000 }, async () => {
  const withInfo = (info: () => Promise<unknown>) =>
    ({ storage: { from: () => ({ info }) } }) as never

  assert.deepEqual(
    await verifyUploadedObject(withInfo(async () => ({ data: null, error: { status: 404, message: 'Not found' } })), 'u/p.jpg', 3),
    { state: 'absent' },
  )
  const refused = await verifyUploadedObject(
    withInfo(async () => ({ data: null, error: { status: 403, message: 'denied' } })),
    'u/p.jpg',
    3,
  )
  assert.equal(refused.state, 'unverified', 'a refusal is not proof the file is missing')
  const noSize = await verifyUploadedObject(withInfo(async () => ({ data: { name: 'p.jpg' }, error: null })), 'u/p.jpg', 3)
  assert.equal(noSize.state, 'unverified')
  assert.deepEqual(
    await verifyUploadedObject(withInfo(async () => ({ data: { metadata: { size: 3 } }, error: null })), 'u/p.jpg', 3),
    { state: 'present' },
  )
})

test('upload diagnostics carry no URL, token, JWT or storage path', { timeout: 20000 }, async () => {
  const restore = stubBrowserImagePipeline(1200, 900)
  try {
    const leaky = {
      status: 400,
      message:
        'bad request for https://auth.example.com/storage/v1/object/sign/memory-photos/user-1/x.jpg?token=SECRET123 ' +
        'Bearer abc.def.ghi eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ1c2VyLTEifQ.c2lnbmF0dXJl',
    }
    const { client } = stubStorage([leaky])

    const err = await rejection(uploadMemoryPhoto(client as never, 'user-1', photo('Private Name.jpg')))
    assert.ok(err instanceof UploadFailedError)
    const serialized = JSON.stringify(err.diagnostics)

    assert.doesNotMatch(serialized, /SECRET123/)
    assert.doesNotMatch(serialized, /https?:\/\//)
    assert.doesNotMatch(serialized, /eyJ/)
    assert.doesNotMatch(serialized, /abc\.def\.ghi/)
    assert.doesNotMatch(serialized, /user-1\//, 'no storage path')
    assert.doesNotMatch(serialized, /Private/, 'no file name')
    assert.equal(redactUploadMessage('x'.repeat(500)).length, 200, 'bounded')
  } finally {
    restore()
  }
})

test('uploadMemoryPhoto: the stage callback names the slow steps in order', { timeout: 20000 }, async () => {
  const restore = stubBrowserImagePipeline(1200, 900)
  try {
    const { client } = stubStorage(['ok'])
    const stages: string[] = []

    await uploadMemoryPhoto(
      client as never,
      'user-1',
      new File([new Uint8Array([1])], 'IMG_4.jpg', { type: 'image/jpeg' }),
      (stage) => stages.push(stage),
    )

    assert.deepEqual(stages, ['decoding', 'encoding', 'uploading'])
  } finally {
    restore()
  }
})

// ── Never lose the photo a parent already chose ─────────────────────────────
//
// Today's capture used to hand a failed batch a toast and nothing else. The
// file input is cleared before the save even starts (so re-picking the same
// photo fires a change event), which meant a failure sent a parent back into a
// camera roll of hundreds to find the one that did not save. These are
// source-level because the behaviour lives inside a 7,000-line client
// component; what they pin is that the file is held and offered back.

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const repoFile = (rel: string) => readFileSync(resolve(process.cwd(), rel), 'utf8')

test('Today capture: a photo that fails to save is held for Try again', () => {
  const src = repoFile('app/dashboard/page.tsx')

  assert.match(src, /const \[retryPhotos, setRetryPhotos\]/, 'the failed files are kept in state')
  assert.match(src, /failedFiles\.push\(batch\[i\]\)/, 'every per-photo failure keeps its file')
  assert.match(
    src,
    /setRetryPhotos\(\{ files: failedFiles, memType, title: prefillTitle \}\)/,
    'and the batch that failed is what Try again re-runs',
  )
  // The offer must not fade. Every other toast clears itself after 4s, which is
  // right for "Memory saved" and wrong for an offer to rescue a photo.
  const retryToast = src.slice(src.indexOf('function showRetryToast'))
  assert.match(retryToast.slice(0, 400), /setCaptureToast\(\{ message, memoryId: null, retry: true \}\)/)
  assert.doesNotMatch(retryToast.slice(0, 400), /captureToastTimer\.current = setTimeout/, 'no auto-dismiss on a retry toast')
  assert.match(src, /Try again/, 'and the toast renders the action')
})

test('Today capture: a retry carries the type and suggested title the first attempt used', () => {
  // Both come off refs that have moved on by the time a retry happens: the
  // suggested title is read-once-and-cleared, and the capture type resets to
  // "photo" after a successful save. A retry that re-read them would file a
  // drawing as a photo.
  const src = repoFile('app/dashboard/page.tsx')
  assert.match(src, /resume\?: \{ memType: string; title: string \| null \}/)
  assert.match(src, /const memType = resume\?\.memType \?\? captureTypeRef\.current/)
  assert.match(src, /const prefillTitle = resume \? resume\.title : prefillTitleRef\.current/)
})

test('every pipeline caller that can wait on a conversion shows that it is working', () => {
  // 90 seconds of wasm on the main thread with a button that says "Saving..."
  // is indistinguishable from a frozen app.
  for (const file of [
    'app/dashboard/page.tsx',
    'app/dashboard/layout.tsx',
    'app/dashboard/memories/yearbook/edit/page.tsx',
  ]) {
    assert.match(repoFile(file), /Converting your photo/, `${file} must say when a conversion is running`)
  }
})

test('the memory save paths still refresh Today and the grid on every save', () => {
  // The regression guard on this branch. Nothing here touches those calls, and
  // this fails if a later edit does.
  const src = repoFile('app/dashboard/page.tsx')
  const refreshes = src.match(/await refreshTodayStory\(\)/g) ?? []
  assert.ok(refreshes.length >= 10, `expected every save path to still refresh Today's Story, found ${refreshes.length}`)
  assert.match(src, /loadDataBusy\.current = false;\s*\n\s*await loadData\(\);\s*\n\s*await refreshTodayStory\(\);/)
})
