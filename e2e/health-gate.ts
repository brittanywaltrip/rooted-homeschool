// Decide whether a deployment is safe to point a browser suite at.
//
// Pure and side-effect free so it can be driven by node --test: no "@/" import
// at module scope, no network, no process.env. global-setup does the fetching
// and hands the result here.
//
// Two failures this exists to name properly:
//
//   1. Behind Vercel Deployment Protection an unauthenticated request gets a
//      401 HTML interstitial, so res.json() throws "Unexpected token '<'".
//      That says nothing about protection and sends you looking at the wrong
//      thing. Protection gets its own code and its own sentence.
//
//   2. The commit pin used to be gated on GITHUB_SHA, so every run outside
//      GitHub Actions skipped the whole gate in silence. The identity checks
//      now always run against a remote deployment; only the commit comparison
//      is optional, and when it is skipped that is stated out loud.
//
// The bypass secret is never a parameter here, so it can never reach a message.

export interface HealthGateInput {
  status: number;
  /** The Location header, when the response was a redirect. */
  location?: string | null;
  bodyText: string;
  expectedRef: string;
  /** null means "not pinned": identity is still checked, the commit is not. */
  expectedCommit: string | null;
  bypassConfigured: boolean;
  host: string;
}

export type HealthGateResult =
  | { ok: true; projectRef: string; commit: string | null; commitPinned: boolean }
  | { ok: false; code: string; message: string };

export function evaluateHealthGate(input: HealthGateInput): HealthGateResult {
  const no = (code: string, message: string): HealthGateResult => ({ ok: false, code, message });

  // Vercel Deployment Protection does NOT answer 401. It answers 302 to
  // vercel.com/sso-api with a _vercel_sso_nonce cookie. Observed directly
  // against the rooted-staging deployment; assuming 401 here would have
  // reported a live, correctly protected deployment as simply unreachable.
  const isRedirect = input.status >= 300 && input.status < 400;
  const toSso = Boolean(input.location && /\/sso-api\b/.test(input.location));
  if (isRedirect && toSso) {
    return input.bypassConfigured
      ? no(
          "protection_bypass_rejected",
          `${input.host} redirected to Vercel SSO despite the bypass secret. The secret is set ` +
            "but not accepted: confirm it is this project's current VERCEL_AUTOMATION_BYPASS_SECRET.",
        )
      : no(
          "protection_blocked",
          `${input.host} redirected to Vercel SSO. Deployment Protection is on and ` +
            "VERCEL_AUTOMATION_BYPASS_SECRET is not set, so the suite cannot reach the deployment.",
        );
  }
  if (isRedirect) {
    return no(
      "unexpected_redirect",
      `${input.host}/api/health redirected to ${input.location ?? 'an unknown location'} ` +
        "(HTTP " + input.status + "). The health endpoint must answer directly.",
    );
  }

  if (input.status === 401 || input.status === 403) {
    return input.bypassConfigured
      ? no(
          "protection_bypass_rejected",
          `${input.host} rejected the protection bypass (HTTP ${input.status}). The secret ` +
            "is set but not accepted: confirm it is this project's current VERCEL_AUTOMATION_BYPASS_SECRET.",
        )
      : no(
          "protection_blocked",
          `${input.host} returned HTTP ${input.status}. Vercel Deployment Protection is on and ` +
            "VERCEL_AUTOMATION_BYPASS_SECRET is not set, so the suite cannot reach the deployment.",
        );
  }
  if (input.status < 200 || input.status >= 300) {
    return no("health_unreachable", `${input.host}/api/health returned HTTP ${input.status}.`);
  }

  let health: { env?: string; projectRef?: string; identityOk?: boolean; commit?: string | null };
  try {
    health = JSON.parse(input.bodyText);
  } catch {
    return no(
      "health_not_json",
      `${input.host}/api/health did not return JSON. A protection interstitial or an error ` +
        "page is the usual cause.",
    );
  }

  if (health.identityOk !== true) {
    return no(
      "identity_not_ok",
      `Deployment reports identityOk=false (env=${health.env}, projectRef=${health.projectRef}). ` +
        "Its own environment variables do not agree with each other.",
    );
  }
  if (health.env !== "staging") {
    return no("env_not_staging", `Deployment reports env=${health.env}, not staging.`);
  }
  if (health.projectRef !== input.expectedRef) {
    return no(
      "project_ref_mismatch",
      `Deployment is using project ${health.projectRef}, but this runner expects ${input.expectedRef}.`,
    );
  }
  if (input.expectedCommit && health.commit !== input.expectedCommit) {
    return no(
      "stale_deployment",
      `Deployment serves commit ${health.commit ?? "unknown"}, not ${input.expectedCommit}. ` +
        "Vercel keeps serving the previous build until the new one is READY.",
    );
  }

  return {
    ok: true,
    projectRef: health.projectRef as string,
    commit: health.commit ?? null,
    commitPinned: Boolean(input.expectedCommit),
  };
}
