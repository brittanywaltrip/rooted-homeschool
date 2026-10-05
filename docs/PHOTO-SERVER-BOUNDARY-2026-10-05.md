# Photo signing boundary — October 5, 2026

Base: production b9904b6fa60223e9d183a64e3db898c0a1f286d7. Separate local branch fix/photo-server-boundary-2026-10-05. No database migration, storage policy, bucket visibility, dependency, or deployed app change.

The shared photo-url module imported getSupabaseAdmin even when browser components used only extractPath, coverBucketFor or authenticated-client signing. This is an unnecessary server import in the client dependency graph. Prior checks did not establish a leaked service key; do not call this a credential incident.

Moved privileged convenience wrappers, unchanged, into lib/photo-url-admin.ts and marked that module server-only. Family feed and digest server callers now import those wrappers there. Browser helpers retain their signatures and continue using the caller-supplied authenticated client. Removed an obsolete comment saying the browser signing chunk intentionally loaded the admin helper.

Scope: the base supabase-admin module remains unchanged because direct Node maintenance scripts import it. This change guards the privileged photo wrapper boundary, not every possible service-client import across the repository. No maintenance scripts were executed.

Validation: 52 focused photo-pipeline/family-portal checks passed. Existing full suite: 2,045 passed, zero failed, eight skipped. Four additional tests verify the import boundary, historical path/cover behavior, supplied-client single signing with expiry, and batch ordering/external placeholders. Changed-file lint and diff checks passed. TypeScript passed, including the new tests.

Build gate remains incomplete. An optimized Next webpack build was started with synthetic public build values only, then stopped after automatic approval review rejected continuing the check because the project's Sentry configuration can upload source maps/build artifacts externally. The build log never reached a completed build result. No attempt was made to bypass the rejection. Real compilation must confirm the Next server-only marker accepts server callers and rejects a client import; scan resulting client bundles for the admin helper and secret sentinels. Browser verification should cover photo capture/fallback, Settings avatars, signed images, yearbook cover/read/edit and family feed. The digest needs a synthetic preview only, not a live email send.

Next documentation: https://nextjs.org/docs/app/getting-started/server-and-client-components#preventing-environment-poisoning . It describes server-only imports as a build-time boundary and confirms non-public environment values are not included in client bundles. Static import tests do not substitute for that actual compilation gate.
