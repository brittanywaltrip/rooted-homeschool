# Local package validation — 2026-10-09

Application base: a10838ae366b33eee0060be694e47d947d9dc5c2. Packaging changes add one transactional migration, deterministic assembler/manifest, metadata-only synthetic fixture, rehearsal branch and documentation. No application source changed.

- All 11 compatibility driver cases exited 0 (10 packaged SQL harness modes and the unchanged calendar-window case).
- Final preservation run: 21 SQL cases passed, including 64 SQL/TypeScript projection/mutation comparisons. Setup additionally asserts mismatched prerequisite refusal leaves no new column, duplicate installation refuses, and existing synthetic goal/lesson business state remains unchanged with new marker false.
- Reference proposal installation versus packaged migration: 23 function definitions compared; bodies, SECURITY DEFINER flags, configured search paths and ACLs identical; zero differences.
- Deterministic assembly reproduced SHA256 d19d4b66df7b091e163c2919382755edf20f43ce95f34cb1c39e95c6ac10fb9f.
- git diff --check, node --check and ESLint of the changed rehearsal harness passed. Aggregate application suite was not repeated for packaging-only changes; prior a108 evidence remains 2239 pass/8 skip/0 fail and TypeScript pass. Existing full-repository lint debt remains 79 errors/177 warnings (no new errors), and the 8 test skips retain their documented limits.

Evidence outside the repository: ../synthetic-runtime/package-compat-results.json, package-preservation.txt, package-reference-catalog.json, package-final-catalog.json, package-catalog-comparison.json. No hosted database or real family record was used. Native PostgreSQL 17.11 is a synthetic compatibility rehearsal, not certification of the current hosted schema/version, ledger, credentials or release build. Old-client containment remains a design, not an implemented property of this package.
