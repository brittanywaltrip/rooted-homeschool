# Verified partner card generation

This is a follow-up to #139, based on its exact tested tree. It does not change #139's branch or interrupt its staging checks.

## Problem and resulting behavior

The existing card endpoint generates Rooted-branded HTML using any caller-supplied name, code and destination, without authenticating or checking the partner record. Code inspection establishes this behavior; no production exploit or card generation is claimed.

The endpoint now verifies a bearer token through Auth `getUser`, then reads the active affiliate record by code. For ordinary users, the query also requires their user ID, and ownership is checked again before rendering. The three existing admin identities can preview another active partner only with a confirmed Auth email. User metadata is not an authorization source. Anonymous Auth users are refused.

Both cards use the saved partner name/code. A canonical `https://rootedhomeschoolapp.com/?ref=...` destination is built with an encoded code. Legacy name/url parameters are ignored. QR contents and visible links derive from the same canonical value. Successful and refused responses are private/no-store and vary by Authorization; the route is force-dynamic.

All four Settings downloads (print/share, admin/partner) now send the bearer token, request no-store, and reject unsuccessful responses. The blank tab still opens synchronously before awaiting session/fetch, preserving the existing mobile popup behavior. Existing downloaded cards continue to work. Direct unauthenticated generation links and older cached clients are intentionally refused; refreshing the app loads the authenticated download workflow.

## Verification

- Full suite: 1,986 passed, 0 failed, 8 skipped (1,994 total), including 13 new access tests and #139's four card-output tests.
- New tests exercise the actual request handler with injected Auth/database/render dependencies: missing/malformed/invalid/anonymous credentials, ownership, unknown/inactive partners, verified versus unverified admin, failures, required/bounded code, forged names/destinations, canonical URL encoding, retained disclosures and private cache headers.
- Typecheck passes; access library, tests and route lint clean. Settings retains its baseline one explicit-any error and eight warnings; none was introduced by this patch.
- Supabase changelog index scanned for relevant changes. Current [getUser documentation](https://supabase.com/docs/reference/javascript/auth-getuser) checked. No dependency, schema or RLS changes; privileged credentials remain server-only. Ownership filters are explicit because the service client bypasses RLS.
- No live database, Auth token or browser integration test was performed here. These remain staging gates; unit mocks do not establish that a deployed environment is correctly configured.

## CC staging handoff

After completing the current PR tests, deploy this exact commit to rooted-staging and verify identity before creating synthetic fixtures.

1. No login, fake token, public API key and ordinary non-partner login: refusal, no card HTML. Verify private/no-store headers on successes and refusals.
2. Active synthetic partner: own print and share downloads succeed; requesting a different partner's code is refused. Inactive partner and unknown code are refused.
3. Confirmed synthetic admin using the existing allowlist: both preview downloads succeed for an active partner. No authorization from editable metadata.
4. Send forged name and external URL parameters with an authorized request. Saved identity and Rooted destination must remain in HTML and both decoded QR codes. Disclosure from #139 remains inside each card.
5. Test mobile popup opening, expired login/error message, print/PDF and normal smoke. Confirm no service key appears in client bundles or responses. Remove synthetic users and data.

Keep draft until these checks pass. This follow-up depends on #139; rebase onto main after #139 merges, then re-check the resulting commit. No production release, payout, email or recovery apply is authorized by this handoff. The general QR image endpoint is unchanged; it does not generate the branded partner HTML. Existing public partner posts and the separate marketing-claim gates remain open.
