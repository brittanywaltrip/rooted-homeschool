// Tests for lib/yearbook-theme.ts — token resolution, default fallback, and a
// regression guard pinning the garden default to today's production values.

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  THEMES,
  DEFAULT_THEME_NAME,
  resolveTheme,
  resolveThemeName,
  themeCssVars,
} from "./yearbook-theme.ts";

test("resolveThemeName: known names pass through, everything else → garden", () => {
  assert.equal(resolveThemeName("garden"), "garden");
  assert.equal(resolveThemeName("heirloom"), "heirloom");
  assert.equal(resolveThemeName("gallery"), "gallery");
  assert.equal(resolveThemeName(undefined), "garden");
  assert.equal(resolveThemeName(null), "garden");
  assert.equal(resolveThemeName(""), "garden");
  assert.equal(resolveThemeName("Garden"), "garden"); // case-sensitive → fallback
  assert.equal(resolveThemeName("bogus"), "garden");
  assert.equal(DEFAULT_THEME_NAME, "garden");
});

test("resolveTheme: returns the full token set, default garden when unset", () => {
  assert.equal(resolveTheme("heirloom").name, "heirloom");
  assert.equal(resolveTheme("gallery").name, "gallery");
  assert.equal(resolveTheme(undefined).name, "garden");
  assert.equal(resolveTheme("nope").name, "garden");
});

test("REGRESSION: garden tokens are pinned to today's production values", () => {
  const g = THEMES.garden;
  assert.equal(g.bg, "#FAFAF7");
  assert.equal(g.heading, "#2d2926");
  assert.equal(g.body, "#2d2926");
  assert.equal(g.muted, "#7a6f65");
  assert.equal(g.accent, "#5c7f63");
  assert.equal(g.headingFont, "var(--font-display)");
  assert.equal(g.coverBg, "#2d5a3d");
  assert.equal(g.coverFg, "#fefcf9");
  assert.equal(g.motif, "sprig");
});

test("each theme defines every token (no undefined leaks into CSS vars)", () => {
  for (const name of ["garden", "heirloom", "gallery"] as const) {
    const vars = themeCssVars(THEMES[name]);
    for (const [k, v] of Object.entries(vars)) {
      assert.ok(typeof v === "string" && v.length > 0, `${name} ${k} is set`);
    }
  }
});

test("themeCssVars: maps tokens to the --yb-* custom properties", () => {
  const vars = themeCssVars(THEMES.garden);
  assert.equal(vars["--yb-bg"], "#FAFAF7");
  assert.equal(vars["--yb-heading-font"], "var(--font-display)");
  assert.equal(vars["--yb-cover-bg"], "#2d5a3d");
  assert.equal(themeCssVars(THEMES.gallery)["--yb-heading-font"], "var(--font-geist-sans)");
  assert.equal(themeCssVars(THEMES.heirloom)["--yb-accent"], "#b08d57");
});
