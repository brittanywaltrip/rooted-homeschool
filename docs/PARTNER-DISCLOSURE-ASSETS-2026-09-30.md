# Partner asset disclosure patch

The print and social card generators on main show a personal discount code, a Rooted Partner badge or “Shared by,” but no explanation that the sharer may earn a commission. The patch puts “I may earn a commission if you subscribe using my code.” directly beside the discount inside both cards. A shared Settings guide appears beside downloads in both the admin partner preview and the partner's own panel.

The guide supplies copyable disclosure, a selectable fallback if clipboard access fails, placement guidance for captions, QR screenshots, Stories, video and live streams, and a reminder to describe actual experience and avoid unverified claims. This does not change commission calculations, discount eligibility, payment records or customer data. The HTML generators moved to a server-side library to test their actual output; logo loading and QR generation behavior are preserved.

## Evidence and scope

- [FTC endorsement FAQ](https://www.ftc.gov/business-guidance/resources/ftcs-endorsement-guides-what-people-are-asking): a personalized discount code can indicate a relationship without conveying that it is financial; disclosures should explain the connection and be clear and conspicuous. Training alone does not replace appropriate advertiser monitoring.
- [FTC Disclosures 101](https://www.ftc.gov/business-guidance/resources/disclosures-101-social-media-influencers): put disclosure with the endorsement; make image overlays readable; disclose in video itself and repeat during live streams.
- Code evidence: `app/api/affiliate/cards/route.ts` at base `55689d02b4838218a730903577b2dec5e8e1dbc9`. An unauthenticated synthetic production GET returned a redirect body rather than card JSON, so no live card render is claimed.

This closes a specific generated-asset gap. It is not a determination of FTC compliance. Existing downloaded assets and posts will not change. A review of partners' actual posts and an appropriate ongoing monitoring process remain to be done. Broader privacy, retention, analytics, review-authenticity and marketing-claim release gates in the claims register remain open. No partner has been contacted.

## Local verification

- Full suite: 1,973 passed, 0 failed, 8 skipped (1,981 total), including four new tests of actual print/share HTML.
- Tests verify disclosure is inside the card beside the offer, with readable declared styling, and that QR/link output and escaped partner input remain present.
- Typecheck passed. New component, libraries, test and card route lint clean.
- Settings has an existing explicit-any lint error and eight existing warnings; compare the base file through ESLint before release. The patch only adds an import and the two guide instances there.
- Chromium installation failed because the download was not a valid ZIP. No browser or physical print verification is claimed.

## Staging handoff

Keep this as a draft until verification on the exact deployed commit. Do not replace CC's current staging deployment while its other checks are running.

1. Open Settings as a synthetic partner and the admin preview. Confirm guide placement, keyboard access, Copy disclosure success and the selectable-text fallback when clipboard access is denied.
2. Open both generated cards. Check at phone width that the disclosure is legible, adjacent to the discount and inside the region a partner would screenshot. Check a long name and code for clipping.
3. Print/PDF the print card; confirm disclosure remains visible and the QR code scans to the expected referral URL. The existing screenshot workflow still requires keeping the full disclosure in the image and adding it beside a recommendation in the caption.
4. Run the project's normal smoke and build checks against that commit. No production merge, deployment or partner message is part of this patch.

Separate follow-up: the existing public card endpoint accepts a caller-provided name, code and destination URL without confirming partner membership. This patch leaves that behavior unchanged; restricting branded output to authenticated partners and canonical referral destinations needs its own compatibility review.
