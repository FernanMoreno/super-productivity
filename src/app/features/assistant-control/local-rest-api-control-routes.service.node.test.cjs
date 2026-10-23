const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { webcrypto } = require('node:crypto');
const ts = require('typescript');

// Execute the actual route, schemas, journal and response builders. Only native
// framework/services are substituted; receipts and permission checks stay real.
const harness = () => {
  const values = new Map();
  const state = {
    isEnabled: true,
    scopes: [
      'tasks:read',
      'tasks:read_notes',
      'tasks:write_notes',
      'time:write',
      'timer:write',
    ],
    syncing: false,
    persistFailure: false,
    flushFailure: false,
    writes: 0,
    flushes: 0,
    calls: 0,
  };
  const storage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
  };
  const cache = new Map();
  let serviceRun = async (_tool, _args, context) => {
    await context.authorize();
    context.markMutation();
    state.writes++;
    return { taskId: 'task' };
  };
  const native = {
    run: (...args) => {
      state.calls++;
      return serviceRun(...args);
    },
  };
  const injector = { get: () => native };
  const hydration = { isInSyncWindow: () => state.syncing };
  const framework = {
    '@angular/core': {
      Injectable: () => (type) => type,
      Injector: 'Injector',
      inject: (token) => (token === 'Injector' ? injector : hydration),
    },
  };
  const load = (filename) => {
    if (cache.has(filename)) return cache.get(filename);
    const exports = {};
    cache.set(filename, exports);
    const source = fs.readFileSync(filename, 'utf8');
    const code = ts.transpileModule(source, {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
        experimentalDecorators: true,
      },
    }).outputText;
    const requireModule = (name) => {
      if (framework[name]) return framework[name];
      if (name.endsWith('hydration-state.service'))
        return { HydrationStateService: 'Hydration' };
      if (name.endsWith('assistant-native-control.service'))
        return { AssistantNativeControlService: 'Native' };
      if (name.endsWith('assistant-system-control.service'))
        return { AssistantSystemControlService: 'System' };
      if (name.endsWith('plugin-persistence-api'))
        return {
          assertPluginWritesHealthy: () => {
            if (state.persistFailure) throw new Error('persistent failure');
          },
          flushPluginWrites: async () => {
            state.flushes++;
            if (state.flushFailure) throw new Error('disk failure');
          },
        };
      if (
        name.endsWith('assistant-control.model') ||
        name.endsWith('control-operation-journal') ||
        name.endsWith('local-rest-api-response')
      ) {
        return load(path.resolve(path.dirname(filename), name + '.ts'));
      }
      throw new Error(`Unexpected runtime dependency: ${name}`);
    };
    vm.runInNewContext(
      code,
      {
        exports,
        require: requireModule,
        localStorage: storage,
        window: {
          ea: {
            getAssistantAccessState: async () => ({
              isEnabled: state.isEnabled,
              scopes: [...state.scopes],
            }),
          },
        },
        crypto: webcrypto,
        TextEncoder,
        Object,
        Number,
        Date,
        Set,
        Error,
      },
      { filename },
    );
    return exports;
  };
  const { LocalRestApiControlRoutesService } = load(
    path.join(__dirname, 'local-rest-api-control-routes.service.ts'),
  );
  const contract = load(
    path.resolve(
      __dirname,
      '../../../../electron/shared-with-frontend/assistant-control.model.ts',
    ),
  );
  const createRoute = () => new LocalRestApiControlRoutesService();
  const route = createRoute();
  const request = (tool, args, scopes = state.scopes) => ({
    requestId: 'request',
    method: 'POST',
    path: '/assistant/control',
    source: 'mcp',
    body: { tool, args, grantedScopes: [...scopes] },
  });
  const write = (operationId = 'operation-123') =>
    request('task_time', {
      command: 'add',
      taskId: 'task',
      date: '2026-10-20',
      duration: 1000,
      operationId,
    });
  return {
    route,
    createRoute,
    request,
    write,
    state,
    values,
    contract,
    setRun: (run) => {
      serviceRun = run;
    },
  };
};

