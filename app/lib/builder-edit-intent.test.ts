import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";
import { resolveBuilderEdits } from "./builder-edit-intent.ts";
import { changedSettings, scheduleSnapshot } from "./builder-settings-restore.ts";
import { clampStartAtLesson, computeNextLessonsForGoal, hasScheduleFieldsChanged } from "./scheduler.ts";

// Execute the actual page's row adapters and pre-write refresh, with a local
// synthetic reader. No React app, session, network or database is involved.
const source = readFileSync(new URL("../dashboard/plan/schedule/page.tsx", import.meta.url), "utf8");
const ast = ts.createSourceFile("page.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const names = ["rowFromCurriculumGoal", "curriculumEditableValues", "compactCurriculumPerDay", "startAtLessonTouched", "scheduleFieldsChangedForRow", "carryDbFieldsOntoDraftRow", "settledCurriculumRow"];
const found = new Map<string, string>();
function visit(n: ts.Node) {
  if (ts.isFunctionDeclaration(n) && n.name && names.includes(n.name.text)) found.set(n.name.text, n.getText(ast));
  ts.forEachChild(n, visit);
}
visit(ast);
const refreshStart = source.indexOf("    const freshGoals = new Map");
const refreshEnd = source.indexOf("    const newCurriculumRows = rows.filter", refreshStart);
const refresh = source.slice(refreshStart, refreshEnd);
const js = ts.transpileModule([...found.values()].join("\n") + `
async function refreshRows(rows: Row[], goals: unknown[]) {
  let saveError = null;
  const effectiveUserId = "u";
  const dupReleaseAndExit = (message) => { saveError = message; };
  const supabase = { from: () => { let id; const q = {
    select: () => q, eq: (key, value) => { if (key === "id") id = value; return q; },
    single: async () => ({data: goals.find(g => g.id === id), error: null}),
  }; return q; } };
  async function run() { ${refresh} return { rows, freshGoals, editPatches }; }
  const result = await run();
  return { ...result, saveError };
}
return { ${names.join(",")}, refreshRows };
`, {compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS }}).outputText;
const page = new Function("scheduleSnapshot", "clampStartAtLesson", "hasScheduleFieldsChanged", "resolveBuilderEdits", "capitalizeName", "normalizeStartTime", "newLocalId", "DAY_LABEL", js)(
  scheduleSnapshot, clampStartAtLesson, hasScheduleFieldsChanged, resolveBuilderEdits, (v: string) => v, (v: unknown) => v ?? null, () => "local", ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"],
);
const original = { id: "g", child_id: "c", curriculum_name: "Math", subject_label: "Math", total_lessons: 20, current_lesson: 0, lessons_per_day: 1, lessons_per_day_overrides: null, school_days: ["Mon", "Tue", "Wed", "Thu", "Fri"], start_date: "2026-10-01", start_at_lesson: 1, default_minutes: 30, scheduled_start_time: null, archived: false, completed_at: null };

test("a stale rename and sibling save preserve newer schedule fields and planner pace", async () => {
  const a = page.rowFromCurriculumGoal(original);
  a.name = "Renamed";
  const b = {...original, lessons_per_day: 2, school_days: ["Mon", "Wed"], total_lessons: 24, start_date: "2026-10-12", start_at_lesson: 3, current_lesson: 2};
  const sibling = {...original, id: "s", curriculum_name: "Reading"};
  const saved = await page.refreshRows([a, page.rowFromCurriculumGoal(sibling)], [b, sibling]);
  assert.equal(saved.saveError, null);
  assert.deepEqual(saved.editPatches.get("g"), {curriculum_name: "Renamed"});
  const row = saved.rows[0];
  assert.equal(row.total_lessons, 24);
  assert.equal(row.start_date, "2026-10-12");
  assert.equal(row.start_at_lesson, 3);
  assert.equal(page.scheduleFieldsChangedForRow(row), false, "untouched sibling pins remain protected");
  const config = {...b, ...page.compactCurriculumPerDay(row)};
  const plan = computeNextLessonsForGoal(config, new Date(2026, 9, 12), 30, []);
  assert.deepEqual(plan.slice(0, 4).map(p => p.date), ["2026-10-12", "2026-10-12", "2026-10-14", "2026-10-14"]);
  assert.deepEqual(changedSettings(scheduleSnapshot(b), scheduleSnapshot(saved.editPatches.get("g"))), {});
});

test("deliberately changed same fields refuse before any write", async () => {
  for (const [formKey, aValue, dbKey, bValue] of [
    ["total_lessons", 30, "total_lessons", 40], ["start_date", "2026-10-10", "start_date", "2026-10-12"],
    ["start_at_lesson", 4, "start_at_lesson", 5], ["name", "A", "curriculum_name", "B"],
    ["per_day_counts", [3,3,3,3,3,1,1], "lessons_per_day", 2],
    ["active_days", [true,false,true,false,false,false,false], "school_days", ["Tue","Thu"]],
  ] as const) {
    const a = page.rowFromCurriculumGoal(original); a[formKey] = aValue;
    const saved = await page.refreshRows([a], [{...original, [dbKey]: bValue}]);
    assert.match(saved.saveError, /changed in another tab/);
    assert.equal(saved.rows, undefined);
  }
});

