// Pins the body-to-row contract for the public partner application
// flow. Two production scenarios that broke before this fix:
//   1. Applicants without PayPal had nowhere to put their Venmo/Zelle/
//      Mercury info, so the form rejected them outright.
//   2. The admin email and partner_apps row both said "PayPal" even
//      when the applicant had picked another channel, so manual triage
//      had to dig into the form-side state to recover the channel.

import { test } from "node:test";
import assert from "node:assert/strict";
import { buildPartnerAppRow } from "./partner-apply.ts";

test("buildPartnerAppRow with paymentMethod='Venmo' persists payment_method='Venmo'", () => {
  const row = buildPartnerAppRow({
    firstName: "Amber",
    lastName: "Cody",
    email: "amber@example.com",
    paymentMethod: "Venmo",
    paymentAccount: "@amber-cody",
    socialHandle: "@amber",
  });
  assert.equal(row.payment_method, "Venmo");
  assert.equal(row.paypal_email, "@amber-cody",
    "Venmo handle still lands in paypal_email since it's the destination column");
});

test("buildPartnerAppRow with no paypalEmail succeeds when paymentMethod is non-PayPal", () => {
  const row = buildPartnerAppRow({
    firstName: "Kendra",
    lastName: "Poole",
    email: "kendra@example.com",
    paymentMethod: "Mercury (ACH)",
    paymentAccount: "kendrapoole62@gmail.com",
    socialHandle: "@kendra",
  });
  assert.equal(row.payment_method, "Mercury (ACH)");
  assert.equal(row.paypal_email, "kendrapoole62@gmail.com");
});

test("buildPartnerAppRow defaults paymentMethod to 'PayPal' when omitted (legacy form)", () => {
  const row = buildPartnerAppRow({
    firstName: "Old",
    lastName: "Form",
    email: "legacy@example.com",
    paypalEmail: "legacy@example.com",
    socialHandle: "@old",
  });
  assert.equal(row.payment_method, "PayPal",
    "back-compat: a body without paymentMethod defaults to PayPal");
  assert.equal(row.paypal_email, "legacy@example.com");
});

test("buildPartnerAppRow prefers paymentAccount over paypalEmail when both are present", () => {
  const row = buildPartnerAppRow({
    firstName: "X", lastName: "Y", email: "xy@example.com",
    paymentMethod: "Venmo",
    paymentAccount: "@new-channel",
    paypalEmail: "stale@old.com",
    socialHandle: "@xy",
  });
  assert.equal(row.paypal_email, "@new-channel",
    "the new field wins; legacy paypalEmail is the fallback");
});

test("buildPartnerAppRow propagates required identity fields", () => {
  const row = buildPartnerAppRow({
    firstName: "First", lastName: "Last", email: "fl@example.com",
    paymentMethod: "Zelle", paymentAccount: "fl@example.com",
    socialHandle: "@fl", hasRootedAccount: true, rootedAccountEmail: "fl@example.com",
    audienceSize: "5,000–20,000", whyRooted: "Big fan", story: "Long story",
  });
  assert.equal(row.first_name, "First");
  assert.equal(row.last_name, "Last");
  assert.equal(row.email, "fl@example.com");
  assert.equal(row.has_rooted_account, true);
  assert.equal(row.rooted_account_email, "fl@example.com");
  assert.equal(row.audience_size, "5,000–20,000");
  assert.equal(row.why_rooted, "Big fan");
  assert.equal(row.about_journey, "Long story");
});
