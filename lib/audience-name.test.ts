// Tests for lib/audience-name.ts: the first name a broadcast greeting uses.

import { test } from "node:test";
import assert from "node:assert/strict";

import { audienceFirstName } from "./audience-name.ts";

test("a normal first name is kept", () => {
  assert.equal(audienceFirstName("Brittany", "The Waltrips"), "Brittany");
  assert.equal(audienceFirstName("Mary Beth", null), "Mary Beth");
});

test("a real name is left alone even when it may be the other parent's", () => {
  assert.equal(audienceFirstName("Chris", "Brittany Waltrip"), "Chris");
});

test("empty or whitespace falls back", () => {
  assert.equal(audienceFirstName("", null), "there");
  assert.equal(audienceFirstName("   ", undefined), "there");
  assert.equal(audienceFirstName(null, null), "there");
});

test("two characters is too short", () => {
  assert.equal(audienceFirstName("Jo", null), "there");
  assert.equal(audienceFirstName("J.", ""), "there");
});

test("stop words are not names, case-insensitive", () => {
  assert.equal(audienceFirstName("The", null), "there");
  assert.equal(audienceFirstName("mrs", null), "there");
  assert.equal(audienceFirstName("MRS.", null), "there");
  assert.equal(audienceFirstName("Our family", null), "there");
  assert.equal(audienceFirstName("the Smiths", null), "there");
  for (const w of ["the", "mrs", "mr", "ms", "and", "our", "my", "family"]) {
    assert.equal(audienceFirstName(w.toUpperCase(), null), "there", w);
  }
});

test("leading, trailing and inner whitespace is tidied", () => {
  assert.equal(audienceFirstName("  Anna  ", null), "Anna");
  assert.equal(audienceFirstName("Mary \n  Beth", null), "Mary Beth");
});

test("falls back to the display name's first word", () => {
  assert.equal(audienceFirstName("The", "Jessica Gauder"), "Jessica");
  assert.equal(audienceFirstName("", "  Sarah   Lee "), "Sarah");
  assert.equal(audienceFirstName("Mr", "Mrs. Smith"), "there");
  assert.equal(audienceFirstName("", "Al Jones"), "there");
});

test("both empty gives there", () => {
  assert.equal(audienceFirstName("", ""), "there");
  assert.equal(audienceFirstName(undefined, "   "), "there");
});

test("an email address is not a name", () => {
  assert.equal(audienceFirstName("mom@example.com", "Kate Smith"), "Kate");
});
