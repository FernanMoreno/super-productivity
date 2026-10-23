const test = require('node:test');
const assert = require('node:assert/strict');
require('ts-node').register({ transpileOnly: true, preferTsExts: true });
const { ControlOperationJournal } = require('./control-operation-journal.ts');
const args = {
  command: 'add',
  operationId: 'operation-123',
  taskId: 'task-1',
  duration: 500,
  date: '2026-10-21',
};
const setup = () => {
  const values = new Map();
  const storage = {
    getItem: (k) => values.get(k) ?? null,
    setItem: (k, v) => values.set(k, v),
  };
  let writes = 0;
  const mutate = async (mark) => {
    mark();
    writes++;
    return { taskId: 'task-1' };
  };
  return {
    values,
    storage,
    mutate,
    count: () => writes,
    journal: new ControlOperationJournal(storage),
  };
};
const auth = async () => {};
const flush = async () => {};
test('same operation applies once across journal instances/restart', async () => {
  const h = setup();
  await h.journal.execute('task_time', args, ['time:write'], h.mutate, auth, flush);
  await new ControlOperationJournal(h.storage).execute(
    'task_time',
    args,
    ['time:write'],
    h.mutate,
    auth,
    flush,
  );
  assert.equal(h.count(), 1);
});
test('operation id cannot be reused with changed data', async () => {
  const h = setup();
  await h.journal.execute('task_time', args, [], h.mutate, auth, flush);
  await assert.rejects(
    h.journal.execute('task_time', { ...args, duration: 900 }, [], h.mutate, auth, flush),
    { code: 'OPERATION_CONFLICT' },
  );
  assert.equal(h.count(), 1);
});
test('failed persistence after mutation leaves pending and forbids retry', async () => {
  const h = setup();
  await assert.rejects(
    h.journal.execute('task_time', args, [], h.mutate, auth, async () => {
      throw Error('disk');
    }),
    { code: 'OUTCOME_UNKNOWN' },
  );
  await assert.rejects(h.journal.execute('task_time', args, [], h.mutate, auth, flush), {
    code: 'OUTCOME_UNKNOWN',
  });
  assert.equal(h.count(), 1);
});
test('receipt lookup needs original scopes', async () => {
  const h = setup();
  await h.journal.execute('task_time', args, ['time:write'], h.mutate, auth, flush);
  await assert.rejects(h.journal.status(args.operationId, []), { code: 'NOT_PERMITTED' });
  assert.equal(
    (await h.journal.status(args.operationId, ['time:write'])).status,
    'applied',
  );
});
test('journal storage failure blocks mutation before native call', async () => {
  const h = setup();
  const broken = new ControlOperationJournal({
    getItem: () => null,
    setItem: () => {
      throw Error('quota');
    },
  });
  await assert.rejects(broken.execute('task_time', args, [], h.mutate, auth, flush), {
    code: 'PERSIST_DEGRADED',
  });
  assert.equal(h.count(), 0);
});
test('simultaneous duplicate commands serialize and apply once', async () => {
  const h = setup();
  await Promise.all([
    h.journal.execute('task_time', args, [], h.mutate, auth, flush),
    h.journal.execute('task_time', args, [], h.mutate, auth, flush),
  ]);
  assert.equal(h.count(), 1);
});
