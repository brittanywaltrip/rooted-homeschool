# Completion-window review correction

Base: `b5bf1cb4617650679d4b35ba7e63200c12eaf076`. This isolated branch leaves that review head and the preserved-work policy head `1a349d668c7444fb497a4539af7ac4bef4edd144` unchanged.

## Confirmed defect and change

The independent reviewer supplied a reproducible 48-hour completion-window bypass. Yesterday's completion could count as today's, allowing an atomic shift whose stored dates disagreed with normal projection. The baseline probe failed the new rejection assertion (`../investigation-evidence/window-red.txt`).

The proposed SQL now derives both civil-midnight boundaries from the owning account's `public.profiles.timezone`, the existing account timezone setting. Preview ignores the legacy caller-supplied boundary parameters and returns canonical boundaries. Commit independently validates both boundaries and requires the account's actual current civil date. Missing/invalid account zones and skipped civil dates fail closed. The snapshot records the zone name, so a zone change invalidates an old preview even if its UTC offset happens to match. Commit and Undo lock the profile row through validation and writes.

Each midnight is converted separately, rather than assuming a 24-hour day. Preview callers whose browser calendar day disagrees with the account calendar day receive a safe refusal; automatically reconciling that UX is not implemented here.

## Validation

- Original 48-hour proposal rejected with the entire stored snapshot unchanged; direct forged expected boundaries also rejected.
- Valid two-lessons-per-day shift succeeds without counting yesterday's completion.
- Zone change after preview invalidates the snapshot.
- Exact boundaries tested for New York's 23/25-hour transitions, Lord Howe's 23.5-hour transition, Kathmandu, Kiritimati and UTC; shifted forged boundaries rejected. Samoa's skipped civil date, missing profile and invalid zone refused.
- Existing 17 SQL rehearsal scenarios passed, including 64 SQL/TypeScript parity and mutation checks, concurrent commits, idempotency, rollback, permissions, Undo and actual callback/coordinator browser rehearsal.
- Targeted unit tests: 51 passed. TypeScript check passed. Full suite: 2,108 passed, 8 skipped, 0 failed. All five prior review probes (gap, silent rewrite, Undo rewrite, protected field and deferred trigger) passed. Results are recorded in the adjacent `investigation-evidence/window-*` logs.

These are synthetic local PostgreSQL 17 and fixture-browser tests. Real schema/PostgREST transport, production auth, production migration application and PR #146 coexistence have **not** been tested. No real family records changed. The SQL remains under `supabase/proposals`, outside the executable migration ledger.

## Integration and release limits

The preserved-work policy branch inherits the reviewed base and must incorporate this correction before any release candidate is considered. Existing release gates remain: independent review, full-schema/authenticated integration, old-client containment, receipt retention/privacy decisions, vacation/profile lock contention and ordering, and the explicit release/reschedule flow for preserved unfinished rows. Do not apply either proposal or repair customer data from these tests.

The private customer inventory was not downloaded locally; the upstream HTTP 403 remains a blocker and was not retried. Cloud numerical validation is parent-supplied evidence only. A customer repair still needs an exact reviewed manifest, verified backup, approved execution and postcondition checks.
