// node --test lib/env-identity.test.ts
//
// The guard that was missing. Every case below is a real misconfiguration:
// a fresh CI runner with no expectation set, a staging label pointed at the
// production database, a custom auth domain that hides the ref, and the
// recovery project being mistaken for a spare environment.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  supabaseKeyIdentity,
  keyRequiresLiveProbe,
  assertCredentialsBindToProject,
  PRODUCTION_PROJECT_REF,
  RECOVERY_PROJECT_REF,
  projectRefFromSupabaseUrl,
  resolveEnvIdentity,
  assertSafeForTestWrites,
  publicEnvIdentity,
  EnvironmentIdentityError,
} from "./env-identity.ts";

const STAGING_REF = "aaaaaaaaaaaaaaaaaaaa";
const url = (ref: string) => `https://${ref}.supabase.co`;

const stagingOk = {
  supabaseUrl: url(STAGING_REF),
  rootedEnv: "staging",
  expectedRef: STAGING_REF,
};

function codeOf(fn: () => unknown): string {
  try {
    fn();
  } catch (err) {
    if (err instanceof EnvironmentIdentityError) return err.code;
    return `unexpected:${(err as Error).name}`;
  }
  return "no_error";
}

// ── ref parsing ─────────────────────────────────────────────────────────────

test("a project ref is parsed from a supabase.co URL", () => {
  assert.equal(projectRefFromSupabaseUrl(url(STAGING_REF)), STAGING_REF);
  assert.equal(projectRefFromSupabaseUrl(url(PRODUCTION_PROJECT_REF)), PRODUCTION_PROJECT_REF);
});

test("a custom auth domain yields NO ref rather than a wrong one", () => {
  // Production serves auth from auth.rootedhomeschoolapp.com. A naive
  // subdomain parse returns "auth" and would conclude "not production".
  assert.equal(projectRefFromSupabaseUrl("https://auth.rootedhomeschoolapp.com"), null);
  assert.equal(projectRefFromSupabaseUrl("not a url"), null);
  assert.equal(projectRefFromSupabaseUrl(undefined), null);
  assert.equal(projectRefFromSupabaseUrl(""), null);
});

test("an unresolvable ref is a refusal, never a pass", () => {
  assert.equal(
    codeOf(() => resolveEnvIdentity({ ...stagingOk, supabaseUrl: "https://auth.rootedhomeschoolapp.com" })),
    "unresolvable_project_ref",
  );
});

// ── fail closed ─────────────────────────────────────────────────────────────

test("a MISSING expectation fails closed", () => {
  // The most dangerous case: this is what a fresh CI runner looks like.
  assert.equal(codeOf(() => resolveEnvIdentity({ ...stagingOk, expectedRef: null })), "missing_expected_ref");
  assert.equal(codeOf(() => resolveEnvIdentity({ ...stagingOk, expectedRef: "  " })), "missing_expected_ref");
});

test("a MISMATCHED expectation fails closed", () => {
  assert.equal(
    codeOf(() => resolveEnvIdentity({ ...stagingOk, expectedRef: "bbbbbbbbbbbbbbbbbbbb" })),
    "project_ref_mismatch",
  );
});

test("a missing or bogus ROOTED_ENV fails closed", () => {
  assert.equal(codeOf(() => resolveEnvIdentity({ ...stagingOk, rootedEnv: null })), "missing_rooted_env");
  assert.equal(codeOf(() => resolveEnvIdentity({ ...stagingOk, rootedEnv: "prod" })), "missing_rooted_env");
});

test("ROOTED_ENV and the actual database must agree in BOTH directions", () => {
  // staging label, production database
  assert.equal(
    codeOf(() => resolveEnvIdentity({
      supabaseUrl: url(PRODUCTION_PROJECT_REF), rootedEnv: "staging", expectedRef: PRODUCTION_PROJECT_REF,
    })),
    "env_label_mismatch",
  );
  // production label, some other database
  assert.equal(
    codeOf(() => resolveEnvIdentity({
      supabaseUrl: url(STAGING_REF), rootedEnv: "production", expectedRef: STAGING_REF,
    })),
    "env_label_mismatch",
  );
});

// ── the production refusal ──────────────────────────────────────────────────

test("tests may NEVER write to production, even when labelled correctly", () => {
  // Correctly labelled production: resolves fine, but is refused for writes.
  const id = resolveEnvIdentity({
    supabaseUrl: url(PRODUCTION_PROJECT_REF), rootedEnv: "production", expectedRef: PRODUCTION_PROJECT_REF,
  });
  assert.equal(id.isProduction, true);
  assert.equal(
    codeOf(() => assertSafeForTestWrites({
      supabaseUrl: url(PRODUCTION_PROJECT_REF), rootedEnv: "production", expectedRef: PRODUCTION_PROJECT_REF,
    }, "unit-test")),
    "production_forbidden",
  );
});

