import test from 'node:test';
import assert from 'node:assert/strict';
import { skippedTests } from './smoke-skips.mjs';

// The shape Playwright's JSON reporter writes (checked against a real run).
const report = {
  suites: [
    {
      title: 'smoke/flows.spec.ts',
      file: 'smoke/flows.spec.ts',
      specs: [],
      suites: [
        {
          title: 'FLOW 7. Stop recurring appointment',
          file: 'smoke/flows.spec.ts',
          specs: [
            {
              title: 'Guitar Lessons stop confirm',
              file: 'smoke/flows.spec.ts',
              line: 597,
              tests: [
                {
                  projectName: 'chromium',
                  status: 'skipped',
                  annotations: [],
                  results: [{ status: 'skipped', annotations: [{ type: 'skip', description: 'Test account has no "Guitar Lessons" recurring appointment.' }] }],
                },
              ],
            },
            {
              title: 'passes',
              file: 'smoke/flows.spec.ts',
              line: 700,
              tests: [{ projectName: 'chromium', status: 'expected', annotations: [], results: [{ status: 'passed' }] }],
            },
          ],
        },
      ],
    },
    {
      title: 'smoke/critical-paths.spec.ts',
      file: 'smoke/critical-paths.spec.ts',
      specs: [
        {
          title: 'static skip',
          file: 'smoke/critical-paths.spec.ts',
          line: 12,
          tests: [{ projectName: 'curriculum-writes', status: 'skipped', annotations: [], results: [] }],
        },
      ],
    },
  ],
};

test('every skipped test is named, with its reason and project', () => {
  assert.deepEqual(skippedTests(report), [
    {
      project: 'chromium',
      title: 'FLOW 7. Stop recurring appointment › Guitar Lessons stop confirm',
      location: 'smoke/flows.spec.ts:597',
      reason: 'Test account has no "Guitar Lessons" recurring appointment.',
    },
    {
      project: 'curriculum-writes',
      title: 'static skip',
      location: 'smoke/critical-paths.spec.ts:12',
      reason: 'no reason given',
    },
  ]);
});

test('an empty report has nothing skipped', () => {
  assert.deepEqual(skippedTests({ suites: [] }), []);
});
