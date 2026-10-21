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
