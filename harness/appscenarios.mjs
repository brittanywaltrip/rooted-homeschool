import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, "..");
const { client, raw, UID } = await import(join(HERE, "appcheck.mjs"));
const { commitGoalSave, ScheduleSaveError } =
  await import(join(REPO, "app/lib/schedule-commit-client.ts"));
const { buildForwardInsertRow } =
  await import(join(REPO, "app/lib/phase2-insert-rows.ts"));

const G = "aaaaaaaa-0000-4000-8000-0000000000cc";
const C = "cccccccc-0000-4000-8000-000000000001";
let pass = 0, fail = 0;
const ok  = (m) => { pass++; console.log("  PASS  " + m); };
const bad = (m, d) => { fail++; console.log("  FAIL  " + m + (d ? "\n        " + d : "")); };

async function reset() {
  // Each run starts clean: stale idempotency keys and consumed proposals
  // from a previous run are fixture pollution, not findings.
  await raw(`delete from schedule_transactions; delete from schedule_proposals;`);
  await raw(`delete from lessons where curriculum_goal_id='${G}';
    delete from curriculum_goals where id='${G}';
    insert into curriculum_goals (id,user_id,child_id,curriculum_name,total_lessons,current_lesson,school_days)
    values ('${G}','${UID}','${C}','App scenario',8,2,'{Mon,Tue,Wed,Thu,Fri}');
    insert into lessons (id,user_id,child_id,curriculum_goal_id,title,date,lesson_number,queue_position,completed)
    select ('cafe0000-0000-4000-8000-0000000000'||lpad(n::text,2,'0'))::uuid,'${UID}','${C}','${G}','L'||n,
           date '2027-01-01'+n, n, n, n<=2 from generate_series(1,5) n;`);
}
const snapshot = async () => (await raw(
  `select md5(string_agg(to_jsonb(l)::text, chr(10) order by l.id)) from lessons l where l.curriculum_goal_id='${G}';`)).out;
const count = async () => (await raw(`select count(*) from lessons where curriculum_goal_id='${G}';`)).out;

// The SHIPPED serializer, not a hand-rolled shape. This harness previously
// built insert rows from the allowlist's own key names, so it validated the
// function against the same assumption the function was written from and
// missed both the user_id and the id defects. It now sends exactly what the
// page sends. The id is no longer supplied at all: the database assigns it.
const row = (n, d) => buildForwardInsertRow({
  childId: C, goalId: G, lessonNumber: n, queuePosition: n,
  curriculumName: `L${n} fresh`, date: d,
});

// 1 ── a successful save
await reset();
let before = await snapshot();
try {
  const r = await commitGoalSave(client, {
    goalId: G,
    lessonUpdates: [{ lesson_id: "cafe0000-0000-4000-8000-000000000003", queue_pinned: false,
                      scheduled_date: "2027-02-01", date: "2027-02-01", scheduled_source: "wizard_create" }],
    deleteIds: ["cafe0000-0000-4000-8000-000000000004"],
    insertRows: [row(4, "2027-02-02")],
    idempotencyKey: "app-scenario-save-001",
  });
  r.status === "committed" && r.deleted === 1 && r.inserted === 1 && r.updated === 1
    ? ok(`successful save: deleted ${r.deleted}, inserted ${r.inserted}, updated ${r.updated}`)
    : bad("successful save returned unexpected counts", JSON.stringify(r));
} catch (e) { bad("successful save threw", e.message); }

// 2 ── retry with the same key
try {
  const r = await commitGoalSave(client, {
    goalId: G,
    lessonUpdates: [{ lesson_id: "cafe0000-0000-4000-8000-000000000003", queue_pinned: false,
                      scheduled_date: "2027-02-01", date: "2027-02-01", scheduled_source: "wizard_create" }],
    deleteIds: ["cafe0000-0000-4000-8000-000000000004"],
    insertRows: [row(4, "2027-02-02")],
    idempotencyKey: "app-scenario-save-001",
  });
  r.status === "already_committed"
    ? ok("retry after an uncertain response replays, it does not save twice")
    : bad("retry did not replay", JSON.stringify(r));
} catch (e) { bad("retry threw", e.message); }

