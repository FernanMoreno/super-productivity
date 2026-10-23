const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
require('ts-node').register({ transpileOnly: true, preferTsExts: true });
const { listGrantedTools, runTool } = require('./mcp-tools.ts');
const {
  ASSISTANT_ACCESS_SCOPES,
} = require('../shared-with-frontend/assistant-access.model.ts');
const grants = [
  'planner:read',
  'planner:write',
  'tasks:read',
  'tasks:read_history',
  'tasks:write',
  'time:write',
];
const operationId = 'operation-example-001';
const range = { from: '2027-02-01', to: '2027-02-07' };
const data = { status: 'applied', operationId, revision: 'revision-002' };
const reply = async () => ({ status: 200, body: { ok: true, data } });
const names = (scopes) => listGrantedTools(scopes).map((t) => t.name);

test('operation status checks the original action grants before forwarding', async () => {
  assert(names(grants).includes('planner_operation_status'));
  let calls = 0;
  const forward = async (request) => {
    calls++;
    assert.equal(request.body.action, 'operation_status');
    return reply();
  };
  const args = { action: 'log_time', operationId };
  const denied = await runTool(
    'planner_operation_status',
    args,
    () => ['planner:read'],
    forward,
  );
  assert.equal(denied.isError, true);
  assert.equal(calls, 0);
  const allowed = await runTool('planner_operation_status', args, () => grants, forward);
  assert.equal(allowed.isError, undefined);
  assert.equal(calls, 1);
});

test('task scheduling accepts exact native times and explicit recurrence scope', async () => {
  const result = await runTool(
    'planner_task',
    {
      operationId,
      taskId: 'task-example',
      moveScope: 'occurrence',
      fields: { projectId: 'project-example', dueWithTime: 1801472400000 },
    },
    () => grants,
    reply,
  );
  assert.equal(result.isError, undefined);
  const ambiguous = await runTool(
    'planner_task',
    {
      operationId,
      fields: { dueDay: '2027-02-01', dueWithTime: 1801472400000 },
    },
    () => grants,
    reply,
  );
  assert.equal(ambiguous.isError, true);
});

test('operation status hides receipts when the original write grant is revoked during the read', async () => {
  let current = grants;
  const result = await runTool(
    'planner_operation_status',
    { action: 'log_time', operationId },
    () => current,
    async () => {
      current = grants.filter((scope) => scope !== 'time:write');
      return reply();
    },
  );
  assert.equal(result.isError, true);
  assert.match(result.content[0].text, /NOT_PERMITTED/);
});

test('planner permissions remain separate and each required scope gates discovery', () => {
  for (const scope of grants) assert(ASSISTANT_ACCESS_SCOPES.includes(scope));
  assert.deepEqual(names([]), ['get_status']);
  assert(!names(['tasks:capture']).some((n) => n.startsWith('planner_')));
  assert(names(['planner:read']).includes('planner_activities'));
  assert(!names(['planner:read']).includes('planner_query'));
  assert(names(grants).includes('planner_apply'));
  for (const scope of [
    'planner:read',
    'planner:write',
    'tasks:read',
    'tasks:read_history',
  ]) {
    assert(!names(grants.filter((s) => s !== scope)).includes('planner_apply'), scope);
  }
  assert(!names(grants.filter((s) => s !== 'time:write')).includes('planner_log_time'));
  assert(!names(grants.filter((s) => s !== 'tasks:write')).includes('planner_task'));
});

const requests = [
  ['planner_activities', 'activities', {}],
  ['planner_query', 'query', range],
  [
    'planner_edit',
    'edit',
    {
      operationId,
      baseRevision: 'revision-001',
      command: { type: 'activity.create', payload: { name: 'Example' } },
    },
  ],
  [
    'planner_task',
    'task',
    {
      operationId,
      taskId: 'task-example',
      fields: {
        title: 'Example',
        isDone: false,
        timeEstimate: 60000,
        projectId: 'project-example',
        tagIds: ['tag-example'],
        dueDay: '2027-02-01',
      },
    },
  ],
  [
    'planner_log_time',
    'log_time',
    {
      operationId,
      activityId: 'activity-example',
      taskId: 'task-example',
      date: '2027-02-01',
      durationMs: 60000,
    },
  ],
  ['planner_prepare', 'prepare', range],
  [
    'planner_apply',
    'apply',
    { operationId, proposalId: 'proposal-example', selection: ['block-example'] },
  ],
];
for (const [name, action, params] of requests)
  test(`${name} forwards an internal MCP request and preserves structured results`, async () => {
    let request;
    const result = await runTool(
      name,
      params,
      () => grants,
      async (r) => {
        request = r;
        return reply();
      },
    );
    assert.deepEqual(request, {
      method: 'POST',
      path: '/assistant/planner',
      body: { action, params, grantedScopes: grants },
      source: 'mcp',
      timeoutMs: 45000,
    });
    assert.deepEqual(result.structuredContent, data);
  });

