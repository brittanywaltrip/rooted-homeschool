// Which database am I actually talking to?
//
// Until 2026-09-19 the staging Vercel environment pointed at the PRODUCTION
// Supabase project, so every staging push ran the Playwright suite against real
// customer data. The only thing that stopped it doing damage was the exact
// account guard in e2e/global-setup.ts, which checks WHO is signed in but never
// WHICH database. That is a guard rail, not isolation.
//
// This module is the missing half: it answers "which project is this" and
// refuses to proceed when the answer disagrees with what the caller expects.
//
// Design rules:
//   - Fail CLOSED. A missing variable is a failure, never a pass. An absent
//     expectation is the most dangerous case, because it is what a fresh CI
//     runner looks like.
//   - Refuse production explicitly by ref, not by inference from a URL shape.
//   - Never read or log a key. Project refs are not secrets; keys are.
//   - No "@/" import and no side effects, so node --test can drive it.

/** The live customer database. Nothing in a test or fixture may touch it. */
export const PRODUCTION_PROJECT_REF = "gvkbegvvmhcrmxdorctk";

/**
 * Kimberly's recovery copy (2026-09-18 backup). Preserved as evidence for an
 * open incident. Read-only by policy; never a test target and never reused as
 * a staging environment.
 */
export const RECOVERY_PROJECT_REF = "drjmqjlbypostvasafke";

export type RootedEnv = "production" | "staging" | "local";

export class EnvironmentIdentityError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "EnvironmentIdentityError";
    this.code = code;
  }
}

/**
 * Extract the project ref from a Supabase URL.
 *
 * Handles the custom-domain case explicitly: production serves auth from
 * https://auth.rootedhomeschoolapp.com, NOT <ref>.supabase.co, so a naive
 * subdomain parse returns "auth" and a caller could conclude it is not
 * production. Returning null for an unrecognised host is the safe answer,
 * because every caller below treats null as a failure.
 */
export function projectRefFromSupabaseUrl(url: string | undefined | null): string | null {
  if (!url) return null;
  let host: string;
  try {
    host = new URL(url).host;
  } catch {
    return null;
  }
  const m = host.match(/^([a-z0-9]{20})\.supabase\.(co|in|red)$/i);
  return m ? m[1].toLowerCase() : null;
}

export interface EnvIdentityInput {
  /** NEXT_PUBLIC_SUPABASE_URL, or SUPABASE_URL for server-only callers. */
  supabaseUrl?: string | null;
  /** ROOTED_ENV. */
  rootedEnv?: string | null;
  /** ROOTED_EXPECTED_SUPABASE_REF. */
  expectedRef?: string | null;
}

export interface EnvIdentity {
  env: RootedEnv;
  projectRef: string;
  isProduction: boolean;
  isRecovery: boolean;
}

/**
 * Resolve and validate the environment identity, or throw.
 *
 * Every branch here is a refusal a real incident would otherwise have allowed:
 * an unset expectation (a fresh CI runner), a URL that does not name a ref (a
 * custom domain), an env label that disagrees with the database it is pointed
 * at (a half-finished migration of env vars), and the recovery project (an
 * incident artefact nobody should be testing against).
 */
export function resolveEnvIdentity(input: EnvIdentityInput): EnvIdentity {
  const projectRef = projectRefFromSupabaseUrl(input.supabaseUrl);
  if (!projectRef) {
    throw new EnvironmentIdentityError(
      "unresolvable_project_ref",
      "Could not determine the Supabase project ref from the configured URL. " +
        "Refusing to continue: an unknown database is treated as production.",
    );
  }

  const expectedRef = (input.expectedRef ?? "").trim().toLowerCase();
  if (!expectedRef) {
    throw new EnvironmentIdentityError(
      "missing_expected_ref",
      "ROOTED_EXPECTED_SUPABASE_REF is not set. Refusing to continue: an absent " +
        "expectation is exactly what a misconfigured runner looks like.",
    );
  }
  if (expectedRef !== projectRef) {
    throw new EnvironmentIdentityError(
      "project_ref_mismatch",
      `Configured Supabase project is ${projectRef} but ROOTED_EXPECTED_SUPABASE_REF ` +
        `is ${expectedRef}. Refusing to continue.`,
    );
  }

  const rawEnv = (input.rootedEnv ?? "").trim().toLowerCase();
  if (rawEnv !== "production" && rawEnv !== "staging" && rawEnv !== "local") {
    throw new EnvironmentIdentityError(
      "missing_rooted_env",
      `ROOTED_ENV must be production, staging or local (got ${rawEnv || "nothing"}).`,
    );
  }
  const env = rawEnv as RootedEnv;

  const isProduction = projectRef === PRODUCTION_PROJECT_REF;
  const isRecovery = projectRef === RECOVERY_PROJECT_REF;

  // The label and the database must agree, in both directions.
  if (env === "production" && !isProduction) {
    throw new EnvironmentIdentityError(
      "env_label_mismatch",
      `ROOTED_ENV=production but the database is ${projectRef}, not the production project.`,
    );
  }
  if (env !== "production" && isProduction) {
    throw new EnvironmentIdentityError(
      "env_label_mismatch",
      `ROOTED_ENV=${env} but the database IS production (${projectRef}). Refusing to continue.`,
    );
  }

  return { env, projectRef, isProduction, isRecovery };
}

/**
 * The gate every destructive path must pass before it does anything.
 *
 * Call this BEFORE launching a browser, writing storageState, authenticating,
 * seeding a fixture, or constructing a service-role client. Ordering is the
 * whole point: a guard that runs after the first write is decoration.
 */
export function assertSafeForTestWrites(
  input: EnvIdentityInput,
  context: string,
): EnvIdentity {
  const id = resolveEnvIdentity(input);

  if (id.isProduction) {
    throw new EnvironmentIdentityError(
      "production_forbidden",
      `${context}: refusing to run against the PRODUCTION database (${id.projectRef}). ` +
        "Tests and fixtures may never write to real customer data.",
    );
  }
  if (id.isRecovery) {
    throw new EnvironmentIdentityError(
      "recovery_forbidden",
      `${context}: refusing to run against the recovery project (${id.projectRef}). ` +
        "That copy is incident evidence and is read-only by policy.",
    );
  }
  if (id.env !== "staging" && id.env !== "local") {
    throw new EnvironmentIdentityError(
      "env_not_testable",
      `${context}: ROOTED_ENV=${id.env} is not a testable environment.`,
    );
  }
  return id;
}

/** Non-secret identity for a health endpoint or a visible build badge. */
export function publicEnvIdentity(input: EnvIdentityInput): {
  env: string;
  projectRef: string | null;
  ok: boolean;
  error?: string;
} {
  try {
    const id = resolveEnvIdentity(input);
    return { env: id.env, projectRef: id.projectRef, ok: true };
  } catch (err) {
    // Report the ref when it is resolvable: it is not a secret, and hiding it
    // is what made the original misconfiguration invisible.
    return {
      env: (input.rootedEnv ?? "unknown").toString(),
      projectRef: projectRefFromSupabaseUrl(input.supabaseUrl),
      ok: false,
      error: err instanceof EnvironmentIdentityError ? err.code : "unknown_error",
    };
  }
}
