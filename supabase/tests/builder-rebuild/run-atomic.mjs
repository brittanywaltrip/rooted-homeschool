// Local synthetic PostgreSQL rehearsal of 20261001000000 without a server.
// Pass the absolute path to an independently installed @electric-sql/pglite/dist/index.js.
// Runs the 20260930200903 assertions against the new function first, then the
// atomic settings assertions, then the 20261005000000 unslotted-date
// assertions and a rollback round trip. No app dependency or remote database is used.
import { readFileSync, readdirSync } from 'node:fs';
import { isAbsolute } from 'node:path';
import { pathToFileURL } from 'node:url';
const modulePath = process.argv[2];
if (!modulePath || !isAbsolute(modulePath)) throw new Error('Pass an absolute PGlite module path');
const { PGlite } = await import(pathToFileURL(modulePath).href);
const db = new PGlite();
try {
  const sql = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
  await db.exec(sql('./stub.sql').replace('create extension if not exists pgcrypto;', '-- Built-in gen_random_uuid.'));
  await db.exec(sql('./live-triggers.sql'));
  const migrations = readdirSync(new URL('../../migrations/', import.meta.url)).filter(n => n.includes('apply_builder_rebuild')).sort();
  for (const name of migrations) await db.exec(sql(`../../migrations/${name}`));
  console.log(`loaded ${migrations.length} migrations, last ${migrations.at(-1)}`);
  await db.exec(sql('./unslotted.sql'));
  console.log(`PASS ${(await db.query('select count(*)::int n from unslotted_checks')).rows[0].n} unslotted preservation assertions against the new function`);
  await db.exec(sql('./atomic.sql'));
  const rows = (await db.query('select label from atomic_checks order by label')).rows;
  for (const r of rows) console.log('  ok', r.label);
  console.log(`PASS ${rows.length} atomic settings assertions`);
  await db.exec(sql('./unslotted-dates.sql'));
  const dates = (await db.query('select label from dates_checks order by label')).rows;
  for (const r of dates) console.log('  ok', r.label);
  console.log(`PASS ${dates.length} unslotted date assertions`);
  const assert = (await import('node:assert/strict')).default;
  await db.query("select pg_temp.reset_atomic()");
  const [{ e }] = (await db.query("select pg_temp.expected_now() || jsonb_build_object('current_lesson_after', 1, 'rows_after_settings', pg_temp.rows_now()) e")).rows;
  const plan = (await db.query('select pg_temp.empty_plan() p')).rows[0].p;
  await db.query("select set_config('request.jwt.claims','{\"sub\":\"bbbbbbbb-0000-4000-8000-000000000002\"}',false)");
  await db.exec('set role authenticated');
  const other = (await db.query("select public.apply_builder_rebuild('aaaaaaaa-0000-4000-8000-000000000001',current_date,$1::jsonb,$2::jsonb,'{\"lessons_per_day\":2}'::jsonb) r", [e, plan])).rows[0].r;
  assert.equal(other.reason, 'not_owner');
  await db.exec('reset role');
  assert.equal((await db.query('select lessons_per_day from public.curriculum_goals')).rows[0].lessons_per_day, 1);
  console.log('PASS another family cannot write settings through the five-argument form');
  await db.exec('set role anon');
  await assert.rejects(db.query("select public.apply_builder_rebuild('aaaaaaaa-0000-4000-8000-000000000001',current_date,'{}','{}','{}')"), err => err.code === '42501');
  await db.exec('reset role');
  console.log('PASS anon cannot execute the five-argument form');
  const fns = (await db.query("select oid::regprocedure::text sig, prosecdef, proconfig from pg_proc where proname='apply_builder_rebuild' order by 1")).rows;
  assert.equal(fns.length, 2);
  for (const f of fns) { assert.equal(f.prosecdef, true, f.sig); assert.ok(f.proconfig.includes('search_path=pg_catalog, pg_temp'), f.sig); }
  console.log('PASS both forms keep security definer and the restricted search path');
  const log = (await db.query("select has_table_privilege('authenticated','rooted_private.builder_commit_log','select') s")).rows[0].s;
  assert.equal(log, false);
  console.log('PASS the commit log is not readable by families');
  // Rollback round trip: the rollback restores the exact live bodies, and the
  // migration re-applies cleanly over them.
  const md5s = async () => (await db.query("select (select md5(prosrc) from pg_proc where proname='curriculum_goals_cleanup_orphans_trg') trg, (select md5(prosrc) from pg_proc where oid='public.apply_builder_rebuild(uuid,date,jsonb,jsonb,jsonb)'::regprocedure) rpc")).rows[0];
  const after = await md5s();
  const trgAttrs = async () => (await db.query("select prosecdef, proconfig from pg_proc where proname='curriculum_goals_cleanup_orphans_trg'")).rows[0];
  assert.deepEqual(await trgAttrs(), { prosecdef: true, proconfig: ['search_path=public, pg_temp'] });
  await db.exec(sql('../../rollbacks/apply_builder_rebuild_unslotted_dates.sql'));
  assert.deepEqual(await md5s(), { trg: '1f0dc993d0b17dea8d9aa086cb449128', rpc: 'cd42d97e39e060c98cf3e610c33bcbf5' });
  assert.deepEqual(await trgAttrs(), { prosecdef: true, proconfig: ['search_path=public, pg_temp'] });
  const migs = readdirSync(new URL('../../migrations/', import.meta.url)).filter(n => n.includes('unslotted_dates'));
  await db.exec(sql(`../../migrations/${migs[0]}`));
  assert.deepEqual(await md5s(), after);
  console.log(`PASS rollback restores the live bodies and the migration re-applies (trigger ${after.trg}, rebuild ${after.rpc})`);
} catch (err) {
  console.error({ message: err.message, where: err.where, detail: err.detail });
  process.exitCode = 1;
} finally {
  await db.close();
}
