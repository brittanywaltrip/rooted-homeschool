// The trial-ending email: who gets it, when her trial actually ends, and the
// promise that a mom who muted nurture mail still hears that her plan changes.
//
// Run with: node --test lib/trial-ending.test.ts

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { TRIAL_DAYS } from "./user-access.ts";
import { getUserAccess } from "./user-access.ts";
import {
  isTrialEndingCandidate,
  stillOnTrial,
  runTrialEnding,
  safeTimeZone,
  trialDaysElapsed,
  trialEndLabel,
  trialEndingSubject,
  trialEndingWho,
  TRIAL_ENDING_UPGRADE_URL,
  type TrialEndingDeps,
  type TrialProfile,
} from "./trial-ending.ts";

const DAY = 24 * 60 * 60 * 1000;
// A fixed instant. isTrialEndingCandidate answers from the clock it is handed
// (stillOnTrial, not getUserAccess), so nothing here drifts with the real date
// or with a daylight-saving transition.
const NOW = new Date("2026-09-15T18:00:00Z");
const startedDaysAgo = (n: number) => new Date(NOW.getTime() - n * DAY).toISOString();

function profile(over: Partial<TrialProfile> & { id: string }): TrialProfile {
  return {
    first_name: "Sam",
    trial_started_at: startedDaysAgo(24),
    is_pro: false,
    onboarded: true,
    timezone: "America/Chicago",
    ...over,
  };
}

