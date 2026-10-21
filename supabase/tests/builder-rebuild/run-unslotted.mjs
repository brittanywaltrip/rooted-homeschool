// Local synthetic PostgreSQL rehearsal without a server. Pass the absolute
// path to an independently installed @electric-sql/pglite/dist/index.js.
// App dependencies and remote Supabase databases are never used.
import { readFileSync, readdirSync } from 'node:fs';
import { isAbsolute } from 'node:path';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';
const modulePath = process.argv[2];
if (!modulePath || !isAbsolute(modulePath)) throw new Error('Pass an absolute PGlite module path');
const { PGlite } = await import(pathToFileURL(modulePath).href);
const db = new PGlite();
try {
  const sql = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
  // gen_random_uuid() is built into this PostgreSQL engine; the minimal fixture
  // needs no additional pgcrypto functions. All other fixture SQL is unchanged.
  await db.exec(sql('./stub.sql').replace('create extension if not exists pgcrypto;', '-- Built-in gen_random_uuid.'));
  for (const name of readdirSync(new URL('../../migrations/', import.meta.url)).filter(n => n.includes('apply_builder_rebuild')).sort()) {
    await db.exec(sql(`../../migrations/${name}`));
  }
  await db.exec(sql('./unslotted.sql'));
  const checks = (await db.query('select label from unslotted_checks order by label')).rows;
  console.log(`PASS ${checks.length} PostgreSQL preservation/refusal assertions`);
  await db.query('select pg_temp.reset_unslotted()');
  const [{ e, p }] = (await db.query('select pg_temp.unslotted_expected() e, pg_temp.unslotted_plan() p')).rows;
  await db.exec('set role authenticated');
  let result = (await db.query("select public.apply_builder_rebuild('aaaaaaaa-0000-4000-8000-000000000001',current_date,$1::jsonb,$2::jsonb) result", [e, p])).rows[0].result;
  assert.equal(result.status, 'applied', JSON.stringify(result));
  await db.exec('reset role');
  console.log('PASS authenticated owner executes the guarded rebuild');
  await db.query("select set_config('request.jwt.claims','{\"sub\":\"bbbbbbbb-0000-4000-8000-000000000002\"}',false)");
  await db.exec('set role authenticated');
  result = (await db.query("select public.apply_builder_rebuild('aaaaaaaa-0000-4000-8000-000000000001',current_date,$1::jsonb,$2::jsonb) result", [e, p])).rows[0].result;
  assert.equal(result.reason, 'not_owner');
  await db.exec('reset role');
  console.log('PASS another family is refused');
  await db.exec('set role anon');
  await assert.rejects(db.query("select public.apply_builder_rebuild('aaaaaaaa-0000-4000-8000-000000000001',current_date,'{}','{}')"), err => err.code === '42501');
  await db.exec('reset role');
  console.log('PASS anon cannot execute');
  const [{ config, definer }] = (await db.query("select proconfig config, prosecdef definer from pg_proc where oid='public.apply_builder_rebuild(uuid,date,jsonb,jsonb)'::regprocedure")).rows;
  assert.equal(definer, true); // Existing narrow privileged RPC: ownership still required.
  assert.ok(config.includes('search_path=pg_catalog, pg_temp'));
  console.log('PASS existing restricted search path and privilege model retained');
} catch (err) {
  console.error({ message: err.message, where: err.where, detail: err.detail });
  process.exitCode = 1;
} finally {
  await db.close();
}
