// Run with: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { gardenButtonLabel, gardenLine } from "./garden-config.ts";

test("a child whose tree already has leaves this year is not a seed", () => {
  assert.equal(gardenLine(1, true, { alreadyGrowing: true, soleChildName: "Zoe" }), "Zoe's tree keeps growing.");
  assert.equal(gardenLine(1, true, { alreadyGrowing: true, soleChildName: "James" }), "James' tree keeps growing.");
  assert.equal(gardenLine(1, true, { alreadyGrowing: true }), "Their tree keeps growing.");
  assert.equal(gardenLine(2, true, { alreadyGrowing: true }), "Their trees keep growing.");
  assert.equal(gardenButtonLabel(2, true, { alreadyGrowing: true }), "See their trees in the Garden");
});

test("a new year's first curriculum still plants seeds", () => {
  assert.equal(gardenLine(1, true, { alreadyGrowing: false, soleChildName: "Zoe" }), "One seed went into the garden today.");
  assert.equal(gardenLine(2, true, { alreadyGrowing: false }), "Two seeds went into the garden today.");
  assert.equal(gardenLine(2, true), "Two seeds went into the garden today.", "no answer yet keeps the old line");
  assert.equal(gardenButtonLabel(1, true, { alreadyGrowing: false }), "See their seed in the Garden");
});

test("the celebration asks the Garden's per-year count rather than counting leaves itself", () => {
  const src = readFileSync(resolve(import.meta.dirname, "..", "curriculum-ready", "page.tsx"), "utf8");
  assert.match(src, /import \{ loadLeafCounts \} from "@\/app\/lib\/garden-leaves"/);
  assert.match(src, /getCurrentSchoolYear\(supabase, userId\)/);
  assert.ok(!/from\("lessons"\)|from\("memories"\)/.test(src), "no leaf query of its own");
  const builder = readFileSync(resolve(import.meta.dirname, "..", "dashboard", "plan", "schedule", "page.tsx"), "utf8");
  assert.match(builder, /childIds: setUpChildren\.map\(\(c\) => c\.id\)/);
  assert.match(builder, /familyUserId: effectiveUserId \?\? null/);
});
