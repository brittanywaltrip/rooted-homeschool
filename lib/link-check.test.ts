import test from "node:test";
import assert from "node:assert/strict";
import {
  categorize,
  countReport,
  isFailure,
  isLoginUrl,
  probeLink,
  reportSubject,
  resolveLinkUrl,
  shouldEmail,
  type Probe,
} from "./link-check.ts";

// ── URL resolution ──────────────────────────────────────────────────────────

test("a relative printable path resolves against the canonical Rooted origin, query intact", () => {
  // The Fall Photo Frame row stores exactly this, and was reported as a
  // connection failure every week because it was fetched with no host.
  assert.equal(
    resolveLinkUrl("/dashboard/printables/first-day?theme=fall"),
    "https://www.rootedhomeschoolapp.com/dashboard/printables/first-day?theme=fall"
  );
});

test("external links keep their own host and query", () => {
  assert.equal(resolveLinkUrl("https://librivox.org/search?title=fall"), "https://librivox.org/search?title=fall");
  assert.equal(resolveLinkUrl("  https://librivox.org  "), "https://librivox.org/");
});

test("non-web links never become requests", () => {
  assert.equal(resolveLinkUrl("javascript:alert(1)"), null);
  assert.equal(resolveLinkUrl("file:///etc/passwd"), null);
  assert.equal(resolveLinkUrl("mailto:hello@example.com"), null);
});

// ── Categories ──────────────────────────────────────────────────────────────

const probe = (status: number | null, extra: Partial<Probe> = {}): Probe => ({
  status,
  finalUrl: "https://example.com/page",
  redirected: false,
  method: "GET",
  ...extra,
});

test("only 404 and 410 are a missing page", () => {
  assert.equal(categorize(probe(404)), "missing");
  assert.equal(categorize(probe(410)), "missing");
  assert.equal(categorize(probe(400)), "unexpected");
  assert.equal(categorize(probe(405)), "unexpected");
});

test("connection failures and timeouts are unreachable, not missing", () => {
  assert.equal(categorize(probe(null)), "unreachable");
  assert.equal(categorize(probe(408)), "unreachable");
  assert.equal(categorize(probe(503)), "server_error");
});

test("403 and 429 are blocked requests", () => {
  assert.equal(categorize(probe(403)), "blocked");
  assert.equal(categorize(probe(429)), "blocked");
});

test("401 or a redirect onto a sign-in page is login_required, and is not a failure", () => {
  assert.equal(categorize(probe(401)), "login_required");
  assert.equal(
    categorize(probe(200, { redirected: true, finalUrl: "https://www.rootedhomeschoolapp.com/login?next=%2Fdashboard" })),
    "login_required"
  );
  assert.equal(categorize(probe(200, { redirected: true, finalUrl: "https://shop.example.com/account/login" })), "login_required");
  assert.equal(isFailure("login_required"), false);
  assert.equal(isFailure("ok"), false);
  for (const c of ["missing", "unreachable", "server_error", "blocked", "unexpected", "invalid_url"] as const) {
    assert.equal(isFailure(c), true, c);
  }
});

test("a redirect to an ordinary page is ok, and the login test reads only the path", () => {
  assert.equal(categorize(probe(200, { redirected: true, finalUrl: "https://example.com/blog/how-to-login-faster" })), "ok");
  assert.equal(isLoginUrl("https://login.example.com/welcome"), false);
  assert.equal(isLoginUrl("https://example.com/en-us/signin"), true);
});

// ── HEAD then bounded GET ───────────────────────────────────────────────────

type Call = { url: string; method: string };

function fakeFetch(responses: Record<string, Array<number | "throw" | { status: number; url: string }>>) {
  const calls: Call[] = [];
  let cancelled = 0;
  const impl = async (url: string, init: RequestInit) => {
    const method = init.method ?? "GET";
    calls.push({ url, method });
    const queue = responses[method] ?? [];
    const next = queue.shift();
    if (next === undefined) throw new Error(`unexpected ${method}`);
    if (next === "throw") throw new TypeError("fetch failed");
    const status = typeof next === "number" ? next : next.status;
    const finalUrl = typeof next === "number" ? url : next.url;
    return {
      status,
      url: finalUrl,
      redirected: finalUrl !== url,
      body: { cancel: async () => { cancelled++; } },
    } as unknown as Response;
  };
  return { impl, calls, cancelled: () => cancelled };
}

const noSleep = async () => {};

test("a HEAD that works makes no GET", async () => {
  const f = fakeFetch({ HEAD: [200] });
  const p = await probeLink("https://example.com/", { fetch: f.impl, sleep: noSleep });
  assert.equal(p.status, 200);
  assert.deepEqual(f.calls.map((c) => c.method), ["HEAD"]);
});

