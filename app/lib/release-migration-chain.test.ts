import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'

const read = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8')
const md5 = (s: string) => createHash('md5').update(s).digest('hex')
const prerequisite = read('supabase/migrations/20261006000000_reopen_lesson_in_place.sql')
const first = read('supabase/migrations/20261009174245_kandl_preserved_cascade_and_completion_locks.sql')
const second = read('supabase/migrations/20261009183309_kandl_protected_scheduler_containment.sql')

test('release preflight accepts the exact preceding reopen migration, not the older live body', () => {
  const body = prerequisite.match(/as \$fn\$([\s\S]*?)\$fn\$;/i)![1]
  const expected = first.match(/to_regprocedure\('public\.reopen_lesson\(uuid,date\)'\)\) IS DISTINCT FROM '([a-f0-9]+)'/)![1]
  assert.equal(expected, md5(body))
})

test('containment preflight matches the reopen body installed by the preceding release migration', () => {
  const body = first.match(/CREATE OR REPLACE FUNCTION public\.reopen_lesson\([\s\S]*?AS \$function\$([\s\S]*?)\$function\$;/)![1]
  const expected = second.match(/'public\.reopen_lesson\(uuid, date\)'::regprocedure\) IS DISTINCT FROM '([a-f0-9]+)'/)![1]
  assert.equal(expected, md5(body))
})

test('fresh production defaults cannot broaden the reviewed receipt and snapshot access', () => {
  assert.match(first, /ALTER TABLE rooted_private\.builder_commit_log ENABLE ROW LEVEL SECURITY;/)
  assert.match(first, /revoke all on function public\.read_cascade_snapshot\(uuid,date,text,text\) from public,anon,service_role;/)
})
