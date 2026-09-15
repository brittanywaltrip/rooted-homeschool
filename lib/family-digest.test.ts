// The weekly family digest runs dry until the founder turns it on.
// Run with: npm test

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { emailDomain, escapeHtml, familyDigestMode, runFamilyDigest, type DigestClient, type DigestDeps } from "./family-digest.ts";

type Row = Record<string, unknown>;

function fakeClient(tables: Record<string, Row[]>): DigestClient {
  return {
    from(table: string) {
      return {
        select() {
          const filters: ((r: Row) => boolean)[] = [];
          const run = () => ({ data: (tables[table] ?? []).filter((r) => filters.every((f) => f(r))), error: null });
          const q = {
            eq(c: string, v: unknown) { filters.push((r) => r[c] === v); return q; },
            gte(c: string, v: unknown) { filters.push((r) => String(r[c]) >= String(v)); return q; },
            order() { return q; },
            limit() { return q; },
            maybeSingle() { return Promise.resolve({ data: run().data[0] ?? null, error: null }); },
            then<T>(res: (v: { data: Row[]; error: null }) => T) { return Promise.resolve(run()).then(res); },
          };
          return q;
        },
      };
    },
  } as unknown as DigestClient;
}

const NOW = new Date("2026-09-20T15:00:00Z");

function tables(): Record<string, Row[]> {
  return {
    family_invites: [
      { id: "i1", token: "tok-1", email: "grandma@example.com", viewer_name: "Grandma", user_id: "fam-1", trial_ends_at: null, is_active: true, email_opt_out: false },
      { id: "i2", token: "tok-2", email: "uncle@mail.test", viewer_name: "Uncle Joe", user_id: "fam-1", trial_ends_at: "2027-01-01T00:00:00Z", is_active: true, email_opt_out: false },
    ],
    profiles: [{ id: "fam-1", display_name: "The Waltrips", first_name: "B", is_pro: true, subscription_status: "active" }],
    memories: [
      { id: "m1", user_id: "fam-1", type: "photo", title: "Zoo", photo_url: "u/1.jpg", child_id: null, family_visible: true, created_at: "2026-09-18T10:00:00Z" },
      { id: "m2", user_id: "fam-1", type: "win", title: "Read a whole book", photo_url: null, child_id: "c1", family_visible: true, created_at: "2026-09-19T10:00:00Z" },
    ],
    children: [{ id: "c1", name: "Zoe", user_id: "fam-1", archived: false }],
  };
}

function deps(over: Partial<DigestDeps>, sendCalls: unknown[], logs: string[]): DigestDeps {
  return {
    client: fakeClient(tables()),
    mode: familyDigestMode(undefined),
    canSend: async () => ({ allowed: true }),
    signPhotos: async (paths) => paths.map((p) => `https://signed/${p}`),
    send: async (args) => { sendCalls.push(args); return { ok: true }; },
    unsubscribeHeaders: (token) => ({ "List-Unsubscribe": `<https://x/${token}>` }),
    log: (line) => logs.push(line),
    now: NOW,
    ...over,
  };
}

test("with the flag unset the digest sends nothing and reports what it would send", async () => {
  assert.equal(familyDigestMode(undefined), "dry");
  assert.equal(familyDigestMode(""), "dry");
  assert.equal(familyDigestMode("yes"), "dry", "anything but live is a dry run");
  const sendCalls: unknown[] = [];
  const logs: string[] = [];
  const out = await runFamilyDigest(deps({}, sendCalls, logs));
  assert.deepEqual(out, { mode: "dry", wouldSend: 2, sent: 0, skipped: 0 });
  assert.equal(sendCalls.length, 0, "no email leaves in a dry run");
  assert.ok(logs.includes("[cron/family-digest] DRY would send to example.com for family fam-1: 2 memories"));
  assert.ok(logs.includes("[cron/family-digest] DRY would send to mail.test for family fam-1: 2 memories"));
  assert.ok(logs.some((l) => l.includes("summary: mode=dry wouldSend=2 sent=0 skipped=0")));
  for (const l of logs) assert.ok(!/[\w.+-]+@[\w-]+\.[\w.]+/.test(l), `no full address in a log line: ${l}`);
});

test('with "live" it calls the sender for each viewer', async () => {
  assert.equal(familyDigestMode(" LIVE "), "live");
  const sendCalls: { to: string; variables: Record<string, string> }[] = [];
  const logs: string[] = [];
  const out = await runFamilyDigest(deps({ mode: familyDigestMode("live") }, sendCalls, logs));
  assert.deepEqual(out, { mode: "live", wouldSend: 2, sent: 2, skipped: 0 });
  assert.deepEqual(sendCalls.map((c) => c.to).sort(), ["grandma@example.com", "uncle@mail.test"]);
  assert.equal(sendCalls[0].variables.familyName, "The Waltrips");
  assert.match(sendCalls[0].variables.highlights, /Zoe: Read a whole book/);
  for (const l of logs) assert.ok(!l.includes("@"), `no full address in a log line: ${l}`);
});

test("an owner who unsubscribed is skipped, and a lapsed trial without a paid parent gets nothing", async () => {
  const t = tables();
  t.profiles[0].is_pro = false;
  t.family_invites[1].trial_ends_at = "2026-01-01T00:00:00Z";
  const sendCalls: unknown[] = [];
  const out = await runFamilyDigest(deps({ client: fakeClient(t), mode: "live" }, sendCalls, []));
  assert.equal(out.sent, 1, "only the viewer whose link never ends");
  const skipped = await runFamilyDigest(deps({ canSend: async () => ({ allowed: false, reason: "unsubscribed" }) }, [], []));
  assert.deepEqual(skipped, { mode: "dry", wouldSend: 0, sent: 0, skipped: 2 });
});

test("emailDomain never returns the local part", () => {
  assert.equal(emailDomain("grandma@example.com"), "example.com");
  assert.equal(emailDomain("no-at-sign"), "(no domain)");
  assert.equal(emailDomain(null), "(no domain)");
});

test("the digest is scheduled Sundays at 15:00 UTC and the route reads the flag", () => {
  const vercel = JSON.parse(readFileSync(resolve(import.meta.dirname, "..", "vercel.json"), "utf8")) as { crons: { path: string; schedule: string }[] };
  assert.deepEqual(vercel.crons.find((c) => c.path === "/api/cron/family-digest"), { path: "/api/cron/family-digest", schedule: "0 15 * * 0" });
  const route = readFileSync(resolve(import.meta.dirname, "..", "app/api/cron/family-digest/route.ts"), "utf8");
  assert.match(route, /familyDigestMode\(process\.env\.FAMILY_DIGEST_MODE\)/);
  assert.match(route, /return NextResponse\.json\(result\)/);
  assert.ok(!/console\.(log|error)\([^)]*inv\.email/.test(route), "the route never logs an address");
});

test("a win title a family typed is escaped before it goes into the email HTML", async () => {
  assert.equal(escapeHtml(`Finished chapter <3 & "loved" it`), "Finished chapter &lt;3 &amp; &quot;loved&quot; it");
  const t = tables();
  t.memories[1].title = "Finished chapter <3";
  const sendCalls: { variables: Record<string, string> }[] = [];
  await runFamilyDigest(deps({ client: fakeClient(t), mode: "live" }, sendCalls, []));
  assert.match(sendCalls[0].variables.highlights, /Zoe: Finished chapter &lt;3/);
  assert.ok(!sendCalls[0].variables.highlights.includes("<3"));
});