// 3 ── A GENUINELY LATE failure: after the delete, the goal update and the
//      lesson updates have all run.
//
//      The previous version of this scenario sent two insert rows claiming one
//      slot. Prevalidation now rejects that BEFORE any lock or write, so it
//      stopped testing rollback at all and was quietly proving nothing.
//
//      This one conflicts with an EXISTING row that is not in the delete set,
//      so it passes every pre-flight check and fails inside the INSERT -- the
//      only place left where earlier writes are already on the table.
await reset();
{
  const acctBefore = await snapshot();
  const goalBefore = (await raw(
    `select curriculum_name||'|'||total_lessons||'|'||current_lesson
       from curriculum_goals where id='${G}';`)).out;
  const survivorBefore = (await raw(
    `select to_jsonb(l)::text from lessons l where l.id='cafe0000-0000-4000-8000-000000000003';`)).out;

  const seal = await client.rpc("schedule_seal_proposal", { p_action: "rebuild", p_goal_ids: [G], p_placements: [] });
  const c = await client.rpc("schedule_commit", {
    p_proposal_id: seal.data.preview_id,
    // a goal field change, so we can prove IT rolled back too
    p_goal_updates: { [G]: { curriculum_name: "SHOULD NOT PERSIST", total_lessons: 99 } },
    // a lesson update, same reason
    p_lesson_updates: [{ lesson_id: "cafe0000-0000-4000-8000-000000000003",
                         scheduled_date: "2029-01-01", date: "2029-01-01" }],
    // a real delete that must be undone
    p_delete_ids: ["cafe0000-0000-4000-8000-000000000004"],
    // lesson_number 3 is ALREADY taken by a row we are NOT deleting: this gets
    // past prevalidation and violates lessons_goal_lesson_unique at the insert
    p_insert_rows: [row(3, "2029-02-02")],
    p_pointers: { [G]: 7 },
    p_idempotency_key: "late-failure-key-003" });

  if (!c.error) { bad("the late insert conflict was not reported at all"); }
  else if (!/duplicate key|unique/i.test(c.error.message)) {
    bad("the failure came from prevalidation, not the insert — the scenario is not testing rollback",
        String(c.error.message).slice(0, 110));
  } else {
    ok(`a late insert conflict is reported: "${c.error.message.slice(0, 48)}…"`);
    const acctAfter = await snapshot();
    acctAfter === acctBefore && acctAfter !== ""
      ? ok("late failure: the whole account is byte-identical — the earlier DELETE rolled back")
      : bad("late failure left the account changed", `${acctBefore} -> ${acctAfter}`);
    const goalAfter = (await raw(
      `select curriculum_name||'|'||total_lessons||'|'||current_lesson
         from curriculum_goals where id='${G}';`)).out;
    goalAfter === goalBefore
      ? ok("the goal fields AND the pointer rolled back with it")
      : bad("goal fields or pointer survived a failed save", `${goalBefore} -> ${goalAfter}`);
    const survivorAfter = (await raw(
      `select to_jsonb(l)::text from lessons l where l.id='cafe0000-0000-4000-8000-000000000003';`)).out;
    survivorAfter === survivorBefore
      ? ok("the lesson UPDATE rolled back too")
      : bad("a lesson update survived a failed save");
    const deleted = (await raw(
      `select count(*) from lessons where id='cafe0000-0000-4000-8000-000000000004';`)).out;
    deleted === "1"
      ? ok("the deleted row is still there")
      : bad("the delete survived the failure — this is the August 2026 shape");
  }
}

