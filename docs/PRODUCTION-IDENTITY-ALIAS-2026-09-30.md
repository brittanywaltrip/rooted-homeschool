# Production identity alias — 2026-09-30

Production /api/health returned identityOk false, unresolvable_project_ref, env unknown and null projectRef at commit 55689d02. The helper only recognized canonical Supabase hostnames, while production uses auth.rootedhomeschoolapp.com.

Read-only DNS verification returned CNAME auth.rootedhomeschoolapp.com -> gvkbegvvmhcrmxdorctk.supabase.co. Supabase's project URL tool independently returned that canonical URL for production. Official custom-domain documentation describes this CNAME binding: https://supabase.com/docs/guides/platform/custom-domains .

The helper now recognizes only the exact HTTPS production alias. It never trusts expectedRef to infer an unknown domain. Unknown aliases, lookalikes, nonstandard ports, URL credentials and HTTP stay unresolved. A resolved production alias is still refused by every test-write gate, including when labeled staging. Credential checks still require matching project refs and roles.

All 30 environment identity tests pass, including production refusal, unknown domains, missing variables and secret-safe error output. TypeScript, focused lint and diff checks pass.

Remaining production configuration: ROOTED_ENV must explicitly be production and ROOTED_EXPECTED_SUPABASE_REF must be gvkbegvvmhcrmxdorctk. The observed health payload alone cannot establish which variable is missing. Verify both in Vercel's production scope; do not infer them from VERCEL_ENV or fill defaults in code. Vercel team access returned a scope/authentication error during the morning audit, so these values were not changed or verified there. Keep staging on its own canonical ref and staging label.

Release gate: deploy the exact commit to rooted-staging, verify staging health identity and commit, then verify production-scoped variables before release. After production deployment, health must explicitly return production, the canonical production ref, identityOk true and the released commit. No deployment or environment change is claimed.
