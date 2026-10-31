import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { runInNewContext } from "node:vm";

const require = createRequire(import.meta.url);
const ts = require("typescript") as typeof import("typescript");
type Identity = { id: string; email: string } | null;
type Response = { status: number; body: Record<string, unknown> };

function fixture(route: "admin" | "public", user: Identity, authError = false) {
  const calls: string[] = [];
  const payloads: Record<string, unknown>[] = [];
  const source = readFileSync(new URL(route === "admin"
    ? "../app/api/admin/reviews/route.ts"
    : "../app/api/reviews/route.ts", import.meta.url), "utf8");
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
  const admin = {
    auth: {
      async getUser(token: string) {
        calls.push("auth");
        assert.equal(token, "fixture-token");
        return { data: { user }, error: authError ? { message: "invalid session" } : null };
      },
    },
    from(table: string) {
      assert.equal(table, "reviews");
      calls.push("reviews");
      const query = {
        select(columns: string) { calls.push(`select:${columns}`); return query; },
        eq(column: string, value: unknown) { calls.push(`eq:${column}:${value}`); return query; },
        order() { return query; },
        insert(payload: Record<string, unknown>) { payloads.push(payload); calls.push("insert"); return query; },
        update(payload: Record<string, unknown>) { payloads.push(payload); calls.push("update"); return query; },
        delete() { calls.push("delete"); return query; },
        then(resolve: (value: unknown) => unknown) { return Promise.resolve({ data: [], error: null }).then(resolve); },
      };
      return query;
    },
  };
  const exports: Record<string, (request: Request) => Promise<Response>> = {};
  runInNewContext(compiled, {
    exports,
    require: (name: string) => {
      if (name === "next/server") return { NextResponse: { json: (body: Record<string, unknown>, opts?: { status: number }) => ({ body, status: opts?.status ?? 200 }) } };
      if (name === "@/lib/supabase-admin") return { supabaseAdmin: admin };
      throw new Error(`Unexpected module ${name}`);
    },
  });
  return { calls, payloads, run: (method: string, bearer: boolean, body?: unknown) => exports[method](new Request("https://fixture.invalid/reviews", {
    method,
    headers: { ...(bearer ? { Authorization: "Bearer fixture-token" } : {}), "Content-Type": "application/json" },
    ...(method !== "GET" ? { body: JSON.stringify(body ?? {}) } : {}),
  })) };
}

for (const method of ["GET", "PATCH", "DELETE"]) {
  test(`admin ${method} rejects anonymous access without touching the reviews table`, async () => {
    const f = fixture("admin", null);
    assert.equal((await f.run(method, false, { id: "fixture-review", approved: true })).status, 403);
    assert.deepEqual(f.calls, []);
  });
  test(`admin ${method} rejects a verified ordinary user and forged admin body`, async () => {
    const f = fixture("admin", { id: "ordinary-user", email: "ordinary@example.invalid" });
    assert.equal((await f.run(method, true, { id: "fixture-review", approved: true, email: "garfieldbrittany@gmail.com", is_admin: true })).status, 403);
    assert.deepEqual(f.calls, ["auth"]);
  });
  test(`admin ${method} rejects an invalid session even with an admin-shaped user`, async () => {
    const f = fixture("admin", { id: "admin", email: "garfieldbrittany@gmail.com" }, true);
    assert.equal((await f.run(method, true, { id: "fixture-review", approved: true })).status, 403);
    assert.deepEqual(f.calls, ["auth"]);
  });
  test(`admin ${method} permits a server-verified admin`, async () => {
    const f = fixture("admin", { id: "admin", email: "garfieldbrittany@gmail.com" });
    assert.equal((await f.run(method, true, { id: "fixture-review", approved: true })).status, 200);
    assert.equal(f.calls[0], "auth");
    assert.ok(f.calls.includes("reviews"));
    if (method === "PATCH") assert.equal(f.payloads[0].approved, true);
    if (method === "DELETE") assert.ok(f.calls.includes("eq:id:fixture-review"));
  });
}

const validReview = { name: "Fixture reviewer", rating: 5, review_text: "Fixture only", user_id: "forged-account" };

test("public review listing selects only public fields and approved records", async () => {
  const f = fixture("public", null);
  assert.equal((await f.run("GET", false)).status, 200);
  assert.ok(f.calls.includes("eq:approved:true"));
  assert.ok(f.calls.includes("select:id, name, rating, review_text, created_at"));
  assert.ok(!f.calls.includes("auth"));
});

test("anonymous review cannot impersonate an account and stays pending", async () => {
  const f = fixture("public", null);
  assert.equal((await f.run("POST", false, validReview)).status, 200);
  assert.equal(f.payloads[0].user_id, null);
  assert.equal(f.payloads[0].approved, false);
});

test("signed-in review uses verified identity instead of caller-supplied user id", async () => {
  const f = fixture("public", { id: "verified-user", email: "ordinary@example.invalid" });
  assert.equal((await f.run("POST", true, validReview)).status, 200);
  assert.equal(f.payloads[0].user_id, "verified-user");
  assert.equal(f.payloads[0].approved, false);
});

test("invalid review session refuses before any review insert", async () => {
  const f = fixture("public", null, true);
  assert.equal((await f.run("POST", true, validReview)).status, 401);
  assert.deepEqual(f.calls, ["auth"]);
  assert.equal(f.payloads.length, 0);
});
