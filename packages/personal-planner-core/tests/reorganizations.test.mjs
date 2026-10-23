import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createPlannerOperations, PlannerError } from '../operations.mjs';
import { createArea, emptyProfile } from '../model.mjs';
import { taskSnapshot } from '../metrics.mjs';
import { instant } from '../schedule.mjs';

const day = '2030-01-07';
const plan = (task) =>
  Object.fromEntries(
    ['dueDay', 'dueWithTime', 'remindAt'].map((key) => [key, task[key] ?? null]),
  );
function fixture() {
  const p = emptyProfile();
  p.areas = [
    { ...createArea('Ficticia', 'area-a'), projectIds: ['project-a'], dailyMinutes: 30 },
  ];
  const storage = new Map([['profile-v1', JSON.stringify(p)]]);
  const tasks = new Map([
    [
      'task-a',
      {
        id: 'task-a',
        title: 'Ficticia',
        projectId: 'project-a',
        tagIds: [],
        subTaskIds: [],
        timeEstimate: 1800000,
        timeSpent: 0,
        timeSpentOnDay: {},
        dueDay: day,
      },
    ],
  ]);
  let version = 0,
    calls = 0,
    lost = false;
  const ports = {
    read: async (key) => storage.get(key) ?? null,
    cas: async (key, expected, next, guard) => {
      guard?.();
      if ((storage.get(key) ?? null) !== expected) return false;
      storage.set(key, next);
      version++;
      return true;
    },
    snapshot: async () => {
      const captured = version;
      return Object.assign(taskSnapshot([...tasks.values()], []), {
        timezone: p.timezone,
        weekStartsOn: 1,
        civilDaysReliable: true,
        assertCurrent: () => {
          if (captured !== version)
            throw new PlannerError('STALE_PLAN', 'Datos cambiados');
        },
      });
    },
    native: async (action, args) => {
      args.assertCurrent?.();
      calls++;
      for (const entry of args.entries) {
        const task = tasks.get(entry.taskId);
        if (action === 'schedule') {
          const offset =
            task.dueWithTime && task.remindAt ? task.dueWithTime - task.remindAt : null;
          tasks.set(task.id, {
            ...task,
            dueDay: undefined,
            dueWithTime: entry.dueWithTime,
            remindAt: offset === null ? undefined : entry.dueWithTime - offset,
          });
        } else {
          assert.equal(action, 'restore_schedule');
          assert.deepEqual(plan(task), entry.expectedAfter);
          tasks.set(task.id, {
            ...task,
            ...Object.fromEntries(
              Object.entries(entry.before).map(([key, value]) => [
                key,
                value ?? undefined,
              ]),
            ),
          });
        }
      }
      version++;
      if (lost) throw Error('Respuesta perdida');
      return { status: 'applied', taskIds: args.entries.map((entry) => entry.taskId) };
    },
  };
  return {
    storage,
    tasks,
    ports,
    api: createPlannerOperations(ports),
    calls: () => calls,
    editTask: (id, fields) => {
      tasks.set(id, { ...tasks.get(id), ...fields });
      version++;
    },
    lose: () => (lost = true),
  };
}
async function nativeProposal(f) {
  const proposal = await f.api.prepare({ from: day, to: day });
  return {
    proposal,
    item: proposal.proposals.find((item) => item.target === 'native-task'),
  };
}

