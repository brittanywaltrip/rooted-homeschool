# rooted-staging repairs

Environment repairs applied to rooted-staging (`cvgqovweybggrqakhdtd`). None of
these are migrations, none carries a ledger version, and **none may be applied
to production**, which is correct in every case below.

Both exist for the same underlying reason: rooted-staging was catalog-cloned
from production, and a catalog clone copies structure and data without
everything that makes the services around them work.

| repair | applied | what it fixed |
|---|---|---|
| [`schema_migrations` constraints](STAGING-LEDGER-REPAIR.md) | 2026-09-19 | The ledger had 108 rows, zero constraints and zero indexes, so `apply_migration` failed with `42P10`. **Production already has both constraints; do not apply there.** |
| [`auth.users` NULL token columns](supabase/hotfix/staging-auth-null-tokens/APPLIED.md) | 2026-09-20 | Password sign-in returned `500 Database error querying schema`. All 6 synthetic users held NULL in four columns GoTrue requires to be `''`. **Production has zero NULLs in all four; do not apply there.** |

Expect more of this class on any future project created the same way. Check
before relying on a cloned project for anything the app actually exercises: the
schema being right is not evidence that the services are.
