import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createWorkbenchOperations } from '../workbench-operations.mjs';
import { emptyProfile } from '../model.mjs';
import { taskSnapshot } from '../metrics.mjs';
import { revision, contextRevision, range, PlannerError } from '../operations.mjs';

function fixture() {
  const storage = new Map(),
    profile = emptyProfile();
  let tasks = [
      {
        id: 'task-a',
        title: 'Tarea ficticia',
        projectId: 'project-a',
        tagIds: [],
        dueDay: '2026-10-19',
        timeEstimate: 60000,
        timeSpent: 0,
        timeSpentOnDay: {},
      },
    ],
    nativeCalls = 0,
    enabled = true;
  const load = async () => ({
    profile,
    raw: JSON.stringify(profile),
    revision: await revision(profile),
  });
  const authorize = async () => {
    if (!enabled) throw new PlannerError('NOT_PERMITTED', 'Deshabilitado');
  };
  const ports = {
    read: async (key) => storage.get(key) ?? null,
    cas: async (key, raw, next, guard) => {
      guard?.();
      if ((storage.get(key) ?? null) !== raw) return false;
      storage.set(key, next);
      return true;
    },
    snapshot: async () => {
      const before = JSON.stringify(tasks);
      return Object.assign(taskSnapshot(tasks, []), {
        timezone: profile.timezone,
        civilDaysReliable: true,
        projects: [],
        assertCurrent: () => {
          if (JSON.stringify(tasks) !== before)
            throw new PlannerError('STALE_PLAN', 'Changed');
        },
      });
    },
    native: async (action, args) => {
      args.assertCurrent();
      nativeCalls++;
      assert.equal(action, 'correct_time');
      return {
        status: 'applied',
        taskId: args.taskId,
        date: args.date,
        durationMs: args.durationMs,
      };
    },
  };
  const receipts = new Map();
  const journal = async (action, args, work) => {
    const key = args.operationId;
    if (receipts.has(key)) return { ...receipts.get(key), replayed: true };
    const result = await work();
    receipts.set(key, result);
    return result;
  };
  const build = () =>
    createWorkbenchOperations({
      ports,
      load,
      authorize,
      journal,
      range,
      revision,
      contextRevision,
      PlannerError,
    });
  return {
    profile,
    storage,
    ports,
    build,
    setTasks: (v) => (tasks = v),
    disable: () => (enabled = false),
    calls: () => nativeCalls,
  };
}
test('review sessions and immutable baseline resume after rebuilding operations; decisions never modify native tasks', async () => {
  const f = fixture();
  let api = f.build();
  const before = await api.review({ from: '2026-10-19', to: '2026-10-20' });
  assert.equal(before.baseline, null);
  assert.equal(f.storage.size, 0);
  const started = await api.reviewAdvance({
    operationId: 'review-start',
    command: 'start',
    expectedRevision: before.revision,
    from: '2026-10-19',
    to: '2026-10-20',
  });
  assert.equal(started.status, 'applied');
  api = f.build();
  const resumed = await api.review({
    from: '2026-10-19',
    to: '2026-10-20',
    reviewId: started.reviewId,
  });
  assert.equal(resumed.session.id, started.reviewId);
  assert.equal(resumed.rows[0].plannedMs, null);
  assert.equal(resumed.rows[0].provenance, 'unknown-before-capture');
  const issue = resumed.session.items[0];
  const decided = await api.reviewAdvance({
    operationId: 'review-decide',
    command: 'decide',
    expectedRevision: resumed.revision,
    reviewId: started.reviewId,
    itemId: issue.id,
    decision: 'keep',
  });
  assert.equal(decided.status, 'applied');
  assert.equal(f.calls(), 0);
  const final = await api.review({
    from: '2026-10-19',
    to: '2026-10-20',
    reviewId: started.reviewId,
  });
  assert.equal(final.session.decisions[issue.id].decision, 'keep');
  assert.equal(final.session.reviewedAt, null);
  assert.equal(
    (
      await api.reviewAdvance({
        operationId: 'stale-decision',
        command: 'decide',
        expectedRevision: before.revision,
        reviewId: started.reviewId,
        itemId: issue.id,
        decision: 'pause',
      })
    ).status,
    'conflict',
  );
});
test('time correction rechecks profile/native guards, forwards total+expected duration and uses one receipt', async () => {
  const f = fixture(),
    api = f.build(),
    args = {
      operationId: 'correct-test',
      activityId: 'area-a',
      taskId: 'task-a',
      date: '2026-10-19',
      expectedDurationMs: 0,
      durationMs: 60000,
    };
  assert.equal((await api.correctTime(args)).status, 'applied');
  assert.equal((await api.correctTime(args)).replayed, true);
  assert.equal(f.calls(), 1);
  f.disable();
  await assert.rejects(
    api.next({ date: '2026-10-19' }),
    (e) => e.code === 'NOT_PERMITTED',
  );
});
test('baseline updates fail closed if native state changes before conditional dispatch', async () => {
  const f = fixture();
  const original = f.ports.cas;
  f.ports.cas = async (...args) => {
    f.setTasks([]);
    return original(...args);
  };
  await assert.rejects(
    f.build().captureBaseline({ from: '2026-10-19', to: '2026-10-19' }),
    (e) => e.code === 'STALE_PLAN',
  );
  assert.equal(f.storage.has('workbench-v1'), false);
});