test('adjusting a proposal validates slots and creates a new revision without writing user data', async () => {
  const f = fixture(),
    { proposal, item } = await nativeProposal(f),
    before = new Map(f.storage);
  const adjusted = await f.api.adjustProposal({
    proposalId: proposal.proposalId,
    changes: [{ itemId: item.id, start: instant(day, '10:00') }],
  });
  assert.notEqual(adjusted.proposalId, proposal.proposalId);
  assert.equal(
    adjusted.proposals.find((value) => value.id === item.id).interval[0],
    instant(day, '10:00'),
  );
  assert.deepEqual(f.storage, before);
  assert.equal(f.calls(), 0);
  await assert.rejects(
    f.api.adjustProposal({
      proposalId: proposal.proposalId,
      changes: [
        { itemId: item.id, start: instant(day, '10:00'), end: instant(day, '11:00') },
      ],
    }),
    (error) => error.code === 'INVALID_ARGUMENTS',
  );
});
test('confirmed native changes survive restart and undo preserves later progress and completion', async () => {
  const f = fixture(),
    { proposal, item } = await nativeProposal(f);
  const args = {
    operationId: 'history-forward-native',
    proposalId: proposal.proposalId,
    selection: [item.id],
  };
  const applied = await f.api.apply(args);
  assert.equal(applied.status, 'applied');
  assert.equal(applied.historyId, args.operationId);
  const restarted = createPlannerOperations(f.ports),
    history = await restarted.history({ historyId: applied.historyId });
  assert.equal(history.entry.status, 'confirmed');
  assert.equal(history.entry.changes[0].before.dueDay, day);
  f.editTask('task-a', {
    timeSpent: 60000,
    timeSpentOnDay: { [day]: 60000 },
    isDone: true,
    title: 'Edición posterior',
  });
  const undo = await restarted.prepareUndo({ historyId: applied.historyId });
  const result = await restarted.apply({
    operationId: 'undo-history-native',
    proposalId: undo.proposalId,
    selection: [undo.proposals[0].id],
  });
  assert.equal(result.status, 'applied');
  assert.equal(f.tasks.get('task-a').dueDay, day);
  assert.equal(f.tasks.get('task-a').dueWithTime, undefined);
  assert.equal(f.tasks.get('task-a').timeSpent, 60000);
  assert.equal(f.tasks.get('task-a').isDone, true);
  assert.equal(f.tasks.get('task-a').title, 'Edición posterior');
  assert.equal(
    (
      await restarted.apply({
        operationId: 'undo-history-native',
        proposalId: undo.proposalId,
        selection: [undo.proposals[0].id],
      })
    ).replayed,
    true,
  );
  assert.equal(f.calls(), 2);
});
test('undo reports a planning conflict instead of overwriting a later schedule', async () => {
  const f = fixture(),
    { proposal, item } = await nativeProposal(f);
  const applied = await f.api.apply({
    operationId: 'history-native-conflict',
    proposalId: proposal.proposalId,
    selection: [item.id],
  });
  f.editTask('task-a', { dueWithTime: instant(day, '15:00') });
  const undo = await f.api.prepareUndo({ historyId: applied.historyId });
  assert.equal(undo.proposals[0].selectable, false);
  assert.ok(undo.conflicts.length);
  assert.equal(
    (
      await f.api.apply({
        operationId: 'conflicting-undo-op',
        proposalId: undo.proposalId,
        selection: [undo.proposals[0].id],
      })
    ).status,
    'rejected',
  );
  assert.equal(f.tasks.get('task-a').dueWithTime, instant(day, '15:00'));
});
test('uncertain native changes have durable pending history and cannot be falsely undone', async () => {
  const f = fixture(),
    { proposal, item } = await nativeProposal(f);
  f.lose();
  const result = await f.api.apply({
    operationId: 'history-uncertain-native',
    proposalId: proposal.proposalId,
    selection: [item.id],
  });
  assert.equal(result.status, 'uncertain');
  const history = await createPlannerOperations(f.ports).history({
    historyId: 'history-uncertain-native',
  });
  assert.notEqual(history.entry.status, 'confirmed');
  await assert.rejects(
    f.api.prepareUndo({ historyId: history.entry.id }),
    (error) => error.code === 'OUTCOME_UNKNOWN',
  );
});
test('undo of a created commitment preserves other later profile changes', async () => {
  const f = fixture(),
    proposal = await f.api.prepare({ from: day, to: day });
  const item = proposal.proposals.find((item) => item.target === 'commitment');
  const result = await f.api.apply({
    operationId: 'history-profile-block',
    proposalId: proposal.proposalId,
    selection: [item.id],
  });
  const p = JSON.parse(f.storage.get('profile-v1'));
  p.areas[0].name = 'Cambio posterior';
  f.storage.set('profile-v1', JSON.stringify(p));
  const undo = await f.api.prepareUndo({ historyId: result.historyId });
  assert.equal(
    (
      await f.api.apply({
        operationId: 'undo-profile-block',
        proposalId: undo.proposalId,
        selection: [undo.proposals[0].id],
      })
    ).status,
    'applied',
  );
  const final = JSON.parse(f.storage.get('profile-v1'));
  assert.equal(final.commitments.length, 0);
  assert.equal(final.areas[0].name, 'Cambio posterior');
});
test('partial undo selects only unchanged planning targets and leaves the conflicted target intact', async () => {
  const f = fixture();
  f.tasks.set('task-b', {
    ...f.tasks.get('task-a'),
    id: 'task-b',
    title: 'Otra ficticia',
  });
  const p = await f.api.prepare({ from: day, to: day }),
    items = p.proposals.filter((item) => item.target === 'native-task');
  const applied = await f.api.apply({
    operationId: 'partial-history-forward',
    proposalId: p.proposalId,
    selection: items.map((item) => item.id),
  });
  f.editTask('task-a', { dueWithTime: instant(day, '16:00') });
  const undo = await f.api.prepareUndo({ historyId: applied.historyId });
  const safe = undo.proposals.find((item) => item.taskId === 'task-b'),
    conflict = undo.proposals.find((item) => item.taskId === 'task-a');
  assert.equal(safe.selectable, true);
  assert.equal(conflict.selectable, false);
  assert.equal(
    (
      await f.api.apply({
        operationId: 'partial-history-undo',
        proposalId: undo.proposalId,
        selection: [safe.id],
      })
    ).status,
    'applied',
  );
  assert.equal(f.tasks.get('task-b').dueDay, day);
  assert.equal(f.tasks.get('task-a').dueWithTime, instant(day, '16:00'));
});
test('undo exposes new capacity conflicts even when original planning fields still match', async () => {
  const f = fixture();
  f.editTask('task-a', { dueDay: undefined, dueWithTime: instant(day, '10:00') });
  const p = JSON.parse(f.storage.get('profile-v1'));
  p.commitments = [
    {
      id: 'first-extra',
      title: 'Extra ficticio',
      kind: 'extra',
      date: day,
      start: '10:00',
      end: '11:00',
      weekdays: [],
      excludedDates: [],
    },
  ];
  f.storage.set('profile-v1', JSON.stringify(p));
  const { proposal, item } = await nativeProposal(f);
  const applied = await f.api.apply({
    operationId: 'capacity-history-forward',
    proposalId: proposal.proposalId,
    selection: [item.id],
  });
  const undo = await f.api.prepareUndo({ historyId: applied.historyId });
  assert.equal(undo.proposals[0].selectable, false);
  assert.equal(undo.conflicts[0].code, 'CAPACITY_CONFLICT');
  assert.equal(
    (
      await f.api.apply({
        operationId: 'capacity-undo-reject',
        proposalId: undo.proposalId,
        selection: [undo.proposals[0].id],
      })
    ).status,
    'rejected',
  );
});
test('adjustments detect occupied native slots and apply checks selected alternatives together', async () => {
  const f = fixture();
  f.tasks.set('fixed', {
    ...f.tasks.get('task-a'),
    id: 'fixed',
    dueDay: undefined,
    dueWithTime: instant(day, '10:00'),
  });
  const { proposal, item } = await nativeProposal(f);
  await assert.rejects(
    f.api.adjustProposal({
      proposalId: proposal.proposalId,
      changes: [{ itemId: item.id, start: instant(day, '10:00') }],
    }),
    (error) => error.code === 'INVALID_ARGUMENTS',
  );
  const commitment = proposal.proposals.find((item) => item.target === 'commitment');
  const adjusted = await f.api.adjustProposal({
    proposalId: proposal.proposalId,
    changes: [{ itemId: commitment.id, start: instant(day, '12:00') }],
  });
  assert.ok(adjusted.proposalId);
  assert.equal(f.calls(), 0);
});
test('history intention is durable before native changes and corrupt metadata fails explicitly', async () => {
  const f = fixture(),
    { proposal, item } = await nativeProposal(f),
    native = f.ports.native;
  let before = false;
  f.ports.native = async (action, args, ...rest) => {
    const entry = JSON.parse(f.storage.get('history-event-pre-native-history'));
    assert.equal(entry.status, 'pending');
    assert.ok(entry.changes[0].before);
    before = true;
    return native(action, args, ...rest);
  };
  assert.equal(
    (
      await f.api.apply({
        operationId: 'pre-native-history',
        proposalId: proposal.proposalId,
        selection: [item.id],
      })
    ).status,
    'applied',
  );
  assert.equal(before, true);
  f.storage.set('history-event-corrupt-history', '{');
  await assert.rejects(
    f.api.history({ historyId: 'corrupt-history' }),
    (error) => error.code === 'DATA_CORRUPT',
  );
});
test('prepare rechecks read authorization and preferences update preserves other preferences', async () => {
  const f = fixture();
  let checks = 0;
  f.ports.authorize = async (action) => {
    if (action === 'prepare' && ++checks === 2)
      throw new PlannerError('NOT_PERMITTED', 'Revoked');
  };
  await assert.rejects(
    f.api.prepare({ from: day, to: day }),
    (error) => error.code === 'NOT_PERMITTED',
  );
  f.ports.authorize = async () => {};
  const state = await f.api.activities();
  assert.equal(
    (
      await f.api.edit({
        operationId: 'preferences-update-op',
        baseRevision: state.revision,
        command: {
          type: 'preferences.update',
          payload: { preferences: { hourFormat: '12h' } },
        },
      })
    ).status,
    'applied',
  );
  assert.deepEqual((await f.api.activities()).profile.preferences, {
    hourFormat: '12h',
    sessionMinutes: 25,
    transitionMinutes: 0,
  });
});
test('calendar changes since preparation invalidate a proposal even if the native task snapshot remains identical', async () => {
  const f = fixture(),
    snapshot = f.ports.snapshot;
  let events = [];
  f.ports.snapshot = async (profile) =>
    Object.assign(await snapshot(profile), {
      calendarEvents: events,
      calendarWarnings: [],
    });
  const { proposal, item } = await nativeProposal(f);
  events = [
    {
      id: 'event-a',
      calProviderId: 'calendar-a',
      title: 'Ficticio',
      start: instant(day, '10:00'),
      duration: 3600000,
    },
  ];
  const result = await f.api.apply({
    operationId: 'stale-calendar-apply',
    proposalId: proposal.proposalId,
    selection: [item.id],
  });
  assert.equal(result.code, 'STALE_PLAN');
  assert.equal(f.calls(), 0);
});
test('revoked history permission after a native change never claims the change was rejected', async () => {
  const f = fixture(),
    { proposal, item } = await nativeProposal(f),
    native = f.ports.native;
  let revoked = false;
  f.ports.native = async (...args) => {
    const result = await native(...args);
    revoked = true;
    return result;
  };
  f.ports.authorize = async () => {
    if (revoked) throw new PlannerError('NOT_PERMITTED', 'Revoked after mutation');
  };
  const result = await f.api.apply({
    operationId: 'revoked-after-native',
    proposalId: proposal.proposalId,
    selection: [item.id],
  });
  assert.equal(result.status, 'uncertain');
  assert.equal(result.code, 'OUTCOME_UNKNOWN');
  assert.equal(typeof f.tasks.get('task-a').dueWithTime, 'number');
  assert.equal(f.calls(), 1);
});
test('malformed history indexes and field snapshots are errors rather than empty or confirmed history', async () => {
  const f = fixture();
  f.storage.set(
    'history-index-v1',
    JSON.stringify({ version: 2, action: 'apply', page: 0 }),
  );
  await assert.rejects(f.api.history({}), (error) => error.code === 'DATA_CORRUPT');
  f.storage.set(
    'history-index-v1',
    JSON.stringify({ version: 1, action: 'apply', page: 0 }),
  );
  f.storage.set(
    'history-page-0',
    JSON.stringify({ version: 1, action: 'apply', ids: ['bad'] }),
  );
  await assert.rejects(f.api.history({}), (error) => error.code === 'DATA_CORRUPT');
  f.storage.set(
    'history-event-invalid-history',
    JSON.stringify({
      version: 1,
      action: 'apply',
      id: 'invalid-history',
      status: 'confirmed',
      changes: [{ id: 'item-a', target: 'native-task', before: null, after: null }],
    }),
  );
  await assert.rejects(
    f.api.history({ historyId: 'invalid-history' }),
    (error) => error.code === 'DATA_CORRUPT',
  );
});
