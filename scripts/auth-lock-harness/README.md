# Two-tab auth harness (rooted-staging only)

Runs the app's real browser auth code in two Chromium tabs that share one
session: `lib/supabase.ts` (the PKCE cookie client from `@supabase/ssr`, with
the session lifeboat installed) and `getUserWithRetry` from `lib/auth-retry.ts`.
Sentry and PostHog are replaced by recorders. Whatever `@supabase/*` version is
installed in the repo is what gets bundled, so the same harness compares the
baseline and a candidate.

It signs in as the staging CI account only. `run.cjs` refuses unless the
Supabase URL, anon key and service-role key all name `cvgqovweybggrqakhdtd`,
and the account id is `1954d827-…` from `e2e/test-account.ts`. The session is
minted with `auth.admin.generateLink`, which returns a token and sends no
email. Each scenario disposes its session with `signOut({ scope: 'local' })`.
It never signs out globally and writes no table rows; the one data call is a
read of the account's own `profiles` row.

```
npm i --prefix /some/tool/dir esbuild@0.25.10
ESBUILD_DIR=/some/tool/dir node scripts/auth-lock-harness/build.mjs "$PWD" /tmp/bundle.js staging.env
node scripts/auth-lock-harness/run.cjs "$PWD" /tmp/bundle.js staging.env [scenario ...]
```

`staging.env` needs `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`
and `SUPABASE_SERVICE_ROLE_KEY` for rooted-staging. Scenarios:

- `concurrent`: the access token is marked expired, then both tabs call
  getUserWithRetry, getSession, getUser and a protected read at once.
- `contention`: tab A's refresh is slowed to 8s inside the client's own
  auto-refresh tick; tab B asks for the session meanwhile.
- `late`: as `contention`, but A's refresh reaches the server 15s late.
- `natural`: no direct calls. The client's own 30s interval tick starts a
  slowed refresh, and the other tab asks for the session while it is in flight.
  This is the production error's path.
- `resume`: both tabs go to the background with an expired token and come
  back together. Visibility is simulated by overriding
  `document.visibilityState` and dispatching `visibilitychange`.
- `signout`: tab A signs out (local scope); tab B must see `SIGNED_OUT` and
  getUserWithRetry must answer `signed-out`, which is what the dashboard
  layout redirects on.
