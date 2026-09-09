// The family portal write guards, and proof that both routes are wired to them.
//
// TWO GROUPS, AND WHY.
//
// The decisions are unit-tested for real, against an in-memory stand-in for
// supabaseAdmin. That covers every case the brief asked for: a memory from
// another family, a memory that is not family-visible, the 21st comment and the
// 61st reaction inside ten minutes, and an over-long name.
//
// What cannot be tested that way is the routes themselves. `node --test` cannot
// load app/api/family/[token]/*/route.ts: they import `next/server`, whose
// conditional exports Node's resolver does not pick up, and they use the `@/`
// alias, which has no Node import map behind it. Probed both on 2026-09-09.
// So a second group reads the two route files as source and checks the wiring
// the unit tests cannot reach: that the ownership check happens BEFORE any
// write, and that each outcome carries the status the brief specified. That is
// the same approach as lib/memory-insert-guard.test.ts.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  assertMemoryBelongsToInvite,
  tooManyFamilyActions,
  tooManyNotificationsForMemory,
  viewerNameTooLong,
  MAX_VIEWER_NAME_LENGTH,
  type FamilyPortalClient,
  type FamilyPortalQuery,
  type QueryOutcome,
} from "./family-portal-guard.ts";

const OWNER = "11111111-1111-4111-8111-111111111111";
const OTHER_OWNER = "22222222-2222-4222-8222-222222222222";
const MEMORY = "33333333-3333-4333-8333-333333333333";
const TOKEN = "44444444-4444-4444-8444-444444444444";
const OTHER_TOKEN = "55555555-5555-4555-8555-555555555555";

type Row = Record<string, unknown>;

/**
 * In-memory stand-in for supabaseAdmin, covering only what the guards call:
 * select + eq + gt, either as maybeSingle() or as a head count.
 *
 * Typed as FamilyPortalClient with no cast, so if the real shape the guards
 * rely on ever changes, this stops compiling rather than quietly diverging.
 */
function makeClient(
  tables: Record<string, Row[]>,
  opts: { errorOn?: string } = {},
): FamilyPortalClient {
  return {
    from(table: string) {
      return {
        select(_columns: string, options?: { count?: "exact"; head?: boolean }) {
          const filters: { op: "eq" | "gt"; column: string; value: unknown }[] = [];

          const matching = () =>
            (tables[table] ?? []).filter((row) =>
              filters.every((f) =>
                f.op === "eq"
                  ? row[f.column] === f.value
                  : String(row[f.column]) > String(f.value),
              ),
            );

          const outcome = (): QueryOutcome => {
            if (opts.errorOn === table) {
              return { data: null, count: null, error: { message: "boom" } };
            }
            const rows = matching();
            return options?.head
              ? { data: null, count: rows.length, error: null }
              : { data: rows, count: rows.length, error: null };
          };

          // `then` is spelled out in full rather than as a one-argument
          // shorthand: PromiseLike declares both handlers optional and
          // nullable, and a narrower signature here does not satisfy it.
          const query: FamilyPortalQuery = {
            eq(column: string, value: unknown) {
              filters.push({ op: "eq", column, value });
              return query;
            },
            gt(column: string, value: unknown) {
              filters.push({ op: "gt", column, value });
              return query;
            },
            maybeSingle(): Promise<QueryOutcome> {
              if (opts.errorOn === table) {
                return Promise.resolve({ data: null, error: { message: "boom" } });
              }
              return Promise.resolve({ data: matching()[0] ?? null, error: null });
            },
            then<TResult1 = QueryOutcome, TResult2 = never>(
              onfulfilled?:
                | ((value: QueryOutcome) => TResult1 | PromiseLike<TResult1>)
                | null,
              onrejected?:
                | ((reason: unknown) => TResult2 | PromiseLike<TResult2>)
                | null,
            ): PromiseLike<TResult1 | TResult2> {
              return Promise.resolve(outcome()).then(onfulfilled, onrejected);
            },
          };
          return query;
        },
      };
    },
  };
}

/** `count` rows in `table`, all stamped inside the last ten minutes. */
function recentRows(count: number, extra: Row): Row[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `row-${i}`,
    created_at: new Date(Date.now() - i * 1000).toISOString(),
    ...extra,
  }));
}

const visibleMemory = {
  id: MEMORY,
  user_id: OWNER,
  family_visible: true,
};

// ── Ownership ──────────────────────────────────────────────────────────────

test("a memory belonging to this family passes", async () => {
  const client = makeClient({ memories: [visibleMemory] });
  const row = await assertMemoryBelongsToInvite(client, MEMORY, OWNER);
  assert.deepEqual(row, visibleMemory);
});

