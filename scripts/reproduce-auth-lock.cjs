// Runs the published SDK lock implementation in two Chromium tabs on localhost.
// No account, credential, Supabase request, or application data is involved.
const { chromium } = require('@playwright/test');
const { createServer } = require('node:http');
const assert = require('node:assert/strict');
const loadLockSource = require('./auth-lock-source.cjs');

async function main() {
  const server = createServer((req, res) => res.end('<html>Lock reproduction</html>'));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  let browser;
  const results = [];
  try {
    browser = await chromium.launch({ headless: true });
    for (const version of ['2.99.2', '2.112.4']) {
      const context = await browser.newContext();
      const a = await context.newPage();
      const b = await context.newPage();
      const url = `http://127.0.0.1:${server.address().port}`;
      await Promise.all([a.goto(url), b.goto(url)]);
      // Only module bootstrapping is adapted: replace imported storage feature
      // detection with false (debug off) and expose exports on window.
      const source = await loadLockSource(version);
      await a.evaluate(source + '\nwindow.probeLock = navigatorLock;');
      const normal = await a.evaluate(async () => {
        let calls = 0;
        const value = await window.probeLock('rooted-lock-normal', 0, async () => { calls++; return 42; });
        return { value, calls };
      });
      assert.deepEqual(normal, { value: 42, calls: 1 });
      await a.evaluate(() => {
        window.calls = 0;
        window.outcome = null;
        window.pending = window.probeLock('rooted-lock-stolen', 0, async () => {
          window.calls++;
          window.acquired = true;
          return new Promise(resolve => { window.release = resolve; });
        }).then(() => { window.outcome = { success: true }; }, e => {
          window.outcome = { name: e.name, constructor: e.constructor.name, isAcquireTimeout: e.isAcquireTimeout === true };
        });
      });
      await a.waitForFunction(() => window.acquired === true);
      await b.evaluate(() => navigator.locks.request('rooted-lock-stolen', { mode: 'exclusive', steal: true }, () => true));
      await a.waitForFunction(() => window.outcome !== null);
      const stolen = await a.evaluate(() => ({ ...window.outcome, calls: window.calls }));
      assert.equal(stolen.calls, 1);
      if (version === '2.99.2') {
        assert.equal(stolen.name, 'AbortError');
        assert.equal(stolen.isAcquireTimeout, false);
      } else {
        assert.equal(stolen.constructor, 'NavigatorLockAcquireTimeoutError');
        assert.equal(stolen.isAcquireTimeout, true);
      }
      await a.evaluate(async () => { window.release(); await window.pending; });
      results.push({ version, normal, stolen });
      await context.close();
    }
    console.log(JSON.stringify({ browser: browser.version(), results }, null, 2));
  } finally {
    if (browser) await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
