const test = require('node:test');
const assert = require('node:assert/strict');
require('ts-node').register({ transpileOnly: true, preferTsExts: true });
const { CONTROL_TOOLS } = require('./control-tools.ts');
const {
  ASSISTANT_ACCESS_SCOPES,
} = require('../shared-with-frontend/assistant-access.model.ts');
const tool = (name) => CONTROL_TOOLS.find((t) => t.definition.name === name);
const grants = () => [...ASSISTANT_ACCESS_SCOPES];
const reply = async (req) => ({
  status: 200,
  body: { ok: true, data: { status: 'applied', command: req.body.tool } },
});
test('control discovery includes all requested capability families', () => {
  for (const name of [
    'task_timer',
    'task_time',
    'task_notes',
    'task_repeat',
    'project_manage',
    'tag_manage',
    'idle_review',
    'app_settings',
    'app_sync',
    'app_update',
    'control_operation_status',
  ])
    assert(tool(name), name);
});

test('repeat set validates calendar schedules and requires a read revision', async () => {
  const valid = {
    command: 'set',
    taskId: 'task-1',
    cycle: 'weekly',
    every: 2,
    weekdays: ['wed', 'fri'],
    startDay: '2026-10-28',
    expectedRevision: null,
    operationId: 'repeat-operation-1',
  };
  for (const patch of [
    { startDay: '2026-02-30' },
    { startDay: '0001-01-01' },
    { every: 0 },
    { every: 100 },
    { weekdays: [] },
    { weekdays: ['wed', 'wed'] },
    { weekdays: ['bad'] },
    { cycle: 'daily' },
    { cycle: 'Weekly' },
    { expectedRevision: undefined },
    { extra: true },
  ]) {
    const result = await tool('task_repeat').run(
      { ...valid, ...patch },
      grants(),
      () => {
        throw Error('invalid schedule forwarded');
      },
      grants,
    );
    assert.equal(result.isError, true);
    assert.match(result.content[0].text, /INVALID_ARGUMENTS/);
  }
  const result = await tool('task_repeat').run(valid, grants(), reply, grants);
  assert.equal(result.isError, undefined);
  const denied = await tool('task_repeat').run(
    valid,
    ['tasks:read'],
    () => {
      throw Error('denied schedule forwarded');
    },
    () => ['tasks:read'],
  );
  assert.match(denied.content[0].text, /NOT_PERMITTED/);
  for (const cycle of ['daily', 'monthly', 'yearly']) {
    const { weekdays, ...args } = valid;
    assert.equal(
      (await tool('task_repeat').run({ ...args, cycle }, grants(), reply, grants))
        .isError,
      undefined,
    );
  }
});
test('repeat advanced fields, template notes scopes and removal are strict', async () => {
  const {
    validateControlArgs,
    controlScopes,
    isControlMutation,
  } = require('../shared-with-frontend/assistant-control.model.ts');
  const args = {
    command: 'set',
    taskId: 'task',
    cycle: 'monthly',
    startDay: '2026-11-01',
    expectedRevision: null,
    operationId: 'repeat-advanced',
    startTime: '12:00',
    reminder: 'DoNotRemind',
    repeatUntilDay: '2026-12-16',
    monthlyWeekOfMonth: -1,
    monthlyWeekday: 1,
    paused: false,
    template: {
      title: 'Course',
      notes: 'secret',
      subTaskTemplates: [{ title: 'Lesson', notes: 'private' }],
    },
  };
  assert.equal(validateControlArgs('task_repeat', args), undefined);
  assert(controlScopes('task_repeat', args).includes('tasks:write_notes'));
  assert(
    controlScopes('task_repeat', { command: 'read_template', taskId: 'task' }).includes(
      'tasks:read_notes',
    ),
  );
  assert.equal(isControlMutation('task_repeat', { command: 'read_template' }), false);
  for (const patch of [
    { startTime: '24:00' },
    { reminder: 'bad' },
    { repeatUntilDay: '2026-02-30' },
    { repeatUntilDay: '2026-01-01' },
    { monthlyWeekOfMonth: 5 },
    { monthlyLastDay: true },
    { paused: 1 },
    { deletedInstanceDates: ['bad'] },
    { template: { hidden: 1 } },
    { template: { subTaskTemplates: [{ title: 'x', hidden: 1 }] } },
  ])
    assert(
      validateControlArgs('task_repeat', { ...args, ...patch }),
      JSON.stringify(patch),
    );
  assert.equal(
    validateControlArgs('task_repeat', {
      command: 'remove',
      taskId: 'task',
      expectedRevision: 'digest',
      operationId: 'repeat-remove',
    }),
    undefined,
  );
  for (const protectedArgs of [args, { command: 'read_template', taskId: 'task' }]) {
    const result = await tool('task_repeat').run(
      protectedArgs,
      ['tasks:read', 'tasks:write'],
      () => {
        throw Error('notes boundary forwarded');
      },
      () => ['tasks:read', 'tasks:write'],
    );
    assert.match(result.content[0].text, /NOT_PERMITTED/);
  }
});

