# APPLIED: rooted-staging auth.users NULL token repair

**Applied 2026-09-20 04:12:16–04:12:31 UTC** to rooted-staging
(`cvgqovweybggrqakhdtd`) only. Production untouched. Run through `execute_sql`,
**not** `apply_migration`: this repairs data, it is not a schema migration and
must not take a ledger version.

## Result: the 500 is resolved

| | before | after |
|---|---|---|
| `POST /auth/v1/token?grant_type=password` | **500** `Database error querying schema` | **400** `Invalid login credentials` |

GoTrue now queries the auth schema successfully. The remaining 400 is a
credential mismatch, a different and much smaller problem. See "What is still
blocked" below.

## Before (04:12:16 UTC)

6 users; **all 6** needed repair.

| column | NULL rows |
|---|---|
| `confirmation_token` | 6 |
| `recovery_token` | 6 |
| `email_change` | 6 |
| `email_change_token_new` | 6 |

Accounts: `e2e@`, `family-a@`, `family-b@`, `family-c@`,
`onboarding-audit@rooted-staging.test`, `fixture-recovery@example.invalid`.

## Executed SQL

One statement, so the guards and the writes shared one transaction. Verbatim:

```sql
do $repair$
declare
  v_total int; v_before int; v_after int; v_affected int;
begin
  -- GUARD 1: this must be the small synthetic project, never a real one.
  select count(*) into v_total from auth.users;
  if v_total > 50 then
    raise exception 'auth.users has % rows; this is not the synthetic staging project', v_total;
  end if;

  -- GUARD 2: every address must be synthetic.
  if exists (select 1 from auth.users
              where email not like '%@rooted-staging.test'
                and email not like '%@example.invalid') then
    raise exception 'auth.users contains a non-synthetic address; refusing to touch it';
  end if;

  select count(*) into v_before from auth.users
   where confirmation_token is null or recovery_token is null
      or email_change is null or email_change_token_new is null;

  -- The documented remedy, four columns only.
  update auth.users set confirmation_token     = '' where confirmation_token     is null;
  update auth.users set recovery_token         = '' where recovery_token         is null;
  update auth.users set email_change           = '' where email_change           is null;
  update auth.users set email_change_token_new = '' where email_change_token_new is null;

  select count(*) into v_after from auth.users
   where confirmation_token is null or recovery_token is null
      or email_change is null or email_change_token_new is null;

  v_affected := v_before - v_after;

  -- GUARD 3: refuse to commit unless every NULL is gone.
  if v_after > 0 then
    raise exception 'still % row(s) with NULL token columns after repair', v_after;
  end if;

  raise notice 'repaired % row(s) of % total users', v_affected, v_total;
end
$repair$;
```

## After (04:12:31 UTC)

| check | value |
|---|---|
| total users | 6 |
| `confirmation_token` NULL | **0** |
| `recovery_token` NULL | **0** |
| `email_change` NULL | **0** |
| `email_change_token_new` NULL | **0** |
| rows with all four `''` | **6** |
| rows still holding a password | 6 (unchanged) |
| rows still email-confirmed | 6 (unchanged) |

Exactly the six synthetic users were affected. Nothing outside the four columns
changed: passwords and confirmations were re-counted afterwards specifically to
show the repair did not disturb them.

## Scope

Four columns, six synthetic `.test` accounts. No schema change, no column added
or dropped, no constraint, no grant, no trigger. No other auth column touched,
and none will be: further column-by-column guessing was ruled out in advance.

## Rollback

Deliberately none. Restoring NULLs would restore the 500 and matches no working
project; production holds `''` in all four columns for all 2,552 users and zero
NULLs. If these accounts ever need to be reset, delete and recreate them through
the Auth admin API, which writes the correct shape.

## What is still blocked

`e2e@rooted-staging.test` is a valid, login-capable account: bcrypt hash
(`$2a$`, 60 chars), email confirmed, not banned, one `auth.identities` row with
provider `email`. The 400 therefore means `PLAYWRIGHT_PASSWORD` does not match
that account's password.

Fixing that means writing a password to `auth.users`, which was explicitly out
of scope, so it was not done. The options are to supply the correct password, or
to set one through the Auth admin API / dashboard.

## The support ticket is no longer needed

`SUPPORT-TICKET.md` is kept as the record of the investigation. It should not be
filed: the cause was Supabase's documented one and the fix worked.
