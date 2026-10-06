/* eslint-disable @typescript-eslint/no-require-imports -- plain CommonJS script, not app code */
// Controlled LockManager rejection test of actual published SDK functions.
// This does not replace a browser or signed-in staging integration test.
const vm = require('node:vm');
const assert = require('node:assert/strict');
const loadLockSource = require('./auth-lock-source.cjs');

async function main() {
  const results = [];
  for (const version of ['2.99.2', '2.112.4']) {
    const source = await loadLockSource(version);
    let requests = 0;
    let mode = 'normal';
    const sandbox = {
      AbortController, setTimeout, clearTimeout, console,
      navigator: { locks: { request: async (name, options, callback) => {
        requests++;
        if (mode === 'stolen') throw new DOMException('Lock broken by another request with the steal option.', 'AbortError');
        return callback(mode === 'busy' ? null : { name });
      } } },
    };
    vm.createContext(sandbox);
    vm.runInContext(source + '\nthis.probeLock = navigatorLock;', sandbox);
    let calls = 0;
    const value = await sandbox.probeLock('normal', 0, async () => { calls++; return 42; });
    assert.equal(value, 42);
    assert.equal(calls, 1);
    mode = 'busy';
    await assert.rejects(sandbox.probeLock('busy', 0, async () => { calls++; }), e => e.isAcquireTimeout === true);
    assert.equal(calls, 1);
    mode = 'stolen';
    const before = requests;
    let caught;
    try { await sandbox.probeLock('stolen', 0, async () => { calls++; }); } catch (e) { caught = e; }
    assert.ok(caught);
    assert.equal(requests - before, 1, 'must not steal back or repeat the callback');
    assert.equal(calls, 1);
    assert.equal(caught.isAcquireTimeout === true, version !== '2.99.2');
    if (version === '2.99.2') assert.equal(caught.name, 'AbortError');
    results.push({ version, ordinaryCallbackOnce: true, busyRefused: true, stolen: { name: caught.name, constructor: caught.constructor.name, typedTimeout: caught.isAcquireTimeout === true, requests: requests - before } });
  }
  console.log(JSON.stringify({ kind: 'controlled SDK test, not staging', results }, null, 2));
}
main().catch(e => { console.error(e); process.exitCode = 1; });
