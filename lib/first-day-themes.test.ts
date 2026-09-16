// Tests for lib/first-day-themes.ts: the fall frames carry no fields, so the
// editor shows no inputs and the export draws no text; the theme a link or a
// stored pick opens on; and the export file name.

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  FIRST_DAY_THEMES,
  FIRST_DAY_THEME_ORDER,
  DEFAULT_FIRST_DAY_THEME,
  DEFAULT_BRANDING_Y_PCT,
  brandingYPct,
  frameExportFilename,
  frameTextRuns,
  initialFirstDayThemeId,
} from "./first-day-themes.ts";

const ALL_VALUES = {
  name: "Emma", grade: "2nd Grade", year: "2026-2027", age: "7", subject: "Art", goal: "Read more",
};

test("every picker theme exists and its id matches its key", () => {
  for (const id of FIRST_DAY_THEME_ORDER) {
    assert.ok(FIRST_DAY_THEMES[id], id);
    assert.equal(FIRST_DAY_THEMES[id].id, id);
  }
  assert.equal(Object.keys(FIRST_DAY_THEMES).length, FIRST_DAY_THEME_ORDER.length);
});

test("a theme with fields: [] draws no text, whatever was typed", () => {
  for (const id of ["fall", "fallCamp"]) {
    assert.deepEqual(FIRST_DAY_THEMES[id].fields, []);
    assert.deepEqual(frameTextRuns(FIRST_DAY_THEMES[id], ALL_VALUES), []);
  }
});

test("eucalyptus draws each typed value and skips blank ones", () => {
  const runs = frameTextRuns(FIRST_DAY_THEMES.eucalyptus, { ...ALL_VALUES, age: "  " });
  assert.deepEqual(runs.map((r) => r.field.key), ["name", "grade", "year", "subject", "goal"]);
  assert.equal(runs[0].text, "Emma");
});

test("eucalyptus geometry is unchanged", () => {
  const t = FIRST_DAY_THEMES.eucalyptus;
  assert.deepEqual(t.arch, { xPct: 0.12, yPct: 0.15, wPct: 0.76, hPct: 0.58 });
  assert.equal(t.naturalWidth, 1024);
  assert.equal(t.naturalHeight, 1536);
  assert.equal(brandingYPct(t), DEFAULT_BRANDING_Y_PCT);
  assert.equal(DEFAULT_BRANDING_Y_PCT, 0.972);
});

test("the fall branding line sits on the wood, below the photo box", () => {
  for (const id of ["fall", "fallCamp"]) {
    const t = FIRST_DAY_THEMES[id];
    const y = brandingYPct(t) * t.naturalHeight;
    const photoBottom = (t.arch.yPct + t.arch.hPct) * t.naturalHeight;
    // Text cap height is about 0.7 of the 2% font; the whole line clears the photo box.
    const top = y - 0.02 * t.naturalWidth;
    assert.ok(top > photoBottom, `${id}: top ${top} vs photo bottom ${photoBottom}`);
    // Measured opaque band under the opening (see the theme comments).
    const bandEnd = id === "fall" ? 1058 : 1077;
    assert.ok(y + 6 <= bandEnd, `${id}: descenders stay on the wood`);
  }
});

test("the fall photo boxes cover the measured openings", () => {
  const openings: Record<string, [number, number, number, number]> = {
    fall: [222, 1156, 302, 980],
    fallCamp: [249, 1156, 305, 949],
  };
  for (const [id, [x0, x1, y0, y1]] of Object.entries(openings)) {
    const t = FIRST_DAY_THEMES[id];
    const W = t.naturalWidth, H = t.naturalHeight;
    assert.ok(t.arch.xPct * W <= x0, `${id} left`);
    assert.ok((t.arch.xPct + t.arch.wPct) * W >= x1, `${id} right`);
    assert.ok(t.arch.yPct * H <= y0, `${id} top`);
    assert.ok((t.arch.yPct + t.arch.hPct) * H >= y1, `${id} bottom`);
  }
});

test("a frame with no name field leaves a hidden (autofilled) name out of the file name", () => {
  assert.equal(frameExportFilename("Emma", FIRST_DAY_THEMES.fall), "fall.png");
  assert.equal(frameExportFilename("Emma", FIRST_DAY_THEMES.fallCamp), "fallCamp.png");
});

test("?theme= preselects a known theme and falls back for an unknown one", () => {
  assert.equal(initialFirstDayThemeId("fall", null), "fall");
  assert.equal(initialFirstDayThemeId("fallCamp", "eucalyptus"), "fallCamp");
  assert.equal(initialFirstDayThemeId("nope", "fall"), DEFAULT_FIRST_DAY_THEME);
  assert.equal(initialFirstDayThemeId("toString", null), DEFAULT_FIRST_DAY_THEME);
  assert.equal(initialFirstDayThemeId("__proto__", null), DEFAULT_FIRST_DAY_THEME);
});

test("with no query value the stored pick is used, if it is still a theme", () => {
  assert.equal(initialFirstDayThemeId(null, "fallCamp"), "fallCamp");
  assert.equal(initialFirstDayThemeId("", "fall"), "fall");
  assert.equal(initialFirstDayThemeId(null, "retired"), DEFAULT_FIRST_DAY_THEME);
  assert.equal(initialFirstDayThemeId(undefined, null), DEFAULT_FIRST_DAY_THEME);
});

test("export file name uses the theme", () => {
  assert.equal(frameExportFilename("", FIRST_DAY_THEMES.fall), "fall.png");
  assert.equal(frameExportFilename("   ", FIRST_DAY_THEMES.fallCamp), "fallCamp.png");
  assert.equal(frameExportFilename("Mary Kate!", FIRST_DAY_THEMES.eucalyptus), "mary-kate-first-day.png");
  assert.equal(frameExportFilename("Emma", FIRST_DAY_THEMES.eucalyptus), "emma-first-day.png");
  assert.equal(frameExportFilename("", FIRST_DAY_THEMES.eucalyptus), "first-day.png");
});