test("the recovery project is refused for writes", () => {
  // Kimberly's 2026-09-18 copy is incident evidence, not a spare environment.
  assert.equal(
    codeOf(() => assertSafeForTestWrites({
      supabaseUrl: url(RECOVERY_PROJECT_REF), rootedEnv: "staging", expectedRef: RECOVERY_PROJECT_REF,
    }, "unit-test")),
    "recovery_forbidden",
  );
});

test("production and recovery refs are distinct and pinned", () => {
  assert.notEqual(PRODUCTION_PROJECT_REF, RECOVERY_PROJECT_REF);
  assert.equal(PRODUCTION_PROJECT_REF, "gvkbegvvmhcrmxdorctk");
  assert.equal(RECOVERY_PROJECT_REF, "drjmqjlbypostvasafke");
});

// ── the happy path ──────────────────────────────────────────────────────────

test("a correctly configured staging environment passes", () => {
  const id = assertSafeForTestWrites(stagingOk, "unit-test");
  assert.equal(id.env, "staging");
  assert.equal(id.projectRef, STAGING_REF);
  assert.equal(id.isProduction, false);
  assert.equal(id.isRecovery, false);
});

test("local development passes when explicitly configured", () => {
  const id = assertSafeForTestWrites(
    { supabaseUrl: url(STAGING_REF), rootedEnv: "local", expectedRef: STAGING_REF }, "unit-test");
  assert.equal(id.env, "local");
});

// ── the public identity surface ─────────────────────────────────────────────

test("the health payload exposes identity but never a key", () => {
  const ok = publicEnvIdentity(stagingOk);
  assert.deepEqual(ok, { env: "staging", projectRef: STAGING_REF, ok: true });

  const bad = publicEnvIdentity({ ...stagingOk, expectedRef: null });
  assert.equal(bad.ok, false);
  assert.equal(bad.error, "missing_expected_ref");
  // The ref is reported even on failure: it is not a secret, and hiding it is
  // what made the original misconfiguration invisible for weeks.
  assert.equal(bad.projectRef, STAGING_REF);

  for (const payload of [ok, bad]) {
    const s = JSON.stringify(payload);
    assert.ok(!/key|secret|token|password|service_role/i.test(s), "health payload leaks a credential name");
  }
});

test("publicEnvIdentity never throws, so a broken env still renders a page", () => {
  assert.doesNotThrow(() => publicEnvIdentity({ supabaseUrl: null, rootedEnv: null, expectedRef: null }));
});

// ── wiring guards: the ordering is the whole point ──────────────────────────

test("the project guard runs BEFORE anything destructive in global-setup", () => {
  const src = readFileSync(resolve(process.cwd(), "e2e/global-setup.ts"), "utf-8")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/\/\/[^\n]*/g, " ");
  const guard = src.indexOf("assertSafeForTestWrites(");
  assert.ok(guard > 0, "the project guard is gone from global-setup");

  // A guard that runs after the first write is decoration.
  for (const marker of [
    "chromium.launch(",   // browser
    "storageState(",      // session to disk
    "input[type=\"email\"]", // authentication
    "adminClient(",       // service-role client
    "assertIsTestAccount(", // the pre-existing account guard
  ]) {
    const at = src.indexOf(marker);
    if (at === -1) continue;
    assert.ok(guard < at, `the project guard must run before ${marker}`);
  }
});

test("the existing exact-test-account guard is preserved", () => {
  const src = readFileSync(resolve(process.cwd(), "e2e/global-setup.ts"), "utf-8");
  assert.ok(src.includes("assertIsTestAccount("), "the account guard was removed");
});

test("the health endpoint reports identity and never a credential", () => {
  const src = readFileSync(resolve(process.cwd(), "app/api/health/route.ts"), "utf-8");
  assert.ok(src.includes("publicEnvIdentity"), "health no longer reports identity");
  for (const bad of ["SERVICE_ROLE", "ANON_KEY", "SECRET", "RESEND_API_KEY", "STRIPE_SECRET"]) {
    assert.ok(!src.includes(bad), `health endpoint references ${bad}`);
  }
});

test("the env badge is hidden in production", () => {
  const src = readFileSync(resolve(process.cwd(), "app/components/EnvBadge.tsx"), "utf-8");
  assert.ok(/env === "production"\s*\)\s*return null/.test(src),
    "the badge would render for real families");
});

// --- credential binding (added 2026-09-19, Stage 2 preflight) ---------------
// These exist because checking the URL alone is not enough: the incident that
// prompted them was a correct-looking environment whose URL was a custom
// domain resolving to production. A key carries its own project ref, so it can
// disagree with the URL, and that disagreement is the bug.

