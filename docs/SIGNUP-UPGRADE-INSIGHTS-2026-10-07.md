# Signup and upgrade insights

Prepared on main b9904b6. Separate from scheduler #146; stage after the scheduler release, rebase and rerun checks if main moves. No production changes, emails, billing writes or schema migrations.

## Behavior

- Admin quick link opens `/admin/insights` with family account, Auth signup date, first positive paid subscription invoice timestamp, elapsed whole days and optional discovery answer.
- Historical upgrade timing uses Stripe invoice `status_transitions.paid_at`, not subscription creation, profile creation or latest renewal. Paid invoices are fully paginated. Later cancellations/refunds remain historical first upgrades; this is not revenue or active subscription reporting.
- Match by saved Stripe customer ID; duplicate ownership is omitted rather than inferred. Unmatched, gifted and app-store purchases are outside this view. The existing founder/test/comped exclusions are reused.
- Auth users, profiles and comped affiliates are fully paginated; source failures return 503 instead of incomplete successful statistics. Responses are private/no-store.
- Median includes only nonnegative known durations. Missing/impossible dates remain Unknown; no zero guess.
- The optional discovery question sits below the existing completion/navigation actions after onboarding. It adds no step and no requirement. A separate authenticated route validates a closed list, saves only the authenticated account's `rooted_discovery_source` Auth metadata and sends no email. It never writes referral, commission, billing, profile or scheduler state.
- Discovery source is explicitly self-reported and user-editable, not verified attribution. Unknown is the default for existing accounts. No historical source backfill or inferred partner attribution.

## Scope limits

Existing customers are not prompted automatically. Source question is shown to new onboarding completers. Campaign attribution, upgrade entry points, activity milestones and monthly cohort conversion rates are follow-ups.

Auth metadata is used only for a simple optional answer; not authorization. Account deletion removes the Auth record. The save route does not modify other metadata fields. Supabase metadata merging and preservation of sibling fields must be checked on staging.

## Local validation

- Full main-based suite plus first 10 new tests: 2063 tests, 2055 pass, 0 fail, 8 environment-gated skips.
- All 13 new tests pass, including three additional tests for the actual discovery save route.
- TypeScript and focused new-file lint pass.
- Local production build blocked by unavailable Google Fonts downloads (existing app/layout.tsx font imports). No successful build or browser/staging verification claimed.

## Required staging checks

1. Deploy integrated exact head after #146, verify staging project/commit identity, and run smoke. No send-capable crons.
2. Use synthetic account: complete onboarding without answering; first-action links work. Choose/save a source, reload Auth metadata and confirm other metadata unchanged. Failed save offers retry without blocking navigation.
3. Admin view: seeded signup and first-paid timestamps; renewal leaves first upgrade fixed; zero-dollar, gift and unmatched invoices omitted; canceled/refunded history wording visible. Missing paid date does not become a duration.
4. Anonymous and ordinary-user direct calls denied. Spoofed user_id has no effect. Response never exposes Stripe credentials or non-admin data.
5. Exercise >1000 Auth/profile rows, later-page errors and duplicate Stripe customer mappings. Verify complete pagination and error state.
6. Phone/desktop visual checks, keyboard labels, failure/retry, empty data, and Pacific dates near midnight.
7. Read-only live sanity check can compare Kelly/Breanne timing once release is ready; never send them test emails.

## Rollback

Rollback app deployment to prior client; no schema change or payment state to reverse. Saved optional discovery answers remain inert Auth metadata. Do not erase answers as part of rollback.
