const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
require('ts-node').register({ transpileOnly: true, preferTsExts: true });

const createHarness = (startOfNextDayDiffMs = 0) => {
  const calls = [];
  const state = {
    currentTaskId: null,
    entities: {
      task: {
        id: 'task',
        title: 'Task',
        notes: 'old',
        subTaskIds: [],
        tagIds: ['TODAY', 'tag'],
        projectId: 'project',
        timeEstimate: 600000,
        timeSpentOnDay: { '2026-10-20': 1000 },
      },
    },
  };
  const projects = [
    { id: 'project', title: 'Project', theme: { primary: '#fff' }, isArchived: false },
  ];
  const tags = [{ id: 'tag', title: 'Tag', color: '#fff' }];
  const repeats = { entities: {} };
  const repeatService = {
    deleteTaskRepeatCfg: (id) => {
      calls.push(['repeatDelete', id]);
      delete repeats.entities[id];
    },
    addTaskRepeatCfgToTask: (taskId, projectId, cfg) => {
      calls.push(['repeatAdd', taskId, projectId, cfg]);
      repeats.entities.repeat = { ...cfg, projectId, id: 'repeat' };
      state.entities[taskId] = { ...state.entities[taskId], repeatCfgId: 'repeat' };
      return 'repeat';
    },
    updateTaskRepeatCfg: (id, changes) => {
      calls.push(['repeatUpdate', id, changes]);
      repeats.entities[id] = { ...repeats.entities[id], ...changes };
    },
  };
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
    'reScheduleTask',
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
    TaskRepeatCfgService: repeatService,
    DateService: {
      todayStr: () => '2026-10-22',
      getStartOfNextDayDiffMs: () => startOfNextDayDiffMs,
    },
    Store: {
      selectSignal: (selector) => () =>
        selector === 'repeats'
          ? repeats
          : selector === 'projects'
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
    if (path.endsWith('assistant-control.model'))
      return {
        ...require('../../../../electron/shared-with-frontend/assistant-control.model.ts'),
        ControlError,
      };
    if (path.endsWith('date-str-to-utc-date'))
      return { dateStrToUtcDate: (day) => new Date(day + 'T12:00:00') };
    if (path.endsWith('task-repeat-cfg.service'))
      return { TaskRepeatCfgService: 'TaskRepeatCfgService' };
    if (path.endsWith('task-repeat-cfg.selectors'))
      return { selectTaskRepeatCfgFeatureState: 'repeats' };
    if (
      [
        'task-repeat-cfg.model',
        'get-interval-repeat-updates',
        'get-default-skip-overdue',
        'remind-option-to-milliseconds',
        'task.model',
        'get-db-date-str',
        'get-repeat-due-with-time.util',
      ].some((suffix) => path.endsWith(suffix))
    )
      return require(require('node:path').resolve(__dirname, path));
    if (path.endsWith('task.selectors')) return { selectTaskFeatureState: () => state };
    if (path.endsWith('project.actions'))
      return { archiveProject: (value) => ({ type: 'archive', ...value }) };
    if (path.endsWith('planner.actions'))
      return {
        PlannerActions: { planTaskForDay: (value) => ({ type: 'planDay', ...value }) },
      };
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
    {
      exports,
      require: requireStub,
      Object,
      Set,
      Number,
      Error,
      crypto: require('node:crypto').webcrypto,
      TextEncoder,
    },
    { filename },
  );
  const service = new exports.AssistantNativeControlService();
  const context = {
    authorize: async () => calls.push(['authorize']),
    markMutation: () => calls.push(['mark']),
  };
  return { service, context, calls, state, projects, tags, taskService, repeats };
};

