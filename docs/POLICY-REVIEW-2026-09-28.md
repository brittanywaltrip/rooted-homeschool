# Policy wording review — September 28, 2026

This branch contains **draft wording for counsel and product review**, not an approved or published legal policy. Do not merge or deploy it until the checks below are resolved. The displayed `Last updated` dates should be changed only when the final policy is published.

## Draft changes

- Terms: describes monthly and annual Rooted+ billing, website Stripe processing, cancellation through the website billing portal, paid access after cancellation, and a channel-aware refund question path. Removes the unverified seven-day reminder promise and absolute refund denial. A lawyer must confirm renewal notice and cancellation requirements for every actual sales channel before this wording goes live.
- Privacy: lists optional child and transcript fields, recognizes operational providers and selected family sharing, describes signed-link access, and avoids unverified guarantees about instant deletion and analytics masking.
- FAQ: clarifies cancellation versus deletion, free yearbook preview, refunds, and renewal information. The existing upgrade/switch/pricing-lock answers still require provider evidence.

## Publication blockers

1. **Billing:** Confirm Stripe renewal emails, live price and price-change settings, refund handling, billing portal configuration, and whether Apple/Google subscriptions exist. Confirm any notice required by applicable law before removing or changing a renewal-reminder commitment. Update Terms and FAQ together.
2. **Analytics:** Inspect live PostHog recording, masking, person profiles, retention, and payloads; inspect Sentry replay masking and captured fields. Replace the draft's "reviewing" sentence with a factual description before publication.
3. **Deletion:** Test account deletion with storage/table failure injection and follow-up cleanup. Verify backups, deletion-record retention, and data-export scope. The current route can continue after some storage/delete errors.
4. **Children and sharing:** Check each profile/transcript field, photo sharing path, family invite and signed-link behavior. Counsel should review COPPA applicability and any state privacy rights text.
5. **Yearbook:** Check an archived yearbook on a free staging account, including navigation and export. The reader code limits free access to four watermarked spreads.
6. **Remaining legal claims:** Counsel should review arbitration, liability waiver, 72-hour breach notice, vendor certification/HIPAA wording, sale/transfer promises, AI/vendor-training guarantees, and promotional pricing-lock language. Do not infer enforceability from this code review.
7. **Export completeness:** Settings and the ZIP README previously promised "everything" while the export route selected seven tables without paging six of them, silently swallowed read errors, and parsed old photo URLs. The draft now pages 32 owner-scoped tables, includes three child tables via scoped parent IDs, lists all five family file buckets, fails on database/list errors, and warns about individual download failures. Staging schema confirms the 32 tables have `user_id` and `id`. Verify a real ZIP end to end on staging before publication. The ZIP remains raw data and files, not finished report/yearbook PDFs; operational logs and some auxiliary records are outside its scope.

No email or customer data was changed by this branch. The previous GitHub write attempt was rejected; this branch is local and must not be represented as a PR or production change.
