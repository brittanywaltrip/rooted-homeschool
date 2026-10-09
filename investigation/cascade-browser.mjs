// Local browser harness: real dialog markup + actual extracted callbacks.
// Storage/RPC and surrounding app shell are stubs, not a full app or SQL E2E.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { chromium } from '@playwright/test';
import * as scheduler from '../app/lib/scheduler.ts';
import { nthSchoolDay } from '../lib/school-days.ts';
import { checkCascadeShift } from '../app/lib/cascade-shift-preflight.ts';
import { moveLessonKeepSlot, planKeepSlotMove, keepSlotUndoRows } from '../app/lib/move-keep-slot.ts';
import { makeMemorySupabase } from '../app/lib/test-helpers/memory-supabase.ts';

const current = readFileSync(new URL('../app/components/PlanV2/index.tsx', import.meta.url), 'utf8');
const historicalSource = execFileSync('git', ['show', '38b9bb8^:app/components/PlanV2/index.tsx'], { encoding: 'utf8' });
const baseline = execFileSync('git', ['show', 'beb53fa9479dc63ed723a519637a6d7eafcf947d:app/components/PlanV2/index.tsx'], { encoding: 'utf8' });
function extract(source, name, context) {
  const ast = ts.createSourceFile('Plan.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let expression;
  function visit(node) {
    if (ts.isVariableDeclaration(node) && node.name.getText(ast) === name) expression = node.initializer.arguments[0].getText(ast);
    if (ts.isFunctionDeclaration(node) && node.name?.text === name) expression = node.getText(ast);
    ts.forEachChild(node, visit);
  }
  visit(ast);
  assert.ok(expression, name);
  const js = ts.transpileModule(`globalThis.${name} = ${expression};`, { compilerOptions: { target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React } }).outputText;
  runInNewContext(js, context);
  return context[name];
}
const ui = { React, X: () => null };
const Dialog = extract(current, 'CascadeChoiceDialog', ui);
const noop = () => {};
let state;
function seed({ day = 'Tue', gap = false, holiday = false, old = false, drift = false, historical = false } = {}) {
  const today = day === 'Sun' ? '2026-09-20' : '2026-09-22';
  const regular = day === 'Sun' ? ['2026-09-20', '2026-09-27', '2026-10-04'] : ['2026-09-22', '2026-09-29', '2026-10-06'];
  const dates = gap ? (day === 'Sun' ? ['2026-09-20', '2026-10-11', '2026-10-18'] : ['2026-09-22', '2026-10-13', '2026-10-20']) : regular;
  const vacations = holiday ? [{ start_date: '2026-10-06', end_date: '2026-10-06' }] : [];
  if (holiday) dates[2] = '2026-10-13';
  const goal = { id: 'synthetic', curriculum_name: 'Disposable weekly course', total_lessons: 3, current_lesson: 0, lessons_per_day: 1, school_days: [day], start_date: today };
  const rows = dates.map((date, i) => ({ id: `L${i + 1}`, curriculum_goal_id: goal.id, lesson_number: i + 1, queue_position: i + 1, completed: false, skipped: false, is_backfill: false, queue_pinned: gap && i > 0, scheduled_source: gap ? 'plan_move' : 'wizard_create', date, scheduled_date: date }));
  if (historical) {
    goal.current_lesson = day === 'Sun' ? 1 : 2;
    goal.total_lessons = 53;
    goal.start_date = day === 'Sun' ? '2026-09-13' : '2026-09-08';
    rows.length = 0;
    for (let i = 0; i < 53; i++) {
      const d = new Date(`${goal.start_date}T12:00:00`); d.setDate(d.getDate() + i * 7);
      const date = d.toISOString().slice(0, 10);
      rows.push({ id: `L${i + 1}`, curriculum_goal_id: goal.id, lesson_number: i + 1, queue_position: i + 1, completed: i < goal.current_lesson, skipped: false, is_backfill: false, queue_pinned: false, scheduled_source: 'wizard_create', date, scheduled_date: date });
    }
  }
  if (drift) { rows[0].queue_position = 2; rows[1].queue_position = 1; rows[0].scheduled_date = rows[1].scheduled_date; rows[0].date = rows[1].date; rows[0].queue_pinned = true; }
  const memory = makeMemorySupabase({ lessons: rows, curriculum_goals: [goal] });
  state = { ...memory, goal, today, vacations, notices: [], events: [], choice: null, writes: 0, old };
  const supabase = {
    from(table) {
      const q = memory.client.from(table);
      return { ...q, update(payload) { state.writes++; return q.update(payload); } };
    },
    async rpc(name, args) {
      if (historical && name === 'move_lesson_to_date') {
        const plan = scheduler.planQueueMove({ movingLessonId: args.p_lesson_id, targetDate: args.p_target_date, goalLessons: memory.tables.lessons });
        assert.ok(plan && !plan.noop);
        for (const change of plan.shifts) memory.tables.lessons.find(r => r.id === change.id).queue_position = change.queue_position;
        Object.assign(memory.tables.lessons.find(r => r.id === args.p_lesson_id), { queue_position: plan.movedNewQp, scheduled_date: args.p_target_date, date: args.p_target_date, queue_pinned: true, scheduled_source: 'plan_move' });
        state.writes++; return { error: null };
      }
      assert.equal(name, 'move_lesson_keep_slot' , 'no unexpected RPC/network fallback');
      const plan = planKeepSlotMove({ rows: memory.tables.lessons, lessonId: args.p_lesson_id, targetDate: args.p_target_date, localDay: args.p_local_day, currentLesson: goal.current_lesson, holdBetween: args.p_hold_between });
      if (!plan) return { data: { status: 'not_movable', reason: 'fixture refusal' }, error: null };
      const row = memory.tables.lessons.find(r => r.id === args.p_lesson_id);
      const moved = structuredClone(row);
      const held = memory.tables.lessons.filter(r => plan.holdIds.includes(r.id)).map(r => structuredClone(r));
      Object.assign(row, { date: args.p_target_date, scheduled_date: args.p_target_date, queue_pinned: true, scheduled_source: 'plan_move' });
      for (const r of memory.tables.lessons.filter(r => plan.holdIds.includes(r.id))) Object.assign(r, { queue_pinned: true, scheduled_source: 'plan_hold' });
      state.writes++;
      return { data: { status: 'moved', moved, held }, error: null };
    },
  };
  class Clock extends Date { constructor(...args) { super(...(args.length ? args : [`${today}T12:00:00`])); } }
  const context = { ...scheduler, Date: Clock, supabase, checkCascadeShift, moveLessonKeepSlot, keepSlotUndoRows, todayStr: today, vacationBlocks: vacations, lessons: memory.tables.lessons, curriculumGoals: [goal],
    setCascadeChoice: noop, setBulkBusy: noop, setLessons: noop, flagLanded: noop, hapticTap: noop, reload: noop, reloadPins: noop,
    flashNotice: s => state.notices.push(s), recordEvent: (type, payload) => state.events.push({ type, payload }), setUndoAction: action => { state.undo = action; state.notices.push(action.message); }, UNDO_INCOMPLETE_NOTICE: 'Undo incomplete',
  };
  const source = historical ? historicalSource : old ? baseline : current;
  for (const name of ['restoreLessonSnapshot', 'reprojectGoalTail', ...(historical ? [] : ['writeSingleMove']), 'handleShiftAllForward']) extract(source, name, context);
  state.context = context;
}
function htmlTable() {
  const projection = scheduler.computeNextLessonsForGoal(state.goal, new Date(`${state.today}T00:00:00`), 3650, state.vacations, 0, scheduler.queueHoldsFromRows(state.tables.lessons, state.goal.id));
  const dates = new Map(projection.map(p => [p.lesson_number, p.date]));
  return `<table><tr><th>Lesson</th><th>Queue slot</th><th>Plan date</th><th>Projected date</th></tr>${state.tables.lessons.map(r => `<tr data-id="${r.id}"><td>${r.id}</td><td>${r.queue_position}</td><td class="plan">${r.scheduled_date}</td><td>${dates.get(r.queue_position)}</td></tr>`).join('')}</table><p id="notice">${state.notices.join(' | ')}</p><p id="writes">Local writes: ${state.writes}</p>`;
}
function documentHtml() {
  return `<!doctype html><html><head><meta charset="utf-8"><title>Disposable cascade reproduction</title><style>body{font:16px system-ui;margin:32px;background:#faf8f4;color:#213a2a;max-width:960px}button,input,select{font:inherit;padding:10px;margin:6px}table{border-collapse:collapse;background:white;margin-top:20px}td,th{border:1px solid #b5c8b4;padding:12px}#dialog button{display:block;max-width:520px}#dialog{margin:20px 0;padding:12px;background:#fff}#notice{font-weight:600}</style></head><body><h1>Disposable local reschedule test</h1><p>Real Rooted dialog and handlers; synthetic data and stubbed storage. No real account.</p><label>Lesson <select id="lesson"><option>L1</option><option>L2</option><option>L3</option></select></label><label>New date <input id="target" type="date" value="${state.goal.school_days[0] === 'Sun' ? '2026-09-27' : '2026-09-29'}"></label><button id="save">Save new date</button><div id="dialog"></div><div id="results">${htmlTable()}</div><script>
  async function post(url, data) { const r = await fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)}); if(!r.ok) throw Error(await r.text()); return r.json(); }
  document.addEventListener('click', async event => { const b=event.target.closest('button'); if(!b)return; try {
    if(b.id==='save') { const d=await post('/choice',{id:document.querySelector('#lesson').value,target:document.querySelector('#target').value});document.querySelector('#dialog').innerHTML=d.html; }
    else if(b.textContent.includes('Shift all remaining')||b.textContent.includes('Move just this')) { const d=await post('/move',{all:b.textContent.includes('Shift all remaining')});document.querySelector('#dialog').innerHTML='';document.querySelector('#results').innerHTML=d.html; }
  } catch(e){document.querySelector('#notice').textContent='ERROR: '+e.message;} });
  </script></body></html>`;
}
const server = createServer(async (req, res) => {
  try {
    if (req.method === 'GET') { res.setHeader('Content-Type', 'text/html'); res.end(documentHtml()); return; }
    let raw = ''; for await (const c of req) raw += c;
    const input = JSON.parse(raw);
    res.setHeader('Content-Type', 'application/json');
    if (req.url === '/choice') {
      const row = state.tables.lessons.find(r => r.id === input.id);
      const delta = scheduler.schoolDayDelta(row.scheduled_date, input.target, state.goal.school_days, state.vacations.map(v => ({ start: v.start_date, end: v.end_date })));
      const later = state.tables.lessons.filter(r => r.id !== row.id && r.scheduled_date > row.scheduled_date);
      const latest = later.reduce((d,r) => r.scheduled_date > d ? r.scheduled_date : d, row.scheduled_date);
      state.choice = { lessonId: row.id, goalId: state.goal.id, fromDateStr: row.scheduled_date, toDateStr: input.target, shiftDays: delta, futureLessonsToShift: later.length, projectedFinishDate: nthSchoolDay(latest, state.goal.school_days, delta, state.vacations) };
      res.end(JSON.stringify({ html: renderToStaticMarkup(React.createElement(Dialog, { choice: state.choice, onCancel: noop, onMoveJustThis: noop, onShiftAll: noop })) }));
    } else if (req.url === '/move') {
      if (input.all) await state.context.handleShiftAllForward(state.choice);
      else { const c = state.choice; const result = await state.context.writeSingleMove(c.lessonId, c.fromDateStr, c.toDateStr); state.notices.push(result ? 'Moved one lesson' : 'Move failed'); }
      res.end(JSON.stringify({ html: htmlTable() }));
    } else { res.statusCode = 404; res.end('{}'); }
  } catch (error) { res.statusCode = 500; res.end(error.stack); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const url = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1100, height: 850 } });
await page.route('**/*', route => new URL(route.request().url()).origin === url ? route.continue() : route.abort());
const results = [];
mkdirSync('../investigation-evidence/isolated-browser', { recursive: true });
async function choose(all = true, target) {
  if (target) await page.locator('#target').fill(target);
  await page.locator('#save').click();
  await page.getByRole('button', { name: all ? /Shift all remaining lessons forward/ : /Move just this lesson/ }).click();
  await page.locator('#dialog').filter({ hasText: /What about/ }).waitFor({ state: 'hidden' });
}
async function scenario(name, config, all, expected, target) {
  seed(config); await page.goto(url); const before = structuredClone(state.tables.lessons);
  await choose(all, target);
  assert.deepEqual(state.tables.lessons.map(r => r.scheduled_date), expected, name);
  if (name.includes('refused')) { assert.equal(state.writes, 0); assert.deepEqual(state.tables.lessons, before); }
  results.push({ name, dates: expected, writes: state.writes, notices: state.notices });
  await page.screenshot({ path: `../investigation-evidence/isolated-browser/${name}.png`, fullPage: true });
}
try {
  await scenario('baseline-tuesday-gap-compresses', { gap: true, old: true }, true, ['2026-09-29','2026-10-06','2026-10-13']);
  await scenario('candidate-tuesday-gap-refused', { gap: true }, true, ['2026-09-22','2026-10-13','2026-10-20']);
  await scenario('candidate-sunday-gap-refused', { day: 'Sun', gap: true }, true, ['2026-09-20','2026-10-11','2026-10-18']);
  await scenario('move-one-keeps-spaced-tail', { gap: true }, false, ['2026-09-29','2026-10-13','2026-10-20']);
  await scenario('weekly-shift-all', {}, true, ['2026-09-29','2026-10-06','2026-10-13']);
  await choose(true, '2026-10-06');
  assert.deepEqual(state.tables.lessons.map(r => r.scheduled_date), ['2026-10-06','2026-10-13','2026-10-20']);
  results.push({ name: 'repeat-weekly-shift', dates: state.tables.lessons.map(r => r.scheduled_date) });
  await scenario('holiday-shift-all', { holiday: true }, true, ['2026-09-29','2026-10-13','2026-10-20']);
  await scenario('move-one-holds-next-week', {}, false, ['2026-09-29','2026-09-29','2026-10-06']);
  seed({ gap: true }); await page.goto(url); await choose(true); await choose(true);
  assert.equal(state.writes, 0); results.push({ name: 'repeated-gap-refusal', writes: state.writes });
  const priorSwitch = process.env.NEXT_PUBLIC_SCHEDULER_SYNC_ENABLED;
  process.env.NEXT_PUBLIC_SCHEDULER_SYNC_ENABLED = 'false';
  try {
    for (const day of ['Sun', 'Tue']) {
      seed({ day, historical: true }); await page.goto(url);
      const n = state.goal.current_lesson + 1;
      await page.locator('#lesson').selectOption(`L${n}`);
      await choose(true);
      const trigger = state.tables.lessons.find(r => r.id === `L${n}`);
      const next = state.tables.lessons.find(r => r.id === `L${n + 1}`);
      assert.equal(trigger.scheduled_date, next.scheduled_date);
      assert.equal(trigger.queue_position, n + 1); assert.equal(next.queue_position, n);
      assert.equal(state.events[0].payload.failed, 0);
      assert.equal(state.events[0].payload.succeeded, day === 'Sun' ? 52 : 51);
      results.push({ name: `historical-${day}-collision-with-success`, pair: [trigger,next].map(r => ({ lesson: r.lesson_number, slot: r.queue_position, date: r.scheduled_date, pinned: r.queue_pinned, source: r.scheduled_source })), event: state.events[0] });
      await page.screenshot({ path: `../investigation-evidence/isolated-browser/historical-${day}.png`, fullPage: true });
    }
  } finally {
    if (priorSwitch === undefined) delete process.env.NEXT_PUBLIC_SCHEDULER_SYNC_ENABLED;
    else process.env.NEXT_PUBLIC_SCHEDULER_SYNC_ENABLED = priorSwitch;
  }
  writeFileSync('../investigation-evidence/isolated-browser/results.json', JSON.stringify(results, null, 2));
  console.log(JSON.stringify(results, null, 2));
} finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
