const test = require('node:test');
const assert = require('node:assert/strict');
require('ts-node').register({ transpileOnly: true, preferTsExts: true });
const { runTool, listGrantedTools } = require('./mcp-tools.ts');
const grants = ['planner:read', 'tasks:read', 'planner:write', 'tasks:write'];
const args = {
  operationId: 'workflow-test-001',
  baseRevision: 'revision',
  nativeRevision: 'native',
  command: { type: 'task.move', payload: { taskId: 'one', column: 'ready' } },
};
const reply = (data) => ({ status: 200, body: { ok: true, data } });
test('workflow discovery documents required payload fields for every command', () => {
  const schema = listGrantedTools(grants).find((t) => t.name === 'workflow_command')
    .inputSchema.properties.command;
  assert.equal(schema.oneOf.length, 22);
  const template = schema.oneOf.find(
    (branch) => branch.properties.type.const === 'template.apply',
  );
  assert.deepEqual(template.properties.payload.required, ['templateId', 'projectId']);
});
test('Trello list movement requires a current list/board snapshot and issue write grants', async () => {
  const command = {
    type: 'integration.move',
    payload: {
      taskId: 'one',
      targetListId: 'list-b',
      expectedListId: 'list-a',
      expectedBoardId: 'board-a',
    },
  };
  let calls = 0;
  const forward = async () => {
    calls++;
    return reply({ status: 'applied' });
  };
  for (const scopes of [grants, [...grants, 'issues:read']])
    assert(
      (await runTool('workflow_command', { ...args, command }, () => scopes, forward))
        .isError,
    );
  assert.equal(calls, 0);
  const scopes = [...grants, 'issues:read', 'issues:write'];
  assert(
    !(await runTool('workflow_command', { ...args, command }, () => scopes, forward))
      .isError,
  );
  assert.equal(calls, 1);
  for (const key of ['targetListId', 'expectedListId', 'expectedBoardId']) {
    const payload = { ...command.payload };
    delete payload[key];
    assert(
      (
        await runTool(
          'workflow_command',
          { ...args, command: { ...command, payload } },
          () => scopes,
          forward,
        )
      ).isError,
    );
  }
  assert.equal(calls, 1);
});
test('workflow tools discover independently of task history and enforce integration scopes', async () => {
  assert(listGrantedTools(grants).some((t) => t.name === 'workflow_query'));
  let calls = 0;
  const forward = async () => {
    calls++;
    return reply({ status: 'applied' });
  };
  assert(!(await runTool('workflow_command', args, () => grants, forward)).isError);
  const denied = await runTool(
    'workflow_command',
    {
      ...args,
      command: {
        type: 'integration.sync',
        payload: { taskId: 'one', targetStatus: 'closed' },
      },
    },
    () => grants,
    forward,
  );
  assert(denied.isError);
  assert.equal(calls, 1);
});
test('workflow queries reject unknown args and revoked read permissions after await', async () => {
  let scopes = grants,
    calls = 0;
  const forward = async () => {
    calls++;
    scopes = [];
    return reply({ cards: [] });
  };
  assert(
    (
      await runTool(
        'workflow_query',
        { view: 'board', unsafe: true },
        () => scopes,
        forward,
      )
    ).isError,
  );
  assert.equal(calls, 0);
  assert(
    (await runTool('workflow_query', { view: 'board' }, () => scopes, forward)).isError,
  );
  assert.equal(calls, 1);
});
test('workflow receipt validates original permissions and strips internal grant metadata', async () => {
  const forward = async () =>
    reply({ status: 'applied', _requiredScopes: [...grants, 'issues:write'] });
  assert(
    (
      await runTool(
        'workflow_query',
        { view: 'receipt', operationId: args.operationId },
        () => grants,
        forward,
      )
    ).isError,
  );
  const okay = await runTool(
    'workflow_query',
    { view: 'receipt', operationId: args.operationId },
    () => [...grants, 'issues:write'],
    forward,
  );
  assert(!okay.isError);
  assert(!okay.content[0].text.includes('_requiredScopes'));
});

test('project board discovery exposes bounded columns and compatible legacy moves', () => {
  const branches = listGrantedTools(grants).find((t) => t.name === 'workflow_command')
    .inputSchema.properties.command.oneOf;
  const payload = (type) =>
    branches.find((b) => b.properties.type.const === type).properties.payload;
  assert.deepEqual(payload('task.move').required, ['taskId', 'column']);
  assert.equal(payload('task.move').properties.columnId.maxLength, 200);
  assert.deepEqual(payload('board.configure').required, ['wipLimit']);
  assert.deepEqual(payload('board.column.remove').required, ['projectId', 'columnId']);
  assert.deepEqual(
    payload('board.column.save').properties.column.properties.status.enum,
    ['inbox', 'ready', 'in_progress', 'blocked', 'done'],
  );
  assert.equal(payload('board.column.reorder').properties.columnIds.uniqueItems, true);
});
