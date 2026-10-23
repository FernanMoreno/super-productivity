const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');
require('ts-node').register({ transpileOnly: true, preferTsExts: true });
const filename = require.resolve('./planner-native.service.ts');
const tokens = new Map();
const token = (name) => {
  if (!tokens.has(name)) tokens.set(name, Symbol(name));
  return tokens.get(name);
};
let context;
const calls = [];
const oldLoad = Module._load;
Module._load = function (request, parent, ...rest) {
  if (parent?.filename === filename) {
    if (request === '@angular/core')
      return {
        Injectable: () => (target) => target,
        Injector: token('Injector'),
        inject: (key) => context.get(key),
      };
    if (request === '@ngrx/store') return { Store: token('Store') };
    if (request.endsWith('task-shared.actions'))
      return {
        TaskSharedActions: Object.fromEntries(
          [
            'addTask',
            'updateTask',
            'unscheduleTask',
            'scheduleTaskWithTime',
            'reScheduleTaskWithTime',
          ].map((kind) => [kind, (args) => ({ kind, ...args })]),
        ),
      };
    if (request.endsWith('task.actions'))
      return { addSubTask: (args) => ({ kind: 'addSubTask', ...args }) };
    if (request.endsWith('planner.actions'))
      return {
        PlannerActions: {
          planTaskForDay: (args) => ({ kind: 'planTaskForDay', ...args }),
        },
      };
    if (request.endsWith('task.selectors'))
      return { selectTaskFeatureState: token('TaskState') };
    if (request.endsWith('project.const'))
      return { INBOX_PROJECT: { id: 'INBOX_PROJECT' } };
    if (request.endsWith('work-context.model'))
      return { WorkContextType: { PROJECT: 'PROJECT' } };
    if (request.endsWith('plugin-persistence-api'))
      return {
        flushPluginWrites: async () => {
          calls.push({ kind: 'flush' });
        },
      };
    const names = {
      'archive-store.service': 'ArchiveStoreService',
      'task.service': 'TaskService',
      'task-move-to-project.service': 'TaskMoveToProjectService',
      'project.service': 'ProjectService',
      'tag.service': 'TagService',
      'date.service': 'DateService',
      'global-config.service': 'GlobalConfigService',
      'hydration-state.service': 'HydrationStateService',
      'operation-capture.service': 'OperationCaptureService',
      'planner-access.service': 'PlannerAccessService',
    };
    for (const [suffix, name] of Object.entries(names))
      if (request.endsWith(suffix)) return { [name]: token(name) };
  }
  return oldLoad.call(this, request, parent, ...rest);
};
let PlannerNativeService;
try {
  ({ PlannerNativeService } = require(filename));
} finally {
  Module._load = oldLoad;
}
function fixture() {
  calls.length = 0;
  const task = {
    id: 'task-example',
    title: 'Example',
    projectId: 'INBOX_PROJECT',
    tagIds: [],
    subTaskIds: [],
    dueDay: undefined,
    dueWithTime: Date.UTC(2030, 0, 1, 10),
    remindAt: Date.UTC(2030, 0, 1, 9, 45),
    timeEstimate: 60000,
    timeSpent: 0,
    timeSpentOnDay: {},
  };
  const state = { entities: { [task.id]: task }, ids: [task.id] };
  const native = {
    update: (taskId, changes) => calls.push({ kind: 'update', taskId, changes }),
    moveToProject: (value, projectId) =>
      calls.push({ kind: 'occurrenceMove', taskId: value.id, projectId }),
    createNewTaskWithDefaults: () => {
      throw Error('not used');
    },
  };
  context = new Map([
    [
      token('Store'),
      { selectSignal: () => () => state, dispatch: (action) => calls.push(action) },
    ],
    [token('TaskService'), native],
    [
      token('TaskMoveToProjectService'),
      {
        moveToProject: async (_task, _project, opts) => {
          await opts.beforeMove(true);
          opts.atMove();
          calls.push({ kind: 'seriesMove' });
          return true;
        },
      },
    ],
    [
      token('ProjectService'),
      { list: () => [{ id: 'INBOX_PROJECT' }, { id: 'project-other' }] },
    ],
    [token('TagService'), { tags: () => [] }],
    [token('DateService'), { todayStr: () => '2030-01-01' }],
    [
      token('GlobalConfigService'),
      {
        cfg: () => ({
          timeTracking: { defaultEstimate: 0 },
          misc: { startOfNextDayTime: '00:00' },
        }),
      },
    ],
    [token('HydrationStateService'), { isApplyingRemoteOps: () => false }],
    [token('OperationCaptureService'), { hasUnrecoveredPersistFailure: () => false }],
    [
      token('PlannerAccessService'),
      { authorize: async (action) => calls.push({ kind: 'authorize', action }) },
    ],
    [token('ArchiveStoreService'), { mutationVersion: 0, mutationPending: false }],
    [token('Injector'), { get: (key) => context.get(key) }],
  ]);
  return {
    service: new PlannerNativeService(),
    task,
    state,
    profile: { timezone: 'Europe/Madrid', areas: [] },
  };
}
const expected = (task) =>
  Object.fromEntries(
    ['dueDay', 'dueWithTime', 'remindAt', 'timeEstimate', 'timeSpent'].map((key) => [
      key,
      task[key],
    ]),
  );