test("a memory belonging to ANOTHER family is refused", async () => {
  // The hole this closes. The token was valid; the memory was not theirs.
  const client = makeClient({
    memories: [{ id: MEMORY, user_id: OTHER_OWNER, family_visible: true }],
  });
  assert.equal(await assertMemoryBelongsToInvite(client, MEMORY, OWNER), null);
});

test("a memory this family has hidden from the portal is refused", async () => {
  const client = makeClient({
    memories: [{ id: MEMORY, user_id: OWNER, family_visible: false }],
  });
  assert.equal(await assertMemoryBelongsToInvite(client, MEMORY, OWNER), null);
});

test("family_visible NULL is refused, matching the feed and not the dashboard", async () => {
  // lib/family-feed.ts selects .eq("family_visible", true), so a NULL row is
  // not on screen for the viewer. Mom's own Memories page reads `!== false`,
  // which is a different question and deliberately not the one asked here.
  const client = makeClient({
    memories: [{ id: MEMORY, user_id: OWNER, family_visible: null }],
  });
  assert.equal(await assertMemoryBelongsToInvite(client, MEMORY, OWNER), null);
});

test("a memory id that does not exist is refused", async () => {
  const client = makeClient({ memories: [] });
  assert.equal(await assertMemoryBelongsToInvite(client, MEMORY, OWNER), null);
});

test("ownership fails CLOSED when the query errors", async () => {
  const client = makeClient({ memories: [visibleMemory] }, { errorOn: "memories" });
  assert.equal(await assertMemoryBelongsToInvite(client, MEMORY, OWNER), null);
});

// ── Volume ─────────────────────────────────────────────────────────────────

test("the 21st comment in ten minutes on one token is refused", async () => {
  const twenty = recentRows(20, { family_token: TOKEN });
  const client = makeClient({ memory_comments: twenty });
  assert.equal(
    await tooManyFamilyActions(client, TOKEN, "memory_comments", 10, 20),
    true,
  );
  // The 20th was fine.
  const nineteen = makeClient({ memory_comments: recentRows(19, { family_token: TOKEN }) });
  assert.equal(
    await tooManyFamilyActions(nineteen, TOKEN, "memory_comments", 10, 20),
    false,
  );
});

test("the 61st reaction in ten minutes on one token is refused", async () => {
  const client = makeClient({ memory_reactions: recentRows(60, { family_token: TOKEN }) });
  assert.equal(
    await tooManyFamilyActions(client, TOKEN, "memory_reactions", 10, 60),
    true,
  );
  const fiftyNine = makeClient({
    memory_reactions: recentRows(59, { family_token: TOKEN }),
  });
  assert.equal(
    await tooManyFamilyActions(fiftyNine, TOKEN, "memory_reactions", 10, 60),
    false,
  );
});

test("another viewer's link is not slowed down by this one", async () => {
  const client = makeClient({ memory_comments: recentRows(50, { family_token: OTHER_TOKEN }) });
  assert.equal(
    await tooManyFamilyActions(client, TOKEN, "memory_comments", 10, 20),
    false,
  );
});

test("rows older than the window do not count", async () => {
  const old = Array.from({ length: 50 }, (_, i) => ({
    id: `old-${i}`,
    family_token: TOKEN,
    created_at: new Date(Date.now() - 60 * 60_000).toISOString(),
  }));
  const client = makeClient({ memory_comments: old });
  assert.equal(
    await tooManyFamilyActions(client, TOKEN, "memory_comments", 10, 20),
    false,
  );
});

test("the volume limiter fails OPEN when the query errors", async () => {
  // Opposite direction from the ownership check on purpose. This one protects
  // an inbox; a database hiccup must not take the family portal down for every
  // grandparent at once.
  const client = makeClient(
    { memory_comments: recentRows(500, { family_token: TOKEN }) },
    { errorOn: "memory_comments" },
  );
  assert.equal(
    await tooManyFamilyActions(client, TOKEN, "memory_comments", 10, 20),
    false,
  );
});

test("a tap loop on one memory is caught by the notification count", async () => {
  // The reaction row is DELETED on every off-tap, so memory_reactions never
  // holds more than one row for that viewer and the row-count limiter above
  // sees nothing. Notification rows are never deleted.
  const rows = recentRows(20, { memory_id: MEMORY, type: "reaction" });
  const client = makeClient({
    memory_reactions: [{ id: "just-one", family_token: TOKEN, created_at: new Date().toISOString() }],
    family_notifications: rows,
  });
  assert.equal(
    await tooManyFamilyActions(client, TOKEN, "memory_reactions", 10, 60),
    false,
    "the row-count limiter cannot see a tap loop, which is why the next one exists",
  );
  assert.equal(
    await tooManyNotificationsForMemory(client, MEMORY, "reaction", 10, 20),
    true,
  );
});

