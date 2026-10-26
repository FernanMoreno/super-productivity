const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');
const { of, Subject } = require('rxjs');
require('ts-node').register({ transpileOnly: true, preferTsExts: true });
const filename = require('node:path').join(
  __dirname,
  'assistant-system-control.service.ts',
);
const tokens = new Map();
const token = (name) => {
  if (!tokens.has(name)) tokens.set(name, Symbol(name));
  return tokens.get(name);
};
let providers;
class IdleDialog {}
const oldLoad = Module._load;
Module._load = function (request, parent, ...rest) {
  if (parent?.filename === filename) {
    if (request === '@angular/core')
      return { Injectable: () => (c) => c, inject: (t) => providers.get(t) };
    if (request === '@angular/material/dialog')
      return { MatDialog: token('MatDialog'), MatDialogState: { OPEN: 0 } };
    if (request === '@ngrx/store') return { Store: token('Store') };
    if (request.endsWith('dialog-idle.component'))
      return { DialogIdleComponent: IdleDialog };
    if (request.endsWith('idle.selectors'))
      return { selectIsIdleTimeFrozen: token('frozen') };
    if (request.endsWith('task.selectors'))
      return { selectTaskFeatureState: token('taskState') };
    if (request.endsWith('environment')) return { environment: { version: '1.0.0' } };
    if (request.endsWith('is-update-check-possible.util'))
      return { isUpdateCheckPossible: () => true };
    const services = {
      'global-config.service': 'GlobalConfigService',
      'task.service': 'TaskService',
      'sync-wrapper.service': 'SyncWrapperService',
      'update-check.service': 'UpdateCheckService',
      'task-widget-settings.service': 'TaskWidgetSettingsService',
      'focus-mode-local-settings.service': 'FocusModeLocalSettingsService',
    };
    for (const [suffix, name] of Object.entries(services))
      if (request.endsWith(suffix)) return { [name]: token(name) };
  }
  return oldLoad.call(this, request, parent, ...rest);
};
let AssistantSystemControlService;
try {
  ({ AssistantSystemControlService } = require(filename));
} finally {
  Module._load = oldLoad;
}

function fixture() {
  const calls = [];
  const cfg = {
    appFeatures: { isFocusModeEnabled: false },
    localization: { lng: 'es' },
    misc: { isDisableAnimations: false, unsplashApiKey: 'credential-secret' },
    tasks: { isAutoMarkParentAsDone: false, notesTemplate: '**template**' },
    timeTracking: { isAutoStartNextTask: false },
    idle: { minIdleTime: 60000 },
    schedule: { workStart: '9:00' },
    flowtime: {
      isBreakEnabled: true,
      breakMode: 'rule',
      breakRules: [{ minDuration: 0, maxDuration: 1500000, breakDuration: 300000 }],
    },
    keyboard: { taskToggleDone: 'D' },
    sync: { isEnabled: true, syncProvider: 'WebDAV', password: 'sync-secret' },
  };
  const taskWidgetSettings = { isEnabled: false, isAlwaysShow: false, opacity: 95 };
  const focusModeLocalSettings = { isLoopBreakEndAlarm: false };
  const config = {
    cfg: () => cfg,
    updateSection: (section, changes) => {
      calls.push('settings');
      Object.assign(cfg[section], changes);
    },
  };
  const closed = new Subject();
  const taskState = { entities: { t: { id: 't', subTaskIds: [] } }, currentTaskId: null };
  let isOpen = true;
  const component = new IdleDialog();
  Object.assign(component, {
    idleTime: () => 120000,
    data: { wasFocusSessionRunning: true },
    simpleCounterToggleBtns: [{ id: 'c', isTrackTo: true }],
    isResetBreakTimer: false,
  });
  const ref = {
    componentInstance: component,
    getState: () => (isOpen ? 0 : 2),
    afterClosed: () => closed,
    close: (result) => {
      calls.push(result);
      const target = result.trackItems?.find((item) => item.task)?.task;
      if (target && taskState.entities[target.id]) taskState.currentTaskId = target.id;
      isOpen = false;
      closed.next(result);
      closed.complete();
    },
  };
  const dialog = { openDialogs: [ref] };
  const sync = {
    busy: false,
    isSyncInProgressSync: () => sync.busy,
    isEncryptionOperationInProgress: false,
    isEnabledAndReady$: of(true),
    syncState$: of('IN_SYNC'),
    sync: async () => 'HANDLED_ERROR',
  };
  const update = {
    checkForUpdateOutcome: async () => ({
      status: 'up_to_date',
      currentVersion: '1.0.0',
    }),
  };
  providers = new Map([
    [token('GlobalConfigService'), config],
    [token('MatDialog'), dialog],
    [token('TaskService'), { getByIdOnce$: () => of(taskState.entities.t) }],
    [
      token('Store'),
      {
        selectSignal: (selector) => () =>
          selector === token('taskState') ? taskState : true,
      },
    ],
    [token('SyncWrapperService'), sync],
    [token('UpdateCheckService'), update],
    [
      token('TaskWidgetSettingsService'),
      {
        settings: () => taskWidgetSettings,
        update: (changes) => {
          calls.push('widget');
          Object.assign(taskWidgetSettings, changes);
        },
      },
    ],
    [
      token('FocusModeLocalSettingsService'),
      {
        settings: () => focusModeLocalSettings,
        update: (changes) => {
          calls.push('focus-mode-local');
          Object.assign(focusModeLocalSettings, changes);
        },
      },
    ],
  ]);
  const service = new AssistantSystemControlService();
  const context = {
    authorize: async () => calls.push('authorize'),
    markMutation: () => calls.push('mutation'),
  };
  return {
    service,
    context,
    calls,
    cfg,
    taskWidgetSettings,
    focusModeLocalSettings,
    sync,
    update,
    ref,
    component,
    dialog,
    taskState,
  };
}

