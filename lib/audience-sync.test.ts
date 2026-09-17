// Tests for lib/audience-sync.ts with fakes for Resend and the database.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  activeUserIdsFrom,
  audienceSince,
  runAudienceSync,
  type AudienceFamily,
  type AudienceSyncDeps,
} from "./audience-sync.ts";
import type { ResendContact, ResendResult } from "./resend-contacts.ts";
import { WEEKLY_AUDIENCE_DAYS } from "./weekly-summary.ts";

const OK: ResendResult = { ok: true, status: 200, json: null };

function fam(id: string, over: Partial<AudienceFamily> = {}): AudienceFamily {
  return {
    userId: id, email: `${id}@example.com`, firstName: "Anna", displayName: null,
    onboarded: true, emailUnsubscribed: false, emailMarketing: true, ...over,
  };
}
function contact(id: string, email: string, over: Partial<ResendContact> = {}): ResendContact {
  return { id, email, first_name: "Anna", last_name: null, unsubscribed: false, ...over };
}

function harness(opts: {
  families: AudienceFamily[];
  active: string[];
  all?: ResendContact[];
  segment?: ResendContact[];
  suppressed?: string[];
  dry?: boolean;
  maxWrites?: number;
  markOk?: boolean;
  createStatus?: number;
}) {
  const writes: string[] = [];
  const profileWrites: string[][] = [];
  const logs: string[] = [];
  const deps: AudienceSyncDeps = {
    dry: opts.dry,
    segmentId: "seg",
    maxWrites: opts.maxWrites,
    listAllContacts: async () => opts.all ?? opts.segment ?? [],
    listSegmentContacts: async () => opts.segment ?? [],
    loadFamilies: async () => opts.families,
    loadActiveUserIds: async () => new Set(opts.active),
    suppressed: new Set(opts.suppressed ?? []),
    isInternalEmail: (e) => e.startsWith("rooted.e2e@") || e === "staff@rootedhomeschoolapp.com",
    markUnsubscribed: async (fs) => { profileWrites.push(fs.map((f) => f.userId)); return opts.markOk ?? true; },
    createContact: async (a) => { writes.push(`create ${a.email} ${a.firstName}`); return opts.createStatus ? { ok: false, status: opts.createStatus, json: null, error: "x" } : OK; },
    updateContactName: async (id, n) => { writes.push(`rename ${id} ${n}`); return OK; },
    addToSegment: async (id) => { writes.push(`add ${id}`); return OK; },
    removeFromSegment: async (id) => { writes.push(`remove ${id}`); return OK; },
    log: (l) => logs.push(l),
  };
  return { deps, writes, profileWrites, logs };
}

// ── active ──

test("active_30d is the weekly summary's window and rule", () => {
  assert.equal(WEEKLY_AUDIENCE_DAYS, 30);
  assert.equal(audienceSince(new Date("2026-09-16T12:00:00Z")), "2026-08-17");
  const ids = activeUserIdsFrom(
    [{ user_id: "a", scheduled_date: "2026-09-01" }, { user_id: null, scheduled_date: "2026-09-01" }, { user_id: "x", scheduled_date: null }],
    [{ user_id: "b", date: "2026-09-02" }, { user_id: "y", date: null }],
  );
  assert.deepEqual([...ids].sort(), ["a", "b"]);
});

test("the sync route reads activity with the same filters as the weekly summary", () => {
  const weekly = readFileSync(new URL("../app/api/cron/weekly-summary/route.ts", import.meta.url), "utf8");
  const sync = readFileSync(new URL("../app/api/cron/sync-audience/route.ts", import.meta.url), "utf8");
  for (const fragment of [
    ".from('lessons')",
    ".eq('completed', true)",
    ".gte('scheduled_date', since)",
    ".from('memories')",
    ".gte('date', since)",
  ]) {
    assert.ok(weekly.includes(fragment), `weekly-summary has ${fragment}`);
    assert.ok(sync.includes(fragment), `sync-audience has ${fragment}`);
  }
  assert.ok(weekly.includes("WEEKLY_AUDIENCE_DAYS"));
  assert.ok(sync.includes("audienceSince("));
});

