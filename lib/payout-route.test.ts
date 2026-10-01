import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { runInNewContext } from "node:vm";
import { buildPayoutSummary, readAllLedgerRows } from "./payout-ledger.ts";

const require = createRequire(import.meta.url);
const ts = require("typescript") as typeof import("typescript");

function fixture(email: string | null, failedTable?: string, inactive = false, paid = true) {
  const reads: string[] = [];
  const data: Record<string, unknown[]> = {
    affiliates: [{ id: "a", code: "TEST", name: "Test", is_active: !inactive, paypal_email: null, payment_method: null }],
    referrals: [{ id: "r", affiliate_code: "TEST", converted: true, commission_amount: 7.8, created_at: "2026-08-01T12:00:00Z" }],
    commission_payments: paid ? [{ id: "p", affiliate_code: "TEST", amount: 7.8, month: "2026-08" }] : [],
  };
  const source = readFileSync(new URL("../app/api/admin/affiliate-payouts/route.ts", import.meta.url), "utf8");
  const exports: { GET?: (req: Request) => Promise<{ status: number; body: { payouts?: { commission_cents: number }[] } }> } = {};
  runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, {
    exports, Date,
    require: (name: string) => {
      if (name === "next/server") return { NextResponse: { json: (body: unknown, options?: { status: number }) => ({ body, status: options?.status ?? 200 }) } };
      if (name === "@/lib/payout-ledger") return { buildPayoutSummary, readAllLedgerRows };
      if (name === "@/lib/supabase-admin") return { supabaseAdmin: {
        auth: { getUser: async () => ({ data: { user: email ? { email } : null }, error: null }) },
        from: (table: string) => {
          reads.push(table);
          const query = {
            select: () => query, eq: () => query, order: () => query,
            range: async (from: number, to: number) => ({
              data: table === failedTable ? null : data[table].slice(from, to + 1),
              error: table === failedTable ? new Error("read failed") : null,
            }),
          };
          return query;
        },
      } };
      throw new Error(`Unexpected dependency ${name}`);
    },
  });
  return { reads, run: (token = true) => exports.GET!(new Request("https://fixture.invalid", {
    headers: token ? { Authorization: "Bearer fixture-token" } : {},
  })) };
}

test("anonymous and ordinary accounts cannot read the payout ledgers", async () => {
  for (const [email, token, status] of [[null, false, 401], ["family@example.invalid", true, 403]] as const) {
    const f = fixture(email);
    assert.equal((await f.run(token)).status, status);
    assert.equal(f.reads.length, 0);
  }
});

test("admin gets the unpaid balance rather than repeat payment instructions", async () => {
  const f = fixture("garfieldbrittany@gmail.com");
  const result = await f.run();
  assert.equal(result.status, 200);
  assert.equal(result.body.payouts![0].commission_cents, 0);
});

for (const table of ["affiliates", "referrals", "commission_payments"]) {
  test(`${table} read failure returns 503, never a successful partial total`, async () => {
    const result = await fixture("garfieldbrittany@gmail.com", table).run();
    assert.equal(result.status, 503);
    assert.equal(result.body.payouts, undefined);
  });
}

test("inactive partners with unpaid balances still have a payout card", async () => {
  const result = await fixture("garfieldbrittany@gmail.com", undefined, true, false).run();
  assert.equal(result.status, 200);
  assert.equal(result.body.payouts![0].commission_cents, 780);
});
test("inactive partners paid in full do not create empty payout cards", async () => {
  const result = await fixture("garfieldbrittany@gmail.com", undefined, true, true).run();
  assert.equal(result.status, 200);
  assert.equal(result.body.payouts!.length, 0);
});
