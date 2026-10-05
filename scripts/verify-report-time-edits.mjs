// Local-only SQL rehearsal. No connection strings, network calls or app credentials.
// Install @electric-sql/pglite@0.5.8 in a temporary prefix, then supply its entry
// path with PGLITE_MODULE. This is not part of the normal dependency tree.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { lessonMinutes, lessonMinutesInput } from '../lib/lesson-minutes.ts';

const require = createRequire(import.meta.url);
const { PGlite } = require(process.env.PGLITE_MODULE || '@electric-sql/pglite');
const db = new PGlite();
const owner = '00000000-0000-0000-0000-000000000001';
const other = '00000000-0000-0000-0000-000000000002';
const day = '2026-09-30';
let checks = 0;
const equal = (actual, expected) => { assert.deepEqual(actual, expected); checks++; };
const row = async id => (await db.query('select * from lessons where id=$1', [id])).rows[0];
const call = async (id, minutes, notes = 'Updated note') => (await db.query(
  'select update_report_lesson_record($1,$2,$3,$4) as ok', [id, day, minutes, notes],
)).rows[0].ok;

try {
  await db.exec(`
    create role anon; create role authenticated;
    create schema auth;
    create function auth.uid() returns uuid language sql as
      $$ select nullif(current_setting('fixture.uid', true), '')::uuid $$;
    create table lessons (
      id uuid primary key, user_id uuid, date date, scheduled_date date,
      completed boolean, completed_at timestamptz, minutes_spent integer,
      hours numeric, notes text, queue_pinned boolean, scheduled_source text,
      updated_at timestamptz default now(), queue_position integer, title text,
      curriculum_goal_id uuid
    );
  `);
  const migration = readFileSync(new URL('../supabase/migrations/20260921120000_report_record_management.sql', import.meta.url), 'utf8');
  const start = migration.indexOf('create or replace function public.update_report_lesson_record(');
  const end = migration.indexOf('create or replace function public.delete_report_lesson_record(');
  assert.ok(start >= 0 && end > start);
  await db.exec(migration.slice(start, end));
  await db.exec(migration.split('\n').filter(line => /^(revoke|grant).*update_report_lesson_record/.test(line)).join('\n'));
  const lockdown = readFileSync(new URL('../supabase/migrations/20260921121000_report_record_management_lockdown.sql', import.meta.url), 'utf8');
  await db.exec(lockdown.split('\n').filter(line => /^revoke.*update_report_lesson_record/.test(line)).join('\n'));

  const cases = [
    [null, 0, '', true], [null, null, '', true], [0, 1, '0', false],
    [45, 0, '45', false], [null, 1.5, '90', false],
  ];
  for (let i = 0; i < cases.length; i++) {
    const [minutes, hours, expectedInput, estimated] = cases[i];
    const id = `10000000-0000-0000-0000-${String(i + 1).padStart(12, '0')}`;
    await db.query(`insert into lessons values
      ($1,$2,$3,$3,true,'2026-09-30T12:00:00Z',$4,$5,'Original',true,'report_correction',now(),7,'Lesson 7')`, [id, owner, day, minutes, hours]);
    const before = await row(id);
    // Match Supabase's numeric JSON values, then the Reports editor/parser.
    const input = lessonMinutesInput({ minutes_spent: before.minutes_spent, hours: hours === null ? null : Number(before.hours) });
    equal(input, expectedInput);
    const parsed = input.trim() === '' ? null : Number(input);
    await db.query("select set_config('fixture.uid',$1,false)", [owner]);
    equal(await call(id, parsed), true);
    const after = await row(id);
    equal(after.minutes_spent, parsed);
    equal(lessonMinutes({ minutes_spent: after.minutes_spent, hours: hours === null ? null : Number(after.hours) }).estimated, estimated);
    for (const key of ['hours', 'user_id', 'completed', 'completed_at', 'queue_position', 'title', 'queue_pinned', 'date', 'scheduled_date']) equal(after[key], before[key]);
  }

  const id = '10000000-0000-0000-0000-000000000001';
  equal(await call(id, 20), true);
  equal((await row(id)).minutes_spent, 20);
  equal(lessonMinutes({ minutes_spent: (await row(id)).minutes_spent }).estimated, false);
  const baseline = await row(id);
  await db.query("select set_config('fixture.uid',$1,false)", [other]);
  equal(await call(id, 99), false);
  equal(await row(id), baseline);
  await db.query("select set_config('fixture.uid','',false)");
  await assert.rejects(call(id, 99), /Not authenticated/); checks++;
  equal(await row(id), baseline);
  await db.query("select set_config('fixture.uid',$1,false)", [owner]);
  for (const minutes of [-1, 1441]) {
    await assert.rejects(call(id, minutes), /Minutes must be between/); checks++;
    equal(await row(id), baseline);
  }
  // Reproduce the existing note-only placement side effect separately from
  // time preservation. A parent completed a past-planned lesson later.
  const placementId = '10000000-0000-0000-0000-000000000099';
  await db.query(`insert into lessons values
    ($1,$2,$3,$3,true,'2026-10-02T15:00:00Z',25,0,'Original',false,'parent_done',now(),9,'Lesson 9')`, [placementId, owner, day]);
  const placementBefore = await row(placementId);
  equal(await call(placementId, 25, 'Note only'), true);
  const placementAfter = await row(placementId);
  equal(placementAfter.minutes_spent, placementBefore.minutes_spent);
  equal(placementAfter.date, placementBefore.date);
  equal(placementAfter.completed_at.toISOString(), '2026-09-30T12:00:00.000Z');
  equal(placementAfter.queue_pinned, true);
  equal(placementAfter.scheduled_source, 'report_correction');
  console.log('REPRODUCED: unchanged-date note edit rewrites completion timestamp and pin/source.');

  // Apply the prepared correction only inside this disposable local database.
  await db.exec(readFileSync(new URL('../supabase/migrations/20261005161936_preserve_report_note_placement.sql', import.meta.url), 'utf8'));
  await db.query(`update lessons set completed_at='2026-10-02T15:00:00Z',
    queue_pinned=false, scheduled_source='parent_done' where id=$1`, [placementId]);
  const fixedBefore = await row(placementId);
  const v2 = async (date, minutes, notes, expected = day, id = placementId) =>
    (await db.query('select update_report_lesson_record_v2($1,$2,$3,$4,$5) as result',
      [id, date, minutes, notes, expected])).rows[0].result;
  equal(await v2(day, 25, 'Note only'), { saved: true, scheduling_changed: false, curriculum_goal_id: null });
  const fixedAfter = await row(placementId);
  for (const key of ['date','scheduled_date','completed_at','queue_pinned','scheduled_source','queue_position','hours','completed']) {
    equal(fixedAfter[key], fixedBefore[key]);
  }
  equal(fixedAfter.notes, 'Note only');
  equal((await v2(day, 0, 'Zero minutes')).scheduling_changed, false);
  equal((await row(placementId)).minutes_spent, 0);
  equal((await v2(day, null, 'No recorded time')).scheduling_changed, false);
  equal((await row(placementId)).minutes_spent, null);
  // Installed clients retain their boolean contract and preserved placement.
  equal(await call(placementId, 25, 'Old client note'), true);
  equal((await row(placementId)).completed_at, fixedBefore.completed_at);
  equal((await row(placementId)).queue_pinned, false);

  equal(await v2('2026-10-03', 25, 'Date correction'),
    { saved: true, scheduling_changed: true, curriculum_goal_id: null });
  const moved = await row(placementId);
  equal(moved.date.toISOString().slice(0, 10), '2026-10-03');
  equal(moved.scheduled_date.toISOString().slice(0, 10), '2026-10-03');
  equal(moved.completed_at.toISOString(), '2026-10-03T12:00:00.000Z');
  equal(moved.queue_pinned, true);
  equal(moved.scheduled_source, 'report_correction');
  await assert.rejects(v2(day, 99, 'Stale tab'), /Record date changed/); checks++;
  equal(await row(placementId), moved);
  await db.query("select set_config('fixture.uid',$1,false)", [other]);
  equal(await v2('2026-10-03', 99, 'Other owner', '2026-10-03'), { saved: false });
  equal(await row(placementId), moved);
  await db.query("select set_config('fixture.uid','',false)");
  await assert.rejects(v2(day, 99, 'No login'), /Not authenticated/); checks++;
  equal(await row(placementId), moved);
  await db.query("select set_config('fixture.uid',$1,false)", [owner]);
  for (const minutes of [-1, 1441]) {
    await assert.rejects(v2('2026-10-03', minutes, 'Invalid', '2026-10-03'), /Minutes must be between/); checks++;
    equal(await row(placementId), moved);
  }
  // If only scheduled_date exists, preserving a same-date note must not
  // manufacture a date or overwrite a deliberately distinct stored date.
  await db.query('update lessons set date=null where id=$1', [placementId]);
  equal((await v2('2026-10-03', 25, 'Fallback date', '2026-10-03')).scheduling_changed, false);
  equal((await row(placementId)).date, null);
  const v2Permissions = (await db.query(`select
    has_function_privilege('anon','public.update_report_lesson_record_v2(uuid,date,integer,text,date)','execute') as anon,
    has_function_privilege('authenticated','public.update_report_lesson_record_v2(uuid,date,integer,text,date)','execute') as authenticated`)).rows[0];
  equal(v2Permissions, { anon: false, authenticated: true });

  await db.exec(readFileSync(new URL('../supabase/rollbacks/20261005161936_preserve_report_note_placement_ROLLBACK.sql', import.meta.url), 'utf8'));
  equal(await call(placementId, 25, 'Rollback smoke'), true);
  equal((await row(placementId)).completed_at.toISOString(), '2026-09-30T12:00:00.000Z');
  equal((await db.query("select to_regprocedure('public.update_report_lesson_record_v2(uuid,date,integer,text,date)') is null as gone")).rows[0].gone, true);

  const permissions = (await db.query(`select
    has_function_privilege('anon','public.update_report_lesson_record(uuid,date,integer,text)','execute') as anon,
    has_function_privilege('authenticated','public.update_report_lesson_record(uuid,date,integer,text)','execute') as authenticated`)).rows[0];
  equal(permissions, { anon: false, authenticated: true });
  console.log(`PASS: ${checks} local SQL/editor assertions; no remote database used.`);
} finally {
  await db.close();
}