const repeatArgs = {
  command: 'set',
  taskId: 'task',
  cycle: 'weekly',
  every: 2,
  weekdays: ['wed', 'fri'],
  startDay: '2026-10-28',
  expectedRevision: null,
  operationId: 'repeat-test-operation',
};
test('repeat creation cannot rewrite a completed task history', async () => {
  const h = createHarness();
  h.state.entities.task.isDone = true;
  const before = JSON.stringify(h.state);
  await assert.rejects(h.service.run('task_repeat', repeatArgs, h.context), {
    code: 'INVALID_ARGUMENTS',
  });
  assert.equal(JSON.stringify(h.state), before);
  assert.equal(h.calls.length, 0);
});
test('repeat creates and edits one native series while preserving task and advanced metadata', async () => {
  const h = createHarness();
  assert.equal(
    (await h.service.run('task_repeat', { command: 'read', taskId: 'task' }, h.context))
      .revision,
    null,
  );
  await h.service.run('task_repeat', repeatArgs, h.context);
  const cfg = h.repeats.entities.repeat;
  assert.equal(cfg.repeatEvery, 2);
  assert.equal(cfg.wednesday, true);
  assert.equal(cfg.friday, true);
  assert.equal(cfg.monday, false);
  assert.equal(cfg.startDate, '2026-10-28');
  assert.deepEqual(Array.from(cfg.tagIds), ['tag']);
  assert.equal(cfg.notes, 'old');
  assert.equal(cfg.defaultEstimate, 600000);
  cfg.waitForCompletion = true;
  cfg.repeatUntilDay = '2027-12-31';
  cfg.startTime = '16:00';
  cfg.remindAt = 'm10';
  const read = await h.service.run(
    'task_repeat',
    { command: 'read', taskId: 'task' },
    h.context,
  );
  assert(!JSON.stringify(read).includes('old'));
  const { weekdays, ...monthlyArgs } = repeatArgs;
  await h.service.run(
    'task_repeat',
    {
      ...monthlyArgs,
      cycle: 'monthly',
      startDay: '2026-11-30',
      expectedRevision: read.revision,
    },
    h.context,
  );
  assert.equal(h.calls.filter((c) => c[0] === 'repeatAdd').length, 1);
  assert.equal(h.repeats.entities.repeat.repeatCycle, 'MONTHLY');
  for (const key of [
    'notes',
    'defaultEstimate',
    'waitForCompletion',
    'repeatUntilDay',
    'startTime',
    'remindAt',
  ])
    assert.equal(h.repeats.entities.repeat[key], cfg[key]);
  assert.equal(h.state.entities.task.timeSpentOnDay['2026-10-20'], 1000);
});

test('repeat rejects stale revisions, UI races, subtasks and missing series without mutation', async () => {
  const h = createHarness();
  await h.service.run('task_repeat', repeatArgs, h.context);
  await assert.rejects(h.service.run('task_repeat', repeatArgs, h.context), {
    code: 'STALE_DATA',
  });
  const read = await h.service.run(
    'task_repeat',
    { command: 'read', taskId: 'task' },
    h.context,
  );
  h.context.authorize = async () => {
    h.repeats.entities.repeat = { ...h.repeats.entities.repeat, repeatEvery: 3 };
  };
  await assert.rejects(
    h.service.run(
      'task_repeat',
      { ...repeatArgs, expectedRevision: read.revision },
      h.context,
    ),
    { code: 'STALE_DATA' },
  );
  h.state.entities.task.parentId = 'parent';
  await assert.rejects(h.service.run('task_repeat', repeatArgs, h.context), {
    code: 'INVALID_ARGUMENTS',
  });
  delete h.state.entities.task.parentId;
  delete h.repeats.entities.repeat;
  await assert.rejects(h.service.run('task_repeat', repeatArgs, h.context), {
    code: 'DATA_UNAVAILABLE',
  });
  assert.equal(h.calls.filter((c) => c[0] === 'mark').length, 1);
});