// 4 ── a concurrent title edit
await reset();
before = await snapshot();
try {
  const seal = await client.rpc("schedule_seal_proposal", { p_action: "rebuild", p_goal_ids: [G], p_placements: [] });
  await raw(`update lessons set title='parent renamed mid-save' where id='cafe0000-0000-4000-8000-000000000005';`);
  const c = await client.rpc("schedule_commit", {
    p_proposal_id: seal.data.preview_id,
    p_goal_updates: {}, p_lesson_updates: [],
    p_delete_ids: ["cafe0000-0000-4000-8000-000000000004"], p_insert_rows: [], p_pointers: {},
    p_idempotency_key: "app-scenario-title-003",
  });
  if (!c.error) bad("a concurrent title edit was not detected");
  else {
    const afterRename = await snapshot();
    afterRename !== before
      ? ok("concurrent title edit: refused, and the rename itself survives")
      : bad("the rename did not persist", `before=${before} after=${afterRename} titles=${(await raw(`select string_agg(title,',' order by lesson_number) from lessons where curriculum_goal_id='${G}';`)).out}`);
    /changed since/.test(c.error.message)
      ? ok(`refused on the stale path: "${c.error.message.slice(0, 54)}…"`)
      : bad("wrong refusal", c.error.message);
  }
} catch (e) { bad("title scenario threw", e.message); }

// 5 ── a concurrent hours edit
await reset();
try {
  const seal = await client.rpc("schedule_seal_proposal", { p_action: "rebuild", p_goal_ids: [G], p_placements: [] });
  await raw(`update lessons set hours=2.5 where id='cafe0000-0000-4000-8000-000000000005';`);
  const c = await client.rpc("schedule_commit", {
    p_proposal_id: seal.data.preview_id,
    p_goal_updates: {}, p_lesson_updates: [],
    p_delete_ids: ["cafe0000-0000-4000-8000-000000000004"], p_insert_rows: [], p_pointers: {},
    p_idempotency_key: "app-scenario-hours-004",
  });
  c.error && /changed since/.test(c.error.message)
    ? ok("concurrent hours edit: refused on the stale path")
    : bad("a concurrent hours edit was not detected", JSON.stringify(c));
} catch (e) { bad("hours scenario threw", e.message); }



// ── Blocker 5: a row that ALREADY holds hours ──────────────────────────────
await reset();
await raw(`update lessons set hours=1.5 where id='cafe0000-0000-4000-8000-000000000004';`);
{
  const seal = await client.rpc("schedule_seal_proposal", { p_action: "rebuild", p_goal_ids: [G], p_placements: [] });
  const c = await client.rpc("schedule_commit", {
    p_proposal_id: seal.data.preview_id, p_goal_updates: {}, p_lesson_updates: [],
    p_delete_ids: ["cafe0000-0000-4000-8000-000000000004"], p_insert_rows: [], p_pointers: {},
    p_idempotency_key: "app-hours-existing-010" });
  c.error && /notes, minutes or hours/.test(c.error.message)
    ? ok("a row that already held hours is refused, not only a concurrent edit")
    : bad("an existing hours-only row was deletable", JSON.stringify(c).slice(0,120));
}

// ── Input validation ──────────────────────────────────────────────────────
await reset();
for (const [label, payload, want] of [
  ["a repeated delete id", { p_delete_ids: ["cafe0000-0000-4000-8000-000000000004","cafe0000-0000-4000-8000-000000000004"] }, /repeats an id/],
  ["a repeated lesson_id in updates", { p_lesson_updates: [{lesson_id:"cafe0000-0000-4000-8000-000000000003",queue_pinned:false},{lesson_id:"cafe0000-0000-4000-8000-000000000003",date:"2027-01-01"}] }, /repeat a lesson_id/],
  ["an unknown update key", { p_lesson_updates: [{lesson_id:"cafe0000-0000-4000-8000-000000000003", completed: true}] }, /unknown key/],
  ["two inserts claiming one slot", { p_insert_rows: [row(9,"2027-04-01"), row(9,"2027-04-02")] }, /same queue slot/],
]) {
  const seal = await client.rpc("schedule_seal_proposal", { p_action: "rebuild", p_goal_ids: [G], p_placements: [] });
  const c = await client.rpc("schedule_commit", Object.assign({
    p_proposal_id: seal.data.preview_id, p_goal_updates: {}, p_lesson_updates: [],
    p_delete_ids: [], p_insert_rows: [], p_pointers: {},
    p_idempotency_key: "app-validate-" + Math.random().toString(36).slice(2,10) }, payload));
  c.error && want.test(c.error.message)
    ? ok(`refused: ${label}`)
    : bad(`not refused: ${label}`, JSON.stringify(c).slice(0,120));
}

