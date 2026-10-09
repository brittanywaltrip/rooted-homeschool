# Local signed-in scheduler browser verification

All nine final phases passed using real password sign-in, real local PostgREST RPCs and a disposable synthetic owner. No app source was edited by this harness. The source was a changing working tree based on cbf46d530ac630d47cc8a1e877dafac69c0fa5d2; this is not an exact-final-commit build claim.

## Coverage

### readiness

Result: PASS; HTTP/page errors: 0.

- Real password sign-in reached Today
- Plan rendered with lesson search

### shift

Result: PASS; HTTP/page errors: 0.

- Real password sign-in reached Today
- Plan rendered with lesson search
- Shift-all committed once after deliberately lost response
- Retry retained identical operation UUID and payload
- Selected and following lessons advanced exactly one session; prefix date unchanged
- Reload preserves committed schedule and receipt count

### complete

Result: PASS; HTTP/page errors: 0.

- Real password sign-in reached Today
- Plan rendered with lesson search
- Actual Plan completion persisted and preserved notes/time/other completion states
- Completion pointer advanced to selected lesson
- Reload preserved completion and projected tail

### catchup

Result: PASS; HTTP/page errors: 0.

- Real password sign-in reached Today
- Catch-up opens on explicit notice click
- Catch-up completed three selected lessons on historical dates with note preserved and pointer3
- Catch-up and tail persisted after reload

### today-retry

Result: PASS; HTTP/page errors: 0.

- Real password sign-in reached Today
- Lost both completion responses shows explicit Check saved completion retry
- Explicit retry resolves original UUID/payload without a second completion timestamp or time write
- Today completion and tail persist across reload

### bulk

Result: PASS; HTTP/page errors: 0.

- Real password sign-in reached Today
- Plan rendered with lesson search
- Actual multi-select bulk completion committed two lessons atomically
- Bulk receipt Undo restores exact business fields, work and goal pointer
- Bulk Undo survives reload

### today-reload

Result: PASS; HTTP/page errors: 0.

- Real password sign-in reached Today
- Lost both completion responses shows explicit Check saved completion retry
- Reload after unresolved replies shows saved lesson with no duplicate completion or receipt; in-memory retry disappears

### tail-retry

Result: PASS; HTTP/page errors: 0.

- Real password sign-in reached Today
- Saved completion plus two lost tail replies shows explicit Refresh upcoming lessons recovery
- Recovery replays original tail UUID/payload without completion repeat or state change
- Recovered saved work and tail persist across reload

### plan-tail-retry

Result: PASS; HTTP/page errors: 0.

- Real password sign-in reached Today
- Plan rendered with lesson search
- Plan saved completion and shows explicit recovery after two lost tail replies
- Recovery replays same tail operation and Plan refetches lessons/goals without repeating completion
- Plan recovered completion and schedule persist on full reload

## Qualifications and provenance

- Browser allows only app 127.0.0.1:3106 and local backend 127.0.0.1:54321; service workers and outbound/telemetry browser requests blocked. App process uses loopback-only OS egress sandbox, strict local environment, test font fixture, existing installed dependencies, dev webpack. No hosted calls or customer records.
- Response-loss faults call route.fetch first, require applied/already_applied from the real database, then drop replies. They do not fabricate success. Database assertions compare actual own goal/lesson/receipt data.
- Full reload of unresolved completion correctly reads saved state and sends no duplicate completion; pending operation UUID is in memory only and does not persist across reload.
- Initial Today retry assertion raced tail receipt arrival; final harness waits actual tail reply, then fresh-course rerun passed. Initial Plan tail assertion used incorrect accessible name incomplete instead of observed not done; fresh-course rerun passed after locator correction. Both unsuccessful harness result files retained. Neither represented an application defect.
- Prior missing Today schemas are present in the current slice. extension-metadata.json, extension-definitions.json, extension-closure.json, extension-static-review.json, extension-install.sql and extension-catalog-verification.json establish reviewed metadata/DDL provenance for 12 tables including memories/app_events; exact catalog matches were previously verified. This agent installed no schemas or invented stubs. Current affected workflows had zero background HTTP errors.
- Screenshots, visible text, control inventories and per-phase JSON are in browser-containment-evidence/. Evidence contains synthetic state only. Real platform-wide feature parity, production settings, deployment behavior, clean dependency installation, real Google font delivery and real customer state are outside this test.

## Cleanup

browser-containment-cleanup-result.json records 96 own user-scoped rows removed, zero remaining rows in every public/rooted_private table with user_id, auth user absent, own scheduler modes/capabilities removed, and app port3106 closed. Cleanup used only exact synthetic owner filters. Server exited0. Local reports and synthetic screenshots retained.

## Remaining release gates

Wait for final committed source SHA and rerun build-exact-containment.py against its git archive. Existing previous cbf46d5 qualified build cannot certify subsequent edits. Parent owns final matrix, reviewed migration/containment sequencing, hosted approval and release decisions. No push, migration to hosted services, release, customer repair or email performed.
