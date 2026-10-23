const test = require('node:test'),
  assert = require('node:assert/strict'),
  Module = require('node:module');
require('ts-node').register({ transpileOnly: true, preferTsExts: true });
const filename = require.resolve('./planner-workflow.service.ts'),
  tokens = new Map();
let context;
const token = (n) => {
  if (!tokens.has(n)) tokens.set(n, Symbol(n));
  return tokens.get(n);
};
const oldLoad = Module._load;
Module._load = function (request, parent, ...rest) {
  if (parent?.filename === filename) {
    if (request === '@angular/core')
      return {
        Injectable: () => (t) => t,
        inject: (k) => context.get(k),
        Injector: token('Injector'),
      };
    if (request === '@ngrx/store') return { Store: token('Store') };
    if (request.endsWith('task.selectors'))
      return { selectTaskFeatureState: token('tasks') };
    if (request.endsWith('project.selectors'))
      return { selectAllProjects: token('projects') };
    if (request.endsWith('plugin-user-data.reducer'))
      return { selectPluginUserDataFeatureState: token('data') };
    if (request.endsWith('task-shared.actions'))
      return { TaskSharedActions: { addTask: (a) => ({ type: 'add', ...a }) } };
    if (request.endsWith('task.actions'))
      return { addSubTask: (a) => ({ type: 'child', ...a }) };
    if (request.endsWith('planner.actions'))
      return { PlannerActions: { planTaskForDay: (a) => ({ type: 'schedule', ...a }) } };
    if (request.endsWith('work-context.model'))
      return { WorkContextType: { PROJECT: 'PROJECT' } };
    if (request.endsWith('plugin-persistence-api'))
      return { flushPluginWrites: async () => {} };
    if (request.endsWith('plugin-persistence-key.util'))
      return { composeId: (o, k) => o + ':' + k };
    const named = {
      'task.service': 'TaskService',
      'global-config.service': 'GlobalConfigService',
      'hydration-state.service': 'HydrationStateService',
      'operation-capture.service': 'OperationCaptureService',
      'archive-store.service': 'ArchiveStoreService',
      'plugin-user-persistence.service': 'PluginUserPersistenceService',
      'planner-calendar.service': 'PlannerCalendarService',
      'workflow-integration.service': 'WorkflowIntegrationService',
    };
    for (const [s, n] of Object.entries(named))
      if (request.endsWith(s)) return { [n]: token(n) };
  }
  return oldLoad.call(this, request, parent, ...rest);
};
let Service;
try {
  Service = require(filename).PlannerWorkflowService;
} finally {
  Module._load = oldLoad;
}
function fixture(defaultEstimate = 0) {
  const task = {
    id: 'one',
    title: 'One',
    isDone: false,
    subTaskIds: [],
    timeEstimate: 60000,
    timeSpent: 0,
    projectId: 'project',
  };
  const state = { entities: { one: task }, ids: ['one'], currentTaskId: null },
    projects = [{ id: 'project', title: 'Project' }],
    data = [],
    storage = new Map(),
    actions = [];
  let busy = false;
  context = new Map([
    [
      token('Store'),
      {
        selectSignal: (s) => () =>
          s === token('tasks') ? state : s === token('projects') ? projects : data,
        dispatch: (a) => {
          actions.push(a);
          if (a.type === 'add')
            state.entities[a.task.id] = {
              ...a.task,
              timeEstimate: a.task.timeEstimate || defaultEstimate,
            };
          if (a.type === 'child') {
            state.entities[a.task.id] = {
              ...a.task,
              parentId: a.parentId,
              timeEstimate: a.task.timeEstimate || defaultEstimate,
            };
            state.entities[a.parentId].subTaskIds.push(a.task.id);
          }
          if (a.type === 'schedule') {
            state.entities[a.task.id].dueDay = a.day;
            state.entities[a.task.id].dueWithTime = undefined;
          }
        },
      },
    ],
    [
      token('TaskService'),
      {
        update: (id, fields) => {
          Object.assign(state.entities[id], fields);
          actions.push({ type: 'update', id, fields });
        },
        createNewTaskWithDefaults: (a) => ({
          id: a.id,
          title: a.title,
          projectId: a.workContextId,
          timeEstimate: 0,
          subTaskIds: [],
          ...a.additional,
        }),
      },
    ],
    [
      token('GlobalConfigService'),
      { cfg: () => ({ tasks: { isAutoMarkParentAsDone: true } }) },
    ],
    [token('HydrationStateService'), { isApplyingRemoteOps: () => busy }],
    [token('OperationCaptureService'), { hasUnrecoveredPersistFailure: () => false }],
    [token('ArchiveStoreService'), { mutationVersion: 0, mutationPending: false }],
    [token('PlannerCalendarService'), { fingerprint: () => 'calendar' }],
    [
      token('PluginUserPersistenceService'),
      {
        loadPluginUserData: async (k) => storage.get(k) ?? null,
        compareAndSwapPluginUserData: async (k, old, next, auth, guard) => {
          await auth?.();
          guard?.();
          if ((storage.get(k) ?? null) !== old) return false;
          storage.set(k, next);
          return true;
        },
      },
    ],
    [token('Injector'), { get: (k) => context.get(k) }],
  ]);
  return {
    service: new Service(),
    state,
    actions,
    set busy(v) {
      busy = v;
    },
    snapshot: async () => ({
      byId: new Map(Object.values(state.entities).map((t) => [t.id, { ...t }])),
      leaves: Object.values(state.entities),
      matches: () => false,
    }),
  };
}
test('native template uses deterministic IDs/project context and literal parent/subtask titles', async () => {
  const f = fixture();
  await f.service._native(
    {
      type: 'template.create',
      parent: { id: 'root', title: 'Literal #tag @tomorrow', projectId: 'project' },
      children: [{ id: 'child', title: 'Literal +project', timeEstimate: 60000 }],
    },
    async () => {},
    () => {},
    () => {},
  );
  assert.equal(f.actions[0].workContextId, 'project');
  assert.equal(f.actions[0].isIgnoreShortSyntax, true);
  assert.equal(f.actions.find((a) => a.type === 'child').isIgnoreShortSyntax, true);
  assert.equal(f.state.entities.child.parentId, 'root');
  assert.equal(f.state.entities.root.timeEstimate, 0);
  assert.equal(f.state.entities.child.timeEstimate, 60000);
});
test('final synchronous health/freshness fence prevents dispatch after an awaited authorization', async () => {
  const f = fixture();
  await assert.rejects(
    f.service._native(
      { type: 'task.update', taskId: 'one', fields: { isDone: true } },
      async () => {
        f.busy = true;
      },
      () => f.service._ready(),
      () => {},
    ),
    (e) => e.code === 'APP_BUSY',
  );
  assert.equal(f.actions.length, 0);
});
test('explicit template zero estimates survive native default-estimate effects', async () => {
  const f = fixture(1800000);
  await f.service._native(
    {
      type: 'template.create',
      parent: { id: 'root', title: 'Parent', projectId: 'project' },
      children: [{ id: 'child', title: 'No estimate', timeEstimate: 0 }],
    },
    async () => {},
    () => {},
    () => {},
  );
  assert.equal(f.state.entities.child.timeEstimate, 0);
});
test('host metadata/native revisions ignore timer ticks and detect task changes', async () => {
  const f = fixture();
  const q = await f.service.run(
    'workflow_query',
    { view: 'board' },
    async () => {},
    f.snapshot,
  );
  f.state.entities.one.timeSpent = 1000;
  const ticking = await f.service.run(
    'workflow_query',
    { view: 'board' },
    async () => {},
    f.snapshot,
  );
  assert.equal(q.nativeRevision, ticking.nativeRevision);
  assert.notEqual(q.weekRevision, ticking.weekRevision);
  f.state.entities.one.title = 'Changed';
  const stale = await f.service.run(
    'workflow_command',
    {
      operationId: 'workflow-host-001',
      baseRevision: q.revision,
      nativeRevision: q.nativeRevision,
      command: { type: 'task.move', payload: { taskId: 'one', column: 'done' } },
    },
    async () => {},
    f.snapshot,
  );
  assert.equal(stale.code, 'STALE_DATA');
  assert.equal(f.actions.length, 0);
});
test('invalid command dates reject before a journal or native action is dispatched', async () => {
  const f = fixture(),
    q = await f.service.run(
      'workflow_query',
      { view: 'board' },
      async () => {},
      f.snapshot,
    );
  const r = await f.service.run(
    'workflow_command',
    {
      operationId: 'workflow-date-001',
      baseRevision: q.revision,
      nativeRevision: q.nativeRevision,
      command: { type: 'task.review', payload: { taskId: 'one', date: 'invalid-date' } },
    },
    async () => {},
    f.snapshot,
  );
  assert.equal(r.status, 'rejected');
  assert.equal(r.code, 'INVALID_ARGUMENTS');
  assert.equal(f.actions.length, 0);
});
