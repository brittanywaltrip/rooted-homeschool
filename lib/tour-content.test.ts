import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { TOUR_FEATURES } from "../app/tour/features.ts";
import { GROWTH_STAGES, getGrowthStage } from "../app/lib/garden-stages.ts";

const page = readFileSync(new URL("../app/tour/page.tsx", import.meta.url), "utf8");
const feature = (id: string) => {
  const found = TOUR_FEATURES.find((item) => item.id === id);
  assert.ok(found, `Missing tour feature: ${id}`);
  return found;
};
const copy = (id: string) => JSON.stringify(feature(id));

test("the tour covers the current core features and their navigation", () => {
  assert.deepEqual(TOUR_FEATURES.map((item) => item.id), [
    "memories", "today", "plan", "garden", "printables", "yearbook",
    "reports", "transcripts", "years", "resources",
  ]);
  for (const item of TOUR_FEATURES) {
    assert.ok(item.location && item.headline && item.sub && item.note);
    assert.equal(item.bullets.length, 3);
  }
  assert.match(feature("reports").location, /More.*mobile.*desktop sidebar/);
  assert.equal(feature("yearbook").location, "Memories → Yearbook");
  assert.equal(feature("years").location, "More → Years");
});

test("Garden copy uses the product's shared stages and school-year scope", () => {
  const garden = copy("garden");
  for (const stage of GROWTH_STAGES) assert.ok(garden.includes(stage.name));
  const last = GROWTH_STAGES[GROWTH_STAGES.length - 1];
  assert.ok(feature("garden").note.includes(`${last.name} begins at ${last.min} leaves`));
  assert.match(garden, /school year/);
  assert.match(garden, /Completed lessons, captured memories, and completed activities/);
  assert.match(page, /const stage = getGrowthStage\(leaves\)/);
  assert.equal(getGrowthStage(31).name, "Growing");
});

test("the tour explains the current planning and completion flows", () => {
  assert.match(copy("plan"), /school days, lessons a day, and where you are in the book/);
  assert.match(copy("plan"), /Plan this week/);
  assert.match(copy("plan"), /unfinished manually planned days/);
  assert.match(copy("today"), /confirm the minutes/);
  assert.doesNotMatch(JSON.stringify(TOUR_FEATURES) + page, /Smart Finish Line|goal date|one tap to recalculate|200\+ lessons|Thriving|Sapling/);
});

test("reports and yearbook claims match their separate current surfaces", () => {
  assert.match(copy("reports"), /Hours & Attendance Log/);
  assert.match(copy("reports"), /Reading Log/);
  assert.match(copy("reports"), /separate Download Progress Report option in Plan/);
  assert.match(copy("yearbook"), /photo and field trip captures are included by default/);
  assert.doesNotMatch(copy("yearbook"), /[Bb]ookmark|[Ff]amily.*messages|approve/);
  assert.doesNotMatch(page, /pct:|s\.pct|Annual Progress Report/);
});

test("the tour discloses paid exports and keeps state guidance separate", () => {
  for (const id of ["memories", "printables", "yearbook", "reports", "transcripts"]) {
    assert.match(feature(id).note, /Rooted\+ or an active trial/);
  }
  assert.match(copy("resources"), /separately in By State/);
  assert.doesNotMatch(copy("resources"), /filtered.*state|zero prep|always free/);
  assert.match(copy("transcripts"), /recipient's requirements/);
  assert.doesNotMatch(JSON.stringify(TOUR_FEATURES), /\u2014/);
});

test("previews are disclosed and feature selection stays under reader control", () => {
  assert.match(page, /<figcaption/);
  assert.match(page, /Illustrative preview with fictional details/);
  assert.match(page, /aria-pressed=\{i === active\}/);
  assert.match(page, /aria-controls="tour-feature"/);
  assert.doesNotMatch(page, /id="tour-feature"[^>]*key=/);
  assert.doesNotMatch(page, /setInterval|setTimeout/);
  assert.match(page, /prefers-reduced-motion/);
  assert.doesNotMatch(page, /supabase|fetch\(/);
});


test("the tour keeps Rooted fonts, core color tokens, and the existing logo", () => {
  const layout = readFileSync(new URL("../app/layout.tsx", import.meta.url), "utf8");
  assert.match(layout, /const geistSans = Geist\(/);
  assert.match(layout, /variable: "--font-geist-sans"/);
  assert.match(layout, /const lora = Lora\(/);
  assert.match(layout, /variable: "--font-display"/);
  assert.match(page, /fontFamily: "var\(--font-display\)"/);
  assert.doesNotMatch(page, /fontFamily: "(?!var\(--font-display\))|font-bold|font-semibold/);
  for (const token of ["--g-brand", "--g-accent", "--background", "--foreground", "--color-warm-card", "--color-warm-border", "--color-text-muted"]) {
    assert.ok(page.includes(`var(${token})`), `Missing Rooted token: ${token}`);
  }
  assert.match(page, /src="\/rooted-logo-nav\.png"/);
});
