# Stage 2 preview environment — setup checklist

Everything below happens in the Vercel Dashboard. **Never paste a key into a
chat, a commit, or a file.** Copy each value from the Supabase dashboard
straight into the Vercel field.

## Identifiers

| | |
|---|---|
| Vercel team | `brittanywaltrips-projects` |
| Vercel project | **`rooted-homeschool`** |
| Branch to configure | `feat/atomic-schedule-commit` |
| Target Supabase project | **rooted-staging**, ref `cvgqovweybggrqakhdtd` |
| Must never be used here | production, ref `gvkbegvvmhcrmxdorctk` |

Where to copy the keys from: Supabase Dashboard, project **rooted-staging**,
Settings, API Keys.

## The five branch-scoped Preview variables

Vercel, Settings, Environment Variables. For each: choose **Preview**, then
**"Specific Branches"** (not "All Preview branches"), and enter
`feat/atomic-schedule-commit`.

| Variable | Value | Notes |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | `https://cvgqovweybggrqakhdtd.supabase.co` | Literal. Do **not** use the `auth.rootedhomeschoolapp.com` custom domain: that is production, and the gate refuses it. |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | rooted-staging anon / publishable key | Public by design, but still paste it only into Vercel. |
| `SUPABASE_SERVICE_ROLE_KEY` | rooted-staging service_role / secret key | **Secret.** Server-only. Mark **Sensitive** so it cannot be read back. |
| `ROOTED_EXPECTED_SUPABASE_REF` | `cvgqovweybggrqakhdtd` | What the gate checks against. If this is missing the build refuses. |
| `ROOTED_ENV` | `staging` | `lib/env-identity.ts` requires the label and the database to agree. |

All five are scoped to this one branch, so `staging`, `main` and production keep
the variables they have now. Nothing else changes.

## Deployment Protection

**Currently OFF on this project** — `passwordProtection`, `ssoProtection` and
`trustedIps` are all disabled, so preview URLs are publicly reachable today.

Settings, Deployment Protection. Turn on **Vercel Authentication** for
**Preview Deployments** (or Password Protection if you want to hand the URL to
someone without a Vercel account). This preview will be signed in to a database
holding synthetic families, and it should not be open to the web while we test
saves and deletes against it.

## What the build gate does once you deploy

`scripts/verify-preview-env.mjs` runs as `prebuild`, before Next compiles.
`feat/atomic-schedule-commit` is pinned to `cvgqovweybggrqakhdtd` in that file,
so the pin does not depend on the variables being right.

It refuses the build, with a distinct code, when:

| code | meaning |
|---|---|
| `missing_expected_ref` | pinned branch, `ROOTED_EXPECTED_SUPABASE_REF` unset |
| `expectation_contradicts_pin` | the variable disagrees with the branch pin |
| `resolves_to_production` | the URL names the production ref |
| `unresolvable_project_ref` | a custom domain, which hides the ref and is treated as production |
| `credential_missing` | either key unset |
| `credential_ref_mismatch` | a key belongs to a different project than the URL |
| `credential_role_mismatch` | the anon key is sitting in the service-role slot |
| `live_probe_rejected` / `live_probe_unreachable` | an opaque `sb_*` key that the project rejected, or that could not be confirmed |

It prints refs, hostnames and HTTP status codes only. No key material appears in
the build log.

**If you push this branch before the variables exist, the build will fail with
`missing_expected_ref`. That is the gate working, not a broken build.**

## After you confirm the variables are set

1. Redeploy **`feat/atomic-schedule-commit`** — not `staging`.
2. **Check the build log contains a `[verify-preview-env]` line.** Vercel runs
   `npm run build` when a build script exists, which is what triggers
   `prebuild`. If that line is absent the gate did not run, and the deployment
   must be treated as unverified regardless of what else it says.
3. Confirm the log ends with
   `OK: URL and both credentials name cvgqovweybggrqakhdtd. Not production.`
4. Only then start the browser tests in `STAGING-TESTS.md`.

## Rollback target

The staging deployment in place before any of this:

| | |
|---|---|
| deployment | `dpl_9Lbjim5TYZ8oj27FuVB8ojxgyQLH` |
| commit | `201fbc6` |
| branch | `staging` |

Nothing in Stage 2 touches that branch, so it stays deployable throughout.
