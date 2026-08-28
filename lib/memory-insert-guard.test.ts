// Every insert into `memories` must set include_in_book explicitly.
//
// WHY THIS IS A STATIC CHECK AND NOT A UNIT TEST.
//
// The bug was one word. saveCapturedPhotos wrote include_in_book: false, the
// yearbook reads .eq("include_in_book", true), and 64% of every photo Rooted
// has ever stored never reached a page. It was fixed in 8e08d08 at two of the
// three capture paths, and the third, the Quick photo button in
// app/dashboard/layout.tsx, was missed and stayed broken. That is the shape
// worth guarding: not the arithmetic of any one insert, but the fact that a
// capture path can be added or edited without anyone deciding what happens to
// the photo.
//
// Reproducing it for real would need a signed-in Supabase session, a real
// upload and a rendered React tree, and this repo has no React/DOM test tooling
// at all. A unit test over an extracted "buildMemoryRow" helper would pass
// identically before and after the fix, because the helper is not where the
// mistake lives. The mistake lives in a call site nobody looked at.
//
// So this sweeps the source instead, the same approach as
// app/components/updaterPurity.test.ts and the scheduler's projection guards.
//
// THE RULE: every `supabase.from("memories").insert({ ... })` names
// include_in_book. The VALUE is not policed here, because there are legitimate
// falses (the Plan page offers "Save to Memories" and "Add to Yearbook" as two
// separate buttons, and the win sheet includes wins and quotes but not other
// types). What is policed is that somebody decided.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve, relative } from "node:path";

const ROOTS = ["app", "components", "lib"];

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    // Build output, the stray FUSE artifacts in app/dashboard, and the
    // per-agent git worktrees, which are other branches and not this one.
    if (entry === "node_modules" || entry === ".next" || entry === ".claude") continue;
    if (entry.startsWith(".fuse_hidden")) continue;
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      if (entry === "_to_delete") continue;
      walk(full, out);
    } else if (full.endsWith(".ts") || full.endsWith(".tsx")) {
      if (full.endsWith(".test.ts") || full.endsWith(".test.tsx")) continue;
      out.push(full);
    }
  }
  return out;
}

/** Strip comments so a match cannot be satisfied by prose about the rule. */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " ");
}

/** Index of the ')' matching the '(' at `open`, skipping string literals. */
function matchParen(src: string, open: number): number {
  let depth = 0;
  let quote: string | null = null;
  for (let i = open; i < src.length; i++) {
    const c = src[i];
    if (quote) {
      if (c === "\\") { i++; continue; }
      if (c === quote) quote = null;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") { quote = c; continue; }
    if (c === "(") depth++;
    else if (c === ")") {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

type Insert = { file: string; line: number; explicit: boolean; snippet: string };

/**
 * Every `.from("memories") … .insert(` in the tree, with whether its argument
 * names include_in_book. The `.from(...)` and the `.insert(` are allowed to be
 * separated by whitespace, a newline or chained calls, which is how they are
 * actually written across these files.
 */
function findMemoryInserts(): Insert[] {
  const out: Insert[] = [];
  const fromMemories = /\.from\(\s*["'`]memories["'`]\s*\)/g;

  for (const root of ROOTS) {
    for (const file of walk(resolve(process.cwd(), root))) {
      const raw = readFileSync(file, "utf-8");
      const src = stripComments(raw);
      for (const m of src.matchAll(fromMemories)) {
        const after = src.slice(m.index! + m[0].length);
        // Only an insert that follows directly, through nothing but whitespace
        // and dots. A `.from("memories").select(...)` is not our business.
        const insert = /^[\s.]*insert\s*\(/.exec(after);
        if (!insert) continue;
        const openParen = m.index! + m[0].length + insert[0].length - 1;
        const closeParen = matchParen(src, openParen);
        assert.ok(closeParen > openParen, `unbalanced insert( in ${file}`);
        const args = src.slice(openParen + 1, closeParen);
        out.push({
          file: relative(process.cwd(), file),
          line: src.slice(0, m.index!).split("\n").length,
          explicit: /\binclude_in_book\s*:/.test(args),
          snippet: args.replace(/\s+/g, " ").trim().slice(0, 80),
        });
      }
    }
  }
  return out;
}

test("every insert into memories decides include_in_book explicitly", () => {
  const inserts = findMemoryInserts();

  // A sanity floor. If the matcher silently stops finding anything, the test
  // would pass while guarding nothing, which is the failure mode that makes a
  // static sweep worthless.
  assert.ok(
    inserts.length >= 6,
    `expected to find the known memory inserts, found ${inserts.length}. The matcher has probably broken.`,
  );

  const silent = inserts.filter((i) => !i.explicit);
  assert.deepEqual(
    silent.map((i) => `${i.file}:${i.line}`),
    [],
    `these inserts leave include_in_book to the column default, so nobody decided whether the photo ` +
      `reaches the book:\n${silent.map((i) => `  ${i.file}:${i.line}  ${i.snippet}`).join("\n")}`,
  );
});

test("the three photo capture paths all put photos in the book", () => {
  // Named individually, because these are the ones a family actually taps and
  // the ones that have gone wrong. The Quick photo FAB in the layout is on
  // every dashboard page and was the one 8e08d08 missed.
  const capturePaths = [
    "app/dashboard/page.tsx", // saveCapturedPhotos and the field trip sheet
    "app/dashboard/layout.tsx", // the Quick photo FAB
  ];
  const inserts = findMemoryInserts().filter((i) => capturePaths.includes(i.file));
  assert.ok(inserts.length >= 3, `expected the capture inserts, found ${inserts.length}`);

  for (const insert of inserts) {
    assert.ok(insert.explicit, `${insert.file}:${insert.line} must name include_in_book`);
  }

  // The FAB is a single insert and must be a true one; the Today page's inserts
  // include the win sheet's deliberate conditional, so they are covered by the
  // explicitness test above rather than asserted true here.
  const fab = inserts.filter((i) => i.file === "app/dashboard/layout.tsx");
  assert.equal(fab.length, 1, "the layout has exactly one memory insert, the Quick photo FAB");
  assert.ok(
    /include_in_book\s*:\s*true/.test(readFileSync(resolve(process.cwd(), "app/dashboard/layout.tsx"), "utf-8")),
    "the Quick photo FAB must insert include_in_book: true",
  );
});
