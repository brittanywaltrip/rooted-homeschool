// The win-back email: who gets it, and only them.
//
// Run with: node --test lib/winback.test.ts

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  lastActivityByUser,
  pickWinbackCandidates,
  resolveFirstName,
  runWinback,
  winbackWho,
  winbackWindow,
  WINBACK_DASHBOARD_URL,
  type WinbackDeps,
} from "./winback.ts";

const NOW = new Date("2026-09-15T15:00:00Z");
const DAY = 24 * 60 * 60 * 1000;
const daysAgo = (n: number) => new Date(NOW.getTime() - n * DAY).toISOString().split("T")[0];

type Family = {
  id: string;
  activity: string[]; // activity dates (memory date or completed lesson scheduled_date)
  onboarded?: boolean;
  sent?: boolean;
  unsubscribed?: boolean;
  suppressed?: boolean;
  email?: string;
  child?: string | null;
};

function deps(families: Family[], over: Partial<WinbackDeps> = {}) {
  const sends: { to: string; variables: Record<string, string> }[] = [];
  const logged: string[] = [];
  const lines: string[] = [];
  const byId = new Map(families.map((f) => [f.id, f]));
  const emailOf = (f: Family) => f.email ?? `${f.id}@example.com`;
  const d: WinbackDeps = {
    now: NOW,
    loadActivitySince: async (since) =>
      families.flatMap((f) => f.activity.filter((date) => date >= since).map((date) => ({ user_id: f.id, date }))),
    loadOnboarded: async (ids) => new Set(ids.filter((id) => byId.get(id)?.onboarded !== false)),
    loadAlreadySent: async (ids) => new Set(ids.filter((id) => byId.get(id)?.sent)),
    alreadySent: async (id) => !!byId.get(id)?.sent || logged.includes(id),
    gate: async (id) =>
      byId.get(id)?.unsubscribed
        ? { allowed: false, reason: "unsubscribed", headers: {} as Record<string, string> }
        : { allowed: true, headers: { "List-Unsubscribe": "<x>" } as Record<string, string> },
    getUser: async (id) => ({ email: emailOf(byId.get(id)!), firstName: "Sam" }),
    isInternalEmail: (email) => email.startsWith("rooted.e2e@"),
    suppressed: new Set(families.filter((f) => f.suppressed).map((f) => emailOf(f).toLowerCase())),
    firstChildName: async (id) => byId.get(id)?.child ?? null,
    send: async (args) => {
      sends.push(args);
      return { ok: true, status: 200 };
    },
    logSent: async (id) => {
      logged.push(id);
      return true;
    },
    log: (line) => lines.push(line),
    ...over,
  };
  return { d, sends, logged, lines };
}

test("window: 21 days ago inclusive to 14 days ago exclusive, weekly-summary's since14 as the end", () => {
  assert.deepEqual(winbackWindow(NOW), { start: "2026-08-25", end: "2026-09-01" });
});

test("who gets it: active 15 days ago yes; 10, 25, never, already sent, unsubscribed no", async () => {
  const { d, sends, logged } = deps([
    { id: "quiet15", activity: [daysAgo(40), daysAgo(15)], child: "Zoe" },
    { id: "active10", activity: [daysAgo(15), daysAgo(10)] },
    { id: "quiet25", activity: [daysAgo(25)] },
    { id: "never", activity: [] },
    { id: "sentBefore", activity: [daysAgo(16)], sent: true },
    { id: "unsubscribed", activity: [daysAgo(17)], unsubscribed: true },
  ]);
  const res = await runWinback(d);
  assert.deepEqual(sends.map((s) => s.to), ["quiet15@example.com"]);
  assert.deepEqual(logged, ["quiet15"], "email_log is written after the send");
  assert.equal(res.candidates, 2, "quiet15 and unsubscribed pass the query; the gate stops one");
  assert.equal(res.sent, 1);
  assert.equal(res.skipped, 1);
  assert.equal(res.errors, 0);
  assert.deepEqual(sends[0].variables, {
    firstName: "Sam",
    who: "Zoe",
    dashboardUrl: WINBACK_DASHBOARD_URL,
    email: "quiet15@example.com",
  });
});