const REF_STAGING = "cvgqovweybggrqakhdtd";

function jwtWith(claims: Record<string, unknown>): string {
  const b64 = (o: unknown) =>
    Buffer.from(JSON.stringify(o)).toString("base64url");
  return `${b64({ alg: "HS256", typ: "JWT" })}.${b64(claims)}.sig`;
}

test("supabaseKeyIdentity reads ref and role from a legacy JWT key", () => {
  const id = supabaseKeyIdentity(jwtWith({ iss: "supabase", ref: REF_STAGING, role: "anon" }));
  assert.deepEqual(id, { ref: REF_STAGING, role: "anon" });
});

test("supabaseKeyIdentity returns null for an opaque sb_ key rather than guessing", () => {
  assert.equal(supabaseKeyIdentity("sb_publishable_cGilYdKx8nTvekicqpU8Ag_9eY_XFNq"), null);
  assert.equal(keyRequiresLiveProbe("sb_publishable_cGilYdKx8nTvekicqpU8Ag_9eY_XFNq"), true);
});

test("supabaseKeyIdentity returns null, never throws, on malformed input", () => {
  for (const bad of ["", "a.b", "a.b.c", "x.!!!.z"]) {
    assert.equal(supabaseKeyIdentity(bad), null);
  }
});

test("a key from another project is refused even when the URL is right", () => {
  assert.throws(
    () =>
      assertCredentialsBindToProject({
        supabaseUrl: `https://${REF_STAGING}.supabase.co`,
        anonKey: jwtWith({ ref: PRODUCTION_PROJECT_REF, role: "anon" }),
        serviceRoleKey: jwtWith({ ref: REF_STAGING, role: "service_role" }),
        expectedRef: REF_STAGING,
      }),
    (e: unknown) => (e as EnvironmentIdentityError).code === "credential_ref_mismatch",
  );
});

test("an anon key in the service-role slot is a privilege error, not a typo", () => {
  assert.throws(
    () =>
      assertCredentialsBindToProject({
        supabaseUrl: `https://${REF_STAGING}.supabase.co`,
        anonKey: jwtWith({ ref: REF_STAGING, role: "anon" }),
        serviceRoleKey: jwtWith({ ref: REF_STAGING, role: "anon" }),
        expectedRef: REF_STAGING,
      }),
    (e: unknown) => (e as EnvironmentIdentityError).code === "credential_role_mismatch",
  );
});

test("a missing credential fails closed", () => {
  assert.throws(
    () =>
      assertCredentialsBindToProject({
        supabaseUrl: `https://${REF_STAGING}.supabase.co`,
        anonKey: jwtWith({ ref: REF_STAGING, role: "anon" }),
        serviceRoleKey: undefined,
        expectedRef: REF_STAGING,
      }),
    (e: unknown) => (e as EnvironmentIdentityError).code === "credential_missing",
  );
});

test("the production custom domain is refused as an unresolvable ref", () => {
  assert.throws(
    () =>
      assertCredentialsBindToProject({
        supabaseUrl: "https://auth.rootedhomeschoolapp.com",
        anonKey: jwtWith({ ref: REF_STAGING, role: "anon" }),
        serviceRoleKey: jwtWith({ ref: REF_STAGING, role: "service_role" }),
        expectedRef: REF_STAGING,
      }),
    (e: unknown) => (e as EnvironmentIdentityError).code === "url_ref_mismatch",
  );
});

test("matching url and both keys passes, and reports what still needs a probe", () => {
  const r = assertCredentialsBindToProject({
    supabaseUrl: `https://${REF_STAGING}.supabase.co`,
    anonKey: "sb_publishable_cGilYdKx8nTvekicqpU8Ag_9eY_XFNq",
    serviceRoleKey: jwtWith({ ref: REF_STAGING, role: "service_role" }),
    expectedRef: REF_STAGING,
  });
  assert.deepEqual(r.verifiedOffline, ["SUPABASE_SERVICE_ROLE_KEY"]);
  assert.deepEqual(r.needsLiveProbe, ["NEXT_PUBLIC_SUPABASE_ANON_KEY"]);
});

test("no error message from a binding failure contains key material", () => {
  const secret = jwtWith({ ref: PRODUCTION_PROJECT_REF, role: "anon" });
  try {
    assertCredentialsBindToProject({
      supabaseUrl: `https://${REF_STAGING}.supabase.co`,
      anonKey: secret,
      serviceRoleKey: jwtWith({ ref: REF_STAGING, role: "service_role" }),
      expectedRef: REF_STAGING,
    });
    assert.fail("expected a refusal");
  } catch (e) {
    const msg = (e as Error).message;
    assert.ok(!msg.includes(secret), "message must not contain the key");
    assert.ok(!msg.includes("eyJ"), "message must not contain any JWT fragment");
  }
});
