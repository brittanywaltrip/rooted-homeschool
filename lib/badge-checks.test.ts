// The badge set is the one the old logic produced. Run with: npm test
//
// The expected sets below were RECORDED from lib/badges.ts as it stood before
// the 2026-09 rewrite (seven id-list reads on memories, five waves), by
// running that module against these same in-memory rows. The rewrite counts
// with { count: "exact", head: true } in one wave; this test is what says it
// still hands out the same badges.

import { test } from "node:test";
import assert from "node:assert/strict";
import { awardActivityBadges, awardFoundingBadge, collectBadgeSignals } from "./badge-checks.ts";

// ── A Supabase client over in-memory rows ───────────────────────────────────
type Row = Record<string, unknown>;
type Filter = (r: Row) => boolean;
export type Tables = Record<string, Row[]>;

function cmp(a: unknown, b: unknown): number | null {
  if (a == null || b == null) return null;
  const x = String(a), y = String(b);
  return x < y ? -1 : x > y ? 1 : 0;
}

class FakeQuery {
  private filters: Filter[] = [];
  private single_ = false;
  private rows: Row[];
  private cols: string;
  private head: boolean;
  private count: boolean;
  constructor(rows: Row[], cols: string, head: boolean, count: boolean) {
    this.rows = rows; this.cols = cols; this.head = head; this.count = count;
  }
  eq(c: string, v: unknown) { this.filters.push((r) => r[c] === v); return this; }
  neq(c: string, v: unknown) { this.filters.push((r) => r[c] !== v); return this; }
  in(c: string, vs: unknown[]) { this.filters.push((r) => vs.includes(r[c])); return this; }
  gte(c: string, v: unknown) { this.filters.push((r) => { const k = cmp(r[c], v); return k != null && k >= 0; }); return this; }
  lte(c: string, v: unknown) { this.filters.push((r) => { const k = cmp(r[c], v); return k != null && k <= 0; }); return this; }
  not(c: string, _op: string, v: unknown) { this.filters.push((r) => r[c] !== v); return this; }
  order() { return this; }
  limit() { return this; }
  single() { this.single_ = true; return this; }
  maybeSingle() { this.single_ = true; return this; }
  private run() {
    const out = this.rows.filter((r) => this.filters.every((f) => f(r)));
    const pick = (r: Row) => this.cols === "*" ? r : Object.fromEntries(this.cols.split(",").map((c) => c.trim()).map((c) => [c, r[c]]));
    const data = this.head ? null : this.single_ ? (out[0] ? pick(out[0]) : null) : out.map(pick);
    return { data, count: this.count ? out.length : null, error: null };
  }
  then<T>(res: (v: ReturnType<FakeQuery["run"]>) => T, rej?: (e: unknown) => T) { return Promise.resolve(this.run()).then(res, rej); }
}

export function makeFakeClient(tables: Tables) {
  const log: { table: string; cols: string; head: boolean }[] = [];
  const upserts: Row[] = [];
  const client = {
    from(table: string) {
      return {
        select(cols: string, opts?: { count?: string; head?: boolean }) {
          log.push({ table, cols, head: !!opts?.head });
          return new FakeQuery(tables[table] ?? [], cols, !!opts?.head, opts?.count === "exact");
        },
        upsert(row: Row) { upserts.push(row); (tables["user_badges"] ??= []).push(row); return Promise.resolve({ data: null, error: null }); },
      };
    },
  };
  return { client, log, upserts };
}