test("the window edges: exactly 14 days ago is still active, exactly 21 days ago is in", async () => {
  const { d, sends } = deps([
    { id: "edge14", activity: [daysAgo(14)] },
    { id: "edge21", activity: [daysAgo(21)] },
    { id: "edge22", activity: [daysAgo(22)] },
  ]);
  await runWinback(d);
  assert.deepEqual(sends.map((s) => s.to), ["edge21@example.com"]);
});

test("not onboarded, suppressed, and internal accounts get nothing", async () => {
  const { d, sends } = deps([
    { id: "notOnboarded", activity: [daysAgo(15)], onboarded: false },
    { id: "bounced", activity: [daysAgo(15)], suppressed: true },
    { id: "e2e", activity: [daysAgo(15)], email: "rooted.e2e@rootedhomeschoolapp.com" },
  ]);
  const res = await runWinback(d);
  assert.equal(sends.length, 0);
  assert.equal(res.candidates, 2, "onboarding is part of the query; the other two are per-send checks");
  assert.equal(res.skipped, 2);
});

test("the authoritative email_log check runs right before each send", async () => {
  const { d, sends } = deps([{ id: "raced", activity: [daysAgo(15)] }], {
    alreadySent: async () => true, // another run logged it after the batch read
  });
  const res = await runWinback(d);
  assert.equal(sends.length, 0);
  assert.equal(res.skipped, 1);
});

test("budget: never more than maxSends, closest to leaving the window first", async () => {
  const fams: Family[] = [15, 20, 16, 19, 17].map((n) => ({ id: `d${n}`, activity: [daysAgo(n)] }));
  const { d, sends } = deps(fams, { maxSends: 2 });
  const res = await runWinback(d);
  assert.deepEqual(sends.map((s) => s.to), ["d20@example.com", "d19@example.com"]);
  assert.equal(res.candidates, 5);
  assert.equal(res.sent, 2);
});

test("a failed send is counted, not logged, and named by user id only", async () => {
  const { d, logged, lines } = deps([{ id: "u1", activity: [daysAgo(15)], email: "private@example.com" }], {
    send: async () => ({ ok: false, status: 422, error: "bad" }),
  });
  const res = await runWinback(d);
  assert.equal(res.errors, 1);
  assert.deepEqual(res.failures, [{ userId: "u1", status: 422, error: "bad" }]);
  assert.deepEqual(logged, []);
  assert.ok(lines.every((l) => !l.includes("private@example.com")), "no address in any log line");
});

test("a failed activity read sends nothing", async () => {
  const { d, sends } = deps([{ id: "u1", activity: [daysAgo(15)] }], { loadActivitySince: async () => null });
  const res = await runWinback(d);
  assert.equal(sends.length, 0);
  assert.equal(res.errors, 1);
});

test("dry run counts and sends nothing, writes no email_log", async () => {
  const { d, sends, logged, lines } = deps([{ id: "u1", activity: [daysAgo(15)] }], { dry: true });
  const res = await runWinback(d);
  assert.equal(res.sent, 1);
  assert.equal(sends.length, 0);
  assert.equal(logged.length, 0);
  assert.match(lines[0], /DRY would send to user u1/);
});

test("who falls back to 'your family' with no children", () => {
  assert.equal(winbackWho(null), "your family");
  assert.equal(winbackWho(undefined), "your family");
  assert.equal(winbackWho("   "), "your family");
  assert.equal(winbackWho(" Zoe "), "Zoe");
});

test("pure pieces: newest date wins, and firstName falls back like reengagement", () => {
  const last = lastActivityByUser([
    { user_id: "a", date: "2026-08-26" },
    { user_id: "a", date: "2026-08-30" },
    { user_id: null, date: "2026-08-30" },
  ]);
  assert.deepEqual([...last], [["a", "2026-08-30"]]);
  assert.deepEqual(
    pickWinbackCandidates({ lastActive: last, window: winbackWindow(NOW), onboarded: new Set(["a"]), alreadySent: new Set() }),
    ["a"],
  );
  assert.equal(resolveFirstName(null, { user_metadata: { full_name: "Jo Smith" } }), "Jo");
  assert.equal(resolveFirstName(null, null), "there");
});

