# Review API authorization

The admin review API previously used the service-role database client without checking the caller. The admin page's browser-side check did not protect direct GET, PATCH or DELETE requests.

This change verifies the bearer session with Supabase Auth and checks the existing administrator email allowlist before accessing reviews. The admin page sends its session token and distinguishes a failed load from an empty moderation queue.

Public review submissions no longer accept a caller-supplied user_id. A verified session supplies the account identity; anonymous submissions remain anonymous. New submissions remain pending, and public listings still select only approved reviews and public fields. This does not establish purchase verification or authenticate historical reviews.

Validation: 16 route tests passed with mocked providers, including unauthorized administration, invalid sessions, verified administrators, forged review ownership and pending/public filtering. TypeScript and focused lint passed (one existing public-page image warning). No live reviews were read, changed or removed during testing.

Before release, verify the exact commit on rooted-staging: anonymous and ordinary-user requests cannot administer reviews; a designated administrator can load the queue; public and signed-in submissions remain pending with the correct identity. Use synthetic reviews and remove fixtures afterward. No production deployment or moderation policy change is included.
