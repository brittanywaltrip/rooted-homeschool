// Sentry knows which environment and which kind of account an event came from.
// Run with: npm test
//
// The environment and tag helpers are pure and tested directly. The two
// call-site facts (the client config reads the build-time environment, and the
// layout sets the user by id only) are static checks over the source, the same
// approach as lib/memory-insert-guard.test.ts, because there is no DOM or
// Sentry transport under node --test and the mistake would live at the call
// site, not in a helper.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { sentryEnvironment } from "./sentry-environment.ts";
import { accountKindTag, isHeadlessUserAgent } from "./sentry-scope.ts";

const read = (rel: string) => readFileSync(resolve(process.cwd(), rel), "utf8");

test("environment: production, preview:<branch>, development", () => {
  assert.equal(sentryEnvironment({ VERCEL_ENV: "production", VERCEL_GIT_COMMIT_REF: "main" }), "production");
  assert.equal(sentryEnvironment({ VERCEL_ENV: "preview", VERCEL_GIT_COMMIT_REF: "staging" }), "preview:staging");
  assert.equal(sentryEnvironment({ VERCEL_ENV: "preview" }), "preview");
  assert.equal(sentryEnvironment({ VERCEL_ENV: "development" }), "development");
  assert.equal(sentryEnvironment({}), "development");
});

test("account_kind: the non-family list is the only thing that says test", () => {
  assert.equal(accountKindTag("rooted.e2e@rootedhomeschoolapp.com"), "test");
  assert.equal(accountKindTag("TEST@rootedhomeschoolapp.com"), "test");
  assert.equal(accountKindTag("someone@example.com"), "family");
  assert.equal(accountKindTag(null), "family");
});

test("e2e: HeadlessChrome and nothing else", () => {
  assert.equal(isHeadlessUserAgent("Mozilla/5.0 (Macintosh) HeadlessChrome/131.0 Safari/537.36"), true);
  assert.equal(isHeadlessUserAgent("Mozilla/5.0 (iPhone) Safari/604.1"), false);
  assert.equal(isHeadlessUserAgent(undefined), false);
});

test("the client Sentry config reads NEXT_PUBLIC_SENTRY_ENVIRONMENT, not NODE_ENV", () => {
  const src = read("sentry.client.config.ts");
  assert.match(src, /environment:\s*process\.env\.NEXT_PUBLIC_SENTRY_ENVIRONMENT/);
  assert.doesNotMatch(src, /environment:\s*process\.env\.NODE_ENV/);
  assert.match(src, /setTag\("e2e", "true"\)/);
});

test("next.config computes NEXT_PUBLIC_SENTRY_ENVIRONMENT and server/edge use the same helper", () => {
  assert.match(read("next.config.ts"), /NEXT_PUBLIC_SENTRY_ENVIRONMENT:\s*sentryEnvironment\(process\.env\)/);
  for (const f of ["sentry.server.config.ts", "sentry.edge.config.ts"]) {
    assert.match(read(f), /environment:\s*sentryEnvironment\(process\.env\)/, f);
  }
});

test("the dashboard layout sets the Sentry user by id only, and clears it on sign-out", () => {
  const src = read("app/dashboard/layout.tsx");
  const calls = [...src.matchAll(/Sentry\.setUser\(([^)]*)\)/g)].map((m) => m[1].trim());
  assert.ok(calls.length >= 2, "expected a set and a clear");
  const objectCalls = calls.filter((c) => c.startsWith("{"));
  assert.equal(objectCalls.length, 1, "exactly one setUser with an object");
  assert.equal(objectCalls[0].replace(/\s+/g, ""), "{id:user.id}");
  assert.ok(calls.includes("null"), "sign-out clears the user");
  assert.match(src, /setTag\("account_kind",\s*accountKindTag\(user\.email\)\)/);
});