test('missing permission rejects calls without reaching the renderer', async () => {
  let called = false;
  const result = await runTool(
    'planner_edit',
    requests[2][2],
    () => ['planner:read'],
    async () => {
      called = true;
      return reply();
    },
  );
  assert.equal(result.isError, true);
  assert.equal(called, false);
});

test('authorization is read again before forwarding; callers cannot supply grants', async () => {
  let calls = 0,
    forwarded = false;
  const result = await runTool(
    'planner_query',
    range,
    () => (++calls === 1 ? grants : []),
    async () => {
      forwarded = true;
      return reply();
    },
  );
  assert.equal(result.isError, true);
  assert.equal(forwarded, false);
  const spoof = await runTool(
    'planner_activities',
    { grantedScopes: grants },
    () => grants,
    reply,
  );
  assert.equal(spoof.isError, true);
});

test('read data is withheld on revocation; mutations already applied keep their result', async () => {
  for (const name of [
    'planner_query',
    'planner_edit',
    'planner_task',
    'planner_log_time',
    'planner_apply',
  ]) {
    let current = grants;
    const params = requests.find((r) => r[0] === name)[2];
    const result = await runTool(
      name,
      params,
      () => current,
      async () => {
        current = [];
        return reply();
      },
    );
    if (name === 'planner_query') assert.equal(result.isError, true);
    else assert.deepEqual(result.structuredContent, data, name);
  }
});

test('strict argument, date, duration, command and selection validation rejects before forwarding', async () => {
  const cases = [
    ['planner_query', { from: '2027-02-30', to: '2027-03-01' }],
    ['planner_query', { from: '2027-02-02', to: '2027-02-01' }],
    ['planner_query', { from: '2027-01-01', to: '2027-04-04' }],
    ['planner_prepare', { ...range, extra: true }],
    ['planner_edit', { ...requests[2][2], operationId: 'x' }],
    [
      'planner_edit',
      { ...requests[2][2], command: { type: 'internal.write', payload: {} } },
    ],
    [
      'planner_edit',
      { ...requests[2][2], command: { type: 'activity.create', payload: [] } },
    ],
    [
      'planner_edit',
      {
        ...requests[2][2],
        command: { type: 'activity.create', payload: { name: 'x'.repeat(70000) } },
      },
    ],
    ['planner_task', { operationId, fields: { timeSpent: 60000 } }],
    ['planner_task', { operationId, fields: { title: '' } }],
    ['planner_task', { operationId, fields: { isDone: 'yes' } }],
    ['planner_task', { operationId, fields: { tagIds: ['tag', 'tag'] } }],
    ['planner_log_time', { ...requests[4][2], durationMs: 0 }],
    ['planner_log_time', { ...requests[4][2], durationMs: 86400001 }],
    ['planner_apply', { operationId, proposalId: 'proposal', selection: ['a', 'a'] }],
    ['planner_apply', { operationId, proposalId: 'proposal', selection: [] }],
  ];
  for (const [name, args] of cases) {
    let forwarded = false;
    const result = await runTool(
      name,
      args,
      () => grants,
      async () => {
        forwarded = true;
        return reply();
      },
    );
    assert.equal(result.isError, true, JSON.stringify(args));
    assert.equal(forwarded, false);
  }
});

test('93 inclusive days are accepted and all semantic result states survive', async () => {
  for (const status of ['applied', 'rejected', 'conflict', 'uncertain']) {
    const result = await runTool(
      'planner_prepare',
      { from: '2027-01-01', to: '2027-04-03' },
      () => grants,
      async () => ({
        status: 200,
        body: { ok: true, data: { status, code: 'EXAMPLE' } },
      }),
    );
    assert.equal(result.structuredContent.status, status);
  }
});

