# Link-check preparation — October 5, 2026

Local branch: fix/link-check-read-fail-closed. Integrated with current production b9904b6fa60223e9d183a64e3db898c0a1f286d7 in e3588988, without conflicts. No migration or dependency change. No deployment, scheduled check invocation, customer email or remote database write.

The weekly checker previously passed a relative printable URL directly to server fetch, which failed before reaching the app. linkCheckUrl now resolves internal paths against https://www.rootedhomeschoolapp.com, preserving query parameters, while preserving external HTTP(S) destinations. Non-web protocols are rejected. Catalog-read errors stop the check rather than producing a misleading empty or partial success.

Verification: 18 URL/Mail Adventures checks passed. Integrated full suite: 2,048 passed, zero failed, eight skipped. Five additional route-execution tests pass with isolated adapters: either catalog failure or both failures returns 500 with no outbound requests, tracking writes or email; genuinely empty catalogs return 200; missing cron authorization reaches no service. Helper, route and new-test lint pass; TypeScript and diff checks pass. The route-execution harness transpiles the actual route, not a copied implementation.

Staging verification still required: run the exact deployed code against synthetic catalog rows and a stubbed email destination/provider. Include relative printable paths with query parameters, external success, 404, 403, timeouts and database read failures. Compare tracking changes against expected rows and confirm visibility fields stay untouched. Do not invoke production cron merely to test: it can send the owner's report and update tracking counters.

Known limitations retained: authentication-gated URLs may redirect to a login page, so an anonymous HTTP success does not prove the signed-in printable flow. HEAD refusals do not establish that a page is broken in a browser. Tracking-write errors and provider delivery acceptance are not fully validated by this narrow change. Catalog HTML escaping and write-result handling merit a separate review. No claim is made that the 55 blocked links are dead, and no resources were hidden or removed.

Related prepared work: admin auth callback fix 8c835807 is locally tested but requires browser verification; Reports integrated code 668728a7 and record 0751a272 require staging verification with actual triggers. CC owns Builder capacity work. Keep all three preparations separate until their exact release gates pass.
