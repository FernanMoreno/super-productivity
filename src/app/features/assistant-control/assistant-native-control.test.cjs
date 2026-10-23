const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');

const createHarness = () => {
  const calls = [];
  const state = {
    currentTaskId: null,
    entities: {
      task: {
        id: 'task',
        title: 'Task',
        notes: 'old',
        subTaskIds: [],
        timeSpentOnDay: { '2026-10-20': 1000 },
      },
    },
  };
  const projects = [
    { id: 'project', title: 'Project', theme: { primary: '#fff' }, isArchived: false },
  ];
  const tags = [{ id: 'tag', title: 'Tag', color: '#fff' }];
  const methods = (names) =>
    Object.fromEntries(
      names.map((name) => [
        name,
        (...args) => {
          calls.push([name, ...args]);
          if (name === 'setCurrentId') state.currentTaskId = args[0];
          if (name === 'pauseCurrent') state.currentTaskId = null;
          if (name === 'add') return 'created-project';
          if (name === 'addTag') return 'created-tag';
        },
      ]),
    );
  const taskService = methods([
    'setCurrentId',
    'pauseCurrent',
    'addTimeSpentAndSync',
    'update',
  ]);
  taskService.isTimeTrackingEnabled = () => true;
  const projectService = {
    ...methods(['add', 'update', 'reopen']),
    list: () => projects,
    getByIdOnce$: (id) => projects.find((p) => p.id === id),
  };
  const tagService = {
    ...methods(['addTag', 'updateTag', 'deleteTag']),
    tags: () => tags,
  };
  const mocks = {
    TaskService: taskService,
    ProjectService: projectService,
    TagService: tagService,
    DateService: { todayStr: () => '2026-10-22' },
    Store: {
      selectSignal: (selector) => () =>
        selector === 'projects'
          ? { entities: Object.fromEntries(projects.map((p) => [p.id, p])) }
          : state,
      dispatch: (action) => calls.push(['dispatch', action]),
    },
  };
  class ControlError extends Error {
    constructor(code, message) {
      super(message);
      this.code = code;
    }
  }
  const exports = {};
  const filename = `${__dirname}/assistant-native-control.service.ts`;
  const source = fs.readFileSync(filename, 'utf8');
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      experimentalDecorators: true,
    },
  }).outputText;
  const requireStub = (path) => {
    if (path === '@angular/core')
      return { Injectable: () => (type) => type, inject: (token) => mocks[token] };
    if (path === '@ngrx/store') return { Store: 'Store' };
    if (path === 'rxjs') return { firstValueFrom: async (value) => value };
    if (path.endsWith('assistant-control.model')) return { ControlError };
    if (path.endsWith('task.selectors')) return { selectTaskFeatureState: () => state };
    if (path.endsWith('project.actions'))
      return { archiveProject: (value) => ({ type: 'archive', ...value }) };
    if (path.endsWith('project.selectors'))
      return { selectProjectFeatureState: 'projects' };
    if (path.endsWith('project.const'))
      return {
        DEFAULT_PROJECT: { theme: { isAutoContrast: true } },
        INBOX_PROJECT: { id: 'INBOX_PROJECT' },
        LEGACY_NO_LIST_TAG_ID: 'NO_LIST',
      };
    if (path.endsWith('tag.const'))
      return {
        SYSTEM_TAG_IDS: new Set(['TODAY', 'EM_URGENT', 'EM_IMPORTANT', 'IN_PROGRESS']),
        TODAY_TAG: { id: 'TODAY' },
      };
    if (path.endsWith('local-rest-api-task-time'))
      return {
        MAX_TIME_SPENT_PER_DAY_MS: 86400000,
        parseTimeSpentBody: (body, today, method) =>
          typeof body.date !== 'string' ||
          !/^\d{4}-\d{2}-\d{2}$/.test(body.date) ||
          body.date > today ||
          !Number.isInteger(body.duration) ||
          body.duration < (method === 'PUT' ? 0 : 1) ||
          body.duration > 86400000
            ? { code: 'INVALID_INPUT', error: 'Invalid time' }
            : body,
      };
    for (const name of ['TaskService', 'ProjectService', 'TagService', 'DateService'])
      if (path.endsWith(name.replace(/Service$/, '').toLowerCase() + '.service'))
        return { [name]: name };
    throw new Error(`Unexpected import ${path}`);
  };
  vm.runInNewContext(
    compiled,
    { exports, require: requireStub, Object, Set, Number, Error },
    { filename },
  );
  const service = new exports.AssistantNativeControlService();
  const context = {
    authorize: async () => calls.push(['authorize']),
    markMutation: () => calls.push(['mark']),
  };
  return { service, context, calls, state, projects, tags, taskService };
};