test('transport failures for writes report uncertain outcomes and large reads are capped', async () => {
  const result = await runTool(
    'planner_edit',
    requests[2][2],
    () => grants,
    async () => {
      throw Error('timeout');
    },
  );
  assert.equal(result.isError, true);
  assert.match(result.content[0].text, /OUTCOME_UNKNOWN/);
  const large = await runTool(
    'planner_query',
    range,
    () => grants,
    async () => ({
      status: 200,
      body: { ok: true, data: { values: 'x'.repeat(300000) } },
    }),
  );
  assert.equal(large.isError, true);
  assert.match(large.content[0].text, /RESPONSE_TOO_LARGE/);
});

test('main-owned grants start disabled and normalize new permissions independently of legacy capture', () => {
  const Module = require('node:module');
  const load = Module._load;
  let access;
  try {
    Module._load = function (request, parent, ...rest) {
      if (request === 'electron') return { app: {}, ipcMain: {} };
      if (request === 'electron-log/main') return { warn() {} };
      if (
        parent?.filename.endsWith(path.join('mcp', 'assistant-access.ts')) &&
        request === '../simple-store'
      )
        return {};
      if (
        parent?.filename.endsWith(path.join('mcp', 'assistant-access.ts')) &&
        request === '../secure-file'
      )
        return {};
      return load.call(this, request, parent, ...rest);
    };
    access = require('./assistant-access.ts');
  } finally {
    Module._load = load;
  }
  assert.equal(access.isAssistantAccessEnabled(), false);
  assert.deepEqual(access.getAssistantAccessScopes(), []);
  assert.deepEqual(
    access.normalizeScopes([
      'planner:write',
      'time:write',
      'tasks:read_notes',
      'tasks:capture',
      'unknown',
    ]),
    ['tasks:capture', 'planner:write', 'time:write'],
  );
  assert.deepEqual(access.normalizeScopes(grants), [
    'tasks:read',
    'planner:read',
    'planner:write',
    'tasks:read_history',
    'tasks:write',
    'time:write',
  ]);
});