// ── Additional: a foreign key pointing at another family ──────────────────
await reset();
{
  const seal = await client.rpc("schedule_seal_proposal", { p_action: "rebuild", p_goal_ids: [G], p_placements: [] });
  const sneak = row(9, "2027-04-09");
  sneak.child_id = "cccccccc-0000-4000-8000-000000000002";   // the other account's child
  const c = await client.rpc("schedule_commit", {
    p_proposal_id: seal.data.preview_id, p_goal_updates: {}, p_lesson_updates: [],
    p_delete_ids: [], p_insert_rows: [sneak], p_pointers: {}, p_idempotency_key: "app-fk-011" });
  c.error
    ? ok(`a row naming another family's child is refused: "${c.error.message.slice(0,52)}…"`)
    : bad("a row was attached to another family's child");
}

// ── Blocker 6: cascade containment in the delete RPCs ─────────────────────
await reset();
await raw(`update lessons set continues_lesson_id='cafe0000-0000-4000-8000-000000000004'
             where id='cafe0000-0000-4000-8000-000000000005';`);
{
  const one = await client.rpc("delete_lesson", { p_lesson_id: "cafe0000-0000-4000-8000-000000000004" });
  one.error && /continue from this one/.test(one.error.message)
    ? ok("delete_lesson refuses an unasked-for continuation cascade")
    : bad("delete_lesson cascaded silently", JSON.stringify(one).slice(0,110));
  const goalWide = await client.rpc("delete_goal_pending_lessons", { p_goal_id: G });
  goalWide.error
    ? bad("delete_goal_pending_lessons refused a cascade fully inside its own predicate", String(goalWide.error.message).slice(0,90))
    : ok("delete_goal_pending_lessons allows a cascade wholly inside its own predicate");
}


// ── Blocker D: continues_lesson_id ownership ──────────────────────────────
await reset();
{
  const mk = async (sneak) => {
    const seal = await client.rpc("schedule_seal_proposal", { p_action: "rebuild", p_goal_ids: [G], p_placements: [] });
    return client.rpc("schedule_commit", {
      p_proposal_id: seal.data.preview_id, p_goal_updates: {}, p_lesson_updates: [],
      p_delete_ids: [], p_insert_rows: [sneak], p_pointers: {},
      p_idempotency_key: "cont-" + Math.random().toString(36).slice(2, 12) });
  };
  const other = row(11, "2027-06-01");
  other.continues_lesson_id = "dddddddd-0000-4000-8000-0000000000e2";  // the OTHER family's lesson
  const r1 = await mk(other);
  r1.error ? ok(`a continuation pointing at another family's lesson is refused: "${r1.error.message.slice(0,46)}…"`)
           : bad("a row was linked to another family's lesson (ON DELETE CASCADE runs both ways)");

  const missing = row(12, "2027-06-02");
  missing.continues_lesson_id = "00000000-0000-4000-8000-00000000dead";
  const r2 = await mk(missing);
  r2.error ? ok("a continuation pointing at a lesson that does not exist is refused")
           : bad("a dangling continuation target was accepted");

  // DECIDED: same-account, outside the proposal's goals, is ALLOWED. A
  // continuation legitimately spans curricula, and the target is never written.
  const crossGoal = row(13, "2027-06-03");
  crossGoal.continues_lesson_id = "dddddddd-0000-4000-8000-0000000000e1";  // own row, other goal
  const r3 = await mk(crossGoal);
  r3.error ? bad("a same-account cross-curriculum continuation was refused", String(r3.error.message).slice(0,90))
           : ok("a same-account continuation into another curriculum is allowed (decided, documented)");
}

