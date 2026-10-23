const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { expect } = require('@playwright/test');

/** Optional real-Electron scenario. Uses only public UI/MCP APIs and isolated fictitious data. */
async function runGuidedScenario({ page, call, waitUntilReady }) {
  const { instant, addDays } =
    await import('../../packages/personal-planner-core/schedule.mjs');
  const frame = () => page.frameLocator('plugin-index iframe');
  const uiApi = (method, ...args) =>
    frame()
      .locator('body')
      .evaluate(
        async (_body, request) => {
          const api = window.PluginAPI;
          if (typeof api?.[request.method] !== 'function')
            throw Error('Missing public plugin API: ' + request.method);
          return api[request.method](...request.args);
        },
        { method, args },
      );
  const data = async (tool, args = {}) => {
    const result = await call(tool, args);
    assert.equal(result.isError ?? false, false, tool + ': ' + JSON.stringify(result));
    assert.ok(result.structuredContent, tool + ' must return structured content');
    return result.structuredContent;
  };
  const applied = async (tool, args) => {
    const result = await data(tool, args);
    assert.equal(result.status, 'applied', tool + ': ' + JSON.stringify(result));
    return result;
  };
  const edit = async (command) => {
    const state = await data('planner_activities');
    return applied('planner_edit', {
      operationId: randomUUID(),
      baseRevision: state.revision,
      command,
    });
  };
  const readTask = async (taskId) => {
    const task = (await uiApi('getTasks')).find((value) => value.id === taskId);
    assert.ok(task, 'Expected active native task ' + taskId);
    return task;
  };
  const zone = await page.evaluate(
    () => Intl.DateTimeFormat().resolvedOptions().timeZone,
  );
  const today = new Intl.DateTimeFormat('en-CA', {
    timeZone: zone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
  const future = addDays(today, 3);
  const reloadPanel = async () => {
    await page.reload();
    await waitUntilReady();
    await frame().locator('form[data-guided="review-load"]').waitFor();
  };
  await frame().locator('form[data-guided="review-load"]').waitFor();
  const originalProfile = await data('planner_activities');
  if (originalProfile.profile.timezone !== zone)
    await edit({ type: 'preferences.update', payload: { timezone: zone } });
  const projectId = await uiApi('addProject', {
    title: 'Proyecto ficticio de revisión guiada',
  });
  const activityId = 'guided-area-' + randomUUID();
  await edit({
    type: 'activity.create',
    payload: { id: activityId, name: 'Actividad ficticia de revisión' },
  });
  await edit({
    type: 'activity.update',
    payload: { id: activityId, updates: { projectIds: [projectId] } },
  });
  const title = 'Tarea ficticia de revisión guiada';
  const created = await applied('planner_task', {
    operationId: randomUUID(),
    fields: { title, projectId, dueDay: today, timeEstimate: 8 * 60000 },
  });
  const taskId = created.taskId;
  const untouched = await readTask(taskId);
  const options = await data('planner_next', {
    date: today,
    now: instant(today, '12:00', zone),
    contextAreaId: activityId,
    availableMinutes: 30,
    limit: 3,
  });
  const candidate = options.candidates.find((value) => value.taskId === taskId);
  assert.ok(
    candidate?.slot && candidate.reasons.length,
    'A fitting next action must explain its actual slot',
  );
  const none = await data('planner_next', {
    date: today,
    now: instant(today, '12:00', zone),
    contextAreaId: activityId,
    availableMinutes: 1,
    limit: 3,
  });
  assert.equal(none.candidates.length, 0);
  assert.ok(none.emptyReason, 'No fitting action must have a reason');
  assert.deepEqual(
    await readTask(taskId),
    untouched,
    'Reading next actions must not alter native tasks',
  );

  let review = await data('planner_review', { from: today, to: today });
  const started = await applied('planner_review_advance', {
    operationId: randomUUID(),
    expectedRevision: review.revision,
    command: 'start',
    from: today,
    to: today,
  });
  const reviewId = started.reviewId;
  review = await data('planner_review', { from: today, to: today, reviewId });
  assert.equal(
    review.baseline.rows.find((row) => row.taskId === taskId).plannedMs,
    8 * 60000,
  );
  assert.ok(
    review.session.items.length,
    'Synthetic profile must contain reviewable issues',
  );
  const load = frame().locator('form[data-guided="review-load"]');
  await load.locator('[name="from"]').fill(today);
  await load.locator('[name="to"]').fill(today);
  await load.locator('button').click();
  const firstIssue = review.session.items[0].id;
  const decision = frame().locator('form[data-guided="review-decision"]').first();
  await decision.waitFor();
  // Confirm which durable item the real form represents, rather than relying on display order.
  const decidedItem = await decision.getAttribute('data-item');
  assert.ok(
    review.session.items.some((item) => item.id === decidedItem),
    firstIssue,
  );
  await decision.locator('[name="decision"]').selectOption('keep');
  await decision.locator('button').click();
  await expect
    .poll(
      async () =>
        (await data('planner_review', { from: today, to: today, reviewId })).session
          .decisions[decidedItem]?.decision,
      { timeout: 30000 },
    )
    .toBe('keep');
  await reloadPanel();
  await expect(frame().locator('#review-content')).toContainText(title);
  review = await data('planner_review', { from: today, to: today, reviewId });
  assert.equal(review.session.decisions[decidedItem].decision, 'keep');
  assert.equal(review.session.reviewedAt, null, 'Reopening must not finish a review');

  const zeroRequest = {
    operationId: randomUUID(),
    activityId,
    taskId,
    date: today,
    expectedDurationMs: 0,
    durationMs: 0,
  };
  await applied('planner_correct_time', zeroRequest);
  // Refresh the actual UI table and edit a real duration through its form.
  await frame().locator('form[data-guided="review-load"] button').click();
  const row = frame().locator('#review-content tbody tr').filter({ hasText: title });
  const correction = row.locator('form[data-guided="correct-time"]');
  await expect(correction.locator('[name="minutes"]')).toHaveValue('0');
  await correction.locator('[name="minutes"]').fill('2');
  await correction.locator('[name="activityId"]').selectOption(activityId);
  await correction.locator('button').click();
  await expect
    .poll(
      async () =>
        (await data('planner_review', { from: today, to: today, reviewId })).rows.find(
          (value) => value.taskId === taskId && value.date === today,
        )?.actualMs,
      { timeout: 30000 },
    )
    .toBe(120000);
  assert.equal((await data('planner_correct_time', zeroRequest)).replayed, true);
  review = await data('planner_review', { from: today, to: today, reviewId });
  const recorded = review.rows.find(
    (value) => value.taskId === taskId && value.date === today,
  );
  assert.equal(
    recorded.actualMs,
    120000,
    'Replaying the zero correction must not erase a later UI edit',
  );
  assert.equal(
    recorded.plannedMs,
    8 * 60000,
    'Captured planned time remains unchanged after actual-time edits',
  );

  await applied('planner_task', {
    operationId: randomUUID(),
    taskId,
    fields: { dueDay: future },
  });
  let proposal = await data('planner_prepare', { from: future, to: future });
  let item = proposal.proposals.find(
    (value) =>
      value.taskId === taskId && value.target === 'native-task' && value.interval,
  );
  assert.ok(item, 'Expected a native future scheduling alternative');
  const adjusted = await data('planner_proposal_adjust', {
    proposalId: proposal.proposalId,
    changes: [{ itemId: item.id, start: item.interval[0] + 3600000 }],
  });
  assert.notEqual(adjusted.proposalId, proposal.proposalId);
  const adjustedItem = adjusted.proposals.find((value) => value.id === item.id);
  assert.equal(adjustedItem.interval[0], item.interval[0] + 3600000);
  const moved = await applied('planner_apply', {
    operationId: randomUUID(),
    proposalId: adjusted.proposalId,
    selection: [item.id],
  });
  assert.ok(moved.historyId);
  assert.equal((await readTask(taskId)).dueWithTime, adjustedItem.interval[0]);
  await applied('planner_correct_time', {
    operationId: randomUUID(),
    activityId,
    taskId,
    date: today,
    expectedDurationMs: 120000,
    durationMs: 180000,
  });
  await applied('planner_task', {
    operationId: randomUUID(),
    taskId,
    fields: { isDone: true },
  });
  const beforeUndo = await readTask(taskId);
  await reloadPanel();
  assert.equal(
    (await readTask(taskId)).doneOn,
    beforeUndo.doneOn,
    'Reload alone must preserve the completion timestamp before any undo',
  );
  const history = await data('planner_reorganizations', { historyId: moved.historyId });
  assert.equal(history.entry.status, 'confirmed');
  assert.equal(history.entry.changes[0].taskId, taskId);
  await frame().locator('[data-action="guided-history"]').click();
  await expect(frame().locator('#history-content')).toContainText(moved.historyId);
  const undo = await data('planner_prepare_undo', { historyId: moved.historyId });
  const undoItem = undo.proposals.find((value) => value.taskId === taskId);
  assert.equal(undoItem.selectable, true);
  const undoArgs = {
    operationId: randomUUID(),
    proposalId: undo.proposalId,
    selection: [undoItem.id],
  };
  await applied('planner_apply', undoArgs);
  assert.equal((await data('planner_apply', undoArgs)).replayed, true);
  const restored = await readTask(taskId);
  assert.equal(restored.dueDay, future);
  assert.equal(restored.dueWithTime ?? null, null);
  assert.equal(restored.timeSpent, beforeUndo.timeSpent);
  assert.deepEqual(restored.timeSpentOnDay, beforeUndo.timeSpentOnDay);
  assert.equal(restored.isDone, true);
  assert.equal(restored.doneOn, beforeUndo.doneOn);

  const later = await applied('planner_task', {
    operationId: randomUUID(),
    fields: {
      title: 'Tarea ficticia con edición posterior',
      projectId,
      dueDay: future,
      timeEstimate: 300000,
    },
  });
  proposal = await data('planner_prepare', { from: future, to: future });
  item = proposal.proposals.find(
    (value) => value.taskId === later.taskId && value.interval,
  );
  assert.ok(item);
  const laterApplied = await applied('planner_apply', {
    operationId: randomUUID(),
    proposalId: proposal.proposalId,
    selection: [item.id],
  });
  const changedTime = item.interval[0] + 7200000;
  await applied('planner_task', {
    operationId: randomUUID(),
    taskId: later.taskId,
    fields: { dueWithTime: changedTime },
  });
  const conflict = await data('planner_prepare_undo', {
    historyId: laterApplied.historyId,
  });
  assert.ok(conflict.conflicts.length);
  assert.equal(conflict.proposals[0].selectable, false);
  const deniedUndo = await data('planner_apply', {
    operationId: randomUUID(),
    proposalId: conflict.proposalId,
    selection: [conflict.proposals[0].id],
  });
  assert.equal(deniedUndo.status, 'rejected');
  assert.equal((await readTask(later.taskId)).dueWithTime, changedTime);
  const dailyMinutes = async () =>
    (await data('planner_query', { from: today, to: today })).days[0].progress.find(
      (value) => value.activityId === activityId,
    ).dailyMinutes;
  const split = await applied('planner_task', {
    operationId: randomUUID(),
    fields: {
      title: 'Tarea ficticia para dividir',
      projectId,
      dueDay: today,
      timeEstimate: 120000,
    },
  });
  await applied('planner_log_time', {
    operationId: randomUUID(),
    taskId: split.taskId,
    activityId,
    date: today,
    durationMs: 60000,
  });
  const beforeSplitTotal = await dailyMinutes();
  const divided = await applied('planner_task', {
    operationId: randomUUID(),
    taskId: split.taskId,
    command: 'split',
    children: [
      { title: 'Primera subtarea ficticia', timeEstimate: 60000 },
      { title: 'Segunda subtarea ficticia', timeEstimate: 60000 },
    ],
  });
  assert.equal(divided.taskIds.length, 2);
  assert.equal((await readTask(divided.taskIds[0])).timeSpent, 60000);
  assert.equal((await readTask(split.taskId)).timeSpent, 60000);
  assert.equal(
    await dailyMinutes(),
    beforeSplitTotal,
    'Parent aggregate and inherited first-child history must not be double-counted',
  );
  const extra = await applied('planner_task', {
    operationId: randomUUID(),
    fields: {
      title: 'Tarea ficticia para archivar',
      projectId,
      dueDay: today,
      timeEstimate: 60000,
    },
  });
  await applied('planner_log_time', {
    operationId: randomUUID(),
    taskId: extra.taskId,
    activityId,
    date: today,
    durationMs: 60000,
  });
  const beforeArchiveTotal = await dailyMinutes();
  await applied('planner_task', {
    operationId: randomUUID(),
    taskId: extra.taskId,
    command: 'archive',
  });
  assert(!(await uiApi('getTasks')).some((task) => task.id === extra.taskId));
  const archived = (await uiApi('getArchivedTasks')).find(
    (task) => task.id === extra.taskId,
  );
  assert.ok(archived, 'Public archive API must return the real archived leaf');
  assert.equal(archived.isDone, true);
  assert.equal(archived.timeSpentOnDay[today], 60000);
  assert.equal(
    await dailyMinutes(),
    beforeArchiveTotal,
    'Moving a task to the archive must preserve its recorded minute exactly once',
  );
  const checkpoint = {
    reviewId,
    from: today,
    to: today,
    taskId,
    doneOn: restored.doneOn,
    historyId: moved.historyId,
    operationId: undoArgs.operationId,
    dailyMinutes: await dailyMinutes(),
    activityId,
  };
  console.log(
    'PASS guided real Electron: reasoned next/no-fit, UI review decision and reload, captured baseline, UI/MCP actual-time correction with durable replay, adjusted proposal/history, plan-only undo preserving later time/completion, later-plan conflict, native split and archived history counted once. Fictitious data only.',
  );
  return checkpoint;
}
module.exports = { runGuidedScenario };
