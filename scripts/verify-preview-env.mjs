#!/usr/bin/env node
// Fail-closed predeployment check: which database will this build talk to?
//
// On 2026-09-19 a Stage 2 deploy was stopped one step short of shipping the
// atomic-commit client against PRODUCTION, because the Vercel staging
// environment's NEXT_PUBLIC_SUPABASE_URL is https://auth.rootedhomeschoolapp.com
// a CNAME to the production project. Nothing in the build would have objected.
// This is the thing that objects.
//
// Rules:
//   - A PINNED branch must resolve to its pinned project, or the build fails.
//   - A missing expectation on a pinned branch is a FAILURE, never a pass:
//     an unset variable is what a misconfigured runner looks like.
//   - Resolving to production on a pinned branch is refused by ref, explicitly.
//   - The URL and BOTH keys must name the same project.
//   - No key material is ever printed, thrown, or written. Refs are not secrets.
//
// Unpinned branches with no expectation are skipped, so production and staging
// builds are unaffected until their env vars are migrated deliberately.

import {
  PRODUCTION_PROJECT_REF,
  RECOVERY_PROJECT_REF,
  projectRefFromSupabaseUrl,
  assertCredentialsBindToProject,
  EnvironmentIdentityError,
} from "../lib/env-identity.ts";

/** Branches that may ONLY ever build against the project named here. */
const PINNED_BRANCHES = {
  "feat/atomic-schedule-commit": "cvgqovweybggrqakhdtd",
};

const say = (m) => process.stdout.write(`[verify-preview-env] ${m}\n`);

function fail(code, message) {
  process.stdout.write("\n");
  say(`REFUSING TO BUILD (${code})`);
  say(message);
  process.stdout.write("\n");
  process.exit(1);
}

/**
 * Prove an opaque key belongs to this project by using it. A 401/403 means the
 * key is not this project's. Any other failure (network, DNS, 5xx) is also a
 * refusal: we cannot confirm, so we do not proceed.
 */
async function liveProbe(name, url, key, asServiceRole) {
  const endpoint = asServiceRole
    ? `${url}/auth/v1/admin/users?page=1&per_page=1`
    : `${url}/rest/v1/`;
  const headers = { apikey: key };
  if (asServiceRole) headers.Authorization = `Bearer ${key}`;

  let res;
  try {
    res = await fetch(endpoint, { headers, signal: AbortSignal.timeout(20000) });
  } catch (err) {
    fail(
      "live_probe_unreachable",
      `${name}: could not reach ${new URL(url).host} to confirm the credential ` +
        `belongs to it (${err?.name ?? "error"}). Failing closed.`,
    );
    return;
  }
  if (res.status === 401 || res.status === 403) {
    fail(
      "live_probe_rejected",
      `${name}: rejected with HTTP ${res.status} by ${new URL(url).host}. ` +
        "The credential does not belong to that project.",
    );
  }
  if (!res.ok) {
    fail("live_probe_inconclusive", `${name}: HTTP ${res.status}; cannot confirm. Failing closed.`);
  }
  say(`  ${name}: live probe OK (HTTP ${res.status}) — belongs to this project`);
}

async function main() {
  const branch = process.env.VERCEL_GIT_COMMIT_REF ?? "";
  const pin = PINNED_BRANCHES[branch];
  const expected = (process.env.ROOTED_EXPECTED_SUPABASE_REF ?? "").trim().toLowerCase();

  if (!pin && !expected) {
    say(`branch "${branch || "(local)"}" is not pinned and no expectation is set; skipping.`);
    return;
  }

  const required = pin ?? expected;
  say(`branch: ${branch || "(local)"}`);
  say(`required project: ${required}${pin ? " (pinned by branch)" : " (from ROOTED_EXPECTED_SUPABASE_REF)"}`);

  if (pin && !expected) {
    fail(
      "missing_expected_ref",
      `${branch} is pinned to ${pin} but ROOTED_EXPECTED_SUPABASE_REF is not set. ` +
        "An absent expectation fails closed.",
    );
  }
  if (pin && expected !== pin) {
    fail(
      "expectation_contradicts_pin",
      `${branch} is pinned to ${pin} but ROOTED_EXPECTED_SUPABASE_REF says ${expected}.`,
    );
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const urlRef = projectRefFromSupabaseUrl(url);

  if (urlRef === PRODUCTION_PROJECT_REF || required === PRODUCTION_PROJECT_REF) {
    fail(
      "resolves_to_production",
      `This build resolves to the PRODUCTION project (${PRODUCTION_PROJECT_REF}). ` +
        "A pinned preview branch may never build against production.",
    );
  }
  if (urlRef === RECOVERY_PROJECT_REF) {
    fail("resolves_to_recovery", `This build resolves to the recovery project (${RECOVERY_PROJECT_REF}).`);
  }
  if (!urlRef) {
    fail(
      "unresolvable_project_ref",
      "NEXT_PUBLIC_SUPABASE_URL does not name a Supabase project ref. A custom " +
        "domain is the production shape and is treated as production.",
    );
  }
  say(`  NEXT_PUBLIC_SUPABASE_URL: project ${urlRef}`);

  let binding;
  try {
    binding = assertCredentialsBindToProject({
      supabaseUrl: url,
      anonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
      serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY,
      expectedRef: required,
    });
  } catch (err) {
    if (err instanceof EnvironmentIdentityError) fail(err.code, err.message);
    throw err;
  }

  for (const n of binding.verifiedOffline) say(`  ${n}: ref claim names ${required} — verified offline`);

  for (const n of binding.needsLiveProbe) {
    const isService = n === "SUPABASE_SERVICE_ROLE_KEY";
    await liveProbe(n, url, isService ? process.env.SUPABASE_SERVICE_ROLE_KEY : process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, isService);
  }

  say(`OK: URL and both credentials name ${required}. Not production. Proceeding.`);
}

main().catch((err) => fail("unexpected", err?.message ?? String(err)));
