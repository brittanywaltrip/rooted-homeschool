import test from "node:test";
import assert from "node:assert/strict";
import { linkCheckUrl } from "./link-check-url.ts";

test("internal printable paths become fetchable URLs with their query intact", () => {
  assert.equal(linkCheckUrl("/dashboard/printables/first-day?theme=fall"),
    "https://www.rootedhomeschoolapp.com/dashboard/printables/first-day?theme=fall");
});

test("external links retain their host and query", () => {
  assert.equal(linkCheckUrl("https://librivox.org/search?title=fall"),
    "https://librivox.org/search?title=fall");
});

test("non-web links cannot become requests", () => {
  assert.throws(() => linkCheckUrl("javascript:alert(1)"), /Unsupported/);
  assert.throws(() => linkCheckUrl("file:///etc/passwd"), /Unsupported/);
});
