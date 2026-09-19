# Staging-only repair: `supabase_migrations.schema_migrations` constraints

**Applied to rooted-staging (`cvgqovweybggrqakhdtd`) on 2026-09-19.**
**Must NOT be applied to production — the constraints already exist there.**

## What was wrong

Stage 1's first `apply_migration` failed with:

```
ERROR:  42P10: there is no unique or exclusion constraint matching the
        ON CONFLICT specification
```

The migration SQL contains no `ON CONFLICT`, which is what gave it away: the
error came from `apply_migration`'s own upsert into the ledger, not from the
migration. Staging's ledger held **108 rows with no constraints and no
indexes** — the catalog clone that created rooted-staging copied the data but
not the primary key.

## Production comparison

| | production `gvkbegvvmhcrmxdorctk` | staging, before | staging, after |
|---|---|---|---|
| rows | 108 | 108 | 108 |
| `PRIMARY KEY (version)` | present | **absent** | present |
| `UNIQUE (idempotency_key)` | present | **absent** | present |
| indexes | `schema_migrations_pkey`, `schema_migrations_idempotency_key_key` | **none** | both |

Production was read only, to establish the target shape. Nothing was applied to
it and nothing should be: it already has both constraints, and re-adding them
would error.

## Safety checks taken first

```sql
select
  (select count(*) from supabase_migrations.schema_migrations where version is null),
  (select count(*) from (select version from supabase_migrations.schema_migrations
                          group by version having count(*) > 1) d),
  (select count(*) from (select idempotency_key from supabase_migrations.schema_migrations
                          where idempotency_key is not null
                          group by idempotency_key having count(*) > 1) d);
-- 0 null versions, 0 duplicate versions, 0 duplicate idempotency keys
```

`UNIQUE` permits multiple NULLs, so the 108 rows with a null `idempotency_key`
are unaffected.

## The exact DDL applied

```sql
alter table supabase_migrations.schema_migrations
  add constraint schema_migrations_pkey primary key (version);
alter table supabase_migrations.schema_migrations
  add constraint schema_migrations_idempotency_key_key unique (idempotency_key);
```

## Rollback

```sql
-- Only if this repair is somehow implicated in a problem. Dropping these
-- returns staging to a state where NO migration can be applied to it at all.
alter table supabase_migrations.schema_migrations
  drop constraint if exists schema_migrations_idempotency_key_key;
alter table supabase_migrations.schema_migrations
  drop constraint if exists schema_migrations_pkey;
```

## Why it is not a repo migration

It repairs the migration *ledger itself*, so it cannot be recorded by the
mechanism it repairs — the first `apply_migration` after it is what writes the
first row. It is also environment-specific: a defect of how rooted-staging was
cloned, not of the schema this repo describes. It lives here as a documented
operational fix.

**Expect it again** on any future project created the same way. Check before
Stage 3, and before any new environment.
