// Unit tests for sendResendTemplate. Run with:
//   node --test lib/resend-template.test.ts
//
// Regression guard: Resend's /emails API requires the nested
// `template: { id, variables }` shape. A flat `template_id` +
// `template_variables` returns 422 "Missing html or text" and silently killed
// the re-engagement drip from April to June 2026. These tests assert the outgoing
// payload never regresses to the flat shape.

import { test } from "node:test";
import assert from "node:assert/strict";

import { sendResendTemplate, sanitizeSubjectText } from "./resend-template.ts";

type Captured = { url: string; body: Record<string, unknown> };

// Replace global fetch with a stub that records the request and returns `status`.
function stubFetch(status: number, jsonBody: Record<string, unknown> = {}): {
  captured: Captured[];
  restore: () => void;
} {
  const captured: Captured[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = (async (url: string, init?: { body?: string }) => {
    captured.push({ url: String(url), body: JSON.parse(init?.body ?? "{}") });
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => jsonBody,
    };
  }) as unknown as typeof fetch;
  return { captured, restore: () => { globalThis.fetch = original; } };
}

test("payload uses nested template.id, never the flat template_id shape", async () => {
  const { captured, restore } = stubFetch(200);
  try {
    await sendResendTemplate("a@b.com", "tmpl-123", { firstName: "Sam" });
  } finally {
    restore();
  }

  assert.equal(captured.length, 1);
  const { body } = captured[0];

  // The flat shape that caused the 422 must never appear.
  assert.equal("template_id" in body, false, "payload must not contain flat template_id");
  assert.equal("template_variables" in body, false, "payload must not contain flat template_variables");

  // The correct nested shape must be present.
  assert.ok(body.template, "payload must contain nested template object");
  const template = body.template as { id: string; variables: Record<string, string> };
  assert.equal(template.id, "tmpl-123");
  assert.deepEqual(template.variables, { firstName: "Sam" });
});

test("passes through subject and headers when provided", async () => {
  const { captured, restore } = stubFetch(200);
  try {
    await sendResendTemplate(
      "a@b.com",
      "tmpl-123",
      { firstName: "Sam" },
      "From <x@y.com>",
      "Subject line",
      { "List-Unsubscribe": "<https://x/unsub>" },
    );
  } finally {
    restore();
  }

  const { body } = captured[0];
  assert.equal(body.from, "From <x@y.com>");
  assert.equal(body.subject, "Subject line");
  assert.deepEqual(body.headers, { "List-Unsubscribe": "<https://x/unsub>" });
});

test("returns the HTTP status on success so failure alerting can inspect it", async () => {
  const { restore } = stubFetch(200);
  let result;
  try {
    result = await sendResendTemplate("a@b.com", "tmpl-123", {});
  } finally {
    restore();
  }
  assert.deepEqual(result, { ok: true, status: 200 });
});

test("returns ok:false with the 4xx status and error message on failure", async () => {
  const { restore } = stubFetch(422, { message: "Missing html or text" });
  let result;
  try {
    result = await sendResendTemplate("a@b.com", "tmpl-123", {});
  } finally {
    restore();
  }
  assert.equal(result.ok, false);
  assert.equal(result.status, 422);
  assert.equal(result.error, "Missing html or text");
});

// ─── sanitizeSubjectText ───────────────────────────────────────────────────
// Resend rejects the entire send with 422 "The \n is not allowed in the
// subject field" if a newline reaches the subject, so the email is never
// delivered. Real case: a memory titled "Started a new skill\nBoxBollen"
// (memory 33204cf4) was reacted to on 2026-08-12 18:37 UTC and the
// notification to mom never went out, because reactionNotification's hosted
// subject interpolates {{{memoryTitle}}}.

test("collapses the newline that caused the August 12 2026 reaction 422", () => {
  assert.equal(
    sanitizeSubjectText("Started a new skill\nBoxBollen"),
    "Started a new skill BoxBollen",
  );
});

test("collapses every flavour of whitespace to a single space", () => {
  assert.equal(
    sanitizeSubjectText("a\r\nb\tc\n\n\nd   e f g"),
    "a b c d e f g",
  );
});

test("trims leading and trailing whitespace", () => {
  assert.equal(sanitizeSubjectText("  \n padded \n  "), "padded");
});

test("leaves an already-clean subject untouched", () => {
  assert.equal(sanitizeSubjectText("Nana reacted to your memory"), "Nana reacted to your memory");
});

test("truncates to 150 characters by default", () => {
  const long = "x".repeat(400);
  const out = sanitizeSubjectText(long);
  assert.equal(out.length, 150);
  assert.ok(out.endsWith("…"));
});

test("truncation prefers a nearby word boundary over cutting mid-word", () => {
  const long = `${"word ".repeat(29)}finalword`; // 145 chars, then a long tail
  const out = sanitizeSubjectText(long, 150);
  assert.ok(out.length <= 150);
  assert.ok(!out.includes("  "), "no double spaces introduced");
});

test("a short string is never padded or given an ellipsis", () => {
  assert.equal(sanitizeSubjectText("hi"), "hi");
});

test("sendResendTemplate sanitizes an explicit subject argument", async () => {
  const { captured, restore } = stubFetch(200, { id: "email-1" });
  try {
    await sendResendTemplate(
      "a@b.com",
      "tmpl-123",
      {},
      undefined,
      "Line one\nLine two",
    );
  } finally {
    restore();
  }
  assert.equal(captured[0].body.subject, "Line one Line two");
});
