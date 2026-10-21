import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createPlannerOperations,
  contextRevision,
  PlannerError,
} from '../operations.mjs';
import { emptyProfile, createArea } from '../model.mjs';
import { taskSnapshot } from '../metrics.mjs';
function fixture() {
  const storage = new Map();
  let nativeCalls = 0;
  let tasks = [];
  const profile = emptyProfile();
  profile.areas = [
    { ...createArea('Actividad ficticia', 'area-test'), dailyMinutes: 30 },
  ];
  storage.set('profile-v1', JSON.stringify(profile));
  const ports = {
    read: async (key) => storage.get(key) ?? null,
    cas: async (key, expected, next, guard) => {
      guard?.();
      if ((storage.get(key) ?? null) !== expected) return false;
      storage.set(key, next);
      return true;
    },
    snapshot: async () => {
      const captured = JSON.stringify(tasks);
      return Object.assign(taskSnapshot(tasks, []), {
        timezone: 'Europe/Madrid',
        weekStartsOn: 1,
        civilDaysReliable: true,
        assertCurrent: () => {
          if (JSON.stringify(tasks) !== captured)
            throw new PlannerError('STALE_PLAN', 'Native data changed');
        },
      });
    },
    native: async () => {
      nativeCalls++;
      return { status: 'applied', taskId: 'native-task' };
    },
  };
  return {
    storage,
    ports,
    api: createPlannerOperations(ports),
    calls: () => nativeCalls,
    setTasks: (v) => (tasks = v),
  };
}
test('goal changes preserve past and retry returns same confirmed result', async () => {
  const f = fixture();
  const { revision } = await f.api.activities();
  const request = {
    operationId: 'operation-goals',
    baseRevision: revision,
    command: {
      type: 'activity.goals',
      payload: {
        id: 'area-test',
        from: '2027-01-01',
        goals: { dailyMinutes: 70, weeklyMinutes: null, targetHours: null },
      },
    },
  };
  const first = await f.api.edit(request);
  assert.equal(first.status, 'applied');
  assert.equal((await f.api.edit(request)).replayed, true);
  const p = (await f.api.activities()).profile;
  assert.equal(p.areas[0].dailyMinutes, 30);
  assert.equal(p.areas[0].goalHistory[0].dailyMinutes, 70);
  assert.equal(
    (
      await f.api.edit({
        ...request,
        command: {
          type: 'activity.state',
          payload: { id: 'area-test', from: '2027-01-01', state: 'paused' },
        },
      })
    ).code,
    'OPERATION_ID_REUSED',
  );
});
test('stale UI replacement cannot overwrite assistant goal edit', async () => {
  const f = fixture(),
    old = await f.api.activities();
  await f.api.edit({
    operationId: 'first-operation',
    baseRevision: old.revision,
    command: {
      type: 'activity.update',
      payload: { id: 'area-test', updates: { name: 'Renombrada' } },
    },
  });
  const result = await f.api.edit({
    operationId: 'stale-ui-operation',
    baseRevision: old.revision,
    command: { type: 'profile.replace', payload: old.profile },
  });
  assert.equal(result.status, 'conflict');
  assert.equal((await f.api.activities()).profile.areas[0].name, 'Renombrada');
});
test('native operation retries never duplicate time; conflicting ID rejected', async () => {
  const f = fixture(),
    request = {
      operationId: 'time-operation',
      activityId: 'area-test',
      taskId: 'native-task',
      date: '2026-01-01',
      durationMs: 60000,
    };
  assert.equal((await f.api.logTime(request)).status, 'applied');
  assert.equal((await f.api.logTime(request)).replayed, true);
  assert.equal(f.calls(), 1);
  assert.equal(
    (await f.api.logTime({ ...request, durationMs: 120000 })).code,
    'OPERATION_ID_REUSED',
  );
  assert.equal(f.calls(), 1);
});
test('uncertain operation remains pending and is never executed again', async () => {
  const f = fixture();
  f.ports.native = async () => {
    throw Error('connection lost after dispatch');
  };
  const api = createPlannerOperations(f.ports),
    request = { operationId: 'uncertain-operation', fields: { title: 'Ficticia' } };
  assert.equal((await api.task(request)).status, 'uncertain');
  assert.equal((await api.task(request)).code, 'OUTCOME_UNKNOWN');
});
test('proposal detects later native data and applies selected blocks only once', async () => {
  const f = fixture();
  const p = await f.api.prepare({ from: '2026-11-02', to: '2026-11-02' });
  assert.ok(p.proposals.length);
  f.setTasks([
    {
      id: 'new-task',
      title: 'Nueva ficticia',
      dueDay: '2026-11-02',
      timeEstimate: 60000,
      timeSpent: 0,
      timeSpentOnDay: {},
      tagIds: [],
    },
  ]);
  assert.equal(
    (
      await f.api.apply({
        operationId: 'stale-proposal-op',
        proposalId: p.proposalId,
        selection: [p.proposals[0].id],
      })
    ).code,
    'STALE_PLAN',
  );
  const fresh = await f.api.prepare({ from: '2026-11-02', to: '2026-11-02' });
  const request = {
    operationId: 'apply-proposal-op',
    proposalId: fresh.proposalId,
    selection: [fresh.proposals[0].id],
  };
  assert.equal((await f.api.apply(request)).status, 'applied');
  assert.equal((await f.api.apply(request)).replayed, true);
  assert.equal((await f.api.activities()).profile.commitments.length, 1);
});
test('two concurrent writers yield one applied revision and one conflict', async () => {
  const f = fixture(),
    revision = (await f.api.activities()).revision;
  const edit = (operationId, name) =>
    f.api.edit({
      operationId,
      baseRevision: revision,
      command: {
        type: 'activity.update',
        payload: { id: 'area-test', updates: { name } },
      },
    });
  assert.deepEqual(
    (
      await Promise.all([
        edit('concurrent-operation-a', 'A'),
        edit('concurrent-operation-b', 'B'),
      ])
    )
      .map((v) => v.status)
      .sort(),
    ['applied', 'conflict'],
  );
});
test('query uses same metrics/calendar and arbitrary profile configuration', async () => {
  const f = fixture();
  const q = await f.api.query({ from: '2026-11-02', to: '2026-11-03' });
  assert.equal(q.days.length, 2);
  assert.equal(q.days[0].progress[0].goals.dailyMinutes, 30);
  await assert.rejects(f.api.query({ from: '2026-02-30', to: '2026-03-01' }));
  await assert.rejects(f.api.query({ from: '2026-01-01', to: '2027-01-01' }));
});