test("a normalized unchanged form does not turn null storage into an edit", async () => {
  const nullable = {...original, lessons_per_day: null, default_minutes: null};
  const a = page.rowFromCurriculumGoal(nullable);
  const saved = await page.refreshRows([a], [{...original, lessons_per_day: 3, default_minutes: 40}]);
  assert.deepEqual(saved.editPatches.get("g"), {});
  assert.equal(saved.rows[0].minutes_per_lesson, 40);
});

test("repeat saves, convergent retries, and edits reverted to their original value", async () => {
  const a = page.rowFromCurriculumGoal(original); a.per_day_counts = [2,2,2,2,2,1,1];
  const first = await page.refreshRows([a], [original]);
  assert.deepEqual(first.editPatches.get("g"), {lessons_per_day: 2});
  const current = {...original, lessons_per_day: 2};
  const lostResponseRetry = await page.refreshRows([a], [current]);
  assert.equal(lostResponseRetry.saveError, null);
  assert.deepEqual(lostResponseRetry.editPatches.get("g"), {});
  const next = page.rowFromCurriculumGoal(current); next.name = "Again";
  const second = await page.refreshRows([next], [{...current, lessons_per_day: 3}]);
  assert.deepEqual(second.editPatches.get("g"), {curriculum_name: "Again"});
  a.per_day_counts = [1,1,1,1,1,1,1];
  assert.deepEqual((await page.refreshRows([a], [current])).editPatches.get("g"), {});
});

test("restored draft retains its original edit baseline and refuses an unknown legacy baseline", async () => {
  const a = page.rowFromCurriculumGoal(original); a.name = "Draft name";
  const b = {...original, lessons_per_day: 2, start_at_lesson: 5, current_lesson: 4};
  const draft = page.carryDbFieldsOntoDraftRow(a, page.rowFromCurriculumGoal(b));
  const saved = await page.refreshRows([draft], [b]);
  assert.deepEqual(saved.editPatches.get("g"), {curriculum_name: "Draft name"});
  delete draft._editBaseline;
  assert.match((await page.refreshRows([draft], [b])).saveError, /draft needs to be reopened/);
});

test("override key order does not create conflicts", () => {
  const baseline = {stored: {lessons_per_day_overrides: {Mon: 1, Wed: 2}}, form: {lessons_per_day_overrides: {Mon: 1, Wed: 2}}};
  assert.deepEqual(resolveBuilderEdits(baseline, {lessons_per_day_overrides: {Wed: 2, Mon: 1}}, {lessons_per_day_overrides: {Mon: 3, Wed: 2}}).patch, {});
});

test("commit guard covers all schedule inputs after refresh, including no-patch siblings", () => {
  assert.match(source, /changedSettings\(scheduleSnapshot\(\{ \.\.\.plannedFrom \}\), scheduleSnapshot\(\{ \.\.\.snapshot \}\)\)/);
  assert.ok(source.indexOf("const freshGoals") < source.indexOf("const newCurriculumRows"));
  assert.match(source, /_editBaseline: \{ stored, form: curriculumEditableValues\(row\) \}/);
});


test("a save about a sibling preserves another tab's complete pace and overrides", async () => {
  const untouched = page.rowFromCurriculumGoal(original);
  const sibling = {...original,id:"s",curriculum_name:"Reading"};
  const edit = page.rowFromCurriculumGoal(sibling); edit.name="Phonics";
  const current = {...original,lessons_per_day:2,lessons_per_day_overrides:{Mon:3,Wed:1},school_days:["Mon","Wed"]};
  const result = await page.refreshRows([untouched,edit],[current,sibling]);
  assert.deepEqual(result.editPatches.get("g"),{});
  assert.deepEqual(page.compactCurriculumPerDay(result.rows[0]),{lessons_per_day:2,lessons_per_day_overrides:{Mon:3,Wed:1},school_days:["Mon","Wed"]});
  assert.equal(page.scheduleFieldsChangedForRow(result.rows[0]),false);
});

test("flat pace and per-day overrides cannot merge into a pace neither tab chose", () => {
  const baseline={stored:{...original},form:{...original}};
  assert.throws(()=>resolveBuilderEdits(baseline,{...original,lessons_per_day_overrides:{Mon:1,Wed:2}},{...original,lessons_per_day:2}),/lessons per day/);
});


test("successful save advances its baseline without normalizing untouched stored values", async () => {
  const raw={...original,default_minutes:null,lessons_per_day:null};
  const row=page.rowFromCurriculumGoal(raw); row.name="Renamed";
  const refreshed=await page.refreshRows([row],[raw]);
  const stored={...raw,...refreshed.editPatches.get("g")};
  const settled=page.settledCurriculumRow(refreshed.rows[0],"g",stored);
  assert.equal(settled._editBaseline.stored.default_minutes,null);
  assert.equal(settled._editBaseline.stored.lessons_per_day,null);
  settled.minutes_per_lesson=45;
  const repeat=await page.refreshRows([settled],[stored]);
  assert.equal(repeat.saveError,null);
  assert.deepEqual(repeat.editPatches.get("g"),{default_minutes:45});
});
