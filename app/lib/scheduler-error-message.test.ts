import test from 'node:test';
import assert from 'node:assert/strict';
import {schedulerErrorMessage} from './scheduler-error-message.ts';

test('direct containment refusals explain recovery without claiming composite rollback',()=>{
  for(const message of ['scheduler_client_upgrade_required','scheduler_calendar_upgrade_required','scheduler_row_scope_refused','scheduler_insert_scope_refused','scheduler_goal_scope_refused','scheduler_bulk_completion_postcondition']) {
    const result=schedulerErrorMessage({code:'P0001',message});
    assert.match(result,/unavailable.*protected curriculum/);
    assert.match(result,/saved work is kept/);
    assert.match(result,/Reload and review/);
    assert.match(result,/earlier changes may already have saved/);
    assert.doesNotMatch(result,/scheduler_|nothing changed/i);
  }
});
test('Error instances and flash-notice strings use the same recovery wording',()=>{
  assert.equal(schedulerErrorMessage(new Error('scheduler_row_scope_refused')),schedulerErrorMessage('scheduler_row_scope_refused'));
});
test('non-containment errors and caller fallbacks retain their useful original wording',()=>{
  assert.equal(schedulerErrorMessage({code:'23505',message:'Lesson 4 already exists.'}),'Lesson 4 already exists.');
  assert.equal(schedulerErrorMessage(new Error('Connection interrupted')),'Connection interrupted');
  assert.equal(schedulerErrorMessage(null,'Insert failed'),'Insert failed');
});
