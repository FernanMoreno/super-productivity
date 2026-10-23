import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createPlannerOperations,
  contextRevision,
  PlannerError,
} from '../operations.mjs';
import { emptyProfile, createArea } from '../model.mjs';
import { taskSnapshot } from '../metrics.mjs';
import { instant } from '../schedule.mjs';
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
test('operation status looks up a confirmed receipt without repeating a mutation or exposing payloads', async () => {
  const f = fixture();
  await f.api.task({
    operationId: 'status-task-operation',
    fields: { title: 'Private title' },
  });
  const result = await f.api.operationStatus({
    action: 'task',
    operationId: 'status-task-operation',
  });
  assert.equal(result.status, 'applied');
  assert.equal(result.receiptState, 'finished');
  assert.equal(result.result.taskId, 'native-task');
  assert.equal(f.calls(), 1);
  assert.equal(JSON.stringify(result).includes('Private title'), false);
});
test('operation status distinguishes missing and pending without interpreting either as unapplied', async () => {
  const f = fixture();
  assert.equal(
    (await f.api.operationStatus({ action: 'task', operationId: 'missing-operation' }))
      .status,
    'not_found',
  );
  f.ports.native = async () => {
    throw Error('Lost response');
  };
  await f.api.task({
    operationId: 'pending-status-operation',
    fields: { title: 'Ficticia' },
  });
  const result = await createPlannerOperations(f.ports).operationStatus({
    action: 'task',
    operationId: 'pending-status-operation',
  });
  assert.equal(result.status, 'uncertain');
  assert.equal(result.code, 'OUTCOME_UNKNOWN');
  assert.equal(result.receiptState, 'pending');
});
test('operation status rechecks the exact action permission after reading and rejects invalid arguments', async () => {
  const f = fixture();
  let calls = 0;
  f.ports.authorize = async (action) => {
    assert.equal(action, 'task');
    if (++calls === 2) throw new PlannerError('NOT_PERMITTED', 'Revoked');
  };
  await assert.rejects(
    f.api.operationStatus({ action: 'task', operationId: 'missing-operation' }),
    (error) => error.code === 'NOT_PERMITTED',
  );
  await assert.rejects(
    f.api.operationStatus({ action: 'query', operationId: 'missing-operation' }),
    (error) => error.code === 'INVALID_ARGUMENTS',
  );
  await assert.rejects(
    f.api.operationStatus({ action: 'task', operationId: '../bad' }),
    (error) => error.code === 'INVALID_ARGUMENTS',
  );
});
test('corrupt receipts fail explicitly in status and retry without executing or exposing stored content', async () => {
  const f = fixture();
  const args = { operationId: 'corrupt-operation', fields: { title: 'Ficticia' } };
  for (const raw of [
    'private invalid JSON',
    JSON.stringify({
      action: 'task',
      signature: 'invalid',
      result: { status: 'applied', private: 'secret' },
    }),
  ]) {
    f.storage.set('op-corrupt-operation', raw);
    await assert.rejects(
      f.api.operationStatus({ action: 'task', operationId: args.operationId }),
      (error) => error.code === 'DATA_CORRUPT' && !error.message.includes('private'),
    );
    await assert.rejects(f.api.task(args), (error) => error.code === 'DATA_CORRUPT');
    assert.equal(f.calls(), 0);
  }
});
test('operation status does not expose a receipt belonging to another action', async () => {
  const f = fixture();
  await f.api.task({
    operationId: 'different-action-operation',
    fields: { title: 'Ficticia' },
  });
  const result = await f.api.operationStatus({
    action: 'edit',
    operationId: 'different-action-operation',
  });
  assert.equal(result.code, 'OPERATION_ACTION_MISMATCH');
  assert.equal(result.result, undefined);
});
test('operation status projects only typed receipt fields and remains read-only', async () => {
  const f = fixture();
  f.storage.set(
    'op-projected-status-op',
    JSON.stringify({
      action: 'task',
      signature: 'a'.repeat(64),
      result: {
        status: 'applied',
        taskId: 'native-task',
        taskIds: ['native-task'],
        code: 'SECRET MESSAGE',
        revision: 'Private profile',
        notes: 'Private notes',
        profile: { private: true },
      },
    }),
  );
  f.ports.cas = async () => {
    throw Error('Status must not write');
  };
  const result = await f.api.operationStatus({
    action: 'task',
    operationId: 'projected-status-op',
  });
  assert.deepEqual(result.result, {
    status: 'applied',
    taskId: 'native-task',
    taskIds: ['native-task'],
  });
  assert.equal(f.calls(), 0);
});
test('journal replay rechecks action permission while reading a finished receipt', async () => {
  const f = fixture();
  const args = { operationId: 'revoked-replay-operation', fields: { title: 'Ficticia' } };
  await f.api.task(args);
  const read = f.ports.read;
  let revoked = false;
  f.ports.read = async (key) => {
    const value = await read(key);
    if (key.startsWith('op-')) revoked = true;
    return value;
  };
  f.ports.authorize = async () => {
    if (revoked) throw new PlannerError('NOT_PERMITTED', 'Revoked');
  };
  await assert.rejects(f.api.task(args), (error) => error.code === 'NOT_PERMITTED');
  assert.equal(f.calls(), 1);
});
test('a receipt permission failure after work completes leaves the mutation uncertain rather than rejected', async () => {
  const f = fixture(),
    cas = f.ports.cas;
  f.ports.cas = async (key, expected, ...rest) => {
    if (key.startsWith('op-') && expected !== null)
      throw new PlannerError('NOT_PERMITTED', 'Revoked after work');
    return cas(key, expected, ...rest);
  };
  const result = await f.api.task({
    operationId: 'post-work-revoked',
    fields: { title: 'Ficticia' },
  });
  assert.equal(result.status, 'uncertain');
  assert.equal(result.code, 'OUTCOME_UNKNOWN');
  assert.equal(f.calls(), 1);
});
test('recording time carries a final native dependency guard and rejects a profile changed before snapshot capture', async () => {
  const f = fixture(),
    snapshot = f.ports.snapshot;
  f.ports.snapshot = async (profile) => {
    const result = await snapshot(profile);
    f.storage.set('profile-v1', JSON.stringify({ ...profile, weekStartsOn: 0 }));
    return result;
  };
  const result = await f.api.logTime({
    operationId: 'profile-race-time',
    taskId: 'task-a',
    activityId: 'area-test',
    date: '2026-11-02',
    durationMs: 60000,
  });
  assert.equal(result.code, 'STALE_DATA');
  assert.equal(f.calls(), 0);
  f.ports.snapshot = snapshot;
  let guarded = false;
  f.ports.native = async (action, args) => {
    assert.equal(action, 'log_time');
    assert.equal(typeof args.assertCurrent, 'function');
    args.assertCurrent();
    guarded = true;
    return { status: 'applied' };
  };
  assert.equal(
    (
      await f.api.logTime({
        operationId: 'guarded-time-op',
        taskId: 'task-a',
        activityId: 'area-test',
        date: '2026-11-02',
        durationMs: 60000,
      })
    ).status,
    'applied',
  );
  assert.equal(guarded, true);
});
test('native proposals reserve independent leaf task slots and prepare never writes', async () => {
  const f = fixture();
  f.setTasks([
    { id: 'parent', subTaskIds: ['child'], timeEstimate: 7200000 },
    {
      id: 'child',
      parentId: 'parent',
      title: 'Subtarea',
      dueDay: '2026-11-02',
      timeEstimate: 1800000,
      timeSpent: 0,
    },
    {
      id: 'other',
      title: 'Otra',
      dueDay: '2026-11-02',
      timeEstimate: 1800000,
      timeSpent: 0,
    },
    { id: 'done', isDone: true, timeEstimate: 1800000 },
  ]);
  const before = new Map(f.storage);
  const proposal = await f.api.prepare({ from: '2026-11-02', to: '2026-11-02' });
  const native = proposal.proposals.filter((item) => item.target === 'native-task');
  assert.deepEqual(native.map((item) => item.taskId).sort(), ['child', 'other']);
  assert.ok(native.every((item) => item.interval && item.expected));
  assert.ok(native[0].interval[1] <= native[1].interval[0]);
  assert.deepEqual(f.storage, before);
  assert.equal(f.calls(), 0);
});
test('native apply uses the host schedule operation and rejects mixed categories before dispatch', async () => {
  const f = fixture();
  f.setTasks([
    { id: 'task-a', title: 'Ficticia', dueDay: '2026-11-02', timeEstimate: 1800000 },
  ]);
  const proposal = await f.api.prepare({ from: '2026-11-02', to: '2026-11-02' });
  const native = proposal.proposals.find((item) => item.target === 'native-task');
  const commitment = proposal.proposals.find((item) => item.target === 'commitment');
  assert.ok(native);
  assert.ok(commitment);
  const mixed = await f.api.apply({
    operationId: 'mixed-native-apply',
    proposalId: proposal.proposalId,
    selection: [native.id, commitment.id],
  });
  assert.equal(mixed.status, 'rejected');
  assert.equal(f.calls(), 0);
  let received;
  f.ports.native = async (action, args) => {
    received = { action, args };
    args.assertCurrent();
    return { status: 'applied', taskIds: args.entries.map((entry) => entry.taskId) };
  };
  const request = {
    operationId: 'native-only-apply',
    proposalId: proposal.proposalId,
    selection: [native.id],
  };
  const result = await f.api.apply(request);
  assert.equal(result.status, 'applied');
  assert.equal(received.action, 'schedule');
  assert.equal(received.args.entries[0].taskId, 'task-a');
  assert.equal(received.args.entries[0].dueWithTime, native.interval[0]);
  assert.equal((await f.api.activities()).profile.commitments.length, 0);
  assert.equal((await f.api.apply(request)).replayed, true);
});
test('native alternatives respect work capacity, extra commitments, child restrictions and other native slots', async () => {
  const f = fixture(),
    profile = emptyProfile(),
    day = '2026-11-02';
  profile.areas = [
    { ...createArea('General', 'parent-area'), projectIds: ['project-a'] },
    {
      ...createArea('Laboral', 'child-area'),
      parentAreaId: 'parent-area',
      tagIds: ['tag-a'],
      workTime: true,
      earliest: '10:00',
      latest: '12:00',
      allowedWeekdays: [1],
    },
  ];
  profile.commitments = [
    {
      id: 'work',
      title: 'Jornada ficticia',
      kind: 'work',
      date: day,
      start: '09:00',
      end: '17:00',
      weekdays: [],
      excludedDates: [],
    },
    {
      id: 'extra',
      title: 'Extra ficticio',
      kind: 'extra',
      date: day,
      start: '10:00',
      end: '11:00',
      weekdays: [],
      excludedDates: [],
    },
  ];
  f.storage.set('profile-v1', JSON.stringify(profile));
  const task = (id, time) => ({
    id,
    title: id,
    projectId: 'project-a',
    tagIds: ['tag-a'],
    dueWithTime: instant(day, time),
    timeEstimate: 1800000,
    timeSpent: 0,
  });
  f.setTasks([task('affected', '10:15'), task('unchanged', '11:00')]);
  const proposal = await f.api.prepare({ from: day, to: day });
  const native = proposal.proposals.filter((item) => item.target === 'native-task');
  assert.equal(native.length, 1);
  assert.equal(native[0].taskId, 'affected');
  assert.equal(native[0].scope, 'work');
  assert.equal(native[0].areaId, 'child-area');
  assert.deepEqual(native[0].interval, [instant(day, '11:30'), instant(day, '12:00')]);
});
test('native alternatives expose missing space and never cross exclusions or deadlines', async () => {
  const f = fixture(),
    profile = emptyProfile(),
    day = '2026-11-02';
  profile.areas = [
    {
      ...createArea('Ficticia', 'area-a'),
      projectIds: ['project-a'],
      earliest: '09:00',
      latest: '10:00',
    },
  ];
  profile.trainingExclusions = [{ areaId: 'area-a', start: day, end: day }];
  f.storage.set('profile-v1', JSON.stringify(profile));
  f.setTasks([
    {
      id: 'blocked',
      projectId: 'project-a',
      dueDay: day,
      timeEstimate: 1800000,
      deadlineDay: day,
    },
  ]);
  const proposal = await f.api.prepare({ from: day, to: '2026-11-03' });
  const native = proposal.proposals.find((item) => item.target === 'native-task');
  assert.equal(native.interval, null);
  assert.match(native.reason, /Sin hueco/);
  assert.equal(
    (
      await f.api.apply({
        operationId: 'blocked-native-apply',
        proposalId: proposal.proposalId,
        selection: [native.id],
      })
    ).status,
    'rejected',
  );
  assert.equal(f.calls(), 0);
});
test('native apply detects changed data and keeps lost native acknowledgements uncertain without repeating', async () => {
  const f = fixture(),
    task = { id: 'native-a', dueDay: '2026-11-02', timeEstimate: 1800000 };
  f.setTasks([task]);
  const first = await f.api.prepare({ from: '2026-11-02', to: '2026-11-02' });
  f.setTasks([{ ...task, remindAt: 123 }]);
  const stale = await f.api.apply({
    operationId: 'stale-native-apply',
    proposalId: first.proposalId,
    selection: [first.proposals.find((item) => item.target === 'native-task').id],
  });
  assert.equal(stale.code, 'STALE_PLAN');
  assert.equal(f.calls(), 0);
  const fresh = await f.api.prepare({ from: '2026-11-02', to: '2026-11-02' });
  let calls = 0;
  f.ports.native = async (action, args) => {
    assert.equal(action, 'schedule');
    args.assertCurrent();
    calls++;
    throw Error('lost after native dispatch');
  };
  const request = {
    operationId: 'lost-native-apply',
    proposalId: fresh.proposalId,
    selection: [fresh.proposals.find((item) => item.target === 'native-task').id],
  };
  assert.equal((await f.api.apply(request)).status, 'uncertain');
  assert.equal((await f.api.apply(request)).status, 'uncertain');
  assert.equal(calls, 1);
});
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
  const snapshot = f.ports.snapshot;
  let captured = false;
  f.ports.snapshot = async (profile) => {
    const value = await snapshot(profile);
    captured = true;
    return value;
  };
  f.ports.authorize = async (action) => {
    if (action === 'apply' && captured)
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
test('native apply rejects a profile changed before the native dependency snapshot was captured', async () => {
  const f = fixture();
  f.setTasks([{ id: 'native-a', dueDay: '2026-11-02', timeEstimate: 1800000 }]);
  const proposal = await f.api.prepare({ from: '2026-11-02', to: '2026-11-02' });
  const snapshot = f.ports.snapshot;
  f.ports.snapshot = async (profile) => {
    f.storage.set('profile-v1', JSON.stringify({ ...profile, weekStartsOn: 0 }));
    return snapshot(profile);
  };
  const result = await f.api.apply({
    operationId: 'native-profile-race',
    proposalId: proposal.proposalId,
    selection: [proposal.proposals.find((item) => item.target === 'native-task').id],
  });
  assert.equal(result.code, 'STALE_PLAN');
  assert.equal(f.calls(), 0);
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