test("the sync route is scheduled daily at 12:00 UTC", () => {
  const cfg = JSON.parse(readFileSync(new URL("../vercel.json", import.meta.url), "utf8")) as { crons: { path: string; schedule: string }[] };
  assert.deepEqual(cfg.crons.find((c) => c.path === "/api/cron/sync-audience"), { path: "/api/cron/sync-audience", schedule: "0 12 * * *" });
});

// ── pull ──

test("pull: a contact unsubscribed in Resend sets the profile flag", async () => {
  const h = harness({
    families: [fam("u1")],
    active: ["u1"],
    all: [contact("c1", "U1@Example.com", { unsubscribed: true })],
    segment: [contact("c1", "U1@Example.com", { unsubscribed: true })],
  });
  const r = await runAudienceSync(h.deps);
  assert.equal(r.pulledUnsubscribes, 1);
  assert.deepEqual(h.profileWrites, [["u1"]]);
  // And the family is then not pushed, and leaves the audience.
  assert.deepEqual(h.writes, ["remove c1"]);
  assert.equal(r.markedIneligible, 1);
});

test("pull: a subscribed contact never clears a profile flag that is already true", async () => {
  const h = harness({
    families: [fam("u1", { emailUnsubscribed: true })],
    active: ["u1"],
    all: [contact("c1", "u1@example.com", { unsubscribed: false })],
    segment: [contact("c1", "u1@example.com")],
  });
  const r = await runAudienceSync(h.deps);
  assert.equal(r.pulledUnsubscribes, 0);
  assert.deepEqual(h.profileWrites, []);
  // Still unsubscribed in Rooted, so taken out of the audience.
  assert.deepEqual(h.writes, ["remove c1"]);
});

test("pull: an already-flagged profile is not written again", async () => {
  const h = harness({
    families: [fam("u1", { emailUnsubscribed: true })],
    active: [],
    all: [contact("c1", "u1@example.com", { unsubscribed: true })],
  });
  const r = await runAudienceSync(h.deps);
  assert.equal(r.pulledUnsubscribes, 0);
  assert.deepEqual(h.profileWrites, []);
});

test("pull: a failed profile write stops the run before any Resend write", async () => {
  const h = harness({
    families: [fam("u1"), fam("u2")],
    active: ["u1", "u2"],
    all: [contact("c1", "u1@example.com", { unsubscribed: true })],
    markOk: false,
  });
  const r = await runAudienceSync(h.deps);
  assert.equal(r.errors, 1);
  assert.deepEqual(h.writes, []);
});

// ── push ──

test("push: an eligible family is added with a cleaned first name; ineligible ones are not", async () => {
  const h = harness({
    families: [
      fam("ok", { firstName: " The ", displayName: "Kate Smith" }),
      fam("unsub", { emailUnsubscribed: true }),
      fam("nomarketing", { emailMarketing: false }),
      fam("suppressed"),
      fam("internal", { email: "rooted.e2e@rootedhomeschoolapp.com" }),
      fam("notonboarded", { onboarded: false }),
      fam("quiet"),
      fam("nullflags", { emailUnsubscribed: null, emailMarketing: null, firstName: null }),
    ],
    active: ["ok", "unsub", "nomarketing", "suppressed", "internal", "notonboarded", "nullflags"],
    suppressed: ["suppressed@example.com"],
  });
  const r = await runAudienceSync(h.deps);
  assert.deepEqual(h.writes, ["create nullflags@example.com there", "create ok@example.com Kate"]);
  assert.equal(r.pushedNew, 2);
  assert.equal(r.audienceSize, 2);
});

test("push: an existing contact joins the segment and gets its name fixed, and is never resubscribed", async () => {
  const h = harness({
    families: [fam("a", { firstName: "Beth" }), fam("b"), fam("c")],
    active: ["a", "b", "c"],
    all: [
      contact("ca", "a@example.com", { first_name: "Mrs" }),
      contact("cb", "b@example.com", { first_name: "Anna" }),
      contact("cc", "c@example.com", { unsubscribed: true }),
    ],
    segment: [contact("cb", "b@example.com", { first_name: "Anna" })],
  });
  const r = await runAudienceSync(h.deps);
  // cc is unsubscribed in Resend: step 1 marks the family, so it is neither added nor resubscribed.
  assert.deepEqual(h.writes, ["add ca", "rename ca Beth"]);
  assert.deepEqual([r.pushedNew, r.pushedUpdated, r.pulledUnsubscribes], [1, 1, 1]);
});