test('HTTP MCP discovery and planner calls enforce the main-owned grant and credential', async () => {
  const Module = require('node:module');
  const http = require('node:http');
  const load = Module._load;
  let current = [...grants],
    enabled = true,
    handleMcpHttpRequest;
  try {
    Module._load = function (request, parent, ...rest) {
      if (
        parent?.filename.endsWith(path.join('mcp', 'mcp-http.ts')) &&
        request === './assistant-access'
      )
        return {
          getAssistantAccessScopes: () => (enabled ? current : []),
          isAssistantAccessEnabled: () => enabled,
          verifyAssistantCredential: (value) => enabled && value === 'example-mcp-key',
        };
      return load.call(this, request, parent, ...rest);
    };
    ({ handleMcpHttpRequest } = require('./mcp-http.ts'));
  } finally {
    Module._load = load;
  }
  let forwarded;
  const server = http.createServer(
    (req, res) =>
      void handleMcpHttpRequest(req, res, {
        isAllowedHost: (host) => host?.startsWith('127.0.0.1:'),
        isAtConcurrencyLimit: () => false,
        parseBearerToken: (header) =>
          header?.startsWith('Bearer ') ? header.slice(7) : undefined,
        serverVersion: 'development',
        forward: async (request) => {
          forwarded = request;
          return reply();
        },
      }),
  );
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const post = (message, key = 'example-mcp-key') =>
    new Promise((resolve, reject) => {
      const req = http.request(
        {
          host: '127.0.0.1',
          port: server.address().port,
          path: '/mcp',
          method: 'POST',
          headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
        },
        (res) => {
          let body = '';
          res.on('data', (chunk) => (body += chunk));
          res.on('end', () =>
            resolve({ status: res.statusCode, body: JSON.parse(body) }),
          );
        },
      );
      req.on('error', reject);
      req.end(JSON.stringify(message));
    });
  try {
    let response = await post({ jsonrpc: '2.0', id: 1, method: 'tools/list' });
    assert(response.body.result.tools.some((t) => t.name === 'planner_apply'));
    response = await post({
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/call',
      params: { name: 'planner_query', arguments: range },
    });
    assert.equal(response.body.result.structuredContent.status, 'applied');
    assert.equal(forwarded.source, 'mcp');
    current = ['tasks:capture'];
    forwarded = null;
    response = await post({
      jsonrpc: '2.0',
      id: 3,
      method: 'tools/call',
      params: { name: 'planner_apply', arguments: requests[6][2] },
    });
    assert(response.body.error);
    assert.equal(forwarded, null);
    response = await post(
      { jsonrpc: '2.0', id: 4, method: 'tools/list' },
      'example-rest-token',
    );
    assert.equal(response.status, 401);
    enabled = false;
    response = await post({ jsonrpc: '2.0', id: 5, method: 'tools/list' });
    assert.equal(response.status, 503);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('renderer permission revocation remains a fixed NOT_PERMITTED error', async () => {
  const result = await runTool(
    'planner_activities',
    {},
    () => grants,
    async () => ({
      status: 403,
      body: {
        ok: false,
        error: { code: 'NOT_PERMITTED', message: 'private detail must never escape' },
      },
    }),
  );
  assert.equal(result.isError, true);
  assert.match(result.content[0].text, /^NOT_PERMITTED:/);
  assert.doesNotMatch(JSON.stringify(result), /private detail/);
});

const workbenchRequests = [
  [
    'planner_next',
    'next',
    { date: range.from, availableMinutes: 25, contextAreaId: null, limit: 3 },
  ],
  ['planner_review', 'review', range],
  [
    'planner_review_advance',
    'review_advance',
    {
      operationId,
      expectedRevision: 'a'.repeat(64),
      command: 'preferences',
      preferences: { contextAreaId: null, availableMinutes: 25 },
    },
  ],
  [
    'planner_correct_time',
    'correct_time',
    {
      operationId,
      activityId: 'area-example',
      taskId: 'task-example',
      date: range.from,
      durationMs: 0,
      expectedDurationMs: 60000,
    },
  ],
  [
    'planner_proposal_adjust',
    'proposal_adjust',
    {
      proposalId: 'proposal-example',
      changes: [{ itemId: 'change-example', start: 1801472400000, end: 1801476000000 }],
    },
  ],
  ['planner_reorganizations', 'history', { limit: 20 }],
  [
    'planner_prepare_undo',
    'prepare_undo',
    { historyId: 'operation-example-001', selection: ['change-example'] },
  ],
];
for (const [name, action, args] of workbenchRequests) {
  test(`${name} validates and forwards its shared host operation without aliases`, async () => {
    let calls = 0;
    const result = await runTool(
      name,
      args,
      () => grants,
      async (request) => {
        calls++;
        assert.equal(request.path, '/assistant/planner');
        assert.equal(request.source, 'mcp');
        assert.equal(request.body.action, action);
        assert.deepEqual(request.body.params, args);
        assert.deepEqual(request.body.grantedScopes, grants);
        return reply();
      },
    );
    assert.equal(calls, 1);
    assert.equal(result.isError, undefined);
  });
}

test('workbench and history discovery remain read-only without write capabilities', () => {
  const readonly = names(['planner:read', 'tasks:read', 'tasks:read_history']);
  for (const name of [
    'planner_next',
    'planner_review',
    'planner_proposal_adjust',
    'planner_reorganizations',
    'planner_prepare_undo',
  ])
    assert(readonly.includes(name), name);
  assert(!readonly.includes('planner_review_advance'));
  assert(!readonly.includes('planner_correct_time'));
  assert(
    !names(grants.filter((scope) => scope !== 'tasks:read_history')).includes(
      'planner_next',
    ),
  );
});

test('corrected-time and review-advance receipts require their original scopes before and after reading', async () => {
  for (const [action, scope] of [
    ['correct_time', 'time:write'],
    ['review_advance', 'planner:write'],
  ]) {
    let calls = 0;
    const denied = await runTool(
      'planner_operation_status',
      { operationId, action },
      () => grants.filter((s) => s !== scope),
      async () => {
        calls++;
        return reply();
      },
    );
    assert.equal(denied.isError, true);
    assert.equal(calls, 0);
    let current = grants;
    const revoked = await runTool(
      'planner_operation_status',
      { operationId, action },
      () => current,
      async () => {
        current = grants.filter((s) => s !== scope);
        return reply();
      },
    );
    assert.equal(revoked.isError, true);
    assert.match(revoked.content[0].text, /NOT_PERMITTED/);
  }
});

test('workbench mutation transport failures remain uncertain while recommendation reads are unavailable', async () => {
  for (const [name, , args] of workbenchRequests) {
    const response = await runTool(
      name,
      args,
      () => grants,
      async () => {
        throw Error('connection closed');
      },
    );
    assert.equal(response.isError, true);
    const mutates = ['planner_review_advance', 'planner_correct_time'].includes(name);
    assert.match(
      response.content[0].text,
      mutates ? /OUTCOME_UNKNOWN/ : /APP_UNAVAILABLE/,
    );
  }
});

test('new tools reject unsupported fields, invalid corrections and forged proposal expectations before forwarding', async () => {
  let calls = 0;
  const invalidRequests = [
    ['planner_next', { availableMinutes: 0 }],
    ['planner_next', { limit: 4 }],
    ['planner_next', { contextAreaId: '../forged' }],
    ['planner_review', { ...range, to: '2027-02-31' }],
    ['planner_review_advance', { operationId, expectedRevision: 'x', command: 'finish' }],
    [
      'planner_review_advance',
      {
        operationId,
        expectedRevision: 'x',
        command: 'preferences',
        preferences: { token: 'forged' },
      },
    ],
    [
      'planner_correct_time',
      {
        operationId,
        activityId: 'area-example',
        taskId: 'task-example',
        date: range.from,
        durationMs: 0,
      },
    ],
    [
      'planner_correct_time',
      {
        operationId,
        activityId: 'area-example',
        taskId: 'task-example',
        date: range.from,
        durationMs: -1,
        expectedDurationMs: 0,
      },
    ],
    [
      'planner_correct_time',
      {
        operationId,
        activityId: 'area-example',
        taskId: 'task-example',
        date: range.from,
        durationMs: 0,
        expectedDurationMs: 86400001,
      },
    ],
    [
      'planner_proposal_adjust',
      {
        proposalId: 'proposal-example',
        changes: [{ itemId: 'item-example', start: 10, end: 5 }],
      },
    ],
    [
      'planner_proposal_adjust',
      {
        proposalId: 'proposal-example',
        changes: [{ itemId: 'item-example', start: 10, expected: { taskId: 'forged' } }],
      },
    ],
    [
      'planner_proposal_adjust',
      {
        proposalId: 'proposal-example',
        changes: [
          { itemId: 'item-example', start: 10 },
          { itemId: 'item-example', start: 20 },
        ],
      },
    ],
    ['planner_reorganizations', { limit: 101 }],
    [
      'planner_prepare_undo',
      { historyId: 'history-example', selection: ['item-example', 'item-example'] },
    ],
  ];
  for (const [name, args] of invalidRequests) {
    const result = await runTool(
      name,
      args,
      () => grants,
      async () => {
        calls++;
        return reply();
      },
    );
    assert.equal(result.isError, true, name + JSON.stringify(args));
    assert.match(result.content[0].text, /INVALID_ARGUMENTS/);
  }
  assert.equal(calls, 0);
});

test('explicit native split and archive commands preserve stable operation ids and reject mixed task fields', async () => {
  for (const args of [
    {
      operationId,
      taskId: 'task-example',
      command: 'split',
      children: [
        { title: 'First fictitious step', timeEstimate: 60000 },
        { title: 'Second fictitious step' },
      ],
    },
    {
      operationId,
      taskId: 'task-example',
      command: 'archive',
      expected: { isDone: false },
    },
  ]) {
    const result = await runTool(
      'planner_task',
      args,
      () => grants,
      async (request) => {
        assert.deepEqual(request.body.params, args);
        return reply();
      },
    );
    assert.equal(result.isError, undefined);
  }
  let calls = 0;
  for (const args of [
    { operationId, command: 'archive' },
    { operationId, taskId: 'task-example', command: 'archive', fields: { isDone: true } },
    { operationId, taskId: 'task-example', command: 'archive', children: [] },
    {
      operationId,
      taskId: 'task-example',
      command: 'split',
      children: [{ title: 'Only child' }],
    },
    {
      operationId,
      taskId: 'task-example',
      command: 'split',
      children: [{ title: 'First', projectId: 'forged' }, { title: 'Second' }],
    },
    {
      operationId,
      taskId: 'task-example',
      command: 'split',
      children: [{ title: 'First', timeEstimate: -1 }, { title: 'Second' }],
    },
    {
      operationId,
      taskId: 'task-example',
      command: 'archive',
      expected: { timeSpentOnDay: {} },
    },
    {
      operationId,
      taskId: 'task-example',
      command: 'archive',
      allowSeriesTemplateUpdate: true,
    },
  ]) {
    const result = await runTool(
      'planner_task',
      args,
      () => grants,
      async () => {
        calls++;
        return reply();
      },
    );
    assert.equal(result.isError, true);
  }
  assert.equal(calls, 0);
});
