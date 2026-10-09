# Disposable local E2E identity (candidate)

This change extends the existing environment and exact-account guards. It does
not create a backend, provision an account, or attest that a listening service
is isolated. Review this change before using it for a local E2E run.

Required app and runner settings:

- `NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321`
- `ROOTED_ENV=local`
- `ROOTED_EXPECTED_SUPABASE_REF=rooted-isolated-local`
- Synthetic account ID: `7b1f8044-4d8e-4c6e-86bc-94fcf7a02e1d`
- Synthetic account email: `rooted-e2e@isolated.invalid`

The sentinel cannot match a hosted project URL. Only the literal loopback URL
above (optionally with one trailing slash) resolves to it. Other ports, DNS
aliases, numeric host encodings, credentials, paths, queries and fragments are
refused. A staging or production label on this endpoint is refused. Existing
production/recovery refusals and the fixed hosted account pins remain in place.
No environment variable can add or replace an account in the allowlist.

Do not reuse hosted passwords, service keys or authentication state. Provision
the fixed account only in the disposable stack; it has not yet been provisioned.
The existing service-key checks remain unchanged. Local keys and real local
Auth/PostgREST behavior still need runtime verification; no local E2E pass is
claimed by these unit tests.

Before startup, verify Docker's license eligibility, resolve any installation
permission prompts with the user, and ensure every published container port
binds to loopback. Use only a reviewed schema-only export with embedded secrets
excluded, plus synthetic fixtures. The repository's incomplete migration
history is not a replacement for the full schema. Never point this setup at
production, recovery or the shared staging project.

Validation: 67 focused guard tests pass; full unit suite 2,124 passed, eight
existing skips, zero failures; TypeScript and focused ESLint pass. No browser
E2E, Auth/PostgREST or full-schema test has run with this candidate.
