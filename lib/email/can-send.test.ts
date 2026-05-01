// Unit tests for canSendMarketingEmail. Run with:
//   node --test lib/email/can-send.test.ts

import { test } from "node:test";
import assert from "node:assert/strict";

import { canSendMarketingEmail, type MarketingEmailType } from "./can-send.ts";

type ProfileRow = {
  email_unsubscribed: boolean | null;
  email_marketing: boolean | null;
  email_weekly_summary: boolean | null;
} | null;

function makeSupabase(profile: ProfileRow) {
  return {
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({ data: profile, error: null }),
        }),
      }),
    }),
  } as unknown as Parameters<typeof canSendMarketingEmail>[2];
}

const ALLOW_ALL: ProfileRow = {
  email_unsubscribed: false,
  email_marketing: true,
  email_weekly_summary: true,
};

test("returns no_user when the profile lookup misses", async () => {
  const result = await canSendMarketingEmail("missing", "weekly_summary", makeSupabase(null));
  assert.deepEqual(result, { allowed: false, reason: "no_user" });
});

test("master flag blocks every type", async () => {
  const profile = { ...ALLOW_ALL, email_unsubscribed: true };
  const types: MarketingEmailType[] = [
    "weekly_summary",
    "reengagement_1",
    "reengagement_2",
    "reengagement_3",
    "onboarding_reminder",
    "family_digest",
  ];
  for (const type of types) {
    const r = await canSendMarketingEmail("u1", type, makeSupabase(profile));
    assert.deepEqual(r, { allowed: false, reason: "unsubscribed" }, `type=${type}`);
  }
});

test("weekly_summary respects email_weekly_summary=false", async () => {
  const profile = { ...ALLOW_ALL, email_weekly_summary: false };
  const r = await canSendMarketingEmail("u1", "weekly_summary", makeSupabase(profile));
  assert.deepEqual(r, { allowed: false, reason: "type_disabled" });
});

test("weekly_summary ignores email_marketing flag", async () => {
  // Marketing off should NOT block weekly_summary — separate granular flag.
  const profile = { ...ALLOW_ALL, email_marketing: false };
  const r = await canSendMarketingEmail("u1", "weekly_summary", makeSupabase(profile));
  assert.deepEqual(r, { allowed: true });
});

test("non-weekly types respect email_marketing=false", async () => {
  const profile = { ...ALLOW_ALL, email_marketing: false };
  const types: MarketingEmailType[] = [
    "reengagement_1",
    "reengagement_2",
    "reengagement_3",
    "onboarding_reminder",
    "family_digest",
  ];
  for (const type of types) {
    const r = await canSendMarketingEmail("u1", type, makeSupabase(profile));
    assert.deepEqual(r, { allowed: false, reason: "type_disabled" }, `type=${type}`);
  }
});

test("non-weekly types ignore email_weekly_summary flag", async () => {
  const profile = { ...ALLOW_ALL, email_weekly_summary: false };
  const r = await canSendMarketingEmail("u1", "reengagement_1", makeSupabase(profile));
  assert.deepEqual(r, { allowed: true });
});

test("NULL granular flags are treated as opt-in", async () => {
  const profile: ProfileRow = {
    email_unsubscribed: null,
    email_marketing: null,
    email_weekly_summary: null,
  };
  for (const type of ["weekly_summary", "reengagement_1", "family_digest"] as MarketingEmailType[]) {
    const r = await canSendMarketingEmail("u1", type, makeSupabase(profile));
    assert.deepEqual(r, { allowed: true }, `type=${type}`);
  }
});

test("happy path: all flags opted in returns allowed", async () => {
  const r = await canSendMarketingEmail("u1", "weekly_summary", makeSupabase(ALLOW_ALL));
  assert.deepEqual(r, { allowed: true });
});
