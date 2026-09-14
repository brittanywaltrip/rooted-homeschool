// Run with: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { keepsakeOwners, yearClosedMessage } from "./year-closed.ts";

const repo = (f: string) => readFileSync(resolve(import.meta.dirname, "..", "..", f), "utf8");

test("whose trees are saved: one, two, three children", () => {
  assert.equal(keepsakeOwners(["Zoe"]), "Zoe's tree, badges, and book are");
  assert.equal(keepsakeOwners(["Zoe", "Emma"]), "Zoe's and Emma's trees, badges, and book are");
  assert.equal(keepsakeOwners(["Zoe", "Emma", "Liam"]), "Zoe's, Emma's, and Liam's trees, badges, and book are");
  assert.equal(keepsakeOwners(["Chris"]), "Chris' tree, badges, and book are");
  assert.equal(keepsakeOwners([" ", ""]), "Your family's trees, badges, and book are");
});

test("the message is the founder's copy, with the year name as the family typed it", () => {
  assert.equal(
    yearClosedMessage({ closingYearName: "2025-2026", childNames: ["Zoe", "Emma"] }),
    "Whether you logged every lesson, made it to the last page, or just barely got here: you're here. " +
      "2025-2026 is saved. Zoe's and Emma's trees, badges, and book are on your Years page whenever you want them.",
  );
});

test("closing a year lands on the moment, and both next-year buttons go to the page that pre-fills", () => {
  const close = repo("app/dashboard/close-year/page.tsx");
  assert.match(close, /writeYearClosed\(\{/);
  assert.match(close, /\/year-closed\?year=/);
  // Names come from the close response.
  assert.match(close, /closingYearName: json\.yearName/);
  assert.match(close, /newYearName: json\.newYearName/);

  assert.ok(existsSync(resolve(import.meta.dirname, "..", "year-closed", "page.tsx")), "full-bleed route outside app/dashboard");
  const screen = repo("app/year-closed/page.tsx");
  assert.match(screen, /import RootedCelebration from "@\/app\/components\/RootedCelebration"/);
  assert.match(screen, /heading="You finished a year\."/);
  assert.match(screen, /Fresh soil, fresh seeds\. Ready for next year\?/);
  assert.match(screen, /\/dashboard\/plan\/new-year\?from=/);
  assert.match(screen, /year_closed_celebrated/);
  assert.match(screen, /year_closed_next_step/);

  const report = repo("app/dashboard/year-end/[schoolYearId]/page.tsx");
  assert.match(report, /\/dashboard\/plan\/new-year\?from=/, "the report's Set Up Next Year goes where its copy promises");
  assert.ok(!/href="\/dashboard\/plan"\s/.test(report), "not to the Plan page, which copies nothing");
});

test("no em dashes in the new copy", () => {
  for (const f of ["app/year-closed/page.tsx", "app/lib/year-closed.ts", "app/dashboard/years/page.tsx"]) {
    assert.ok(!repo(f).includes("\u2014"), `${f} has an em dash`);
  }
});