test("a HEAD refused by the server falls back to GET, and the GET decides", async () => {
  const f = fakeFetch({ HEAD: [405], GET: [200] });
  const p = await probeLink("https://example.com/", { fetch: f.impl, sleep: noSleep });
  assert.equal(categorize(p), "ok");
  assert.deepEqual(f.calls.map((c) => c.method), ["HEAD", "GET"]);
});

test("a 404 on HEAD is only missing when the GET agrees", async () => {
  const lying = fakeFetch({ HEAD: [404], GET: [200] });
  assert.equal(categorize(await probeLink("https://example.com/", { fetch: lying.impl, sleep: noSleep })), "ok");

  const gone = fakeFetch({ HEAD: [404], GET: [404] });
  assert.equal(categorize(await probeLink("https://example.com/", { fetch: gone.impl, sleep: noSleep })), "missing");
});

test("a HEAD connection failure still gets a GET before it is called unreachable", async () => {
  const recovers = fakeFetch({ HEAD: ["throw"], GET: [200] });
  assert.equal(categorize(await probeLink("https://example.com/", { fetch: recovers.impl, sleep: noSleep })), "ok");

  const down = fakeFetch({ HEAD: ["throw"], GET: ["throw"] });
  assert.equal(categorize(await probeLink("https://example.com/", { fetch: down.impl, sleep: noSleep })), "unreachable");
});

test("a blocked GET is retried once after a pause, and no more", async () => {
  let slept = 0;
  const sleep = async () => { slept++; };
  const f = fakeFetch({ HEAD: [403], GET: [403, 403] });
  assert.equal(categorize(await probeLink("https://example.com/", { fetch: f.impl, sleep })), "blocked");
  assert.deepEqual(f.calls.map((c) => c.method), ["HEAD", "GET", "GET"]);
  assert.equal(slept, 1);
});

test("every response body is cancelled, so a GET never downloads the page", async () => {
  const f = fakeFetch({ HEAD: [404], GET: [404] });
  await probeLink("https://example.com/big.pdf", { fetch: f.impl, sleep: noSleep });
  assert.equal(f.cancelled(), 2);
});

test("a hung request is aborted at the timeout", async () => {
  const impl = (_url: string, init: RequestInit) =>
    new Promise<Response>((_resolve, reject) => {
      init.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
    });
  const p = await probeLink("https://example.com/", { fetch: impl, sleep: noSleep, timeoutMs: 5 });
  assert.equal(categorize(p), "unreachable");
});

test("a sign-in redirect is detected on the HEAD without a GET", async () => {
  const f = fakeFetch({ HEAD: [{ status: 200, url: "https://example.com/login" }] });
  const p = await probeLink("https://example.com/members", { fetch: f.impl, sleep: noSleep });
  assert.equal(categorize(p), "login_required");
  assert.equal(f.calls.length, 1);
});

// ── The report ──────────────────────────────────────────────────────────────

test("the subject never counts connection failures as broken", () => {
  const c = countReport([
    { category: "unreachable", consecutive_failures: 1 },
    { category: "unreachable", consecutive_failures: 4 },
    { category: "server_error", consecutive_failures: 1 },
  ]);
  const subject = reportSubject(c, 0);
  assert.equal(subject, "Weekly Link Check: 1 server error, 2 couldn't connect");
  assert.doesNotMatch(subject, /broken|missing/);
});

test("confirmed missing pages lead the subject on their own", () => {
  const c = countReport([
    { category: "missing", consecutive_failures: 1 },
    { category: "missing", consecutive_failures: 2 },
    { category: "unreachable", consecutive_failures: 1 },
    { category: "blocked", consecutive_failures: 3 },
    { category: "blocked", consecutive_failures: 1 },
    { category: "login_required", consecutive_failures: 0 },
  ]);
  assert.equal(reportSubject(c, 0), "Weekly Link Check: 2 missing, 1 couldn't connect, 1 blocked (persistent)");
  assert.equal(c.blocked_monitoring, 1);
  assert.equal(c.login_required, 1);
});

test("unsaved results mark the report incomplete", () => {
  const c = countReport([{ category: "missing", consecutive_failures: 1 }]);
  assert.equal(reportSubject(c, 2), "Weekly Link Check (incomplete): 1 missing, 2 not recorded");
  assert.equal(shouldEmail(countReport([]), 1), true);
});

test("sign-in pages and new 403s alone do not send an email", () => {
  const c = countReport([
    { category: "login_required", consecutive_failures: 0 },
    { category: "blocked", consecutive_failures: 2 },
  ]);
  assert.equal(shouldEmail(c, 0), false);
});
