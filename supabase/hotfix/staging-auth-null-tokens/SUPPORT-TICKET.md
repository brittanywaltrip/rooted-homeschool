# Supabase support ticket — rooted-staging auth password grant returns 500

**Project ref:** `cvgqovweybggrqakhdtd` (rooted-staging)
**Date:** 2026-09-19
**Severity:** blocking staging e2e; no production impact

## Exact error

`POST https://cvgqovweybggrqakhdtd.supabase.co/auth/v1/token?grant_type=password`

```json
{"msg":"Database error querying schema","code":500,"error_code":"unexpected_failure"}
```

Reproduced 3/3 attempts spaced 4s apart. Also reproduced through the
application's own `/api/auth/login`, which returns the same message.

## What is NOT wrong

- **GoTrue is up.** `GET /auth/v1/health` returns 200, `{"version":"v2.197.0"}`.
  `GET /auth/v1/settings` returns 200. The service is serving, not wedged, so a
  restart is not indicated.
- **The database is up.** An anonymous PostgREST read returns 200.
- **The auth schema matches production**: 35 columns on `auth.users`, 27 auth
  tables, 4 auth functions, `auth.sessions` 15 columns, `auth.refresh_tokens`
  9 columns, 82 rows in `auth.schema_migrations` (latest `20260831180000`).
- **Ownership and grants match**: all 27 auth tables owned by
  `supabase_auth_admin`; it holds USAGE on `public`; `search_path=auth`. No
  auth hooks, no triggers on `auth.users`, 6 event triggers (same as production).

## Root cause (believed identified, no ticket may be needed)

All 6 users carry NULL in four columns GoTrue requires to be `''`:

| column | rooted-staging | production |
|---|---|---|
| `confirmation_token` | 6/6 NULL | 0 NULL, 2541 empty |
| `recovery_token` | 6/6 NULL | 0 NULL, 2540 empty |
| `email_change` | 6/6 NULL | 0 NULL, 2551 empty |
| `email_change_token_new` | 6/6 NULL | 0 NULL, 2551 empty |

This matches the documented cause exactly:
https://supabase.com/docs/guides/troubleshooting/auth-error-500-database-error-querying-schema-eb6b44

The project was catalog-cloned and its synthetic accounts created by hand,
which is the circumstance that doc names.

**Ask, if raising this anyway:** please confirm the four columns above are the
complete set GoTrue requires to be non-NULL for a password grant, so the fix
does not have to be found one column at a time.