test("push: the write budget defers the rest to tomorrow", async () => {
  const h = harness({ families: [fam("a"), fam("b"), fam("c")], active: ["a", "b", "c"], maxWrites: 2 });
  const r = await runAudienceSync(h.deps);
  assert.equal(r.pushedNew, 2);
  assert.equal(r.deferred, 1);
});

test("push: a failed create is an error, not a crash, and the run goes on", async () => {
  const h = harness({ families: [fam("a"), fam("b")], active: ["a", "b"], createStatus: 422 });
  const r = await runAudienceSync(h.deps);
  assert.equal(r.errors, 2);
  assert.deepEqual(r.failures.map((f) => f.userId), ["a", "b"]);
});

// ── gap ──

test("gap: a contact who has gone quiet is taken out of the audience, not deleted or unsubscribed", async () => {
  const h = harness({
    families: [fam("quiet"), fam("busy")],
    active: ["busy"],
    segment: [contact("cq", "quiet@example.com"), contact("cb", "busy@example.com")],
  });
  const r = await runAudienceSync(h.deps);
  assert.deepEqual(h.writes, ["remove cq"]);
  assert.equal(r.markedIneligible, 1);
  assert.equal(r.audienceSize, 1);
  assert.deepEqual(h.profileWrites, []);
});

test("gap: a contact with no Rooted family is taken out too", async () => {
  const h = harness({ families: [], active: [], segment: [contact("cx", "stranger@example.com")] });
  const r = await runAudienceSync(h.deps);
  assert.deepEqual(h.writes, ["remove cx"]);
  assert.equal(r.markedIneligible, 1);
});

test("gap: emptying most of a real audience is refused", async () => {
  const segment = Array.from({ length: 30 }, (_, i) => contact(`c${i}`, `u${i}@example.com`));
  const h = harness({ families: segment.map((_, i) => fam(`u${i}`)), active: ["u0"], segment });
  const r = await runAudienceSync(h.deps);
  assert.equal(r.removalGuardTripped, true);
  assert.equal(r.markedIneligible, 0);
  assert.ok(!h.writes.some((w) => w.startsWith("remove")));
  assert.equal(r.errors, 1);
});

// ── dry ──

test("dry mode writes nothing to Resend or profiles, and still counts", async () => {
  const h = harness({
    dry: true,
    families: [fam("new"), fam("gone"), fam("optout")],
    active: ["new", "optout"],
    all: [contact("cg", "gone@example.com"), contact("co", "optout@example.com", { unsubscribed: true })],
    segment: [contact("cg", "gone@example.com"), contact("co", "optout@example.com", { unsubscribed: true })],
  });
  const r = await runAudienceSync(h.deps);
  assert.deepEqual(h.writes, []);
  assert.deepEqual(h.profileWrites, []);
  assert.deepEqual(
    [r.pulledUnsubscribes, r.pushedNew, r.markedIneligible, r.dry],
    [1, 1, 2, true],
  );
  assert.ok(h.logs.every((l) => !l.includes("@")), "logs carry ids, never addresses");
});

// ── reads ──

test("a failed read changes nothing", async () => {
  const h = harness({ families: [fam("a")], active: ["a"] });
  h.deps.listSegmentContacts = async () => null;
  const r = await runAudienceSync(h.deps);
  assert.equal(r.errors, 1);
  assert.deepEqual(h.writes, []);
  assert.deepEqual(h.profileWrites, []);
});

test("logs carry user ids, never an address", async () => {
  const h = harness({
    families: [fam("u1"), fam("u2")],
    active: ["u2"],
    all: [contact("c1", "u1@example.com", { unsubscribed: true })],
    segment: [contact("c3", "stranger@example.com")],
  });
  await runAudienceSync(h.deps);
  assert.ok(h.logs.length > 0);
  assert.ok(h.logs.every((l) => !l.includes("@")), h.logs.join("\n"));
});
