// A parent removes a family viewer's comment from their own memory; nobody
// else can. Run with: npm test

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { removeFamilyComment, type RemovalClient } from "./family-comment-removal.ts";

type Row = Record<string, unknown>;

function fakeClient(tables: Record<string, Row[]>): RemovalClient {
  return ({
    from(table: string) {
      const rows = () => tables[table] ?? [];
      const build = (mode: "select" | "delete") => {
        const filters: [string, unknown][] = [];
        const run = () => {
          const matched = rows().filter((r) => filters.every(([c, v]) => r[c] === v));
          if (mode === "delete") {
            tables[table] = rows().filter((r) => !matched.includes(r));
            return { data: null, error: null };
          }
          return { data: matched, error: null };
        };
        const q = {
          eq(c: string, v: unknown) { filters.push([c, v]); return q; },
          maybeSingle() { const out = run(); return Promise.resolve({ data: (out.data as Row[] | null)?.[0] ?? null, error: null }); },
          then<T>(res: (v: { data?: unknown; error?: null }) => T) { return Promise.resolve(run()).then(res); },
        };
        return q;
      };
      return { select: () => build("select"), delete: () => build("delete") };
    },
  }) as unknown as RemovalClient;
}

function family() {
  return {
    memories: [
      { id: "mem-1", user_id: "parent-a" },
      { id: "mem-2", user_id: "parent-b" },
    ],
    memory_comments: [
      { id: "c-1", memory_id: "mem-1", body: "So proud of you!" },
      { id: "c-2", memory_id: "mem-2", body: "Lovely" },
    ],
  } as Record<string, Row[]>;
}

test("a parent removes a family comment on their own memory, and the row is gone", async () => {
  const tables = family();
  const out = await removeFamilyComment(fakeClient(tables), { userId: "parent-a", memoryId: "mem-1", commentId: "c-1" });
  assert.equal(out.status, 200);
  assert.deepEqual(tables.memory_comments.map((c) => c.id), ["c-2"]);
});

test("a different signed-in user gets 404 and the row stays", async () => {
  const tables = family();
  const out = await removeFamilyComment(fakeClient(tables), { userId: "parent-b", memoryId: "mem-1", commentId: "c-1" });
  assert.equal(out.status, 404);
  assert.deepEqual(tables.memory_comments.map((c) => c.id), ["c-1", "c-2"]);
});

test("a comment id from another memory, or one that does not exist, is a 404 and deletes nothing", async () => {
  const tables = family();
  // parent-a owns mem-1, but c-2 is on mem-2.
  assert.equal((await removeFamilyComment(fakeClient(tables), { userId: "parent-a", memoryId: "mem-1", commentId: "c-2" })).status, 404);
  assert.equal((await removeFamilyComment(fakeClient(tables), { userId: "parent-a", memoryId: "mem-1", commentId: "nope" })).status, 404);
  assert.equal((await removeFamilyComment(fakeClient(tables), { userId: "parent-a", memoryId: "missing", commentId: "c-1" })).status, 404);
  assert.equal(tables.memory_comments.length, 2);
});

test("the route authenticates the parent and the sheet offers Remove with the plain confirm", () => {
  const route = readFileSync(resolve(import.meta.dirname, "..", "app/api/memories/[id]/comments/[commentId]/route.ts"), "utf8");
  assert.match(route, /export async function DELETE\(/);
  assert.match(route, /supabase\.auth\.getUser\(\)/);
  assert.match(route, /removeFamilyComment\(/);
  const sheet = readFileSync(resolve(import.meta.dirname, "..", "app/dashboard/memories/page.tsx"), "utf8");
  assert.match(sheet, /comment\? They will not be told\./);
  assert.match(sheet, /posthog\.capture\("family_comment_removed"/);
  assert.match(sheet, /method: "DELETE"/);
  assert.ok(!/[—]/.test(sheet.slice(sheet.indexOf("They will not be told") - 200, sheet.indexOf("They will not be told") + 40)));
});