test('baseline rejects a profile change that happened before snapshot capture', async () => {
  const f = fixture(),
    original = f.ports.snapshot;
  f.ports.snapshot = async () => {
    f.profile.timezone = 'UTC';
    return original();
  };
  const result = await f
    .build()
    .captureBaseline({ from: '2026-10-19', to: '2026-10-19' });
  assert.equal(result.status, 'conflict');
  assert.equal(f.storage.has('workbench-v1'), false);
});

test('correct time rejects an uncertifiable civil calendar before reaching native tracking', async () => {
  const f = fixture(),
    original = f.ports.snapshot;
  f.ports.snapshot = async () => ({ ...(await original()), civilDaysReliable: false });
  await assert.rejects(
    f.build().correctTime({
      operationId: 'correct-civil',
      activityId: 'a',
      taskId: 'task-a',
      date: '2026-10-19',
      expectedDurationMs: 0,
      durationMs: 0,
    }),
    (e) => e.code === 'UNSUPPORTED_OPERATION',
  );
  assert.equal(f.calls(), 0);
});

test('finishing is explicit, requires every decision, and does not complete native tasks', async () => {
  const f = fixture(),
    api = f.build(),
    args = { from: '2026-10-19', to: '2026-10-19' };
  let view = await api.review(args);
  const start = await api.reviewAdvance({
    operationId: 'finish-start',
    command: 'start',
    expectedRevision: view.revision,
    ...args,
  });
  view = await api.review({ ...args, reviewId: start.reviewId });
  await assert.rejects(
    api.reviewAdvance({
      operationId: 'finish-early',
      command: 'finish',
      reviewId: start.reviewId,
      expectedRevision: view.revision,
    }),
    (e) => e.code === 'INVALID_ARGUMENTS',
  );
  for (const item of view.session.items) {
    await api.reviewAdvance({
      operationId: `finish-${item.id}`,
      command: 'decide',
      reviewId: start.reviewId,
      itemId: item.id,
      decision: 'keep',
      expectedRevision: view.revision,
    });
    view = await api.review({ ...args, reviewId: start.reviewId });
  }
  const finished = await api.reviewAdvance({
    operationId: 'finish-complete',
    command: 'finish',
    reviewId: start.reviewId,
    expectedRevision: view.revision,
  });
  assert.equal(finished.status, 'applied');
  assert.ok((await api.review({ ...args, reviewId: start.reviewId })).session.reviewedAt);
  assert.equal(f.calls(), 0);
});

test('corrupt workbench metadata is surfaced and never replaced', async () => {
  const f = fixture();
  f.storage.set('workbench-v1', '{"schemaVersion":1,"action":"other"}');
  await assert.rejects(
    f.build().review({ from: '2026-10-19', to: '2026-10-19' }),
    (e) => e.code === 'DATA_CORRUPT',
  );
  assert.equal(f.storage.get('workbench-v1'), '{"schemaVersion":1,"action":"other"}');
});

test('changing the visible interval never recaptures an already observed daily plan', async () => {
  const f = fixture(),
    api = f.build();
  const original = {
    id: 'task-a',
    title: 'Tarea ficticia',
    projectId: 'project-a',
    tagIds: [],
    dueDay: '2099-10-19',
    timeEstimate: 60000,
    timeSpent: 0,
    timeSpentOnDay: {},
  };
  f.setTasks([original]);
  await api.captureBaseline({ from: '2099-10-19', to: '2099-10-25' });
  f.setTasks([{ ...original, dueDay: '2099-10-20', timeEstimate: 180000 }]);
  await api.captureBaseline({ from: '2099-10-19', to: '2099-10-19' });
  const view = await api.review({ from: '2099-10-19', to: '2099-10-19' });
  assert.equal(view.rows.length, 1);
  assert.equal(view.rows[0].plannedMs, 60000);
});

test('invalid saved preferences and daily provenance are rejected without overwriting state', async () => {
  for (const change of [
    (state) => (state.preferences.availableMinutes = 'bad'),
    (state) =>
      (Object.values(state.baselines)[0].days['2026-10-19'].provenance = 'invented'),
  ]) {
    const f = fixture(),
      api = f.build();
    await api.captureBaseline({ from: '2026-10-19', to: '2026-10-19' });
    const state = JSON.parse(f.storage.get('workbench-v1'));
    change(state);
    const raw = JSON.stringify(state);
    f.storage.set('workbench-v1', raw);
    await assert.rejects(
      api.review({ from: '2026-10-19', to: '2026-10-19' }),
      (e) => e.code === 'DATA_CORRUPT',
    );
    assert.equal(f.storage.get('workbench-v1'), raw);
  }
});

test('unassigned historical durations remain unknown even when no daily row can be produced', async () => {
  const f = fixture();
  f.setTasks([
    {
      id: 'unknown-duration',
      title: 'Dato ficticio',
      projectId: 'project-a',
      tagIds: [],
      timeEstimate: 120000,
      timeSpent: 60000,
      timeSpentOnDay: {},
    },
  ]);
  const view = await f.build().review({ from: '2026-10-19', to: '2026-10-21' });
  assert.deepEqual(view.rows, []);
  assert.deepEqual(view.unknownRecordedTaskIds, ['unknown-duration']);
  assert.equal(view.actualReliable, false);
  assert.ok(view.warnings.some((w) => /distribuir|desconocid/i.test(w)));
});