// ── Tightening: unknown keys ──────────────────────────────────────────────
await reset();
for (const [label, payload, want] of [
  ["an unknown key in the goal updates", { p_goal_updates: { [G]: { total_lessns: 9 } } }, /unknown key\(s\) in the goal updates/],
  ["an unknown key in an inserted row", { p_insert_rows: [Object.assign(row(14, "2027-06-08"), { titel: "typo" })] }, /unknown key\(s\) in the inserted rows/],
]) {
  const seal = await client.rpc("schedule_seal_proposal", { p_action: "rebuild", p_goal_ids: [G], p_placements: [] });
  const c = await client.rpc("schedule_commit", Object.assign({
    p_proposal_id: seal.data.preview_id, p_goal_updates: {}, p_lesson_updates: [],
    p_delete_ids: [], p_insert_rows: [], p_pointers: {},
    p_idempotency_key: "unk-" + Math.random().toString(36).slice(2, 12) }, payload));
  c.error && want.test(c.error.message)
    ? ok(`refused: ${label}`)
    : bad(`a typo was silently accepted: ${label}`, JSON.stringify(c).slice(0, 120));
}

// ── server-owned identity: id and user_id both belong to the database ───────
// Added 2026-09-20 after both were found only by the real client on staging.

const txnCount = async () =>
  Number((await raw(`select count(*) from schedule_transactions where user_id='${UID}';`)).out.trim());

await reset();
{
  const r = await commitGoalSave(client, {
    goalId: G,
    insertRows: [row(41, "2027-09-01"), row(42, "2027-09-02")],
    idempotencyKey: "app-dbids-001",
  });
  r.inserted === 2
    ? ok("the real builder payload -- no id, no user_id -- commits")
    : bad(`the real builder payload did not commit (inserted=${r.inserted})`);

  const written = (await raw(
    `select id::text || ' ' || user_id::text from lessons
      where curriculum_goal_id='${G}' and lesson_number in (41,42) order by lesson_number;`))
    .out.trim().split("\n").filter(Boolean).map((l) => l.trim().split(/\s+/));
  written.length === 2
    ? ok("both rows are present after the commit")
    : bad(`expected 2 written rows, found ${written.length}`);
  written.every(([id]) => id && id.length === 36)
    ? ok("every inserted lesson carries a database-generated id")
    : bad("an inserted lesson has no id");
  new Set(written.map(([id]) => id)).size === written.length
    ? ok("the generated ids are distinct")
    : bad("the database generated a duplicate id");
  written.every(([, uid]) => uid === UID)
    ? ok("user_id came from auth.uid(), not from the payload")
    : bad(`user_id is not the caller: ${written.map(([, u]) => u).join(",")}`);
}

// A payload that supplies an id is refused, exactly as user_id is, and neither
// writes anything.
for (const [label, extra] of [
  ["an insert row supplying its own id", { id: "cafe0000-0000-4000-8000-0000000000ff" }],
  ["an insert row supplying user_id", { user_id: UID }],
]) {
  await reset();
  const lessonsBefore = Number((await count()).trim());
  const txnsBefore = await txnCount();
  const seal = await client.rpc("schedule_seal_proposal", {
    p_action: "rebuild", p_goal_ids: [G], p_placements: [],
    p_reset_parent_placements: false, p_become_authoritative: false });
  const c = await client.rpc("schedule_commit", {
    p_proposal_id: seal.data.preview_id, p_goal_updates: {}, p_lesson_updates: [],
    p_delete_ids: [], p_insert_rows: [{ ...row(51, "2027-10-01"), ...extra }], p_pointers: {},
    p_idempotency_key: `app-owned-${label.length}` });
  c.error && /unknown key/.test(c.error.message)
    ? ok(`${label} is refused: "${c.error.message.slice(0, 44)}..."`)
    : bad(`${label} was NOT refused (${c.error ? c.error.message : "no error"})`);
  const lessonsAfter = Number((await count()).trim());
  const txnsAfter = await txnCount();
  lessonsAfter === lessonsBefore && txnsAfter === txnsBefore
    ? ok("  and it wrote no lesson and no schedule_transaction")
    : bad(`  but it changed rows: lessons ${lessonsBefore}->${lessonsAfter}, txns ${txnsBefore}->${txnsAfter}`);
}


console.log(`\n  ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