test('repeat safe template read, time edits, explicit clear and removal preserve history', async () => {
  const h = createHarness();
  await h.service.run('task_repeat', repeatArgs, h.context);
  const read = () =>
    h.service.run('task_repeat', { command: 'read', taskId: 'task' }, h.context);
  const first = await read();
  assert.equal(first.template.title, 'Task');
  assert(!JSON.stringify(first).includes('old'));
  const edit = {
    ...repeatArgs,
    expectedRevision: first.revision,
    startTime: '12:00',
    reminder: 'm10',
    repeatUntilDay: '2026-12-16',
    paused: true,
    template: { title: 'Course', notes: 'private' },
  };
  await h.service.run('task_repeat', edit, h.context);
  assert.equal(h.repeats.entities.repeat.startTime, '12:00');
  assert.equal(h.repeats.entities.repeat.remindAt, 'm10');
  assert.equal(h.repeats.entities.repeat.isPaused, true);
  const second = await read();
  assert(!JSON.stringify(second).includes('private'));
  assert.equal(
    (
      await h.service.run(
        'task_repeat',
        { command: 'read_template', taskId: 'task' },
        h.context,
      )
    ).template.notes,
    'private',
  );
  h.repeats.entities.repeat = { ...h.repeats.entities.repeat, notes: 'raced' };
  await assert.rejects(
    h.service.run(
      'task_repeat',
      { ...edit, expectedRevision: second.revision },
      h.context,
    ),
    { code: 'STALE_DATA' },
  );
  await h.service.run(
    'task_repeat',
    {
      ...repeatArgs,
      expectedRevision: (await read()).revision,
      startTime: null,
      reminder: null,
      repeatUntilDay: null,
    },
    h.context,
  );
  assert.equal(h.repeats.entities.repeat.startTime, undefined);
  assert.equal(h.repeats.entities.repeat.repeatUntilDay, undefined);
  await h.service.run(
    'task_repeat',
    {
      command: 'remove',
      taskId: 'task',
      expectedRevision: (await read()).revision,
      operationId: 'remove-repeat',
    },
    h.context,
  );
  assert(h.calls.some((c) => c[0] === 'repeatDelete'));
  assert.equal(h.state.entities.task.timeSpentOnDay['2026-10-20'], 1000);
});

test('repeat current time edits keep the selected calendar day and estimates; default edits are future only', async () => {
  const h = createHarness();
  h.state.entities.task.dueDay = '2026-10-28';
  await h.service.run('task_repeat', repeatArgs, h.context);
  const read = () =>
    h.service.run('task_repeat', { command: 'read', taskId: 'task' }, h.context);
  await h.service.run(
    'task_repeat',
    {
      ...repeatArgs,
      expectedRevision: (await read()).revision,
      startTime: '12:00',
      reminder: 'm10',
    },
    h.context,
  );
  assert(!h.calls.some((c) => c[0] === 'reScheduleTask'));
  const update = h.calls.filter((c) => c[0] === 'repeatUpdate').at(-1)[2];
  assert(!('startDate' in update));
  assert(!('repeatCycle' in update));
  await h.service.run(
    'task_repeat',
    {
      ...repeatArgs,
      expectedRevision: (await read()).revision,
      startTime: '13:00',
      reminder: null,
      applyTo: 'current',
    },
    h.context,
  );
  const scheduled = h.calls.find((c) => c[0] === 'reScheduleTask')[1];
  assert.equal(new Date(scheduled.due).getDate(), 28);
  assert.equal(new Date(scheduled.due).getHours(), 13);
  assert.equal(scheduled.remindCfg, 'DoNotRemind');
  assert.equal(scheduled.task.timeEstimate, 600000);
  await h.service.run(
    'task_repeat',
    {
      ...repeatArgs,
      expectedRevision: (await read()).revision,
      startTime: null,
      applyTo: 'current',
    },
    h.context,
  );
  assert.equal(
    h.calls.find((c) => c[0] === 'dispatch' && c[1].type === 'planDay')[1].day,
    '2026-10-28',
  );
});