test("notifications on other memories, and of the other type, do not count", async () => {
  const client = makeClient({
    family_notifications: [
      ...recentRows(30, { memory_id: "some-other-memory", type: "reaction" }),
      ...recentRows(30, { memory_id: MEMORY, type: "comment" }),
    ],
  });
  assert.equal(
    await tooManyNotificationsForMemory(client, MEMORY, "reaction", 10, 20),
    false,
  );
});

// ── Names ──────────────────────────────────────────────────────────────────

test("a name over 60 characters is refused, at or under is fine", () => {
  assert.equal(MAX_VIEWER_NAME_LENGTH, 60);
  assert.equal(viewerNameTooLong("Grandma Jo"), false);
  assert.equal(viewerNameTooLong("x".repeat(60)), false);
  assert.equal(viewerNameTooLong("x".repeat(61)), true);
  // Trimmed first, so padding cannot be used to smuggle length past the check
  // and cannot trip it either.
  assert.equal(viewerNameTooLong(`   ${"x".repeat(58)}   `), false);
  assert.equal(viewerNameTooLong(undefined), false);
});

// ── The routes are wired to all of it ──────────────────────────────────────

const ROOT = join(import.meta.dirname, "..");
const ROUTES = [
  { rel: "app/api/family/[token]/comment/route.ts", table: "memory_comments", max: "10, 20" },
  { rel: "app/api/family/[token]/react/route.ts", table: "memory_reactions", max: "10, 60" },
];

function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " ");
}

for (const route of ROUTES) {
  const label = route.rel.includes("comment") ? "comment" : "react";

  test(`${label} route refuses an unowned memory with 404 before it writes`, () => {
    const src = stripComments(readFileSync(join(ROOT, route.rel), "utf8"));

    const check = src.indexOf("assertMemoryBelongsToInvite(");
    assert.ok(check > 0, "the ownership check is missing");

    // The 404 has to be the thing that happens when the check comes back null.
    assert.match(
      src.slice(check, check + 400),
      /if \(!memoryRow\) \{\s*return NextResponse\.json\(\{ error: "not_found" \}, \{ status: 404 \}\);/,
    );

    // And every write has to be downstream of it. This is the assertion that
    // stands in for "inserts nothing": if a future edit moves an insert above
    // the guard, or adds a new one, this goes red.
    const writes = [...src.matchAll(/\.(insert|upsert|delete)\(/g)];
    assert.ok(writes.length > 0, "expected this route to write something");
    for (const write of writes) {
      assert.ok(
        write.index > check,
        `a .${write[1]}() runs before the ownership check in ${route.rel}`,
      );
    }
  });

  test(`${label} route answers 429 over the limit, before it writes`, () => {
    const src = stripComments(readFileSync(join(ROOT, route.rel), "utf8"));

    const limiter = src.indexOf("tooManyFamilyActions(");
    assert.ok(limiter > 0, "the volume limiter is missing");
    assert.match(
      src.slice(limiter, limiter + 320),
      new RegExp(`tooManyFamilyActions\\(guard, token, "${route.table}", ${route.max}\\)`),
    );
    // Both limiters, and the second is what catches a tap loop.
    assert.match(src.slice(limiter, limiter + 320), /tooManyNotificationsForMemory\(guard, memory_id,/);
    assert.match(
      src.slice(limiter, limiter + 460),
      /return NextResponse\.json\(\{ error: "slow_down" \}, \{ status: 429 \}\);/,
    );

    const firstStore = src.search(/\.(insert|upsert)\(/);
    assert.ok(limiter < firstStore, "the limiter must run before anything is stored");
  });

  test(`${label} route rejects an over-long name with 400`, () => {
    const src = stripComments(readFileSync(join(ROOT, route.rel), "utf8"));
    const guard = src.indexOf("viewerNameTooLong(");
    assert.ok(guard > 0, "the name-length check is missing");
    assert.match(src.slice(guard, guard + 220), /status: 400/);
  });
}

test("the react route checks ownership before the toggle-off delete", () => {
  // A viewer must not be able to delete a reaction on a memory that is not
  // their family's either, so the guard sits above the toggle branch.
  const src = stripComments(
    readFileSync(join(ROOT, "app/api/family/[token]/react/route.ts"), "utf8"),
  );
  assert.ok(
    src.indexOf("assertMemoryBelongsToInvite(") < src.indexOf('.eq("reactor_key", reactor_key)'),
  );
});
