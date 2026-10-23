import test from 'node:test';
import assert from 'node:assert/strict';
import { createWorkflowOperations, workflowAction } from '../workflow-operations.mjs';

test('Trello list movement uses the remote-write grant and receipt family', () => {
  assert.equal(workflowAction({ type: 'integration.move' }), 'workflow_issue_write');
});

test('an uncertain Trello move is never dispatched again after a restart', async () => {
  const f = fixture();
  let writes = 0;
  f.ports.integrationCommand = async (_command, options) => {
    await options.beforeMutation();
    writes++;
    throw Object.assign(new Error('verification failed'), { code: 'UNCERTAIN' });
  };
  const q = await f.api.query({ view: 'board' });
  const args = {
    operationId: 'trello-move-uncertain-001',
    baseRevision: q.revision,
    nativeRevision: q.nativeRevision,
    command: {
      type: 'integration.move',
      payload: {
        taskId: 'one',
        targetListId: 'list-b',
        expectedListId: 'list-a',
        expectedBoardId: 'board-a',
      },
    },
  };
  assert.equal((await f.api.command(args)).status, 'uncertain');
  assert.equal(
    (await createWorkflowOperations(f.ports).command(args)).status,
    'uncertain',
  );
  assert.equal(writes, 1);
  const receipt = await f.api.query({ view: 'receipt', operationId: args.operationId });
  assert.equal(receipt.requiredAction, 'workflow_issue_write');
});

function fixture() {
  const data = new Map();
  let allowed = true,
    nativeRevision = 'native-1',
    calls = 0,
    fail = false;
  const ports = {
    read: async (k) => data.get(k) ?? null,
    cas: async (k, old, next, guard) => {
      guard?.();
      if ((data.get(k) ?? null) !== old) return false;
      data.set(k, next);
      return true;
    },
    authorize: async () => {
      if (!allowed) throw Object.assign(new Error('Denied'), { code: 'NOT_PERMITTED' });
    },
    snapshot: async () => ({
      tasks: [
        { id: 'one', title: 'One', isDone: false, subTaskIds: [], timeEstimate: 60000 },
      ],
      projects: [{ id: 'project', title: 'P' }],
      today: '2026-10-22',
      nativeRevision,
      weekRevision: 'week-1',
      assertCurrent() {
        if (nativeRevision !== 'native-1')
          throw Object.assign(new Error('Stale'), { code: 'STALE_DATA' });
      },
    }),
    native: async () => {
      calls++;
      if (fail) throw new Error('Disconnected after dispatch');
    },
    integrations: async () => ({ providers: [] }),
  };
  const api = createWorkflowOperations(ports);
  return {
    api,
    data,
    ports,
    set allowed(v) {
      allowed = v;
    },
    set stale(v) {
      nativeRevision = v;
    },
    set fail(v) {
      fail = v;
    },
    get calls() {
      return calls;
    },
  };
}
const command = (q, payload = { taskId: 'one', column: 'done' }) => ({
  operationId: 'workflow-test-001',
  baseRevision: q.revision,
  nativeRevision: q.nativeRevision,
  command: { type: 'task.move', payload },
});
test('workflow pending journal is durable before native work, confirmed retry replays across coordinators', async () => {
  const f = fixture(),
    q = await f.api.query({ view: 'board' });
  const args = command(q);
  const first = await f.api.command(args);
  assert.equal(first.status, 'applied');
  assert.equal(f.calls, 1);
  const replay = await createWorkflowOperations(f.ports).command(args);
  assert.equal(replay.replayed, true);
  assert.equal(f.calls, 1);
  assert.equal(
    (
      await f.api.command({
        ...args,
        command: { type: 'task.move', payload: { taskId: 'one', column: 'ready' } },
      })
    ).code,
    'OPERATION_ID_REUSED',
  );
});
test('uncertain native operation stays pending and is never executed twice', async () => {
  const f = fixture(),
    q = await f.api.query({ view: 'board' });
  f.fail = true;
  assert.equal((await f.api.command(command(q))).status, 'uncertain');
  assert.equal((await f.api.command(command(q))).status, 'uncertain');
  assert.equal(f.calls, 1);
  assert.equal(
    (await f.api.query({ view: 'receipt', operationId: 'workflow-test-001' })).status,
    'uncertain',
  );
});
test('stale snapshots and revoked permissions cannot mutate native data', async () => {
  const f = fixture(),
    q = await f.api.query({ view: 'board' });
  f.stale = 'changed';
  assert.equal((await f.api.command(command(q))).code, 'STALE_DATA');
  assert.equal(f.calls, 0);
  f.allowed = false;
  await assert.rejects(f.api.query({ view: 'board' }), (e) => e.code === 'NOT_PERMITTED');
});
test('receipt includes original scope family and cannot leak when original authorization is revoked', async () => {
  const f = fixture(),
    q = await f.api.query({ view: 'board' });
  await f.api.command(command(q));
  const receipt = await f.api.query({
    view: 'receipt',
    operationId: 'workflow-test-001',
  });
  assert.equal(receipt.status, 'applied');
  assert.equal(receipt.requiredAction, 'workflow_command');
  f.allowed = false;
  await assert.rejects(
    f.api.query({ view: 'receipt', operationId: 'workflow-test-001' }),
    (e) => e.code === 'NOT_PERMITTED',
  );
});

test('project board CAS commands survive restart and replay without native dispatch', async () => {
  const f = fixture();
  const initial = await f.api.query({ view: 'board', projectId: 'project' });
  const args = {
    operationId: 'board-column-operation-001',
    baseRevision: initial.revision,
    nativeRevision: initial.nativeRevision,
    command: {
      type: 'board.column.save',
      payload: {
        projectId: 'project',
        column: { id: 'study', title: 'Study', status: 'ready' },
      },
    },
  };
  assert.equal((await f.api.command(args)).status, 'applied');
  const restarted = createWorkflowOperations(f.ports);
  assert.equal((await restarted.command(args)).replayed, true);
  const board = await restarted.query({ view: 'board', projectId: 'project' });
  assert.equal(board.columns.at(-1).id, 'study');
  assert.equal(f.calls, 0);
  const stale = await restarted.command({
    ...args,
    operationId: 'board-column-operation-002',
  });
  assert.equal(stale.code, 'STALE_DATA');
  assert.equal(
    (await restarted.query({ view: 'board', projectId: 'project' })).columns.length,
    6,
  );
});