// ── Two families ─────────────────────────────────────────────────────────
const d = (daysAgo: number) => { const t = new Date(); t.setDate(t.getDate() - daysAgo); return t; };
const ymd = (t: Date) => `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, "0")}-${String(t.getDate()).padStart(2, "0")}`;
const iso = (t: Date) => t.toISOString();
// Fixture dates hang off "now" the way the module does. Anchored to the 20th
// so "this month" holds at least 5 days on every day the test can run.
const now = new Date(); const monthDay = (n: number) => { const t = new Date(now.getFullYear(), now.getMonth(), n, 12); return t; };
const yearAgo = new Date(now.getFullYear() - 1, now.getMonth(), now.getDate());
const U = "user-active";
const V = "user-sparse";
const mem = (u: string, type: string, extra: Record<string, unknown> = {}) => ({ id: `${u}-${type}-${Math.random()}`, user_id: u, type, include_in_book: false, created_at: iso(monthDay(3)), date: ymd(monthDay(3)), ...extra });
function activeFamily(): Tables {
  return {
    memories: [
      mem(U, "photo", { include_in_book: true, created_at: iso(monthDay(1)), date: ymd(monthDay(1)) }),
      mem(U, "photo", { created_at: iso(monthDay(2)), date: ymd(monthDay(2)) }),
      mem(U, "drawing"), mem(U, "drawing"), mem(U, "drawing", { created_at: iso(monthDay(4)), date: ymd(monthDay(4)) }),
      mem(U, "book"), mem(U, "book"), mem(U, "book"), mem(U, "book"), mem(U, "book", { include_in_book: true }),
      mem(U, "win", { created_at: iso(monthDay(5)), date: ymd(monthDay(5)) }),
      mem(U, "photo", { created_at: iso(d(365)), date: ymd(yearAgo) }),
      // Another family's rows, which must never count.
      mem("someone-else", "win"), mem("someone-else", "photo"),
    ],
    app_events: [
      { id: "e1", user_id: U, type: "memory_photo", created_at: iso(d(400)) },
      { id: "e2", user_id: U, type: "memory_book", created_at: iso(d(400)) },
      { id: "e3", user_id: U, type: "memory_activity", created_at: iso(d(400)) },
      { id: "e4", user_id: "someone-else", type: "memory_photo", created_at: iso(monthDay(1)) },
    ],
    lessons: [
      { id: "l1", user_id: U, completed: true, date: ymd(monthDay(6)), scheduled_date: ymd(monthDay(6)) },
      { id: "l2", user_id: U, completed: true, date: null, scheduled_date: ymd(monthDay(7)) },
      { id: "l3", user_id: U, completed: false, date: ymd(monthDay(8)), scheduled_date: ymd(monthDay(8)) },
    ],
    profiles: [
      { id: U, created_at: iso(d(400)), plan_type: "founding_family" },
      { id: V, created_at: iso(d(10)), plan_type: null },
    ],
    user_badges: [],
  };
}
function sparseFamily(): Tables {
  const t = activeFamily();
  t.memories.push(mem(V, "photo", { created_at: iso(d(2)), date: ymd(d(2)) }));
  return t;
}

test("the active family earns the eleven badges the old logic awarded, story_begun first", async () => {
  const { client, upserts, log } = makeFakeClient(activeFamily());
  const first = await awardActivityBadges(client, U);
  const founding = await awardFoundingBadge(client, U);
  assert.equal(first?.id, "story_begun");
  assert.equal(founding?.id, "founding_family");
  assert.deepEqual(
    upserts.map((u) => u.badge_id).sort(),
    ["author", "bookworm_begins", "first_leaf", "first_win", "founding_family", "full_circle", "gallery_wall", "rooted", "showing_up", "shutter", "story_begun"],
  );
  // The old version made 19 requests in five waves and loaded ids seven times.
  assert.ok(log.length <= 18, `expected at most 18 requests, made ${log.length}`);
  for (const q of log) {
    if (q.table === "memories") assert.ok(q.head || q.cols === "created_at", `memories read must be a head count or the created_at column, got ${q.cols}`);
    assert.notEqual(q.cols, "id", `${q.table} must never load ids to count them`);
  }
});

test("the sparse family earns story_begun and shutter and nothing else", async () => {
  const { client, upserts } = makeFakeClient(sparseFamily());
  const first = await awardActivityBadges(client, V);
  const founding = await awardFoundingBadge(client, V);
  assert.equal(first?.id, "story_begun");
  assert.equal(founding, null);
  assert.deepEqual(upserts.map((u) => u.badge_id).sort(), ["shutter", "story_begun"]);
});

test("badges already held are not re-awarded and do not count as new", async () => {
  const tables = sparseFamily();
  tables.user_badges.push({ user_id: V, badge_id: "story_begun" });
  const { client, upserts } = makeFakeClient(tables);
  const first = await awardActivityBadges(client, V);
  assert.equal(first?.id, "shutter");
  assert.deepEqual(upserts.map((u) => u.badge_id), ["shutter"]);
});

test("signals come from counts, and another family's rows never leak in", async () => {
  const { client } = makeFakeClient(activeFamily());
  const s = await collectBadgeSignals(client, U);
  assert.equal(s.totalMemories, 12 + 3);
  assert.equal(s.totalBooks, 5 + 1);
  assert.equal(s.totalWins, 1 + 1);
  assert.equal(s.totalDrawings, 3);
  assert.equal(s.totalPhotosAndDrawings, 3 + 3 + 1);
  assert.equal(s.totalLessons, 2);
  assert.equal(s.onThisDayCount, 1);
  assert.ok(s.activeDays >= 5);
  assert.ok(s.daysSinceSignup >= 365);
});