test('native change during final authorization invalidates proposal at dispatch', async () => {
  const f = fixture(),
    p = await f.api.prepare({ from: '2026-11-02', to: '2026-11-02' });
  let authorizations = 0;
  f.ports.authorize = async (action) => {
    if (action === 'apply' && ++authorizations === 3)
      f.setTasks([{ id: 'changed', timeEstimate: 60000 }]);
  };
  const result = await f.api.apply({
    operationId: 'racing-proposal-op',
    proposalId: p.proposalId,
    selection: [p.proposals[0].id],
  });
  assert.equal(result.code, 'STALE_PLAN');
  assert.equal((await f.api.activities()).profile.commitments.length, 0);
});
test('lost final receipt remains pending across restart and profile replacement', async () => {
  const f = fixture(),
    cas = f.ports.cas;
  f.ports.cas = async (key, expected, next, guard) => {
    if (key.startsWith('op-') && expected !== null) throw Error('disk unavailable');
    return cas(key, expected, next, guard);
  };
  const request = {
    operationId: 'lost-receipt-operation',
    fields: { title: 'Ficticia' },
  };
  assert.equal((await f.api.task(request)).status, 'uncertain');
  assert.equal(f.calls(), 1);
  f.storage.set('profile-v1', JSON.stringify(emptyProfile()));
  assert.equal(
    (await createPlannerOperations(f.ports).task(request)).status,
    'uncertain',
  );
  assert.equal(f.calls(), 1);
});