test('only authenticated MCP POST source reaches the control route', async () => {
  const h = harness();
  for (const changes of [
    { source: undefined },
    { source: 'rest' },
    { method: 'GET' },
    { path: '/unrelated' },
  ]) {
    assert.equal(await h.route.handle({ ...h.write(), ...changes }), undefined);
  }
  assert.equal(h.state.calls, 0);
});

test('unknown body fields and schema-inconsistent arguments reject before dispatch', async () => {
  const h = harness();
  const unknown = h.write();
  unknown.body.extra = true;
  assert.equal((await h.route.handle(unknown)).status, 400);
  const invalid = h.request('task_time', {
    command: 'add',
    operationId: 'operation-123',
    taskId: 'task',
    date: '2026-02-30',
    duration: 1000,
  });
  assert.equal((await h.route.handle(invalid)).body.error.code, 'INVALID_ARGUMENTS');
  assert.equal(h.state.calls, 0);
});

test('a forged forwarded write grant cannot exceed current device grants', async () => {
  const h = harness();
  h.state.scopes = ['tasks:read'];
  const result = await h.route.handle(h.write());
  assert.equal(result.body.error.code, 'NOT_PERMITTED');
  const forged = await h.route.handle(
    h.request('task_time', h.write().body.args, ['tasks:read', 'time:write']),
  );
  assert.equal(forged.body.error.code, 'NOT_PERMITTED');
  assert.equal(h.state.calls, 0);
});

test('notes read is redacted if its current read grant disappears during execution', async () => {
  const h = harness();
  const request = h.request('task_notes', { command: 'read', taskId: 'task' });
  h.setRun(async () => {
    h.state.scopes = ['tasks:read'];
    return { notes: 'private notes' };
  });
  const result = await h.route.handle(request);
  assert.equal(result.body.error.code, 'NOT_PERMITTED');
  assert.equal(JSON.stringify(result).includes('private notes'), false);
});

test('same write operation applies once across route service restart', async () => {
  const h = harness();
  const first = await h.route.handle(h.write());
  const second = await h.createRoute().handle(h.write());
  assert.equal(first.body.data.status, 'applied');
  assert.equal(second.body.data.operationId, 'operation-123');
  assert.equal(h.state.writes, 1);
  assert.equal(h.state.calls, 1);
  assert.equal(h.state.flushes, 1);
});

test('receipt reads retain original command grants and metadata for the main gate', async () => {
  const h = harness();
  await h.route.handle(h.write());
  h.state.scopes = ['tasks:read'];
  const denied = await h.route.handle(
    h.request('control_operation_status', {
      command: 'status',
      operationId: 'operation-123',
    }),
  );
  assert.equal(denied.body.error.code, 'NOT_PERMITTED');
  h.state.scopes.push('time:write');
  const allowed = await h.route.handle(
    h.request('control_operation_status', {
      command: 'status',
      operationId: 'operation-123',
    }),
  );
  assert.equal(allowed.body.data._requiredScopes.includes('time:write'), true);
  assert.equal(allowed.body.data.operationId, 'operation-123');
});

test('the final mutation fence rejects a sync window opened after authorization', async () => {
  const h = harness();
  h.setRun(async (_tool, _args, context) => {
    await context.authorize();
    h.state.syncing = true;
    context.markMutation();
    h.state.writes++;
    return {};
  });
  const result = await h.route.handle(h.write());
  assert.equal(result.body.error.code, 'APP_BUSY');
  assert.equal(h.state.writes, 0);
  assert.equal(h.state.flushes, 0);
});

test('a partial persistence failure remains unknown and is never replayed', async () => {
  const h = harness();
  h.state.flushFailure = true;
  const first = await h.route.handle(h.write());
  assert.equal(first.body.error.code, 'OUTCOME_UNKNOWN');
  h.state.flushFailure = false;
  const retry = await h.createRoute().handle(h.write());
  assert.equal(retry.body.error.code, 'OUTCOME_UNKNOWN');
  assert.equal(h.state.writes, 1);
  assert.equal(h.state.calls, 1);
});