test('timer writes require independent grant and never forward on denial', async () => {
  let calls = 0;
  const r = await tool('task_timer').run(
    { command: 'start', taskId: 'task-1', operationId: 'operation-123' },
    ['tasks:read'],
    async () => {
      calls++;
      return reply({ body: {} });
    },
    () => ['tasks:read'],
  );
  assert.equal(r.isError, true);
  assert.equal(calls, 0);
});
test('strict validation rejects unknown fields and missing mutation operation id', async () => {
  for (const args of [
    { command: 'pause', unknown: true, operationId: 'operation-123' },
    { command: 'start', taskId: 'task-1' },
  ]) {
    const r = await tool('task_timer').run(
      args,
      grants(),
      () => {
        throw Error('must not forward');
      },
      grants,
    );
    assert.equal(r.isError, true);
  }
});
test('new control commands use authenticated MCP-only internal route', async () => {
  const r = await tool('task_timer').run(
    { command: 'start', taskId: 'task-1', operationId: 'operation-123' },
    grants(),
    async (req) => {
      assert.equal(req.source, 'mcp');
      assert.equal(req.path, '/assistant/control');
      assert.equal(req.body.tool, 'task_timer');
      return reply(req);
    },
    grants,
  );
  assert.equal(r.isError, undefined);
});
test('unavailable mutation outcome is uncertain and never retried', async () => {
  let calls = 0;
  const r = await tool('task_time').run(
    {
      command: 'add',
      taskId: 'task-1',
      date: '2026-10-21',
      duration: 300000,
      operationId: 'operation-123',
    },
    grants(),
    async () => {
      calls++;
      throw Error('timeout');
    },
    grants,
  );
  assert.equal(calls, 1);
  assert.match(r.content[0].text, /OUTCOME_UNKNOWN/);
});
test('revoked note read permission prevents response leakage', async () => {
  const r = await tool('task_notes').run(
    { command: 'read', taskId: 'task-1' },
    grants(),
    async () => ({ status: 200, body: { ok: true, data: { notes: 'private' } } }),
    () => [],
  );
  assert.equal(r.isError, true);
  assert.doesNotMatch(JSON.stringify(r), /private/);
});
test('receipt lookup rechecks original permissions and strips internal grant metadata', async () => {
  const data = {
    status: 'applied',
    settings: { private: true },
    _requiredScopes: ['settings:write'],
  };
  const args = { command: 'status', operationId: 'operation-123' };
  const denied = await tool('control_operation_status').run(
    args,
    grants(),
    async () => ({ status: 200, body: { ok: true, data } }),
    () => ['tasks:read'],
  );
  assert.equal(denied.isError, true);
  assert.doesNotMatch(JSON.stringify(denied), /private/);
  const allowed = await tool('control_operation_status').run(
    args,
    grants(),
    async () => ({ status: 200, body: { ok: true, data } }),
    grants,
  );
  assert.equal(allowed.isError, undefined);
  assert.doesNotMatch(JSON.stringify(allowed), /_requiredScopes/);
});
test('invalid dates, oversized notes and structural entity fields reject', async () => {
  const cases = [
    ['task_time', { command: 'add', date: '2026-02-30', duration: 1, taskId: 'task-1' }],
    ['task_notes', { command: 'write', taskId: 'task-1', notes: 'x'.repeat(8193) }],
    [
      'project_manage',
      { command: 'create', fields: { title: 'test', taskIds: ['task-1'] } },
    ],
  ];
  for (const [name, args] of cases) {
    const r = await tool(name).run(
      { ...args, operationId: 'operation-123' },
      grants(),
      () => {
        throw Error('must not forward');
      },
      grants,
    );
    assert.equal(r.isError, true);
  }
});
test('registry advertises controls only with their base grants', () => {
  const { listGrantedTools } = require('./mcp-tools.ts');
  const names = (scopes) => listGrantedTools(scopes).map((t) => t.name);
  assert(names(grants()).includes('task_timer'));
  assert(!names([]).includes('task_timer'));
  assert(!names([]).includes('control_operation_status'));
  assert(names(['tasks:read']).includes('control_operation_status'));
  assert(!names(['tasks:read']).includes('project_manage'));
});
test('unknown commands reject before forwarding', async () => {
  const r = await tool('app_sync').run(
    { command: 'force_upload', operationId: 'operation-123' },
    grants(),
    () => {
      throw Error('must not forward');
    },
    grants,
  );
  assert.equal(r.isError, true);
  assert.match(r.content[0].text, /INVALID_ARGUMENTS/);
});
test('main rechecks current write grants rather than trusting supplied snapshot', async () => {
  let calls = 0;
  const r = await tool('task_notes').run(
    { command: 'write', taskId: 'task-1', notes: 'text', operationId: 'operation-123' },
    grants(),
    async () => {
      calls++;
      return reply({ body: {} });
    },
    () => ['tasks:read'],
  );
  assert.equal(r.isError, true);
  assert.equal(calls, 0);
});
test('successful mutation outcome survives an in-flight grant revocation', async () => {
  let current = grants();
  const r = await tool('task_timer').run(
    { command: 'pause', operationId: 'operation-123' },
    current,
    async (req) => {
      current = [];
      return reply(req);
    },
    () => current,
  );
  assert.equal(r.isError, undefined);
  assert.equal(r.structuredContent.status, 'applied');
});
test('revoked status read never leaks through family-level mutation metadata', async () => {
  const { runTool } = require('./mcp-tools.ts');
  let current = grants();
  const r = await runTool(
    'task_timer',
    { command: 'status' },
    () => current,
    async () => {
      current = [];
      return { status: 200, body: { ok: true, data: { taskTitle: 'private-task' } } };
    },
  );
  assert.equal(r.isError, true);
  assert.doesNotMatch(JSON.stringify(r), /private-task/);
});
test('control requests carry current main grants and finite response timeout', async () => {
  const current = ['tasks:read'];
  await tool('task_timer').run(
    { command: 'status' },
    grants(),
    async (req) => {
      assert.deepEqual(req.body.grantedScopes, current);
      assert.equal(req.method, 'POST');
      assert.equal(req.timeoutMs, 45000);
      return reply(req);
    },
    () => current,
  );
});
test('oversized control results are rejected instead of leaked or retried', async () => {
  let calls = 0;
  const r = await tool('task_timer').run(
    { command: 'status' },
    grants(),
    async () => {
      calls++;
      return {
        status: 200,
        body: { ok: true, data: { payload: 'x'.repeat(256 * 1024) } },
      };
    },
    grants,
  );
  assert.equal(calls, 1);
  assert.equal(r.isError, true);
  assert.match(r.content[0].text, /RESPONSE_TOO_LARGE/);
  assert(JSON.stringify(r).length < 1024);
});
test('renderer failure projection preserves known code without private message', async () => {
  const r = await tool('task_timer').run(
    { command: 'status' },
    grants(),
    async () => ({
      status: 409,
      body: { ok: false, error: { code: 'CONFLICT', message: 'private-note-secret' } },
    }),
    grants,
  );
  assert.equal(r.isError, true);
  assert.match(r.content[0].text, /CONFLICT/);
  assert.doesNotMatch(JSON.stringify(r), /private-note-secret/);
});
test('unknown renderer failure codes and payloads are not exposed', async () => {
  const r = await tool('app_settings').run(
    { command: 'read' },
    grants(),
    async () => ({
      status: 500,
      body: { ok: false, error: { code: 'private-secret', message: 'private-secret' } },
    }),
    grants,
  );
  assert.equal(r.isError, true);
  assert.match(r.content[0].text, /INTERNAL_ERROR/);
  assert.doesNotMatch(JSON.stringify(r), /private-secret/);
});
test('unknown or malformed mutation replies retain honest uncertain outcome', async () => {
  for (const body of [
    { ok: false, error: { code: 'unexpected-private', message: 'private' } },
    { ok: true, data: null },
  ]) {
    const r = await tool('task_timer').run(
      { command: 'pause', operationId: 'operation-123' },
      grants(),
      async () => ({ status: 200, body }),
      grants,
    );
    assert.equal(r.isError, true);
    assert.match(r.content[0].text, /OUTCOME_UNKNOWN/);
    assert.doesNotMatch(JSON.stringify(r), /private/);
  }
});
test('native runtime error codes retain safe useful identity', async () => {
  for (const code of [
    'STALE_DATA',
    'APP_BUSY',
    'PERSIST_DEGRADED',
    'DATA_UNAVAILABLE',
    'NOTES_TOO_LARGE',
    'INVALID_INPUT',
    'INVALID_TIME',
    'TIME_LIMIT_EXCEEDED',
    'NOT_FOUND',
    'REVIEW_NOT_FROZEN',
    'INVALID_ARGUMENT',
    'BUSY',
  ]) {
    const r = await tool('task_timer').run(
      { command: 'status' },
      grants(),
      async () => ({
        status: 409,
        body: { ok: false, error: { code, message: 'private' } },
      }),
      grants,
    );
    assert.match(r.content[0].text, new RegExp('^' + code + ':'));
    assert.doesNotMatch(JSON.stringify(r), /private/);
  }
});
