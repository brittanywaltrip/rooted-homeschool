import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'

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
  { status: 'refused', reason: 'unavailable' },
  { status: 'refused', reason: 'selection' },
  { status: 'refused', reason: 'unrepresented_gap' },
  { status: 'refused', reason: 'stale' },
  { status: 'refused', reason: 'transaction' },
  { status: 'unknown', operationId: 'op' },
]) {
  test(`Shift all handles ${result.status}/${result.reason ?? 'unknown response'} without fallback writes or success`, async () => {
    const effects: string[] = []
    const busy: boolean[] = []
    const notices: string[] = []
    const context = {
      supabase: { rpc: async () => { effects.push('unexpected direct RPC'); throw Error('unexpected') } },
      todayStr: '2026-09-24', crypto: { randomUUID: () => 'op' },
      setCascadeChoice: () => {}, setBulkBusy: (b: boolean) => busy.push(b),
      flashNotice: (s: string) => notices.push(s),
      shiftCurriculumSessions: async () => result,
      recordEvent: () => effects.push('success event'), setUndoAction: () => effects.push('Undo'),
      reloadPins: () => {}, reload: () => {},
    }
    runInNewContext(compiled, context)
    const run = (context as unknown as { run: (c: unknown) => Promise<void> }).run
    await run({ previewSnapshot: {dayStartIso:'2026-09-24T00:00:00Z',dayEndIso:'2026-09-25T00:00:00Z'}, lessonId: 'L4', goalId: 'g', fromDateStr: '2026-09-24', toDateStr: '2026-09-29', shiftDays: 3 })
    assert.deepEqual(effects, [])
    assert.deepEqual(busy, [true, false])
    assert.equal(notices.length, 1)
    assert.match(notices[0], result.status === 'unknown' ? /Couldn't confirm/ : /nothing moved/i)
  })
}

test('actual callback registers receipt Undo only after atomic success', async () => {
  const calls: string[] = [], notices: string[] = []
  let undo: (() => Promise<void>) | undefined
  const context = {
    supabase: {}, todayStr: '2026-09-24', crypto: { randomUUID: () => 'op' }, curriculumGoals: [],
    setCascadeChoice: () => {}, setBulkBusy: () => {}, flagLanded: () => {}, hapticTap: () => {},
    flashNotice: (s: string) => notices.push(s), reloadPins: () => {}, reload: () => {},
    shiftCurriculumSessions: async () => ({ status: 'applied', operationId: 'op', writtenIds: ['L4', 'L5'] }),
    recordEvent: (_name: string, data: {count: number}) => { assert.equal(data.count, 2); calls.push('success') },
    setUndoAction: (action: {onUndo: () => Promise<void>}) => { undo = action.onUndo },
    undoCurriculumShift: async (_client: unknown, id: string) => { assert.equal(id, 'op'); calls.push('Undo'); return 'stale' },
  }
  runInNewContext(compiled, context)
  await (context as unknown as {run: (c: unknown) => Promise<void>}).run({previewSnapshot: {dayStartIso:'2026-09-24T00:00:00Z',dayEndIso:'2026-09-25T00:00:00Z'},lessonId: 'L4', goalId: 'g', fromDateStr: '2026-09-24', toDateStr: '2026-09-29', shiftDays: 3})
  assert.deepEqual(calls, ['success']); assert.ok(undo); await undo()
  assert.deepEqual(calls, ['success','Undo']); assert.match(notices[0], /left it as it is/)
})

test('a missing safe preview cannot call the mutation coordinator', async () => {
  const notices: string[] = []
  const context={setCascadeChoice:()=>{},flashNotice:(s:string)=>notices.push(s),shiftCurriculumSessions:()=>{throw Error('unexpected write')}}
  runInNewContext(compiled,context)
  await (context as unknown as {run:(c:unknown)=>Promise<void>}).run({previewSnapshot:null})
  assert.match(notices[0],/Nothing moved/)
})