test('repeat current time changes preserve the logical day across a custom 04:00 boundary', async () => {
  const h = createHarness(4 * 60 * 60 * 1000);
  h.state.entities.task.dueDay = '2026-10-28';
  await h.service.run('task_repeat', repeatArgs, h.context);
  const read = () =>
    h.service.run('task_repeat', { command: 'read', taskId: 'task' }, h.context);
  await h.service.run(
    'task_repeat',
    {
      ...repeatArgs,
      expectedRevision: (await read()).revision,
      startTime: '02:00',
      applyTo: 'current',
    },
    h.context,
  );
  const scheduled = h.calls.find((c) => c[0] === 'reScheduleTask')[1];
  assert.equal(new Date(scheduled.due).getDate(), 29);
  assert.equal(new Date(scheduled.due).getHours(), 2);
  h.state.entities.task = {
    ...h.state.entities.task,
    dueDay: undefined,
    dueWithTime: scheduled.due,
  };
  await h.service.run(
    'task_repeat',
    {
      ...repeatArgs,
      expectedRevision: (await read()).revision,
      startTime: '03:00',
      applyTo: 'current',
    },
    h.context,
  );
  const rescheduled = h.calls.filter((c) => c[0] === 'reScheduleTask').at(-1)[1];
  assert.equal(new Date(rescheduled.due).getDate(), 29);
  assert.equal(new Date(rescheduled.due).getHours(), 3);
  await h.service.run(
    'task_repeat',
    {
      ...repeatArgs,
      expectedRevision: (await read()).revision,
      startTime: null,
      applyTo: 'current',
    },
    h.context,
  );
  assert.equal(
    h.calls.find((c) => c[0] === 'dispatch' && c[1].type === 'planDay')[1].day,
    '2026-10-28',
  );
});

test('clearing repeat current time restores the logical day of a late-night timestamp', async () => {
  const h = createHarness(4 * 60 * 60 * 1000);
  h.state.entities.task.dueWithTime = new Date('2026-10-29T02:00:00').getTime();
  await h.service.run('task_repeat', repeatArgs, h.context);
  const read = await h.service.run(
    'task_repeat',
    { command: 'read', taskId: 'task' },
    h.context,
  );
  await h.service.run(
    'task_repeat',
    {
      ...repeatArgs,
      expectedRevision: read.revision,
      startTime: null,
      applyTo: 'current',
    },
    h.context,
  );
  assert.equal(
    h.calls.find((c) => c[0] === 'dispatch' && c[1].type === 'planDay')[1].day,
    '2026-10-28',
  );
});

test('repeat monthly anchors preserve when omitted and referenced tags recheck after authorization', async () => {
  const h = createHarness();
  const { weekdays, ...args } = repeatArgs;
  await h.service.run(
    'task_repeat',
    { ...args, cycle: 'monthly', monthlyWeekOfMonth: -1, monthlyWeekday: 1 },
    h.context,
  );
  const read = () =>
    h.service.run('task_repeat', { command: 'read', taskId: 'task' }, h.context);
  await h.service.run(
    'task_repeat',
    {
      ...args,
      cycle: 'monthly',
      expectedRevision: (await read()).revision,
      skipOverdue: true,
    },
    h.context,
  );
  assert.equal(h.repeats.entities.repeat.monthlyWeekOfMonth, -1);
  assert.equal(h.repeats.entities.repeat.monthlyWeekday, 1);
  const revision = (await read()).revision;
  const marks = h.calls.filter((c) => c[0] === 'mark').length;
  h.context.authorize = async () => h.tags.splice(0);
  await assert.rejects(
    h.service.run(
      'task_repeat',
      {
        ...args,
        cycle: 'monthly',
        expectedRevision: revision,
        template: { tagIds: ['tag'] },
      },
      h.context,
    ),
    { code: 'INVALID_ARGUMENTS' },
  );
  assert.equal(h.calls.filter((c) => c[0] === 'mark').length, marks);
});

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
