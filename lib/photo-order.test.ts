// Tests for lib/photo-order.ts — chapter photo ordering: explicit page_order
// first, then date, then created_at, stable; null page_order = today's behavior.

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  comparePhotoOrder,
  orderPhotos,
  normalizedPageOrders,
  type OrderablePhoto,
} from "./photo-order.ts";

const ids = (photos: OrderablePhoto[]) => orderPhotos(photos).map((p) => p.id);

test("page_order ascending wins over date", () => {
  const photos: OrderablePhoto[] = [
    { id: "a", page_order: 2, date: "2026-01-01" },
    { id: "b", page_order: 0, date: "2026-12-31" },
    { id: "c", page_order: 1, date: "2026-06-15" },
  ];
  assert.deepEqual(ids(photos), ["b", "c", "a"]);
});

test("all null page_order → date ascending (today's behavior)", () => {
  const photos: OrderablePhoto[] = [
    { id: "a", date: "2026-03-01" },
    { id: "b", date: "2026-01-01" },
    { id: "c", date: "2026-02-01" },
  ];
  assert.deepEqual(ids(photos), ["b", "c", "a"]);
});

test("same date → created_at ascending, then id (stable/deterministic)", () => {
  const photos: OrderablePhoto[] = [
    { id: "z", date: "2026-01-01", created_at: "2026-01-01T10:00:00Z" },
    { id: "a", date: "2026-01-01", created_at: "2026-01-01T09:00:00Z" },
    { id: "m", date: "2026-01-01", created_at: "2026-01-01T09:00:00Z" },
  ];
  // a and m share created_at → id tiebreak puts a before m; z is later
  assert.deepEqual(ids(photos), ["a", "m", "z"]);
});

test("explicitly ordered photos sort ahead of un-ordered ones", () => {
  const photos: OrderablePhoto[] = [
    { id: "new", date: "2026-12-01" }, // null page_order, newest
    { id: "first", page_order: 0, date: "2026-01-01" },
    { id: "second", page_order: 1, date: "2026-02-01" },
  ];
  assert.deepEqual(ids(photos), ["first", "second", "new"]);
});

test("equal page_order falls back to date tiebreak", () => {
  const photos: OrderablePhoto[] = [
    { id: "a", page_order: 0, date: "2026-05-01" },
    { id: "b", page_order: 0, date: "2026-01-01" },
  ];
  assert.deepEqual(ids(photos), ["b", "a"]);
});

test("non-finite / undefined page_order is treated as unset", () => {
  const photos: OrderablePhoto[] = [
    { id: "a", page_order: NaN, date: "2026-02-01" },
    { id: "b", page_order: undefined, date: "2026-01-01" },
    { id: "c", page_order: 0, date: "2026-09-01" },
  ];
  assert.deepEqual(ids(photos), ["c", "b", "a"]);
});

test("orderPhotos is pure (does not mutate input) and total ordering is consistent", () => {
  const input: OrderablePhoto[] = [
    { id: "a", date: "2026-03-01" },
    { id: "b", date: "2026-01-01" },
  ];
  const snapshot = input.map((p) => p.id);
  const out = orderPhotos(input);
  assert.deepEqual(input.map((p) => p.id), snapshot, "input not mutated");
  assert.notEqual(out, input, "returns a new array");
  // comparator is anti-symmetric for these two
  assert.ok(comparePhotoOrder(input[1], input[0]) < 0);
  assert.ok(comparePhotoOrder(input[0], input[1]) > 0);
  assert.equal(comparePhotoOrder(input[0], input[0]), 0);
});

test("normalizedPageOrders assigns 0..n in array order", () => {
  assert.deepEqual(normalizedPageOrders(["x", "y", "z"]), [
    { id: "x", page_order: 0 },
    { id: "y", page_order: 1 },
    { id: "z", page_order: 2 },
  ]);
  assert.deepEqual(normalizedPageOrders([]), []);
});

test("reordering then reading back reflects the new sequence", () => {
  // simulate: chapter photos, user drags 'c' to the front → normalized writes
  const before: OrderablePhoto[] = [
    { id: "a", date: "2026-01-01" },
    { id: "b", date: "2026-02-01" },
    { id: "c", date: "2026-03-01" },
  ];
  const reordered = ["c", "a", "b"];
  const writes = new Map(normalizedPageOrders(reordered).map((w) => [w.id, w.page_order]));
  const after = before.map((p) => ({ ...p, page_order: writes.get(p.id) }));
  assert.deepEqual(ids(after), ["c", "a", "b"]);
});