test('a date-only change uses native planner action and a timed change preserves reminder offset', async () => {
  let f = fixture();
  let result = await f.service.execute(
    'task',
    { taskId: f.task.id, fields: { dueDay: '2030-01-03' } },
    f.profile,
  );
  assert.equal(result.status, 'applied');
  assert(calls.some((v) => v.kind === 'planTaskForDay' && v.day === '2030-01-03'));
  assert(!calls.some((v) => v.kind === 'update' && 'dueDay' in v.changes));
  f = fixture();
  const target = Date.UTC(2030, 0, 5, 12);
  result = await f.service.execute(
    'task',
    { taskId: f.task.id, fields: { dueWithTime: target } },
    f.profile,
  );
  assert.equal(result.status, 'applied');
  const action = calls.find((v) => v.kind === 'reScheduleTaskWithTime');
  assert.equal(action.dueWithTime, target);
  assert.equal(action.remindAt, target - 15 * 60000);
});
test('clearing scheduling uses unschedule and ambiguous fields or scopes reject before dispatch', async () => {
  let f = fixture();
  await f.service.execute(
    'task',
    { taskId: f.task.id, fields: { dueWithTime: null } },
    f.profile,
  );
  assert(calls.some((v) => v.kind === 'unscheduleTask'));
  for (const args of [
    {
      taskId: 'task-example',
      fields: { dueDay: '2030-01-03', dueWithTime: Date.UTC(2030, 0, 3, 10) },
    },
    { taskId: 'task-example', moveScope: 'unexpected', fields: { title: 'Example' } },
  ]) {
    f = fixture();
    await assert.rejects(f.service.execute('task', args, f.profile));
    assert(
      !calls.some((v) => ['planTaskForDay', 'unscheduleTask', 'update'].includes(v.kind)),
    );
  }
});
test('an explicit occurrence move leaves the recurring configuration and other instances untouched', async () => {
  const f = fixture();
  f.task.repeatCfgId = 'repeat-example';
  await f.service.execute(
    'task',
    {
      taskId: f.task.id,
      moveScope: 'occurrence',
      fields: { projectId: 'project-other' },
    },
    f.profile,
  );
  assert(calls.some((v) => v.kind === 'occurrenceMove'));
  assert(!calls.some((v) => v.kind === 'seriesMove'));
});
test('native proposal batch preflights all tasks and checks context after asynchronous authorization', async () => {
  let f = fixture();
  const target = Date.UTC(2030, 0, 7, 10);
  let guarded = false;
  let result = await f.service.execute(
    'schedule',
    {
      entries: [{ taskId: f.task.id, dueWithTime: target, expected: expected(f.task) }],
      assertCurrent: () => {
        guarded = true;
      },
    },
    f.profile,
  );
  assert.equal(result.status, 'applied');
  assert.deepEqual(result.taskIds, [f.task.id]);
  assert(guarded);
  assert(calls.some((v) => v.kind === 'reScheduleTaskWithTime'));
  f = fixture();
  const entry = { taskId: f.task.id, dueWithTime: target, expected: expected(f.task) };
  f.task.timeSpent = 1;
  await assert.rejects(
    f.service.execute('schedule', { entries: [entry] }, f.profile),
    /cambi|stale/i,
  );
  assert(!calls.some((v) => v.kind === 'reScheduleTaskWithTime'));
});
test('a host-only authorizer allows the UI without granting any MCP capability', async () => {
  const f = fixture();
  let checks = 0;
  await f.service.execute(
    'task',
    { taskId: f.task.id, fields: { title: 'Example' } },
    f.profile,
    async () => {
      checks++;
    },
  );
  assert(checks >= 2);
  assert(!calls.some((v) => v.kind === 'authorize'));
});

