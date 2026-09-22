// Name every skipped smoke test, with the reason it gave.
//
//   node scripts/smoke-skips.mjs smoke-results.json
//
// Playwright counts a skip as a non-failure, and the summary line only says
// "9 skipped". A run once reported green while skipping every test that
// completes a lesson (see e2e/seed-curriculum.ts), so the skips are listed by
// name in the log and in the job summary on every run.
//
// Reads Playwright's JSON report. Prints titles and skip reasons only: no
// error text, no attachments, nothing that could carry the bypass cookie.

import { appendFileSync, readFileSync } from 'node:fs';

/** Every test in the report, with the path of titles that leads to it. */
export function collectTests(report) {
  const out = [];
  const walk = (suite, path) => {
    const here = suite.title ? [...path, suite.title] : path;
    for (const spec of suite.specs ?? []) {
      for (const t of spec.tests ?? []) {
        out.push({ path: [...here, spec.title], file: spec.file ?? suite.file ?? '', line: spec.line, test: t });
      }
    }
    for (const child of suite.suites ?? []) walk(child, here);
  };
  for (const s of report.suites ?? []) walk(s, []);
  return out;
}

/** The skipped ones, each with its reason (or "no reason given"). */
export function skippedTests(report) {
  return collectTests(report)
    .filter(({ test }) => test.status === 'skipped')
    .map(({ path, file, line, test }) => {
      const notes = [...(test.annotations ?? []), ...(test.results ?? []).flatMap((r) => r.annotations ?? [])];
      const skip = notes.find((a) => a.type === 'skip' || a.type === 'fixme');
      return {
        project: test.projectName ?? '',
        title: path.filter((p) => p !== file).join(' › '),
        location: line ? `${file}:${line}` : file,
        reason: skip?.description?.trim() || 'no reason given',
      };
    });
}

function main() {
  const file = process.argv[2];
  if (!file) {
    console.error('usage: node scripts/smoke-skips.mjs <playwright-json-report>');
    process.exit(2);
  }
  let report;
  try {
    report = JSON.parse(readFileSync(file, 'utf8'));
  } catch (e) {
    console.error(`[smoke-skips] could not read ${file}: ${e.message}`);
    process.exit(1);
  }
  const skipped = skippedTests(report);
  const lines = [`Skipped smoke tests: ${skipped.length}`];
  for (const s of skipped) lines.push(`- [${s.project}] ${s.title} (${s.location}): ${s.reason}`);
  console.log(lines.join('\n'));
  if (process.env.GITHUB_STEP_SUMMARY) {
    const md = [`### Skipped smoke tests (${skipped.length})`, '', '| Project | Test | Reason |', '|---|---|---|'];
    for (const s of skipped) md.push(`| ${s.project} | ${s.title.replace(/\|/g, '\\|')} | ${s.reason.replace(/\|/g, '\\|')} |`);
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, md.join('\n') + '\n');
  }
}

if (import.meta.url === `file://${process.argv[1]}`) main();
