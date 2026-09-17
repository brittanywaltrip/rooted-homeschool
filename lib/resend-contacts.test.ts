// Tests for lib/resend-contacts.ts with a fake fetch: 429 retries, paging, and
// the request shapes the audience sync depends on.

import { test } from "node:test";
import assert from "node:assert/strict";

import { createResendContactsClient } from "./resend-contacts.ts";

type Call = { method: string; url: string; body: unknown };

function fakeFetch(responses: Array<{ status: number; body?: unknown; headers?: Record<string, string> }>) {
  const calls: Call[] = [];
  const impl = (async (url: string | URL, init?: RequestInit) => {
    calls.push({ method: init?.method ?? "GET", url: String(url), body: init?.body ? JSON.parse(String(init.body)) : undefined });
    const next = responses.shift();
    if (!next) throw new Error("no more fake responses");
    return new Response(next.body === undefined ? "" : JSON.stringify(next.body), {
      status: next.status,
      headers: next.headers,
    });
  }) as typeof fetch;
  return { impl, calls };
}

function client(responses: Parameters<typeof fakeFetch>[0]) {
  const f = fakeFetch(responses);
  const sleeps: number[] = [];
  const c = createResendContactsClient({
    apiKey: "re_test",
    fetchImpl: f.impl,
    sleep: async (ms) => { sleeps.push(ms); },
    paceMs: 0,
  });
  return { c, calls: f.calls, sleeps };
}

test("a 429 is retried, honouring Retry-After, and the call then succeeds", async () => {
  const { c, calls, sleeps } = client([
    { status: 429, headers: { "retry-after": "2" } },
    { status: 429 },
    { status: 200, body: { object: "contact", id: "c1" } },
  ]);
  const res = await c.updateContact("c1", { firstName: "Anna" });
  assert.equal(res.ok, true);
  assert.equal(calls.length, 3);
  assert.deepEqual(sleeps, [2000, 2000]);
});

test("a 429 that never clears is an error result, not a throw", async () => {
  const { c, calls } = client(Array.from({ length: 6 }, () => ({ status: 429 })));
  const res = await c.addToSegment("a@b.com", "seg");
  assert.equal(res.ok, false);
  assert.equal(res.status, 429);
  assert.equal(calls.length, 6);
});

test("a network failure is an error result", async () => {
  const c = createResendContactsClient({
    apiKey: "k",
    fetchImpl: (async () => { throw new Error("offline"); }) as typeof fetch,
    sleep: async () => {},
    paceMs: 0,
  });
  const res = await c.removeFromSegment("x", "seg");
  assert.deepEqual([res.ok, res.status, res.error], [false, 0, "offline"]);
});

test("lists page with limit and after until has_more is false", async () => {
  const { c, calls } = client([
    { status: 200, body: { object: "list", has_more: true, data: [{ id: "a", email: "a@x.com", unsubscribed: false }, { id: "b", email: "b@x.com", unsubscribed: true }] } },
    { status: 200, body: { object: "list", has_more: false, data: [{ id: "c", email: "c@x.com", unsubscribed: false }] } },
  ]);
  const rows = await c.listSegmentContacts("seg 1");
  assert.deepEqual(rows?.map((r) => r.id), ["a", "b", "c"]);
  assert.equal(calls[0].url, "https://api.resend.com/segments/seg%201/contacts?limit=100");
  assert.equal(calls[1].url, "https://api.resend.com/segments/seg%201/contacts?limit=100&after=b");
});

test("a failed page makes the whole list null", async () => {
  const { c } = client([
    { status: 200, body: { has_more: true, data: [{ id: "a", email: "a@x.com", unsubscribed: false }] } },
    { status: 500, body: { message: "boom" } },
  ]);
  assert.equal(await c.listContacts(), null);
});

test("request shapes", async () => {
  const { c, calls } = client([{ status: 200 }, { status: 200 }, { status: 200 }, { status: 200 }, { status: 200 }]);
  await c.createContact({ email: "mom+1@x.com", firstName: "Kate", segmentId: "seg" });
  await c.updateContact("mom+1@x.com", { firstName: "Kate" });
  await c.updateContact("id-1", { unsubscribed: true });
  await c.addToSegment("mom+1@x.com", "seg");
  await c.removeFromSegment("id-1", "seg");
  assert.deepEqual(calls.map((x) => `${x.method} ${x.url}`), [
    "POST https://api.resend.com/contacts",
    "PATCH https://api.resend.com/contacts/mom%2B1%40x.com",
    "PATCH https://api.resend.com/contacts/id-1",
    "POST https://api.resend.com/contacts/mom%2B1%40x.com/segments/seg",
    "DELETE https://api.resend.com/contacts/id-1/segments/seg",
  ]);
  assert.deepEqual(calls[0].body, { email: "mom+1@x.com", first_name: "Kate", unsubscribed: false, segments: [{ id: "seg" }] });
  assert.deepEqual(calls[1].body, { first_name: "Kate" });
  assert.deepEqual(calls[2].body, { unsubscribed: true });
  assert.equal(calls[3].body, undefined);
});

test("updateContact cannot send unsubscribed: false", async () => {
  const { c, calls } = client([{ status: 200 }]);
  // @ts-expect-error false is not allowed by the type, and is dropped if forced.
  await c.updateContact("id-1", { unsubscribed: false });
  assert.deepEqual(calls[0].body, {});
});