test('native proposals reject stale context and revoked access before any scheduling action', async () => {
  for (const mode of ['guard', 'revoke', 'identity']) {
    const f = fixture();
    let checks = 0;
    const entry = {
      taskId: f.task.id,
      dueWithTime: Date.UTC(2030, 0, 9, 10),
      expected: expected(f.task),
    };
    await assert.rejects(
      f.service.execute(
        'schedule',
        {
          entries: [entry],
          assertCurrent: () => {
            if (mode === 'guard') throw Error('stale context');
          },
        },
        f.profile,
        async () => {
          if (++checks === 2) {
            if (mode === 'revoke') throw Error('revoked');
            if (mode === 'identity') f.state.entities[f.task.id] = { ...f.task };
          }
        },
      ),
    );
    assert(
      !calls.some((v) =>
        ['reScheduleTaskWithTime', 'scheduleTaskWithTime'].includes(v.kind),
      ),
    );
  }
});

test('all selected tasks are validated before scheduling the first one', async () => {
  const f = fixture();
  await assert.rejects(
    f.service.execute(
      'schedule',
      {
        entries: [
          {
            taskId: f.task.id,
            dueWithTime: Date.UTC(2030, 0, 9, 10),
            expected: expected(f.task),
          },
          {
            taskId: 'missing-task',
            dueWithTime: Date.UTC(2030, 0, 9, 11),
            expected: expected(f.task),
          },
        ],
      },
      f.profile,
    ),
  );
  assert(!calls.some((v) => v.kind === 'reScheduleTaskWithTime'));
});

test('a whole-series project move requires explicit scope and reauthorizes at the native helper boundary', async () => {
  let f = fixture();
  f.task.repeatCfgId = 'repeat-example';
  let checks = 0;
  let result = await f.service.execute(
    'task',
    { taskId: f.task.id, moveScope: 'series', fields: { projectId: 'project-other' } },
    f.profile,
    async () => {
      checks++;
    },
  );
  assert.equal(result.status, 'applied');
  assert.equal(checks, 3);
  assert(calls.some((v) => v.kind === 'seriesMove'));
  f = fixture();
  f.task.repeatCfgId = 'repeat-example';
  checks = 0;
  await assert.rejects(
    f.service.execute(
      'task',
      { taskId: f.task.id, moveScope: 'series', fields: { projectId: 'project-other' } },
      f.profile,
      async () => {
        if (++checks === 3) context.get(token('ArchiveStoreService')).mutationVersion++;
      },
    ),
    (error) => error.code === 'STALE_DATA',
  );
  assert(!calls.some((v) => v.kind === 'seriesMove'));
  f = fixture();
  await assert.rejects(
    f.service.execute(
      'task',
      { taskId: f.task.id, moveScope: 'series', fields: { title: 'Example' } },
      f.profile,
    ),
  );
});

test('logical day settings and host snapshot are rechecked after authorization before tracking', async () => {
  for (const mode of ['boundary', 'snapshot']) {
    const f = fixture();
    const cfg = { misc: { startOfNextDayTime: '00:00' } };
    context.get(token('GlobalConfigService')).cfg = () => cfg;
    f.profile.timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    f.profile.areas = [
      { id: 'example-area', projectIds: [f.task.projectId], tagIds: [] },
    ];
    let checks = 0;
    let tracked = false;
    context.get(token('TaskService')).addTimeSpentAndSync = () => {
      tracked = true;
    };
    await assert.rejects(
      f.service.execute(
        'log_time',
        {
          activityId: 'example-area',
          taskId: f.task.id,
          date: '2029-12-31',
          durationMs: 60000,
          assertCurrent: () => {
            if (mode === 'snapshot') throw Error('stale association');
          },
        },
        f.profile,
        async () => {
          if (++checks === 2 && mode === 'boundary')
            cfg.misc.startOfNextDayTime = '03:00';
        },
      ),
    );
    assert.equal(tracked, false);
  }
});

