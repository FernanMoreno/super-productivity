const test = require('node:test');
const assert = require('node:assert/strict');
require('ts-node').register({ transpileOnly: true, preferTsExts: true });
const {
  validateTaskControlArgs: validate,
  taskControlExtraScopes: scopes,
} = require('../shared-with-frontend/assistant-task-control.contract.ts');
const write = (command, extra = {}) => ({
  command,
  taskId: 'task',
  expectedRevision: 'rev',
  operationId: 'operation-1',
  ...extra,
});
test('task command arguments reject irrelevant and raw persisted fields', () => {
  assert.equal(
    validate(
      'task_manage',
      write('update', { fields: { title: '#literal', priority: null, created: 10 } }),
    ),
    undefined,
  );
  assert.ok(
    validate('task_manage', write('update', { fields: { repeatCfgId: 'internal' } })),
  );
  assert.ok(
    validate('task_manage', write('complete', { fields: { title: 'ignored?' } })),
  );
  assert.ok(
    validate('task_manage', { command: 'delete', taskId: 'task', confirm: true }),
  );
  assert.ok(validate('task_manage', write('delete', { confirm: false })));
  assert.equal(validate('task_manage', write('delete', { confirm: true })), undefined);
});
test('schedule and deadline are exclusive and dates are real', () => {
  assert.equal(
    validate('task_manage', write('deadline', { day: '2026-12-16', remindAt: null })),
    undefined,
  );
  assert.ok(validate('task_manage', write('schedule', { day: '2026-02-30' })));
  assert.ok(validate('task_manage', write('schedule', { day: '2026-12-16', at: 100 })));
  assert.ok(validate('task_manage', write('schedule', { at: 100, remindAt: 101 })));
});
test('history, note and capture grants remain independent', () => {
  assert.deepEqual(scopes('task_manage', { command: 'read', location: 'archive' }), [
    'tasks:read_history',
  ]);
  assert.deepEqual(scopes('task_attachment', { command: 'read' }), []);
  assert.deepEqual(scopes('task_attachment', { command: 'read', includeNotes: true }), [
    'tasks:read_notes',
  ]);
  assert.ok(
    scopes('task_manage', { command: 'duplicate' }).includes('tasks:write_notes'),
  );
});
test('attachments accept references without executable or internal options', () => {
  assert.equal(
    validate(
      'task_attachment',
      write('add', { attachment: { type: 'COMMAND', path: 'echo stored only' } }),
    ),
    undefined,
  );
  assert.ok(
    validate(
      'task_attachment',
      write('add', {
        attachment: { type: 'LINK', path: 'https://example.com', execute: true },
      }),
    ),
  );
  assert.ok(validate('task_attachment', write('add', { attachment: { type: 'LINK' } })));
});
