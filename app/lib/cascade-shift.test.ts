import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
import { makeMemorySupabase } from './test-helpers/memory-supabase.ts'

// Exercise the actual component callback, without mounting the calendar or
// connecting to a database. Compile only this callback; all effects are fakes.
const source = readFileSync(new URL('../components/PlanV2/index.tsx', import.meta.url), 'utf8')
const ast = ts.createSourceFile('Plan.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
let callback: ts.Expression | undefined
function visit(node: ts.Node) {
  if (ts.isVariableDeclaration(node) && node.name.getText(ast) === 'handleShiftAllForward') {
    assert.ok(node.initializer && ts.isCallExpression(node.initializer))
    callback = node.initializer.arguments[0]
  }
  ts.forEachChild(node, visit)
}
visit(ast)
assert.ok(callback)
const compiled = ts.transpileModule(`globalThis.run = ${callback.getText(ast)};`, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
}).outputText

for (const result of [
  { status: 'unavailable' },
  { status: 'not_movable', reason: 'no_slot' },
  { status: 'not_movable', reason: 'completed' },
  { status: 'not_movable', reason: 'skipped' },
  { status: 'not_movable', reason: 'not_later' },
  { status: 'failed', reason: 'connection' },
]) {
  test(`Shift all refuses ${result.status}/${result.reason ?? 'missing RPC'} without a reorder or tail write`, async () => {
    const seed = {
      curriculum_goals: [{ id: 'g' }],
      lessons: [{ id: 'L4', curriculum_goal_id: 'g', completed: false, queue_position: 4, scheduled_date: '2026-09-24' }],
    }
    const { client, tables } = makeMemorySupabase(seed)
    const effects: string[] = []
    const busy: boolean[] = []
    const notices: string[] = []
    const context = {
      supabase: { ...client, rpc: async () => { effects.push('legacy reorder'); return { error: null } } },
      GOAL_CONFIG_COLUMNS: 'id', toGoalConfig: (g: unknown) => g,
      todayStr: '2026-09-24', vacationBlocks: [], checkCascadeShift: () => ({ ok: true }),
      setCascadeChoice: () => {}, setBulkBusy: (b: boolean) => busy.push(b),
      flashNotice: (s: string) => notices.push(s),
      moveLessonKeepSlot: async () => result,
      reprojectGoalTail: async () => { effects.push('tail write'); throw new Error('unexpected tail write') },
      PARENT_RESPREAD_SOURCE: { cascade: 'plan_cascade_shift' },
    }
    runInNewContext(compiled, context)
    const run = (context as unknown as { run: (c: unknown) => Promise<void> }).run
    await run({ lessonId: 'L4', goalId: 'g', fromDateStr: '2026-09-24', toDateStr: '2026-09-29', shiftDays: 3 })
    assert.deepEqual(effects, [])
    assert.deepEqual(tables, seed)
    assert.deepEqual(busy, [true, false])
    assert.equal(notices.length, 1)
    assert.match(notices[0], result.status === 'failed' ? /Couldn't confirm the move/ : /nothing moved/i)
  })
}