test('series failures distinguish preflight rejection from uncertain post-transition errors', async () => {
  for (const phase of ['before', 'after']) {
    const f = fixture();
    f.task.repeatCfgId = 'repeat-example';
    context.get(token('TaskMoveToProjectService')).moveToProject = async (
      _task,
      _project,
      opts,
    ) => {
      if (phase === 'after') {
        await opts.beforeMove(true);
        opts.atMove();
        calls.push({ kind: 'seriesMove' });
      }
      throw Error('private implementation failure');
    };
    const work = f.service.execute(
      'task',
      { taskId: f.task.id, moveScope: 'series', fields: { projectId: 'project-other' } },
      f.profile,
    );
    if (phase === 'before')
      await assert.rejects(
        work,
        (error) =>
          error.code === 'DATA_UNAVAILABLE' && !error.message.includes('private'),
      );
    else {
      const result = await work;
      assert.equal(result.status, 'uncertain');
      assert.equal(result.code, 'OUTCOME_UNKNOWN');
    }
  }
});

test('correct_time replaces only the selected civil-day duration through native update without making a session', async () => {
  for (const next of [0, 120000]) {
    const f = fixture();
    f.profile.timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    f.profile.areas = [
      { id: 'area-example', projectIds: [f.task.projectId], tagIds: [] },
    ];
    f.task.timeSpentOnDay = { '2029-12-30': 30000, '2029-12-31': 60000 };
    const result = await f.service.execute(
      'correct_time',
      {
        taskId: f.task.id,
        activityId: 'area-example',
        date: '2029-12-31',
        durationMs: next,
        expectedDurationMs: 60000,
        assertCurrent: () => {},
      },
      f.profile,
    );
    assert.equal(result.status, 'applied');
    const update = calls.find((v) => v.kind === 'update');
    assert.deepEqual(update.changes, {
      timeSpentOnDay: { '2029-12-30': 30000, '2029-12-31': next },
    });
    assert(!calls.some((v) => v.kind === 'addTimeSpentAndSync'));
  }
});

test('correct_time rejects stale totals, parents and unavailable archived tasks before any write', async () => {
  for (const mode of ['stale', 'parent', 'archive']) {
    const f = fixture();
    f.profile.timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    f.profile.areas = [
      { id: 'area-example', projectIds: [f.task.projectId], tagIds: [] },
    ];
    if (mode === 'parent') f.task.subTaskIds = ['child-example'];
    if (mode === 'archive') delete f.state.entities[f.task.id];
    await assert.rejects(
      f.service.execute(
        'correct_time',
        {
          taskId: f.task.id,
          activityId: 'area-example',
          date: '2029-12-31',
          durationMs: 60000,
          expectedDurationMs: mode === 'stale' ? 1 : 0,
        },
        f.profile,
      ),
    );
    assert(!calls.some((v) => v.kind === 'update'));
  }
});

test('undo restores exact native planning fields while preserving later tracked time and completed state', async () => {
  const f = fixture();
  f.task.isDone = true;
  f.task.timeSpent = 120000;
  f.task.timeSpentOnDay = { '2030-01-01': 120000 };
  const target = Date.UTC(2030, 0, 2, 15);
  const result = await f.service.execute(
    'restore_schedule',
    {
      entries: [
        {
          taskId: f.task.id,
          expectedAfter: {
            dueDay: null,
            dueWithTime: f.task.dueWithTime,
            remindAt: f.task.remindAt,
          },
          before: { dueDay: null, dueWithTime: target, remindAt: target - 30000 },
        },
      ],
      assertCurrent: () => {},
    },
    f.profile,
  );
  assert.equal(result.status, 'applied');
  assert.deepEqual(result.taskIds, [f.task.id]);
  const action = calls.find((v) => v.kind === 'reScheduleTaskWithTime');
  assert.equal(action.remindAt, target - 30000);
  assert.equal(f.task.isDone, true);
  assert.equal(f.task.timeSpent, 120000);
  assert(!calls.some((v) => v.kind === 'update'));
});

