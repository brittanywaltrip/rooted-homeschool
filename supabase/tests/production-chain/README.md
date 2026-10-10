# Production prerequisite chain regression

The seven-file chain must begin with the actual production scheduler schema,
not an intermediate that omits the October 6 reopen migration.

That migration preserves unslotted lessons on reopen. The packaged lock
correction previously expected the older body and removed that behavior.
The release preflight now accepts only the exact prerequisite body; the locking
body preserves unslotted dates, pin, source, backfill and work. The containment
preflight matches that locked body exactly.

`transition.sql` is a synthetic-only transactional integration fixture for an
already migrated disposable local database. It tests the old-main Builder
request shape, legacy moves, protected stale writers, and unslotted reopen in
legacy and atomic modes. All fixture writes roll back. Never run it against
production or a customer database.

Independent rehearsal exercised clean and populated seven-step upgrades,
failure before every COMMIT, repeat-install refusal, exact final schema equality,
and restoration of a synthetic pre-upgrade checkpoint. Managed Auth ownership
and hosted PITR are outside this local proof.

Old Builder clients fail closed after the goal guard is installed; refresh is
required. This is an explicit release transition, not uninterrupted compatibility.
