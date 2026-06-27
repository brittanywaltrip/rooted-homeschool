// Tests for lib/focal-point.ts — focal-point application and the null-default
// fallback that keeps existing crops unchanged when no focal point is set.

import { test } from "node:test";
import assert from "node:assert/strict";

import { focalObjectPosition, isValidFocal, clampFocal } from "./focal-point.ts";

const LANDSCAPE = 1.5; // 3:2
const PORTRAIT = 2 / 3; // 0.667
const SQUARE = 1;

test("focalObjectPosition: a set focal point maps straight to object-position %", () => {
  assert.equal(focalObjectPosition(0.5, 0.35, LANDSCAPE), "50% 35%");
  assert.equal(focalObjectPosition(0, 0, PORTRAIT), "0% 0%");
  assert.equal(focalObjectPosition(1, 1, LANDSCAPE), "100% 100%");
  assert.equal(focalObjectPosition(0.25, 0.75, SQUARE), "25% 75%");
});

test("focalObjectPosition: a set focal point overrides the orientation heuristic", () => {
  // a portrait would default to "center 35%" — an explicit focal wins
  assert.equal(focalObjectPosition(0.7, 0.2, PORTRAIT), "70% 20%");
});

test("focalObjectPosition: null/undefined falls back to the orientation default", () => {
  // portraits bias toward the top (faces); everything else centers
  assert.equal(focalObjectPosition(null, null, PORTRAIT), "center 35%");
  assert.equal(focalObjectPosition(undefined, undefined, PORTRAIT), "center 35%");
  assert.equal(focalObjectPosition(null, null, LANDSCAPE), "center");
  assert.equal(focalObjectPosition(null, null, SQUARE), "center");
  // a single missing coordinate is not a valid focal point → default
  assert.equal(focalObjectPosition(0.5, null, PORTRAIT), "center 35%");
  assert.equal(focalObjectPosition(null, 0.5, LANDSCAPE), "center");
});

test("focalObjectPosition: out-of-range / non-finite values fall back to the default", () => {
  assert.equal(focalObjectPosition(1.5, 0.5, LANDSCAPE), "center");
  assert.equal(focalObjectPosition(-0.2, 0.5, PORTRAIT), "center 35%");
  assert.equal(focalObjectPosition(0.5, 2, LANDSCAPE), "center");
  assert.equal(focalObjectPosition(NaN, 0.5, PORTRAIT), "center 35%");
  assert.equal(focalObjectPosition(0.5, Infinity, LANDSCAPE), "center");
});

test("focalObjectPosition: rounds to at most 2 decimals (no float noise)", () => {
  assert.equal(focalObjectPosition(1 / 3, 2 / 3, LANDSCAPE), "33.33% 66.67%");
});

test("isValidFocal: accepts in-range pairs, rejects partial / out-of-range / non-finite", () => {
  assert.equal(isValidFocal(0, 0), true);
  assert.equal(isValidFocal(1, 1), true);
  assert.equal(isValidFocal(0.5, 0.5), true);
  assert.equal(isValidFocal(0.5, null), false);
  assert.equal(isValidFocal(null, null), false);
  assert.equal(isValidFocal(1.01, 0.5), false);
  assert.equal(isValidFocal(0.5, -0.01), false);
  assert.equal(isValidFocal(NaN, 0.5), false);
});

test("clampFocal: clamps into 0..1 and defaults non-finite to center", () => {
  assert.equal(clampFocal(-0.3), 0);
  assert.equal(clampFocal(1.4), 1);
  assert.equal(clampFocal(0.42), 0.42);
  assert.equal(clampFocal(NaN), 0.5);
});