test('undo refuses changed plan fields and preflights the entire selection before any restoration', async () => {
  const f = fixture();
  await assert.rejects(
    f.service.execute(
      'restore_schedule',
      {
        entries: [
          {
            taskId: f.task.id,
            expectedAfter: {
              dueDay: null,
              dueWithTime: f.task.dueWithTime + 1,
              remindAt: f.task.remindAt,
            },
            before: { dueDay: null, dueWithTime: null, remindAt: null },
          },
        ],
      },
      f.profile,
    ),
  );
  assert(!calls.some((v) => v.kind === 'unscheduleTask'));
});

test('split uses native subtask actions with literal titles and never writes copied tracking fields', async () => {
  const f = fixture();
  f.task.timeSpentOnDay = { '2029-12-31': 60000 };
  f.task.timeSpent = 60000;
  let index = 0;
  context.get(token('TaskService')).createNewTaskWithDefaults = ({
    title,
    additional,
  }) => ({
    ...f.task,
    ...additional,
    id: 'child-' + ++index,
    title,
    timeSpentOnDay: {},
    timeSpent: 0,
    subTaskIds: [],
  });
  const result = await f.service.execute(
    'task',
    {
      command: 'split',
      taskId: f.task.id,
      children: [
        { title: 'First #literal', timeEstimate: 120000 },
        { title: 'Second', timeEstimate: 60000 },
      ],
    },
    f.profile,
  );
  assert.equal(result.status, 'applied');
  assert.deepEqual(result.taskIds, ['child-1', 'child-2']);
  const children = calls.filter((v) => v.kind === 'addSubTask');
  assert.equal(children.length, 2);
  assert(children.every((v) => v.parentId === f.task.id && v.isIgnoreShortSyntax));
  assert.deepEqual(children[0].task.timeSpentOnDay, {});
  assert(!calls.some((v) => v.kind === 'update'));
});

test('archive explicitly delegates completion plus archiving to the native service with all subtasks', async () => {
  const f = fixture();
  f.task.subTaskIds = ['child-example'];
  f.state.entities['child-example'] = {
    ...f.task,
    id: 'child-example',
    parentId: f.task.id,
    subTaskIds: [],
  };
  context.get(token('TaskService')).moveToArchive = async (task, guards) => {
    await guards.beforeWrite();
    guards.atWrite();
    calls.push({ kind: 'archive', task });
    guards.beforeRemove();
  };
  const result = await f.service.execute(
    'task',
    { command: 'archive', taskId: f.task.id },
    f.profile,
  );
  assert.equal(result.status, 'applied');
  assert.equal(calls.find((v) => v.kind === 'archive').task.subTasks.length, 1);
});

test('archive refuses fresh permission denial before write and retains concurrent live tracking after write begins', async () => {
  for (const phase of ['permission', 'tracking']) {
    const f = fixture();
    let checks = 0;
    context.get(token('TaskService')).moveToArchive = async (task, guards) => {
      await guards.beforeWrite();
      guards.atWrite();
      calls.push({ kind: 'archiveWrite', task });
      f.state.entities[f.task.id] = {
        ...f.task,
        timeSpent: 60000,
        timeSpentOnDay: { '2030-01-01': 60000 },
      };
      await Promise.resolve();
      guards.beforeRemove();
      delete f.state.entities[f.task.id];
    };
    const work = f.service.execute(
      'task',
      { taskId: f.task.id, command: 'archive' },
      f.profile,
      async () => {
        if (++checks === 3 && phase === 'permission') {
          const {
            PlannerError,
          } = require('../../../../packages/personal-planner-core/operations.mjs');
          throw new PlannerError('NOT_PERMITTED', 'revoked');
        }
      },
    );
    if (phase === 'permission') {
      await assert.rejects(work, (error) => error.code === 'NOT_PERMITTED');
      assert(!calls.some((v) => v.kind === 'archiveWrite'));
    } else {
      const result = await work;
      assert.equal(result.status, 'uncertain');
      assert.equal(f.state.entities[f.task.id].timeSpent, 60000);
    }
  }
});

