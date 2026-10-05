import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { deferAuthWork } from './defer-auth-work.ts';

test('auth work starts after the notifying callback and its microtasks return', async () => {
  const order: string[] = [];
  await new Promise<void>((resolve) => {
    deferAuthWork(async () => { order.push('refresh'); resolve(); }, () => assert.fail());
    order.push('callback returned');
    void Promise.resolve().then(() => order.push('lock released'));
  });
  assert.deepEqual(order, ['callback returned', 'lock released', 'refresh']);
});

test('unmount cancels queued auth work', async () => {
  let ran = false;
  const cancel = deferAuthWork(async () => { ran = true; }, () => assert.fail());
  cancel();
  await new Promise(resolve => setTimeout(resolve, 5));
  assert.equal(ran, false);
});

test('a rejected refresh is handled without an unhandled rejection', async () => {
  await new Promise<void>(resolve => {
    deferAuthWork(async () => { throw new Error('refresh failed'); }, resolve);
  });
});

test('unmount suppresses a pending refresh error callback', async () => {
  let rejectWork!: (reason: Error) => void;
  let errorCalled = false;
  let cancel!: () => void;
  await new Promise<void>(resolve => {
    cancel = deferAuthWork(() => {
      resolve();
      return new Promise<void>((_resolve, reject) => { rejectWork = reject; });
    }, () => { errorCalled = true; });
  });
  cancel();
  rejectWork(new Error('late failure'));
  await new Promise(resolve => setTimeout(resolve, 5));
  assert.equal(errorCalled, false);
});

test('both admin auth listeners defer work and cancel on unmount', () => {
  for (const path of ['../app/admin/page.tsx', '../app/admin/resources/page.tsx']) {
    const source = readFileSync(new URL(path, import.meta.url), 'utf8');
    assert.ok(!source.includes('onAuthStateChange(async'));
    assert.ok(source.includes('cancelWork = deferAuthWork(async () =>'));
    assert.ok(source.includes('cancelWork?.(); subscription.unsubscribe();'));
  }
});