test('timer status reads current state without mutating', async () => {
  const h = createHarness();
  const result = await h.service.run('task_timer', { command: 'status' }, h.context);
  assert.equal(result.currentTaskId, null);
  assert.equal(h.calls.length, 0);
});
test('timer start checks expected current and authorizes before native transition', async () => {
  const h = createHarness();
  await h.service.run(
    'task_timer',
    { command: 'start', taskId: 'task', expectedCurrentTaskId: null },
    h.context,
  );
  assert.deepEqual(
    h.calls.map((c) => c[0]),
    ['authorize', 'mark', 'setCurrentId'],
  );
});
test('stale timer expectation rejects without changing tracking', async () => {
  const h = createHarness();
  h.state.currentTaskId = 'different';
  await assert.rejects(
    h.service.run(
      'task_timer',
      { command: 'stop', expectedCurrentTaskId: null },
      h.context,
    ),
    { code: 'STALE_DATA' },
  );
  assert.equal(h.calls.length, 0);
});
test('manual time uses backfill sync and refuses parent-owned totals', async () => {
  const h = createHarness();
  await h.service.run(
    'task_time',
    { command: 'add', taskId: 'task', date: '2026-10-20', duration: 500 },
    h.context,
  );
  assert.deepEqual(h.calls.at(-1).slice(2), [500, '2026-10-20', true]);
  h.state.entities.task.subTaskIds = ['child'];
  await assert.rejects(
    h.service.run(
      'task_time',
      { command: 'set', taskId: 'task', date: '2026-10-20', duration: 0 },
      h.context,
    ),
  );
});
test('time correction checks previous duration and removes zero bucket', async () => {
  const h = createHarness();
  await assert.rejects(
    h.service.run(
      'task_time',
      {
        command: 'set',
        taskId: 'task',
        date: '2026-10-20',
        duration: 0,
        expectedDuration: 999,
      },
      h.context,
    ),
    { code: 'STALE_DATA' },
  );
  await h.service.run(
    'task_time',
    {
      command: 'set',
      taskId: 'task',
      date: '2026-10-20',
      duration: 0,
      expectedDuration: 1000,
    },
    h.context,
  );
  assert.equal(Object.hasOwn(h.calls.at(-1)[2].timeSpentOnDay, '2026-10-20'), false);
});
test('notes are only returned by explicit read and stale writes reject', async () => {
  const h = createHarness();
  assert.equal(
    (await h.service.run('task_notes', { command: 'read', taskId: 'task' }, h.context))
      .notes,
    'old',
  );
  await assert.rejects(
    h.service.run(
      'task_notes',
      { command: 'write', taskId: 'task', notes: 'new', expectedNotes: 'stale' },
      h.context,
    ),
    { code: 'STALE_DATA' },
  );
  const result = await h.service.run(
    'task_notes',
    { command: 'write', taskId: 'task', notes: 'new', expectedNotes: 'old' },
    h.context,
  );
  assert.equal(Object.hasOwn(result, 'notes'), false);
});
test('project colors map to existing theme and Inbox cannot archive', async () => {
  const h = createHarness();
  await h.service.run(
    'project_manage',
    { command: 'update', id: 'project', fields: { color: '#123' } },
    h.context,
  );
  assert.equal(h.calls.at(-1)[2].theme.primary, '#123');
  h.projects.push({ id: 'INBOX_PROJECT', title: 'Inbox', theme: {} });
  await assert.rejects(
    h.service.run(
      'project_manage',
      { command: 'archive', id: 'INBOX_PROJECT' },
      h.context,
    ),
  );
});
test('system tags cannot be changed and ordinary deletion uses native sidecar service', async () => {
  const h = createHarness();
  h.tags.push({ id: 'TODAY', title: 'Today' });
  await assert.rejects(
    h.service.run('tag_manage', { command: 'delete', id: 'TODAY' }, h.context),
  );
  await h.service.run('tag_manage', { command: 'delete', id: 'tag' }, h.context);
  assert.equal(h.calls.at(-1)[0], 'deleteTag');
});
test('entity changed during authorization rejects before dispatch', async () => {
  const h = createHarness();
  h.context.authorize = async () => {
    h.state.entities.task = { ...h.state.entities.task, notes: 'remote' };
  };
  await assert.rejects(
    h.service.run(
      'task_notes',
      { command: 'write', taskId: 'task', notes: 'new' },
      h.context,
    ),
    { code: 'STALE_DATA' },
  );
  assert.equal(h.calls.length, 0);
});
test('project creation preserves default theme options when choosing a color', async () => {
  const h = createHarness();
  await h.service.run(
    'project_manage',
    { command: 'create', fields: { title: 'New', color: '#abc' } },
    h.context,
  );
  assert.equal(h.calls.at(-1)[1].theme.isAutoContrast, true);
});
test('revoked authorization never marks or applies a mutation', async () => {
  const h = createHarness();
  h.context.authorize = async () => {
    throw new Error('revoked');
  };
  await assert.rejects(
    h.service.run('tag_manage', { command: 'delete', id: 'tag' }, h.context),
  );
  assert.equal(h.calls.length, 0);
});
test('future and over-limit time and oversized notes cannot dispatch', async () => {
  const h = createHarness();
  for (const input of [
    { date: '2026-10-23', duration: 1 },
    { date: '2026-10-20', duration: 86400000 },
  ]) {
    await assert.rejects(
      h.service.run('task_time', { command: 'add', taskId: 'task', ...input }, h.context),
    );
  }
  await assert.rejects(
    h.service.run(
      'task_notes',
      { command: 'write', taskId: 'task', notes: 'x'.repeat(8193) },
      h.context,
    ),
  );
  assert.equal(h.calls.length, 0);
});
test('disabled tracking rejects start before changing native state', async () => {
  const h = createHarness();
  h.taskService.isTimeTrackingEnabled = () => false;
  await assert.rejects(
    h.service.run('task_timer', { command: 'start', taskId: 'task' }, h.context),
    { code: 'TRACKING_DISABLED' },
  );
  assert.equal(h.calls.length, 0);
});
test('tracking disabled during authorization rejects before marking mutation', async () => {
  const h = createHarness();
  h.context.authorize = async () => {
    h.taskService.isTimeTrackingEnabled = () => false;
  };
  await assert.rejects(
    h.service.run('task_timer', { command: 'start', taskId: 'task' }, h.context),
    { code: 'TRACKING_DISABLED' },
  );
  assert.equal(h.calls.length, 0);
});
