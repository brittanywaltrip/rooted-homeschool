// node --test e2e/health-gate.test.ts
import test from "node:test";
import assert from "node:assert/strict";
import { evaluateHealthGate } from "./health-gate.ts";

const REF = "cvgqovweybggrqakhdtd";
const ok = (over: Record<string, unknown> = {}) =>
  JSON.stringify({ env: "staging", projectRef: REF, identityOk: true, commit: "abc123", ...over });

const base = { expectedRef: REF, expectedCommit: "abc123", bypassConfigured: true, host: "x.vercel.app" };

test("the REAL protection response (302 to vercel.com/sso-api) is named as protection", () => {
  // Observed against rooted-staging: Deployment Protection answers 302 with
  // location: https://vercel.com/sso-api?url=...&nonce=..., NOT 401. A gate
  // that only knew 401 called a correctly protected deployment "unreachable".
  const r = evaluateHealthGate({
    ...base,
    bypassConfigured: false,
    status: 302,
    location:
      "https://vercel.com/sso-api?url=https%3A%2F%2Frooted-homeschool-env-rooted-staging" +
      "-brittanywaltrips-projects.vercel.app%2Fapi%2Fhealth&nonce=a718e42e",
    bodyText: "Redirecting...",
  });
  assert.equal((r as { code: string }).code, "protection_blocked");
  assert.match((r as { message: string }).message, /Deployment Protection is on/);
});

test("a 302 to SSO WITH a bypass secret says the secret was rejected", () => {
  const r = evaluateHealthGate({
    ...base, status: 302, location: "https://vercel.com/sso-api?url=x", bodyText: "",
  });
  assert.equal((r as { code: string }).code, "protection_bypass_rejected");
});

test("a redirect somewhere OTHER than SSO is not mislabelled as protection", () => {
  const r = evaluateHealthGate({
    ...base, status: 302, location: "https://example.com/elsewhere", bodyText: "",
  });
  assert.equal((r as { code: string }).code, "unexpected_redirect");
});

test("a 401 with no bypass secret names PROTECTION, not JSON", () => {
  const r = evaluateHealthGate({ ...base, bypassConfigured: false, status: 401, bodyText: "<html>Login</html>" });
  assert.equal(r.ok, false);
  assert.equal((r as { code: string }).code, "protection_blocked");
  assert.match((r as { message: string }).message, /VERCEL_AUTOMATION_BYPASS_SECRET is not set/);
});

test("a 401 WITH a bypass secret says the secret was rejected", () => {
  const r = evaluateHealthGate({ ...base, status: 401, bodyText: "<html>" });
  assert.equal((r as { code: string }).code, "protection_bypass_rejected");
});

test("an HTML body on a 200 is reported as not-JSON, not crashed on", () => {
  const r = evaluateHealthGate({ ...base, status: 200, bodyText: "<html>nope</html>" });
  assert.equal((r as { code: string }).code, "health_not_json");
});

test("a deployment serving a different commit is refused as stale", () => {
  const r = evaluateHealthGate({ ...base, status: 200, bodyText: ok({ commit: "deadbee" }) });
  assert.equal((r as { code: string }).code, "stale_deployment");
});

test("a deployment on the wrong project is refused", () => {
  const r = evaluateHealthGate({ ...base, status: 200, bodyText: ok({ projectRef: "gvkbegvvmhcrmxdorctk" }) });
  assert.equal((r as { code: string }).code, "project_ref_mismatch");
});

test("identityOk=false is refused even when everything else looks right", () => {
  const r = evaluateHealthGate({ ...base, status: 200, bodyText: ok({ identityOk: false }) });
  assert.equal((r as { code: string }).code, "identity_not_ok");
});

test("env=production is refused", () => {
  const r = evaluateHealthGate({ ...base, status: 200, bodyText: ok({ env: "production" }) });
  assert.equal((r as { code: string }).code, "env_not_staging");
});

test("a healthy pinned deployment passes and reports the pin", () => {
  const r = evaluateHealthGate({ ...base, status: 200, bodyText: ok() });
  assert.deepEqual(r, { ok: true, projectRef: REF, commit: "abc123", commitPinned: true });
});

test("without a commit pin the identity checks STILL run", () => {
  // The old behaviour skipped the entire gate when GITHUB_SHA was unset.
  const bad = evaluateHealthGate({
    ...base, expectedCommit: null, status: 200,
    bodyText: ok({ projectRef: "gvkbegvvmhcrmxdorctk" }),
  });
  assert.equal((bad as { code: string }).code, "project_ref_mismatch");

  const good = evaluateHealthGate({ ...base, expectedCommit: null, status: 200, bodyText: ok() });
  assert.deepEqual(good, { ok: true, projectRef: REF, commit: "abc123", commitPinned: false });
});
