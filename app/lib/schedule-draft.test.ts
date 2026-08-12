// Unit tests for the Schedule Builder draft merge. Run with:
//   npm test
//
// The dangerous case these guard is silent data loss on restore. The save
// sweep archives every previously-saved id that isn't present in `rows`, so
// a restored draft that has simply never heard of a goal created elsewhere
// would archive that goal on the next save. mergeDraftWithDbRows has to
// treat the database as authoritative about which rows exist, and the draft
// as authoritative only about the edits to rows that still do.

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { mergeDraftWithDbRows, type DraftRowLike } from './schedule-draft.ts'

type TestRow = DraftRowLike & {
  name: string
  stale?: string
}

// Stand-in for the page's carryDbFieldsOntoDraftRow: keeps the draft's
// edits, re-reads the database-derived field.
const carry = (draft: TestRow, fresh: TestRow): TestRow => ({
  ...draft,
  stale: fresh.stale,
})

const dbRow = (dbId: string, name: string, child_id = 'kid-1'): TestRow => ({
  localId: `db-${dbId}`,
  dbId,
  child_id,
  name,
  stale: 'from-db',
})

test('keeps draft edits on rows that still exist', () => {
  const draft: TestRow[] = [
    { localId: 'db-g1', dbId: 'g1', child_id: 'kid-1', name: 'Edited name', stale: 'from-draft' },
  ]
  const db = [dbRow('g1', 'Original name')]

  const { rows, droppedCount, addedFromDbCount } = mergeDraftWithDbRows(
    draft,
    db,
    new Set(['kid-1']),
    carry,
  )

  assert.equal(rows.length, 1)
  assert.equal(rows[0].name, 'Edited name')
  // Database-derived fields must come from the fresh row, never the snapshot.
  assert.equal(rows[0].stale, 'from-db')
  assert.equal(droppedCount, 0)
  assert.equal(addedFromDbCount, 0)
})

test('appends live rows the draft never saw, so saving cannot archive them', () => {
  const draft: TestRow[] = [
    { localId: 'db-g1', dbId: 'g1', child_id: 'kid-1', name: 'Edited', stale: 'from-draft' },
  ]
  // g2 was added from another device after the draft was written.
  const db = [dbRow('g1', 'Original'), dbRow('g2', 'Added later')]

  const { rows, addedFromDbCount } = mergeDraftWithDbRows(draft, db, new Set(['kid-1']), carry)

  assert.equal(rows.length, 2)
  assert.equal(addedFromDbCount, 1)
  assert.ok(rows.some((r) => r.dbId === 'g2'), 'g2 must survive the restore')
})

test('drops draft rows whose goal is gone', () => {
  const draft: TestRow[] = [
    { localId: 'db-g1', dbId: 'g1', child_id: 'kid-1', name: 'Edited', stale: 'from-draft' },
    { localId: 'db-g9', dbId: 'g9', child_id: 'kid-1', name: 'Archived elsewhere', stale: 'x' },
  ]
  const db = [dbRow('g1', 'Original')]

  const { rows, droppedCount } = mergeDraftWithDbRows(draft, db, new Set(['kid-1']), carry)

  assert.equal(rows.length, 1)
  assert.equal(rows[0].dbId, 'g1')
  assert.equal(droppedCount, 1)
})

test('keeps never-saved rows only while their child is active', () => {
  const draft: TestRow[] = [
    { localId: 'new-1', dbId: null, child_id: 'kid-1', name: 'Typed but never saved' },
    { localId: 'new-2', dbId: null, child_id: 'kid-gone', name: 'Child archived since' },
  ]

  const { rows, droppedCount } = mergeDraftWithDbRows(draft, [], new Set(['kid-1']), carry)

  assert.equal(rows.length, 1)
  assert.equal(rows[0].localId, 'new-1')
  assert.equal(droppedCount, 1)
})

test('falls back to the live row when the draft row belongs to an archived child', () => {
  const draft: TestRow[] = [
    { localId: 'db-g1', dbId: 'g1', child_id: 'kid-gone', name: 'Edited', stale: 'from-draft' },
  ]
  const db = [dbRow('g1', 'Original', 'kid-gone')]

  const { rows, droppedCount } = mergeDraftWithDbRows(draft, db, new Set(['kid-1']), carry)

  assert.equal(rows.length, 1)
  assert.equal(rows[0].name, 'Original', 'edits to an archived child are not restored')
  assert.equal(droppedCount, 1)
})

test('an empty draft against a populated account returns the account untouched', () => {
  const db = [dbRow('g1', 'One'), dbRow('g2', 'Two')]

  const { rows, droppedCount, addedFromDbCount } = mergeDraftWithDbRows(
    [],
    db,
    new Set(['kid-1']),
    carry,
  )

  assert.deepEqual(rows.map((r) => r.dbId), ['g1', 'g2'])
  assert.equal(droppedCount, 0)
  assert.equal(addedFromDbCount, 2)
})

test('does not duplicate a row that appears in both draft and database', () => {
  const draft: TestRow[] = [
    { localId: 'db-g1', dbId: 'g1', child_id: 'kid-1', name: 'Edited', stale: 'from-draft' },
    { localId: 'new-1', dbId: null, child_id: 'kid-1', name: 'Brand new' },
  ]
  const db = [dbRow('g1', 'Original')]

  const { rows } = mergeDraftWithDbRows(draft, db, new Set(['kid-1']), carry)

  assert.equal(rows.length, 2)
  assert.equal(rows.filter((r) => r.dbId === 'g1').length, 1)
})
