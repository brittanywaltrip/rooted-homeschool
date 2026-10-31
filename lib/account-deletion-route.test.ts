import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { runInNewContext } from "node:vm";
import { prepareDeletionBilling } from "./account-deletion-billing.ts";
import type { DeletionSubscriptions } from "./account-deletion-billing.ts";
import type { SweepResult } from "./storage-cleanup.ts";

// Execute the actual route with isolated fake providers. No credentials, HTTP,
// storage writes, billing changes, or outbound email are used by these tests.
const require = createRequire(import.meta.url);
const ts = require("typescript") as typeof import("typescript");
const source = readFileSync(new URL("../app/api/account/delete/route.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;

function routeFixture(profileError: unknown = null, cancelFails = false, storageResults: SweepResult[] = [], deleteFailure?: string) {
  const events: string[] = [];
  const deleteScopes: { table: string; column: string; id: string }[] = [];
  let status: "active" | "canceled" = "active";
  const subscriptions: DeletionSubscriptions = {
    async list() { events.push("billing:list"); return { data: [{ id: "sub_test", status }], has_more: false }; },
    async cancel() {
      events.push("billing:cancel");
      if (cancelFails) throw new Error("Stripe unavailable");
      status = "canceled";
      return { id: "sub_test", status };
    },
  };
  const admin = {
    auth: {
      async getUser() { return { data: { user: { id: "user_test", email: "test@example.invalid" } }, error: null }; },
      admin: { async deleteUser() { events.push("auth:delete"); return { error: deleteFailure === "auth" ? { message: "auth failed" } : null }; } },
    },
    from(table: string) {
      let deleting = false;
      const query = {
        select() { return query; },
        eq(column: string, id: string) {
          if (deleting) {
            assert.equal(id, "user_test", "every explicit deletion must use the authenticated owner");
            assert.equal(column, table === "profiles" ? "id" : "user_id");
            deleteScopes.push({ table, column, id });
          }
          return query;
        },
        order() { return query; }, limit() { return query; },
        async single() {
          events.push("profile:read");
          return { data: { stripe_customer_id: "cus_test", stripe_subscription_id: "sub_test" }, error: profileError };
        },
        async maybeSingle() { return { data: null, error: null }; },
        delete() { deleting = true; events.push(`delete:${table}`); return query; },
        insert() { events.push(`insert:${table}`); return query; },
        then(resolve: (value: unknown) => unknown) {
          return Promise.resolve({ error: deleting && table === deleteFailure ? { message: "delete failed" } : null, count: 0 }).then(resolve);
        },
      };
      return query;
    },
  };
  const modules: Record<string, unknown> = {
    "next/server": { NextResponse: { json: (body: unknown, options?: { status: number }) => ({ body, status: options?.status ?? 200 }) } },
    "@/lib/supabase-admin": { supabaseAdmin: admin },
    "@/lib/api-clients": {
      stripeClient: () => ({ subscriptions }),
      resendClient: () => ({ emails: { async send() { events.push("email:send"); } } }),
    },
    "@/lib/email-footer": { emailFooterHtml: () => "" },
    "@/lib/sentry-error": { captureSupabaseError: () => events.push("error:capture") },
    "@/lib/account-deletion-billing": { prepareDeletionBilling },
    "@/lib/storage-cleanup": {
      async deleteAllUserStorage() { events.push("storage:delete"); return storageResults; },
      unremovedCount: (results: SweepResult[]) => results.reduce((sum, row) => sum + row.found - row.removed, 0),
      summarize: () => "fixture",
    },
  };
  const exports: { DELETE?: (req: unknown) => Promise<{ status: number; body: { dataDeleted?: boolean; success?: boolean } }> } = {};
  runInNewContext(compiled, {
    exports, console: { log() {}, warn() {}, error() {} },
    require: (name: string) => {
      if (!(name in modules)) throw new Error(`Unexpected import ${name}`);
      return modules[name];
    },
  });
  return {
    events,
    deleteScopes,
    setStorageResults: (results: SweepResult[]) => { storageResults = results; },
    run: () => exports.DELETE!({ headers: { get: () => "Bearer fixture" } }),
  };
}

test("actual deletion route preserves all data and sends no email when profile lookup fails", async () => {
  const f = routeFixture({ message: "database unavailable" });
  const response = await f.run();
  assert.equal(response.status, 503);
  assert.equal(response.body.dataDeleted, false);
  assert.deepEqual(f.events, ["profile:read", "error:capture"]);
});

test("actual deletion route preserves all data and sends no email when cancellation fails", async () => {
  const f = routeFixture(null, true);
  const response = await f.run();
  assert.equal(response.status, 503);
  assert.equal(response.body.dataDeleted, false);
  assert.deepEqual(f.events, ["profile:read", "billing:list", "billing:cancel", "error:capture"]);
});

test("actual route completes billing cancellation and recheck before its first write", async () => {
  const f = routeFixture();
  const response = await f.run();
  assert.equal(response.status, 200);
  assert.equal(response.body.success, true);
  assert.deepEqual(f.events.slice(0, 4), ["profile:read", "billing:list", "billing:cancel", "billing:list"]);
  assert.ok(f.events.indexOf("insert:deleted_accounts") > 3);
  assert.ok(f.events.indexOf("storage:delete") > 3);
  assert.ok(f.events.indexOf("delete:profiles") > 3);
  assert.ok(f.events.indexOf("auth:delete") > 3);
});

test("storage failure preserves records and login, sends no email, and permits cleanup retry", async () => {
  const f = routeFixture(null, false, [{ bucket: "memory-photos", found: 2, removed: 1, errors: ["remove failed"] }]);
  const response = await f.run();
  assert.equal(response.status, 503);
  assert.equal(response.body.dataDeleted, false);
  assert.ok(f.events.includes("storage:delete"));
  assert.ok(!f.events.some(event => /^(delete:|insert:|auth:delete|email:send)/.test(event)));
  f.setStorageResults([]);
  const retry = await f.run();
  assert.equal(retry.status, 200);
  assert.equal(f.events.filter(event => event === "billing:cancel").length, 1);
  assert.equal(f.events.filter(event => event === "email:send").length, 1);
});

test("storage list errors refuse even when no leftover files were counted", async () => {
  const f = routeFixture(null, false, [{ bucket: "memories", found: 0, removed: 0, errors: ["list failed"] }]);
  assert.equal((await f.run()).status, 503);
  assert.ok(!f.events.some(event => /^(delete:|insert:|auth:delete|email:send)/.test(event)));
});

test("record deletion failure stops before removing profile or login and sends no success email", async () => {
  const f = routeFixture(null, false, [], "lessons");
  const response = await f.run();
  assert.equal(response.status, 500);
  assert.equal(response.body.dataDeleted, true);
  assert.ok(f.events.includes("delete:lessons"));
  assert.ok(!f.events.includes("delete:profiles"));
  assert.ok(!f.events.includes("auth:delete"));
  assert.ok(!f.events.includes("email:send"));
});

test("auth deletion failure returns partial status and sends no success email", async () => {
  const f = routeFixture(null, false, [], "auth");
  const response = await f.run();
  assert.equal(response.status, 500);
  assert.equal(response.body.dataDeleted, true);
  assert.ok(f.events.includes("auth:delete"));
  assert.ok(!f.events.includes("email:send"));
});

test("non-cascading family tables are explicitly deleted using the authenticated owner", async () => {
  const f = routeFixture();
  assert.equal((await f.run()).status, 200);
  for (const table of ["daily_reflections", "child_ui_prefs", "app_events"]) {
    assert.deepEqual(f.deleteScopes.find(scope => scope.table === table), { table, column: "user_id", id: "user_test" });
    assert.ok(f.events.indexOf(`delete:${table}`) < f.events.indexOf("auth:delete"));
  }
});

test("a reflection deletion error stops before profile/login removal and reports partial completion", async () => {
  const f = routeFixture(null, false, [], "daily_reflections");
  const response = await f.run();
  assert.equal(response.status, 500);
  assert.equal(response.body.dataDeleted, true);
  assert.ok(!f.events.includes("delete:profiles"));
  assert.ok(!f.events.includes("auth:delete"));
  assert.ok(!f.events.includes("email:send"));
});