test('a whole-day proposal is rejected without claiming uncertain writes', async () => {
  const f = fixture(),
    profile = JSON.parse(f.storage.get('profile-v1'));
  profile.areas[0].dailyMinutes = 1440;
  f.storage.set('profile-v1', JSON.stringify(profile));
  const p = await f.api.prepare({ from: '2026-11-02', to: '2026-11-02' });
  const result = await f.api.apply({
    operationId: 'whole-day-proposal',
    proposalId: p.proposalId,
    selection: [p.proposals[0].id],
  });
  assert.equal(result.status, 'rejected');
  assert.equal(result.code, 'INVALID_ARGUMENTS');
  assert.equal((await f.api.activities()).profile.commitments.length, 0);
});

test('ambiguous DST endpoint is rejected rather than saving an invisible block', async () => {
  const f = fixture(),
    profile = JSON.parse(f.storage.get('profile-v1'));
  profile.areas[0].dailyMinutes = 150;
  f.storage.set('profile-v1', JSON.stringify(profile));
  const p = await f.api.prepare({ from: '2026-10-25', to: '2026-10-25' });
  const result = await f.api.apply({
    operationId: 'ambiguous-dst-proposal',
    proposalId: p.proposalId,
    selection: [p.proposals[0].id],
  });
  assert.equal(result.status, 'rejected');
  assert.equal(result.code, 'INVALID_ARGUMENTS');
  assert.match(result.message, /ambigua/);
  assert.equal((await f.api.activities()).profile.commitments.length, 0);
});

test('query aggregates descendant associations once with native parent and archive totals', async () => {
  const f = fixture(),
    p = JSON.parse(f.storage.get('profile-v1'));
  p.areas = [
    createArea('Parent', 'parent'),
    { ...createArea('Child', 'child'), parentAreaId: 'parent', projectIds: ['PROJECT'] },
  ];
  f.storage.set('profile-v1', JSON.stringify(p));
  f.setTasks([
    {
      id: 'task-parent',
      subTaskIds: ['task-child'],
      projectId: 'PROJECT',
      timeSpent: 3840000,
      timeSpentOnDay: { '2026-11-02': 3840000 },
    },
    {
      id: 'task-child',
      parentId: 'task-parent',
      projectId: 'PROJECT',
      timeSpent: 3840000,
      timeSpentOnDay: { '2026-11-02': 3840000 },
    },
  ]);
  const q = await f.api.query({ from: '2026-11-02', to: '2026-11-02' });
  assert.equal(q.days[0].progress[0].totalMinutes, 64);
  assert.equal(q.days[0].progress[1].totalMinutes, 64);
});

test('timed native schedule takes precedence over a stale dueDay', async () => {
  const f = fixture();
  f.setTasks([
    {
      id: 'timed-task',
      title: 'Ficticia',
      dueDay: '2026-11-02',
      dueWithTime: Date.parse('2026-11-03T10:00:00+01:00'),
      timeEstimate: 60000,
    },
  ]);
  const q = await f.api.query({ from: '2026-11-02', to: '2026-11-03' });
  assert.equal(q.days[0].tasks.length, 0);
  assert.equal(q.days[1].tasks[0].id, 'timed-task');
});
test('unmapped activity reports missing association rather than invented zero progress', async () => {
  const f = fixture(),
    q = await f.api.query({ from: '2026-11-02', to: '2026-11-02' }),
    p = q.days[0].progress[0];
  assert.equal(p.totalMinutes, null);
  assert.equal(p.dailyMinutes, null);
  assert.equal(p.incomplete, true);
  assert.deepEqual(p.missing, ['activity_association']);
});
