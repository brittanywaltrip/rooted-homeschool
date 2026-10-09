// Offline contracts for the local lock correction. These do not replace the
// two-connection PostgreSQL tests proving savepoint lock release and progress.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { parseKeepSlotMove, parseRestoreBookOrder } from './move-keep-slot.ts'
import { untickLessonThen } from './reopen-lesson.ts'

const sql = readFileSync(new URL('../../supabase/proposals/remaining_completion_locks.sql', import.meta.url), 'utf8')
const normalize = (text: string) => text.replace(/--[^\n]*/g, '').replace(/\s+/g, ' ').trim().toLowerCase()
const definitions = [...sql.matchAll(/create\s+or\s+replace\s+function\s+public\.(\w+)\s*\(([^)]*)\)([\s\S]*?)as\s+(\$\w*\$)([\s\S]*?)\4\s*;/gi)]
const functions = definitions.map((m) => ({
  name: m[1],
  types: m[2].split(',').map((arg) => normalize(arg).split(' ').at(-1)).join(','),
  header: normalize(m[3]),
  body: normalize(m[5]),
}))
const expected = [
  ['reopen_lesson', 'uuid,date', 'jsonb'],
  ['restore_queue_book_order', 'uuid,date', 'jsonb'],
  ['move_lesson_keep_slot', 'uuid,date,date,boolean', 'jsonb'],
  ['move_lesson_to_date', 'uuid,date', 'void'],
  ['apply_builder_rebuild', 'uuid,date,jsonb,jsonb,jsonb', 'jsonb'],
  ['apply_builder_rebuild', 'uuid,date,jsonb,jsonb', 'jsonb'],
]
const statements = normalize(sql).split(';').map((s) => s.trim())
const locking = functions.filter((fn) => fn.types !== 'uuid,date,jsonb,jsonb')

test('lock correction preserves the six public signatures and security boundaries', () => {
  assert.deepEqual(functions.map((fn) => [fn.name, fn.types]), expected.map(([name, types]) => [name, types]))
  for (const [name, types, returns] of expected) {
    const fn = functions.find((f) => f.name === name && f.types === types)!
    assert.match(fn.header, new RegExp(`returns ${returns} language plpgsql security definer`))
    const path = fn.header.match(/set search_path\s*(?:to|=)\s*(.*)/)?.[1].replaceAll("'", '').replaceAll(' ', '')
    assert.equal(path, name === 'move_lesson_to_date' ? 'public' : 'pg_catalog,pg_temp')
    const signature = `public.${name}(${types})`
    // Ignore whitespace around commas without requiring a particular layout.
    const grants = statements.map((s) => s.replace(/\s*,\s*/g, ','))
    assert.ok(grants.includes(`alter function ${signature} owner to postgres`))
    assert.ok(grants.includes(`revoke all on function ${signature} from public,anon,authenticated,service_role`))
    assert.ok(grants.includes(`grant execute on function ${signature} to authenticated,service_role`))
    assert.deepEqual(grants.filter((s) => s.startsWith('grant ') && s.includes(signature)),
      [`grant execute on function ${signature} to authenticated,service_role`])
  }
})

test('both Builder signatures share one locking and mutation implementation', () => {
  const wrapper = functions.find((fn) => fn.types === 'uuid,date,jsonb,jsonb')!
  assert.equal(wrapper.body, 'begin return public.apply_builder_rebuild(p_goal_id, p_local_day, p_expected, p_plan, null::jsonb); end;')
})

test('all goal lessons are locked without waiting inside the busy exception savepoint', () => {
  assert.equal(locking.length, 5)
  for (const fn of locking) {
    const locks = [...fn.body.matchAll(/(?:select|perform)\b[^;]*for update(?: nowait)?\s*;/g)].map((m) => m[0])
    assert.equal(locks.length, 2, fn.name)
    assert.ok(locks.every((lock) => /for update nowait\s*;$/.test(lock)), fn.name)
    assert.match(locks[0], /from public\.curriculum_goals g where g\.id = (?:v_goal_id|p_goal_id) and g\.user_id = (?:v_uid|auth\.uid\(\))/)
    // Exact predicate intentionally excludes completed, skipped, date, pin,
    // slot and ownership filters: trigger effects can reach every goal row.
    assert.match(locks[1], /from public\.lessons l where l\.curriculum_goal_id = (?:p_goal_id|v_goal_id)(?: or l\.id = p_lesson_id)? order by l\.id for update nowait;/)
    const first = fn.body.indexOf(locks[0])
    const savepoint = fn.body.lastIndexOf('begin ', first)
    assert.ok(savepoint > fn.body.indexOf('begin '), `${fn.name}: nested exception block must contain acquisition`)
    const handler = fn.body.indexOf('exception when lock_not_available then', first)
    assert.ok(handler > fn.body.indexOf(locks[1]), fn.name)
    const acquisition = fn.body.slice(savepoint, handler)
    assert.doesNotMatch(acquisition, /\b(?:update public\.|update lessons|insert into|delete from)\b/)
    assert.doesNotMatch(acquisition, /\bend\s*;/, 'no nested block may end before the busy handler')
  }
})

test('lesson-targeted operations recheck owner and goal membership after acquiring locks', () => {
  for (const name of ['reopen_lesson', 'move_lesson_keep_slot', 'move_lesson_to_date']) {
    const fn = functions.find((f) => f.name === name)!
    const afterLocks = fn.body.slice(fn.body.lastIndexOf('for update nowait;') + 'for update nowait;'.length)
    const checked = afterLocks.slice(0, afterLocks.indexOf('exception when lock_not_available'))
    assert.match(checked, /l\.id = p_lesson_id and l\.user_id = (?:v_uid|auth\.uid\(\))/)
    assert.match(checked, /(?:v_row|l)\.curriculum_goal_id is (?:not )?distinct from v_goal_id/)
    assert.match(checked, /if not found[\s\S]*raise lock_not_available/)
  }
})

test('busy produces an explicit refusal, including the historical void RPC', () => {
  for (const fn of locking) {
    const handler = fn.body.split('exception when lock_not_available then')[1].split('end;')[0]
    if (fn.name === 'move_lesson_to_date') {
      assert.match(handler, /raise exception 'rooted_schedule_busy' using errcode = '55p03';/)
      assert.doesNotMatch(handler, /\breturn\b/)
    } else {
      assert.match(handler, /return jsonb_build_object\('status', 'stale', 'reason', 'busy'\);/)
    }
  }
})

test('busy responses cannot become keep-slot fallback or a reopen follow-up write', async () => {
  const busy = { status: 'stale', reason: 'busy' }
  assert.deepEqual(parseKeepSlotMove(busy, null), { status: 'failed', reason: 'busy' })
  assert.deepEqual(parseRestoreBookOrder(busy, null), { status: 'failed', reason: 'busy' })
  let followups = 0
  const client = { rpc: async () => ({ data: busy, error: null }) } as never
  const result = await untickLessonThen(client, { lessonId: 'test', localDay: '2026-10-09' }, async () => { followups++ })
  assert.equal(result.ok, false)
  assert.equal(followups, 0)
})
