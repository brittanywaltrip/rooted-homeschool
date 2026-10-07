import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { runInNewContext } from "node:vm";
import * as linkCheck from "./link-check.ts";

const require = createRequire(import.meta.url);
const ts = require("typescript") as typeof import("typescript");

// Runs the real route with in-memory database, email and network adapters.
// Nothing here can reach Supabase, Resend or the internet.
const source = readFileSync(new URL("../app/api/cron/check-links/route.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;

type Row = { id: string; title: string; url?: string; official_url?: string; consecutive_failures: number };
type Opts = {
  resources?: Row[];
  listings?: Row[];
  readFails?: string[];
  writeFails?: string[];
  emailFails?: boolean;
  /** Status by requested URL, or "throw" for a connection failure. */
  web?: Record<string, number | "throw">;
  secret?: string;
};

function fixture(o: Opts = {}) {
  const writes: { table: string; id: string; patch: Record<string, unknown> }[] = [];
  const emails: { subject: string; html: string }[] = [];
  const requests: { url: string; method: string }[] = [];
  const exports: { GET?: (r: Request) => Promise<Response> } = {};
  const errors: unknown[] = [];

  runInNewContext(compiled, {
    exports,
    process: { env: o.secret === undefined ? { CRON_SECRET: "fixture-only" } : o.secret ? { CRON_SECRET: o.secret } : {} },
    console: { error: (...a: unknown[]) => errors.push(a) },
    AbortController, clearTimeout: () => {},
    setTimeout: (fn: () => void) => { fn(); return 0; },
    fetch: async (url: string, init: RequestInit) => {
      requests.push({ url, method: init.method ?? "GET" });
      const r = o.web?.[url] ?? 200;
      if (r === "throw") throw new TypeError("fetch failed");
      return { status: r, url, redirected: false, body: null } as unknown as Response;
    },
    require(name: string) {
      if (name === "next/server") return { NextResponse: { json: (b: unknown, init?: ResponseInit) => Response.json(b, init) } };
      if (name === "@/lib/link-check") return linkCheck;
      if (name === "@/lib/api-clients") return { resendClient: () => ({ emails: {
        send: async (m: { subject: string; html: string }) => {
          emails.push(m);
          return o.emailFails ? { data: null, error: { message: "fixture send failure" } } : { data: { id: "x" }, error: null };
        },
      } }) };
      if (name === "@/lib/supabase-admin") return { supabaseAdmin: {
        from(table: string) {
          const rows = table === "resources" ? o.resources ?? [] : o.listings ?? [];
          const read = o.readFails?.includes(table)
            ? { data: null, error: { message: "fixture read failure" } }
            : { data: rows, error: null };
          return {
            select: () => ({ ...read, eq: () => read }),
            update: (patch: Record<string, unknown>) => ({
              eq: async (_col: string, id: string) => {
                if (o.writeFails?.includes(id)) return { error: { message: "fixture write failure" } };
                writes.push({ table, id, patch: { ...patch } });
                return { error: null };
              },
            }),
          };
        },
      } };
      throw new Error(`Unexpected import: ${name}`);
    },
  });

  return {
    run: (auth: string | null = "Bearer fixture-only") =>
      exports.GET!(new Request("https://staging.invalid/api/cron/check-links", { headers: auth ? { authorization: auth } : {} })),
    writes, emails, requests, errors,
  };
}

const ROOTED = "https://www.rootedhomeschoolapp.com";

test("a relative resource is requested on the Rooted origin and passes", async () => {
  const f = fixture({
    resources: [{ id: "frame", title: "Fall Photo Frame", url: "/dashboard/printables/first-day?theme=fall", consecutive_failures: 3 }],
  });
  const res = await f.run();
  assert.equal(res.status, 200);
  assert.deepEqual(f.requests, [{ url: `${ROOTED}/dashboard/printables/first-day?theme=fall`, method: "HEAD" }]);
  // Its stale connection_failed streak is cleared.
  assert.deepEqual(f.writes, [{ table: "resources", id: "frame", patch: { last_check_status: "ok", consecutive_failures: 0 } }]);
  assert.equal(f.emails.length, 0);
});

test("connection failures are reported apart from missing pages", async () => {
  const f = fixture({
    resources: [
      { id: "gone", title: "Gone", url: "https://gone.example/", consecutive_failures: 0 },
      { id: "down", title: "Down", url: "https://down.example/", consecutive_failures: 0 },
    ],
    web: { "https://gone.example/": 404, "https://down.example/": "throw" },
  });
  const res = await f.run();
  const body = await res.json();
  assert.equal(res.status, 200);
  assert.equal(body.broken, 1);
  assert.equal(body.unreachable, 1);
  assert.equal(f.emails.length, 1);
  assert.equal(f.emails[0].subject, "Weekly Link Check: 1 missing, 1 couldn't connect");
  const byId = Object.fromEntries(f.writes.map((w) => [w.id, w.patch]));
  assert.deepEqual(byId.gone, { last_check_status: "missing", consecutive_failures: 1 });
  assert.deepEqual(byId.down, { last_check_status: "unreachable", consecutive_failures: 1 });
});

test("the checker writes only status and failure count, never visibility", async () => {
  const f = fixture({
    listings: [{ id: "l", title: "State park", official_url: "https://park.example/", consecutive_failures: 9 }],
    web: { "https://park.example/": 404 },
  });
  await f.run();
  for (const w of f.writes) assert.deepEqual(Object.keys(w.patch).sort(), ["consecutive_failures", "last_check_status"]);
  assert.equal(f.writes[0].table, "mailbox_listings");
});

for (const failed of [["resources"], ["mailbox_listings"], ["resources", "mailbox_listings"]]) {
  test(`a failed ${failed.join(" + ")} read stops before any request, write or email`, async () => {
    const f = fixture({
      resources: [{ id: "r", title: "R", url: "https://r.example/", consecutive_failures: 0 }],
      readFails: failed,
    });
    const res = await f.run();
    assert.equal(res.status, 500);
    assert.deepEqual(await res.json(), { error: "Link catalog read failed" });
    assert.equal(f.requests.length + f.writes.length + f.emails.length, 0);
  });
}

test("a failed tracking write makes the sweep a failure and says so in the email", async () => {
  const f = fixture({
    resources: [
      { id: "ok", title: "Ok", url: "https://ok.example/", consecutive_failures: 0 },
      { id: "bad", title: "Bad", url: "https://bad.example/", consecutive_failures: 0 },
    ],
    web: { "https://bad.example/": 404 },
    writeFails: ["bad"],
  });
  const res = await f.run();
  const body = await res.json();
  assert.equal(res.status, 500);
  assert.equal(body.tracking_write_failures, 1);
  assert.equal(f.emails[0].subject, "Weekly Link Check (incomplete): 1 missing, 1 not recorded");
  assert.match(f.emails[0].html, /This sweep is incomplete/);
});

test("a report email the provider rejects is not a successful sweep", async () => {
  const f = fixture({
    resources: [{ id: "g", title: "G", url: "https://g.example/", consecutive_failures: 0 }],
    web: { "https://g.example/": 410 },
    emailFails: true,
  });
  const res = await f.run();
  assert.equal(res.status, 500);
  assert.equal((await res.json()).email_error, "fixture send failure");
});

test("a non-web URL is reported without a request", async () => {
  const f = fixture({ resources: [{ id: "js", title: "Bad <b>", url: "javascript:alert(1)", consecutive_failures: 0 }] });
  await f.run();
  assert.equal(f.requests.length, 0);
  assert.equal(f.writes[0].patch.last_check_status, "invalid_url");
  assert.match(f.emails[0].html, /Bad &lt;b&gt;/);
});

test("empty catalogs still return a successful empty check", async () => {
  const f = fixture({ resources: [{ id: "e", title: "E", url: "", consecutive_failures: 20 }] });
  const res = await f.run();
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { checked: 0, broken: 0 });
});

test("missing or unset cron authorization touches nothing", async () => {
  // With CRON_SECRET unset, "Bearer undefined" used to match.
  assert.equal((await fixture({ secret: "" }).run("Bearer undefined")).status, 401);
  assert.equal((await fixture().run("Bearer wrong")).status, 401);
  const f = fixture({ resources: [{ id: "r", title: "R", url: "https://r.example/", consecutive_failures: 0 }] });
  assert.equal((await f.run(null)).status, 401);
  assert.equal(f.requests.length + f.writes.length + f.emails.length, 0);
});