test('undo accepts later recorded time and completion even when they arrive during fresh authorization', async () => {
  const f = fixture();
  let checks = 0;
  const result = await f.service.execute(
    'restore_schedule',
    {
      entries: [
        {
          taskId: f.task.id,
          expectedAfter: {
            dueDay: null,
            dueWithTime: f.task.dueWithTime,
            remindAt: f.task.remindAt,
          },
          before: { dueDay: null, dueWithTime: null, remindAt: null },
        },
      ],
    },
    f.profile,
    async () => {
      if (++checks === 2)
        f.state.entities[f.task.id] = { ...f.task, isDone: true, timeSpent: 300000 };
    },
  );
  assert.equal(result.status, 'applied');
  assert(calls.some((v) => v.kind === 'unscheduleTask'));
  assert.equal(f.state.entities[f.task.id].timeSpent, 300000);
  assert.equal(f.state.entities[f.task.id].isDone, true);
});

test('correct_time rechecks fresh host permissions and snapshot before native update', async () => {
  for (const mode of ['permission', 'snapshot']) {
    const f = fixture();
    f.profile.timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    f.profile.areas = [
      { id: 'area-example', projectIds: [f.task.projectId], tagIds: [] },
    ];
    let checks = 0;
    await assert.rejects(
      f.service.execute(
        'correct_time',
        {
          taskId: f.task.id,
          activityId: 'area-example',
          date: '2029-12-31',
          durationMs: 60000,
          expectedDurationMs: 0,
          assertCurrent: () => {
            if (mode === 'snapshot') throw Error('stale snapshot');
          },
        },
        f.profile,
        async () => {
          if (++checks === 2 && mode === 'permission') throw Error('revoked');
        },
      ),
    );
    assert(!calls.some((v) => v.kind === 'update'));
  }
});

test('known manual duration today reaches the real native reducer without inventing a session interval', () => {
  const fs = require('node:fs'),
    ts = require('typescript'),
    vm = require('node:vm');
  const source = ts.createSourceFile(
    'task.service.ts',
    fs.readFileSync(require.resolve('../../features/tasks/task.service.ts'), 'utf8'),
    ts.ScriptTarget.Latest,
    true,
  );
  const serviceClass = source.statements.find(
    (node) => ts.isClassDeclaration(node) && node.name?.text === 'TaskService',
  );
  const methods = serviceClass.members
    .filter((node) => ['addTimeSpent', 'addTimeSpentAndSync'].includes(node.name?.text))
    .map((node) => node.getText(source))
    .join('\n');
  const reducerSource = ts.createSourceFile(
    'time-tracking.reducer.ts',
    fs.readFileSync(
      require.resolve('../../features/time-tracking/store/time-tracking.reducer.ts'),
      'utf8',
    ),
    ts.ScriptTarget.Latest,
    true,
  );
  let handler;
  const find = (node) => {
    if (
      ts.isCallExpression(node) &&
      node.expression.getText(reducerSource) === 'on' &&
      node.arguments[0]?.getText(reducerSource) === 'TimeTrackingActions.addTimeSpent'
    )
      handler = node.arguments[1].getText(reducerSource);
    ts.forEachChild(node, find);
  };
  find(reducerSource);
  assert(handler, 'Expected real native add-time reducer handler');
  const actions = [];
  const sandbox = {
    TimeTrackingActions: { addTimeSpent: (props) => ({ type: 'add', ...props }) },
    syncTimeSpent: (props) => ({ type: 'sync', ...props }),
    Date,
    roundTsToMinutes: (value) => Math.round(value / 60000) * 60000,
    TODAY_TAG: { id: 'TODAY' },
  };
  const code = ts.transpileModule(
    'class TimeProbe {' +
      methods +
      '}\nglobalThis.TimeProbe = TimeProbe;globalThis.handler = ' +
      handler +
      ';',
    { compilerOptions: { target: ts.ScriptTarget.ES2022 } },
  ).outputText;
  vm.runInNewContext(code, sandbox);
  const native = new sandbox.TimeProbe();
  native._store = { dispatch: (action) => actions.push(action) };
  native._taskTimeSync = { flushOne: () => {} };
  native._dateService = { todayStr: () => '2030-01-01' };
  const before = {
    project: { example: { '2030-01-01': { s: 60000, e: 120000 } } },
    tag: {},
  };
  const task = { id: 'task-example', projectId: 'example', tagIds: [] };
  native.addTimeSpentAndSync(task, 60000, '2030-01-01', true);
  assert.equal(
    sandbox.handler(
      before,
      actions.find((action) => action.type === 'add'),
    ),
    before,
    'Manual duration must leave actual session bounds untouched',
  );
  assert.equal(actions.find((action) => action.type === 'sync').duration, 60000);
  actions.length = 0;
  native.addTimeSpentAndSync(task, 60000, '2030-01-01');
  assert.notEqual(
    sandbox.handler(
      before,
      actions.find((action) => action.type === 'add'),
    ),
    before,
    'Existing interval-aware callers keep native session behavior',
  );
});

