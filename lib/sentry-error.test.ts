// captureSupabaseError wraps what it is given in a new Error, so anything the
// original carried as `cause` never reached Sentry. Photo upload failures read
// as a bare "Upload failed" because of it. uploadDiagnosticsOf is the one
// thing that now crosses over, and it must be exactly the pipeline's redacted
// summary: nothing from an arbitrary error object.

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { uploadDiagnosticsOf } from './sentry-error.ts'

test('uploadDiagnosticsOf: passes an UploadFailedError-shaped summary through', () => {
  const diagnostics = { outcome: 'unverified', attempts: 2, reusedPath: false, notes: [], verifications: ['unverified:no_answer'] }
  const err = Object.assign(new Error('Upload failed. Check your connection and try again.'), { diagnostics })
  assert.deepEqual(uploadDiagnosticsOf(err), diagnostics)
})

test('uploadDiagnosticsOf: ignores errors without a summary, including a bare cause', () => {
  assert.equal(uploadDiagnosticsOf(new Error('x', { cause: { status: 403, message: 'https://signed?token=a' } })), null)
  assert.equal(uploadDiagnosticsOf({ code: '42501', message: 'rls' }), null)
  assert.equal(uploadDiagnosticsOf({ diagnostics: { attempts: 2 } }), null, 'no outcome, not ours')
  assert.equal(uploadDiagnosticsOf(null), null)
})