test('settings projection reads built-in and local preferences without exposing provider credentials', async () => {
  const f = fixture();
  const result = await f.service.run('app_settings', { command: 'read' }, f.context);
  assert.ok(!JSON.stringify(result).includes('credential-secret'));
  assert.ok(!JSON.stringify(result).includes('sync-secret'));
  assert.equal(result.settings.misc.isDisableAnimations, false);
  assert.ok(!Object.hasOwn(result.settings.tasks, 'notesTemplate'));
  assert.equal(result.settings.appFeatures.isFocusModeEnabled, false);
  assert.equal(result.settings.localization.lng, 'es');
  assert.equal(result.settings.schedule.workStart, '9:00');
  assert.equal(result.settings.keyboard.taskToggleDone, 'D');
  assert.equal(result.settings.taskWidget.opacity, 95);
  assert.equal(result.settings.focusModeLocal.isLoopBreakEndAlarm, false);
  assert.ok(!Object.hasOwn(result.settings.misc, 'unsplashApiKey'));
  assert.ok(!Object.hasOwn(result.settings, 'sync'));
  const withNotes = await f.service.run(
    'app_settings',
    { command: 'read', section: 'tasks', includeNotesTemplate: true },
    f.context,
  );
  assert.equal(withNotes.settings.tasks.notesTemplate, '**template**');
});
test('settings expected-value conflict is atomic and safe update is authorized', async () => {
  const f = fixture();
  await assert.rejects(
    f.service.run(
      'app_settings',
      {
        command: 'update',
        section: 'misc',
        changes: { isDisableAnimations: true },
        expected: { isDisableAnimations: true },
      },
      f.context,
    ),
    { code: 'CONFLICT' },
  );
  assert.deepEqual(f.calls, []);
  await f.service.run(
    'app_settings',
    {
      command: 'update',
      section: 'misc',
      changes: { isDisableAnimations: true },
      expected: { isDisableAnimations: false },
    },
    f.context,
  );
  assert.deepEqual(f.calls, ['authorize', 'mutation', 'settings']);
});
test('settings updates nested values through shared config and compares structures by value', async () => {
  const f = fixture();
  const rules = [{ minDuration: 0, maxDuration: 1800000, breakDuration: 300000 }];
  await f.service.run(
    'app_settings',
    {
      command: 'update',
      section: 'flowtime',
      changes: { breakRules: rules },
      expected: {
        breakRules: [{ breakDuration: 300000, maxDuration: 1500000, minDuration: 0 }],
      },
    },
    f.context,
  );
  assert.deepEqual(f.cfg.flowtime.breakRules, rules);
  assert.deepEqual(f.calls.slice(-3), ['authorize', 'mutation', 'settings']);
});
test('notes template can be updated through its protected app-settings field', async () => {
  const f = fixture();
  await f.service.run(
    'app_settings',
    {
      command: 'update',
      section: 'tasks',
      changes: { notesTemplate: 'updated' },
      expected: { notesTemplate: '**template**' },
    },
    f.context,
  );
  assert.equal(f.cfg.tasks.notesTemplate, 'updated');
});
test('native settings rejects malformed values before authorization or mutation', async () => {
  const f = fixture();
  await assert.rejects(
    f.service.run(
      'app_settings',
      {
        command: 'update',
        section: 'schedule',
        changes: { workStart: '25:00' },
        expected: { workStart: '9:00' },
      },
      f.context,
    ),
    { code: 'INVALID_ARGUMENT' },
  );
  assert.deepEqual(f.calls, []);
});
test('device-local settings use their own services instead of shared config', async () => {
  const f = fixture();
  await assert.rejects(
    f.service.run(
      'app_settings',
      {
        command: 'update',
        section: 'taskWidget',
        changes: { opacity: 80 },
        expected: { opacity: 90 },
      },
      f.context,
    ),
    { code: 'CONFLICT' },
  );
  assert.deepEqual(f.calls, []);
  await f.service.run(
    'app_settings',
    {
      command: 'update',
      section: 'taskWidget',
      changes: { opacity: 80 },
      expected: { opacity: 95 },
    },
    f.context,
  );
  assert.equal(f.taskWidgetSettings.opacity, 80);
  assert.deepEqual(f.calls.slice(-3), ['authorize', 'mutation', 'widget']);
  await f.service.run(
    'app_settings',
    {
      command: 'update',
      section: 'focusModeLocal',
      changes: { isLoopBreakEndAlarm: true },
      expected: { isLoopBreakEndAlarm: false },
    },
    f.context,
  );
  assert.equal(f.focusModeLocalSettings.isLoopBreakEndAlarm, true);
  assert.deepEqual(f.calls.slice(-3), ['authorize', 'mutation', 'focus-mode-local']);
  assert.deepEqual(
    f.calls.filter((call) => call === 'settings'),
    [],
  );
});
test('settings rechecks expected values after awaiting authorization', async () => {
  const f = fixture();
  f.context.authorize = async () => {
    f.cfg.misc.isDisableAnimations = true;
  };
  await assert.rejects(
    f.service.run(
      'app_settings',
      {
        command: 'update',
        section: 'misc',
        changes: { isDisableAnimations: true },
        expected: { isDisableAnimations: false },
      },
      f.context,
    ),
    { code: 'CONFLICT' },
  );
  assert.deepEqual(f.calls, []);
});
test('native settings refuses unsupported keys even without transport validation', async () => {
  const f = fixture();
  await assert.rejects(
    f.service.run(
      'app_settings',
      {
        command: 'update',
        section: 'misc',
        changes: { unsplashApiKey: 'changed' },
        expected: { unsplashApiKey: null },
      },
      f.context,
    ),
    { code: 'INVALID_ARGUMENT' },
  );
  assert.equal(f.cfg.misc.unsplashApiKey, 'credential-secret');
});
test('idle uses one stable review identity and closes real dialog with native counter/focus semantics', async () => {
  const f = fixture();
  const a = await f.service.run('idle_review', { command: 'status' }, f.context);
  const b = await f.service.run('idle_review', { command: 'status' }, f.context);
  assert.equal(a.reviewId, b.reviewId);
  await f.service.run(
    'idle_review',
    {
      command: 'track_task',
      reviewId: a.reviewId,
      expectedIdleTime: 120000,
      taskId: 't',
    },
    f.context,
  );
  const result = f.calls[2];
  assert.equal(result.wasFocusSessionRunning, true);
  assert.equal(result.trackItems[0].task.id, 't');
  assert.equal(result.trackItems[0].time, 'IDLE_TIME');
  assert.equal(result.trackItems[0].simpleCounterToggleBtns[0].isTrackTo, true);
  await assert.rejects(
    f.service.run(
      'idle_review',
      { command: 'discard', reviewId: a.reviewId, expectedIdleTime: 120000 },
      f.context,
    ),
    { code: 'CONFLICT' },
  );
});
test('idle rejects stale duration and dialog closing during authorization', async () => {
  const f = fixture();
  const a = await f.service.run('idle_review', { command: 'status' }, f.context);
  await assert.rejects(
    f.service.run(
      'idle_review',
      { command: 'discard', reviewId: a.reviewId, expectedIdleTime: 1 },
      f.context,
    ),
    { code: 'CONFLICT' },
  );
  f.context.authorize = async () => f.ref.close({});
  await assert.rejects(
    f.service.run(
      'idle_review',
      { command: 'discard', reviewId: a.reviewId, expectedIdleTime: 120000 },
      f.context,
    ),
    { code: 'CONFLICT' },
  );
  assert.ok(!f.calls.includes('mutation'));
});
test('sync reports handled errors, busy and disabled accurately', async () => {
  const f = fixture();
  assert.equal(
    (await f.service.run('app_sync', { command: 'run' }, f.context)).status,
    'handled_error',
  );
  f.sync.busy = true;
  assert.equal(
    (await f.service.run('app_sync', { command: 'run' }, f.context)).status,
    'busy',
  );
  f.cfg.sync.isEnabled = false;
  assert.equal(
    (await f.service.run('app_sync', { command: 'status' }, f.context)).status,
    'disabled',
  );
});
test('sync rechecks permission and provider state immediately before starting', async () => {
  const f = fixture();
  let authorizations = 0;
  f.context.authorize = async () => {
    authorizations++;
    if (authorizations === 2) f.cfg.sync.isEnabled = false;
  };
  let started = false;
  f.sync.sync = async () => {
    started = true;
    return 'IN_SYNC';
  };
  assert.equal(
    (await f.service.run('app_sync', { command: 'run' }, f.context)).status,
    'disabled',
  );
  assert.equal(started, false);
});
test('sync does not report non-success native outcomes as completed', async () => {
  for (const outcome of ['NotConfigured', 'Conflict', 'IncompleteRemoteData']) {
    const f = fixture();
    f.sync.sync = async () => outcome;
    assert.notEqual(
      (await f.service.run('app_sync', { command: 'run' }, f.context)).status,
      'completed',
    );
  }
});
test('update check returns native outcome and install is unsupported', async () => {
  const f = fixture();
  assert.equal(
    (await f.service.run('app_update', { command: 'check' }, f.context)).status,
    'up_to_date',
  );
  assert.equal(
    (await f.service.run('app_update', { command: 'install' }, f.context)).status,
    'unsupported',
  );
});