test('planner log_time declares an unanchored duration even when registering today', async () => {
  const f = fixture();
  f.profile.timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  f.profile.areas = [{ id: 'area-example', projectIds: [f.task.projectId], tagIds: [] }];
  let received;
  context.get(token('TaskService')).addTimeSpentAndSync = (...args) => {
    received = args;
  };
  const result = await f.service.execute(
    'log_time',
    {
      taskId: f.task.id,
      activityId: 'area-example',
      date: '2030-01-01',
      durationMs: 60000,
    },
    f.profile,
  );
  assert.equal(result.status, 'applied');
  assert.equal(received[3], true);
});

test('native completion supplies one timestamp shared by the real local reducer and operation replay', async () => {
  const f = fixture();
  f.task.isDone = false;
  await f.service.execute(
    'task',
    { taskId: f.task.id, fields: { isDone: true } },
    f.profile,
  );
  const changes = calls.find((call) => call.kind === 'update').changes;
  const fs = require('node:fs'),
    ts = require('typescript'),
    vm = require('node:vm');
  const read = (filename) =>
    ts.createSourceFile(
      filename,
      fs.readFileSync(filename, 'utf8'),
      ts.ScriptTarget.Latest,
      true,
    );
  const util = read(require.resolve('../../features/tasks/store/task.reducer.util.ts'));
  let update;
  const visit = (node) => {
    if (
      ts.isVariableDeclaration(node) &&
      node.name.getText(util) === 'updateDoneOnForTask'
    )
      update = node.initializer.getText(util);
    ts.forEachChild(node, visit);
  };
  visit(util);
  const captureSource = read(
    require.resolve('../../op-log/capture/operation-log.effects.ts'),
  );
  let capture;
  const find = (node) => {
    if (
      ts.isMethodDeclaration(node) &&
      node.name.getText(captureSource) === 'addReplayDateFieldsToActionPayload'
    )
      capture = node.getText(captureSource);
    ts.forEachChild(node, find);
  };
  find(captureSource);
  assert(
    update && capture,
    'Expected actual native completion and capture implementations',
  );
  let now = 1000;
  const sandbox = {
    Date: { now: () => now },
    ActionType: { TASK_SHARED_UPDATE: 'update' },
    taskAdapter: {
      updateOne: ({ id, changes: patch }, state) => ({
        ...state,
        entities: { ...state.entities, [id]: { ...state.entities[id], ...patch } },
      }),
    },
  };
  vm.runInNewContext(
    ts.transpileModule(
      'const update=' +
        update +
        ';class Capture {' +
        capture +
        '};globalThis.update=update;globalThis.capture=new Capture();',
      { compilerOptions: { target: ts.ScriptTarget.ES2022 } },
    ).outputText,
    sandbox,
  );
  let state = { entities: { [f.task.id]: { ...f.task, isDone: true } } };
  state = sandbox.update({ id: f.task.id, changes }, state);
  const localDoneOn = state.entities[f.task.id].doneOn;
  now = 1006;
  const persisted = sandbox.capture.addReplayDateFieldsToActionPayload(
    { type: 'update' },
    { task: { id: f.task.id, changes } },
    now,
  );
  state = sandbox.update(persisted.task, state);
  assert.equal(
    state.entities[f.task.id].doneOn,
    localDoneOn,
    'Reload alone must preserve doneOn before any undo',
  );
  assert.equal(
    changes.doneOn,
    localDoneOn,
    'Native action must carry its concrete completion timestamp',
  );
});