function deps(profiles: TrialProfile[], over: Partial<TrialEndingDeps> = {}) {
  const sends: { to: string; subject: string; variables: Record<string, string> }[] = [];
  const logged: string[] = [];
  const lines: string[] = [];
  const unsubscribed = new Set<string>();
  const d: TrialEndingDeps = {
    now: NOW,
    loadProfiles: async () => profiles,
    loadAlreadySent: async () => new Set(profiles.filter((p) => p.id.startsWith("sent")).map((p) => p.id)),
    alreadySent: async (id) => logged.includes(id),
    gate: async (id) =>
      unsubscribed.has(id) || id.startsWith("unsub")
        ? { allowed: false, reason: "unsubscribed", headers: {} as Record<string, string> }
        : { allowed: true, headers: {} as Record<string, string> },
    getUser: async (id) => ({ email: `${id}@example.com`, firstName: "Sam" }),
    isInternalEmail: (email) => email.startsWith("rooted.e2e@"),
    suppressed: new Set<string>(),
    firstChildName: async () => "Zoe",
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

test("who gets it: day 24 yes; day 20 and day 27 no; already pro, already sent, unsubscribed no", async () => {
  const { d, sends, logged } = deps([
    profile({ id: "day24" }),
    profile({ id: "day20", trial_started_at: startedDaysAgo(20) }),
    profile({ id: "day27", trial_started_at: startedDaysAgo(27) }),
    profile({ id: "pro", is_pro: true }),
    profile({ id: "sent-already" }),
    profile({ id: "unsub-mom" }),
  ]);
  const res = await runTrialEnding(d);
  assert.deepEqual(sends.map((s) => s.to), ["day24@example.com"]);
  assert.deepEqual(logged, ["day24"]);
  assert.equal(res.candidates, 2, "day24 and the unsubscribed mom pass the query; the gate stops one");
  assert.equal(res.sent, 1);
  assert.equal(res.skipped, 1);
  assert.equal(res.errors, 0);
});

test("day 27 is past the window even though the trial has not ended yet", () => {
  // Still on trial (30 days), but the email would arrive with three days left
  // and the point is six days of warning.
  const late = profile({ id: "late", trial_started_at: startedDaysAgo(27) });
  assert.equal(isTrialEndingCandidate({ profile: late, now: NOW, alreadySent: false }), false);
  assert.equal(trialDaysElapsed(late.trial_started_at!, NOW, "America/Chicago"), 27);
});

test("the window is 23 to 25 days, inclusive at both ends", () => {
  for (const [days, want] of [[22, false], [23, true], [24, true], [25, true], [26, false]] as const) {
    const p = profile({ id: `d${days}`, trial_started_at: startedDaysAgo(days) });
    assert.equal(isTrialEndingCandidate({ profile: p, now: NOW, alreadySent: false }), want, `day ${days}`);
  }
});

test("not onboarded, no trial start, or already sent: no", () => {
  const cases: [Partial<TrialProfile>, boolean][] = [
    [{ onboarded: false }, false],
    [{ onboarded: null }, false],
    [{ trial_started_at: null }, false],
    [{}, true],
  ];
  for (const [over, want] of cases) {
    const p = profile({ id: "x", ...over });
    assert.equal(isTrialEndingCandidate({ profile: p, now: NOW, alreadySent: false }), want, JSON.stringify(over));
  }
  assert.equal(isTrialEndingCandidate({ profile: profile({ id: "x" }), now: NOW, alreadySent: true }), false);
});

test("endDate is the trial start plus 30 days, in the family's timezone, and it is what the subject says", () => {
  // A trial that started at 9pm Chicago on a Thursday ends 30 days later, and
  // the label is that day in her timezone, not the server's.
  const start = "2026-08-28T02:30:00Z"; // 2026-08-27 21:30 in Chicago
  assert.equal(trialEndLabel(start, "America/Chicago"), "Saturday, September 26");
  assert.equal(TRIAL_DAYS, 30);
  const end = new Date(new Date(start).getTime());
  end.setDate(end.getDate() + TRIAL_DAYS);
  assert.equal(
    trialEndLabel(start, "America/Chicago"),
    new Intl.DateTimeFormat("en-US", { timeZone: "America/Chicago", weekday: "long", month: "long", day: "numeric" }).format(end),
  );
  assert.equal(trialEndingSubject("Saturday, September 26"), "Your Rooted+ trial ends Saturday, September 26");
  // A newline in a variable that reaches the subject is a 422 from Resend.
  assert.equal(trialEndingSubject("Saturday,\nSeptember 26"), "Your Rooted+ trial ends Saturday, September 26");
});

test("a broken or missing timezone falls back to US Pacific, never throws", () => {
  assert.equal(safeTimeZone("Mars/Olympus"), "America/Los_Angeles");
  assert.equal(safeTimeZone(""), "America/Los_Angeles");
  assert.equal(safeTimeZone(null), "America/Los_Angeles");
  assert.equal(safeTimeZone("America/Chicago"), "America/Chicago");
});

test("the email carries her name, her child, her end date and the upgrade link", async () => {
  const { d, sends } = deps([profile({ id: "u1" })]);
  await runTrialEnding(d);
  const v = sends[0].variables;
  assert.equal(v.firstName, "Sam");
  assert.equal(v.who, "Zoe");
  assert.equal(v.upgradeUrl, TRIAL_ENDING_UPGRADE_URL);
  assert.equal(v.email, "u1@example.com");
  assert.equal(v.endDate, trialEndLabel(startedDaysAgo(24), "America/Chicago"));
  assert.equal(sends[0].subject, `Your Rooted+ trial ends ${v.endDate}`);
});

test("who falls back to 'your family', and the possessive is left alone", async () => {
  assert.equal(trialEndingWho(null), "your family");
  assert.equal(trialEndingWho("  "), "your family");
  const { d, sends } = deps([profile({ id: "u1" })], { firstChildName: async () => null });
  await runTrialEnding(d);
  assert.equal(sends[0].variables.who, "your family");
});

test("suppressed and internal accounts get nothing", async () => {
  const { d, sends } = deps([profile({ id: "bounced" }), profile({ id: "e2e" })], {
    suppressed: new Set(["bounced@example.com"]),
    getUser: async (id) => ({
      email: id === "e2e" ? "rooted.e2e@rootedhomeschoolapp.com" : `${id}@example.com`,
      firstName: "Sam",
    }),
  });
  const res = await runTrialEnding(d);
  assert.equal(sends.length, 0);
  assert.equal(res.skipped, 2);
});

test("a failed read sends nothing; a lost email_log row is flagged; dry sends nothing", async () => {
  for (const over of [{ loadProfiles: async () => null }, { loadAlreadySent: async () => null }]) {
    const { d, sends } = deps([profile({ id: "u1" })], over);
    const res = await runTrialEnding(d);
    assert.equal(sends.length, 0);
    assert.equal(res.errors, 1);
  }
  const lost = deps([profile({ id: "u1" })], { logSent: async () => false });
  const lostRes = await runTrialEnding(lost.d);
  assert.equal(lostRes.sent, 1);
  assert.equal(lostRes.logWriteFailures, 1);
  assert.equal(lostRes.errors, 1);

  const dryRun = deps([profile({ id: "u1" })], { dry: true });
  const dryRes = await runTrialEnding(dryRun.d);
  assert.equal(dryRun.sends.length, 0);
  assert.equal(dryRun.logged.length, 0);
  assert.equal(dryRes.sent, 1);
  assert.match(dryRun.lines[0], /DRY would send to user u1, trial ends /);
  assert.ok(dryRun.lines.every((l) => !l.includes("@example.com")), "no address in any log line");
});

test("budget: never more than maxSends, closest to the end of the trial first", async () => {
  const { d, sends } = deps(
    [23, 25, 24].map((n) => profile({ id: `d${n}`, trial_started_at: startedDaysAgo(n) })),
    { maxSends: 2 },
  );
  const res = await runTrialEnding(d);
  assert.deepEqual(sends.map((s) => s.to), ["d25@example.com", "d24@example.com"]);
  assert.equal(res.candidates, 3);
});

test("scheduled daily at 16:00 UTC, behind the cron secret, gated as an account notice", () => {
  const vercel = JSON.parse(readFileSync(resolve(import.meta.dirname, "..", "vercel.json"), "utf8")) as {
    crons: { path: string; schedule: string }[];
  };
  assert.deepEqual(
    vercel.crons.find((c) => c.path === "/api/cron/trial-ending"),
    { path: "/api/cron/trial-ending", schedule: "0 16 * * *" },
  );
  const route = readFileSync(resolve(import.meta.dirname, "..", "app/api/cron/trial-ending/route.ts"), "utf8");
  assert.match(route, /authorization'\) !== `Bearer \$\{process\.env\.CRON_SECRET\}`/);
  assert.match(route, /canSendMarketingEmail\(userId, 'trial_ending', supabase\)/);
  assert.match(route, /TEMPLATES\.trialEnding/);
  assert.match(route, /if \(error\) return true/, "the per-send email_log check fails closed");
  assert.match(route, /or\('is_pro\.is\.null,is_pro\.eq\.false'\)/, "neq would drop NULL is_pro rows");
  assert.match(route, /if \(dry\) return \{ allowed: true, headers: \{\} \}/, "a dry run writes no token");
});

test("stillOnTrial is the rule getUserAccess applies, checked against it on the real clock", () => {
  const realNow = new Date();
  const ago = (n: number) => new Date(realNow.getTime() - n * DAY).toISOString();
  for (const p of [
    { is_pro: false, trial_started_at: ago(1) },
    { is_pro: false, trial_started_at: ago(29) },
    { is_pro: false, trial_started_at: ago(31) },
    { is_pro: true, trial_started_at: ago(5) },
    { is_pro: true, trial_started_at: ago(400) },
    { is_pro: false, trial_started_at: null },
  ]) {
    assert.equal(
      stillOnTrial(p, realNow),
      getUserAccess(p) === "trial",
      `${JSON.stringify(p)}: the local rule must answer exactly as the app's gate does`,
    );
  }
});

test("candidates left behind by the budget are counted and named, never dropped in silence", async () => {
  const { d, lines } = deps(
    [23, 24, 25].map((n) => profile({ id: `d${n}`, trial_started_at: startedDaysAgo(n) })),
    { maxSends: 1 },
  );
  const res = await runTrialEnding(d);
  assert.equal(res.sent, 1);
  assert.equal(res.deferred, 2, "the other two are a backlog, and the window is only three days wide");
  assert.ok(lines.some((l) => /budget reached, 2 candidate\(s\) left/.test(l)));
  assert.equal(res.candidates, res.sent + res.skipped + res.errors + res.deferred);
});

test("route: a run that sent nothing because a read failed still alerts, and a plus-address survives", () => {
  const route = readFileSync(resolve(import.meta.dirname, "..", "app/api/cron/trial-ending/route.ts"), "utf8");
  assert.match(route, /const silentFailure = result\.errors > 0 && result\.sent === 0/);
  assert.match(route, /result\.deferred > 0 \|\| silentFailure/);
  assert.match(route, /encodeEmailVariable: true/);
});

test("the email variable is encoded when the caller asks, so /unsubscribe sees the real address", async () => {
  const plus = deps([profile({ id: "u1" })], {
    encodeEmailVariable: true,
    getUser: async () => ({ email: "mom+rooted@gmail.com", firstName: "Sam" }),
  });
  await runTrialEnding(plus.d);
  assert.equal(plus.sends[0].variables.email, "mom%2Brooted%40gmail.com");
  assert.equal(plus.sends[0].to, "mom+rooted@gmail.com", "the envelope address is never encoded");
});