test('idle rejects target deletion or new children during authorization before closing', async () => {
  for (const change of [
    (state) => {
      delete state.entities.t;
    },
    (state) => {
      state.entities.t = { id: 't', subTaskIds: ['child'] };
    },
  ]) {
    const f = fixture();
    const review = await f.service.run('idle_review', { command: 'status' }, f.context);
    f.context.authorize = async () => change(f.taskState);
    await assert.rejects(
      f.service.run(
        'idle_review',
        {
          command: 'track_task',
          reviewId: review.reviewId,
          expectedIdleTime: 120000,
          taskId: 't',
        },
        f.context,
      ),
      { code: 'CONFLICT' },
    );
    assert.equal(f.ref.getState(), 0);
    assert.ok(!f.calls.includes('mutation'));
  }
});

test('idle does not confirm resumption if target disappears during close animation', async () => {
  const f = fixture();
  const review = await f.service.run('idle_review', { command: 'status' }, f.context);
  const close = f.ref.close;
  f.ref.close = (result) => {
    delete f.taskState.entities.t;
    close(result);
  };
  await assert.rejects(
    f.service.run(
      'idle_review',
      {
        command: 'track_task',
        reviewId: review.reviewId,
        expectedIdleTime: 120000,
        taskId: 't',
      },
      f.context,
    ),
    { code: 'CONFLICT' },
  );
  assert.ok(f.calls.includes('mutation'));
});
