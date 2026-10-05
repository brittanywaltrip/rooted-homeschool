import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lessonMinutes, lessonMinutesInput } from './lesson-minutes.ts';

for (const row of [{ minutes_spent: null }, { minutes_spent: null, hours: 0 }, {}]) {
  test(`a notes-only save keeps unrecorded time estimated: ${JSON.stringify(row)}`, () => {
    const value = lessonMinutesInput(row);
    assert.equal(value, '');
    const savedMinutes = value.trim() === '' ? null : Number(value);
    assert.deepEqual(lessonMinutes({ minutes_spent: savedMinutes, hours: 0 }), { minutes: 30, source: 'estimated', estimated: true });
  });
}
test('explicit zero stays recorded zero through an editor save', () => {
  const value = lessonMinutesInput({ minutes_spent: 0, hours: 1 });
  assert.equal(value, '0');
  assert.equal(lessonMinutes({ minutes_spent: Number(value) }).estimated, false);
  assert.equal(lessonMinutes({ minutes_spent: Number(value) }).minutes, 0);
});
test('recorded minutes and legacy positive hours remain populated', () => {
  assert.equal(lessonMinutesInput({ minutes_spent: 45 }), '45');
  assert.equal(lessonMinutesInput({ minutes_spent: null, hours: 1.5 }), '90');
});
test('a parent can deliberately replace an estimate with actual minutes', () => {
  assert.equal(lessonMinutesInput({ minutes_spent: null }), '');
  assert.deepEqual(lessonMinutes({ minutes_spent: 20 }), { minutes: 20, source: 'recorded', estimated: false });
});
