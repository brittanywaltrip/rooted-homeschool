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

import { sendResendTemplate } from "./resend-template.ts";

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