test("scheduled daily at 15:00 UTC, gated like the other nurture emails, same activity sources as weekly-summary", () => {
  const vercel = JSON.parse(readFileSync(resolve(import.meta.dirname, "..", "vercel.json"), "utf8")) as {
    crons: { path: string; schedule: string }[];
  };
  assert.deepEqual(vercel.crons.find((c) => c.path === "/api/cron/winback"), { path: "/api/cron/winback", schedule: "0 15 * * *" });
  const route = readFileSync(resolve(import.meta.dirname, "..", "app/api/cron/winback/route.ts"), "utf8");
  assert.match(route, /canSendMarketingEmail\(userId, 'winback', supabase\)/);
  assert.match(
    route,
    /if \(dry\) return \{ allowed: true, headers: \{\} \}\s*const token = await ensureUnsubscribeToken/,
    "a dry run never writes an unsubscribe token",
  );
  assert.match(route, /authorization'\) !== `Bearer \$\{process\.env\.CRON_SECRET\}`/);
  assert.match(route, /from\('memories'\)\.select\('id, user_id, date'\)\.gte\('date', since\)/);
  assert.match(route, /\.eq\('completed', true\)\s*\.gte\('scheduled_date', since\)/);
  // The weekly summary reads the same two sources, over its own window: a
  // memory's `date` and a completed lesson's `scheduled_date`.
  const weekly = readFileSync(resolve(import.meta.dirname, "..", "app/api/cron/weekly-summary/route.ts"), "utf8");
  assert.match(weekly, /from\('memories'\)\.select\('id, user_id, type, date'\)\.gte\('date', since\)/);
  assert.match(weekly, /\.eq\('completed', true\)\s*\.gte\('scheduled_date', since\)/);
});

test("a failed profile or email_log bulk read sends nothing", async () => {
  for (const over of [{ loadOnboarded: async () => null }, { loadAlreadySent: async () => null }]) {
    const { d, sends } = deps([{ id: "u1", activity: [daysAgo(15)] }], over);
    const res = await runWinback(d);
    assert.equal(sends.length, 0);
    assert.equal(res.errors, 1);
  }
});

test("a send whose email_log row does not save is counted as sent AND flagged for the alert", async () => {
  const { d, sends } = deps([{ id: "u1", activity: [daysAgo(15)] }], { logSent: async () => false });
  const res = await runWinback(d);
  assert.equal(sends.length, 1);
  assert.equal(res.sent, 1);
  assert.equal(res.errors, 1);
  assert.equal(res.logWriteFailures, 1);
  assert.equal(res.failures[0].userId, "u1");
});

test("route: the per-send email_log check fails closed, and a lost log row alerts", () => {
  const route = readFileSync(resolve(import.meta.dirname, "..", "app/api/cron/winback/route.ts"), "utf8");
  assert.match(route, /if \(error\) return true\s*return \(data\?\.length \?\? 0\) > 0/);
  assert.match(route, /if \(has4xx \|\| result\.logWriteFailures > 0 \|\| result\.errors > FAILURE_ALERT_THRESHOLD\)/);
});

test("the retired backfill route no longer sends the win-back template", () => {
  const backfill = readFileSync(resolve(import.meta.dirname, "..", "app/api/cron/backfill/route.ts"), "utf8");
  assert.ok(!/sendResendTemplate|TEMPLATES\.winback/.test(backfill));
  assert.match(backfill, /status: 410/);
});

test("the unsubscribe link survives a plus address", async () => {
  // /unsubscribe reads ?email= with useSearchParams, which decodes a raw "+" as
  // a space: "mom+rooted@gmail.com" arrived as "mom rooted@gmail.com", matched
  // no auth user, and the page still said "You've been unsubscribed".
  const { d, sends } = deps([{ id: "u1", activity: [daysAgo(15)] }], {
    encodeEmailVariable: true,
    getUser: async () => ({ email: "mom+rooted@gmail.com", firstName: "Sam" }),
  });
  await runWinback(d);
  assert.equal(sends[0].variables.email, "mom%2Brooted%40gmail.com");
  assert.equal(sends[0].to, "mom+rooted@gmail.com", "the envelope address is never encoded");
  assert.equal(
    decodeURIComponent(sends[0].variables.email),
    "mom+rooted@gmail.com",
    "and it decodes back to the address the unsubscribe route looks up",
  );
});

test("route: the win-back cron asks for the encoded variable", () => {
  const route = readFileSync(resolve(import.meta.dirname, "..", "app/api/cron/winback/route.ts"), "utf8");
  assert.match(route, /encodeEmailVariable: true/);
});
