import test from 'node:test';
import assert from 'node:assert/strict';
import {
  emptyWorkflow,
  validateWorkflow,
  workflowView,
  workflowBlockedTaskIds,
  applyWorkflowCommand,
  WorkflowError,
} from '../workflow.mjs';

const task = (id, extra = {}) => ({
  id,
  title: id,
  projectId: 'p',
  isDone: false,
  timeEstimate: 30 * 60000,
  timeSpent: 0,
  ...extra,
});
const snapshot = (tasks = [task('a'), task('b'), task('c')]) => ({
  tasks,
  projects: [{ id: 'p', title: 'Project' }],
  today: '2026-10-22',
  scopeByTask: {},
  capacityByDay: {
    '2026-10-22': { workMinutes: 60, personalMinutes: 30, partial: false },
  },
});
const apply = (s, type, payload, snap = snapshot()) =>
  applyWorkflowCommand(s, { type, payload }, snap, {
    operationId: 'operation-1',
    now: '2026-10-22',
  });
const rejects = (fn, code) =>
  assert.throws(fn, (e) => e instanceof WorkflowError && e.code === code);

test('validates versions, strict dates, bounds and clone isolation', () => {
  const state = emptyWorkflow();
  assert.equal(state.wipLimit, 2);
  assert.deepEqual(validateWorkflow(state), state);
  rejects(() => validateWorkflow({ ...state, schemaVersion: 2 }), 'INVALID_STATE');
  rejects(() => validateWorkflow({ ...state, wipLimit: 21 }), 'INVALID_STATE');
  rejects(
    () => validateWorkflow({ ...state, tasks: { a: { reviewOn: '2026-02-30' } } }),
    'INVALID_STATE',
  );
  rejects(
    () =>
      apply(state, 'task.criteria', {
        taskId: 'a',
        criteria: [{ id: 'x', text: 'x', isDone: 'yes' }],
      }),
    'INVALID_COMMAND',
  );
  const result = apply(state, 'task.priority', { taskId: 'a', priority: 'high' });
  assert.deepEqual(state, emptyWorkflow());
  assert.equal(result.state.tasks.a.priority, 'high');
});

test('dependencies reject self/cycles and expose missing and archived prerequisites', () => {
  let state = apply(emptyWorkflow(), 'task.dependencies', {
    taskId: 'a',
    dependsOn: ['b'],
  }).state;
  rejects(
    () => apply(state, 'task.dependencies', { taskId: 'b', dependsOn: ['a'] }),
    'DEPENDENCY_CYCLE',
  );
  rejects(
    () => apply(state, 'task.dependencies', { taskId: 'a', dependsOn: ['a'] }),
    'DEPENDENCY_CYCLE',
  );
  state.tasks.b = { dependsOn: ['missing'] };
  const view = workflowView(state, snapshot([task('a'), task('b', { archived: true })]), {
    view: 'board',
  });
  assert.equal(view.cards[0].blockers[0].reason, 'archived');
  rejects(
    () => apply(state, 'task.move', { taskId: 'a', column: 'in_progress' }),
    'TASK_BLOCKED',
  );
});

test('WIP uses full snapshot before filters, never starts timers and done is native', () => {
  const state = emptyWorkflow();
  state.tasks = { a: { column: 'in_progress' }, b: { column: 'in_progress' } };
  rejects(
    () => apply(state, 'task.move', { taskId: 'c', column: 'in_progress' }),
    'WIP_LIMIT',
  );
  assert.equal(workflowView(state, snapshot(), { view: 'board', limit: 1 }).wip.count, 2);
  const result = apply(emptyWorkflow(), 'task.move', { taskId: 'a', column: 'done' });
  assert.deepEqual(result.nativeActions, [
    { type: 'task.update', taskId: 'a', fields: { isDone: true } },
  ]);
  assert.equal(
    workflowView(result.state, snapshot(), { view: 'board' }).cards[0].column,
    'inbox',
  );
  const done = snapshot([task('a', { isDone: true })]);
  assert.equal(workflowView(state, done, { view: 'board' }).cards[0].column, 'done');
});

test('manual blocks, criteria completion, review and explicit reopening', () => {
  let state = apply(emptyWorkflow(), 'task.block', {
    taskId: 'a',
    reason: 'Waiting',
    reviewOn: '2026-10-23',
  }).state;
  rejects(
    () => apply(state, 'task.move', { taskId: 'a', column: 'done' }),
    'TASK_BLOCKED',
  );
  state = apply(state, 'task.unblock', { taskId: 'a' }).state;
  state = apply(state, 'task.criteria', {
    taskId: 'a',
    criteria: [{ id: 'x', text: 'Check', isDone: false }],
  }).state;
  rejects(
    () => apply(state, 'task.move', { taskId: 'a', column: 'done' }),
    'CRITERIA_INCOMPLETE',
  );
  assert.ok(
    workflowView(state, snapshot([task('a', { isDone: true })]), {
      view: 'review',
    }).issues.some((i) => i.code === 'criteria_mismatch'),
  );
  assert.deepEqual(
    apply(
      state,
      'task.move',
      { taskId: 'a', column: 'ready' },
      snapshot([task('a', { isDone: true })]),
    ).nativeActions[0].fields,
    { isDone: false },
  );
  assert.equal(
    apply(state, 'task.review', { taskId: 'a', date: '2026-10-22' }).state.tasks.a
      .reviewedOn,
    '2026-10-22',
  );
});

test('templates produce deterministic native IDs without copied native state', () => {
  const template = {
    id: 't',
    title: 'Routine',
    steps: [{ title: 'Step', timeEstimate: 60000 }],
    criteria: [{ id: 'x', text: 'Check', isDone: false }],
  };
  const state = apply(emptyWorkflow(), 'template.save', { template }).state;
  const first = apply(state, 'template.apply', { templateId: 't', projectId: 'p' });
  assert.deepEqual(
    first,
    apply(state, 'template.apply', { templateId: 't', projectId: 'p' }),
  );
  assert.equal(first.nativeActions[0].type, 'template.create');
  assert.equal(first.nativeActions[0].children.length, 1);
  assert.deepEqual(
    first.state.tasks[first.nativeActions[0].parent.id].criteria,
    template.criteria,
  );
  rejects(
    () => apply(state, 'template.save', { template: { ...template, steps: [] } }),
    'INVALID_COMMAND',
  );
});

test('weekly proposals account for existing work, dependencies, unknown estimates and partial guards', () => {
  const state = emptyWorkflow();
  state.tasks.b = { dependsOn: ['a'] };
  const snap = snapshot([
    task('b'),
    task('a'),
    task('existing', { dueDay: '2026-10-22' }),
    task('unknown', { timeEstimate: 0 }),
  ]);
  snap.capacityByDay['2026-10-23'] = {
    workMinutes: 60,
    personalMinutes: 0,
    partial: true,
  };
  const view = workflowView(state, snap, {
    view: 'week',
    from: '2026-10-22',
    to: '2026-10-23',
  });
  assert.deepEqual(
    view.proposal.assignments.map((a) => [a.taskId, a.date]),
    [
      ['a', '2026-10-22'],
      ['b', '2026-10-23'],
    ],
  );
  assert.equal(view.days[0].work.plannedMinutes, 30);
  assert.ok(
    view.issues.some((i) => i.code === 'missing_estimate' && i.taskId === 'unknown'),
  );
  const payload = { assignments: view.proposal.assignments, weekRevision: 'fresh' };
  rejects(() => apply(state, 'week.apply', payload, snap), 'PARTIAL_CAPACITY');
  assert.equal(
    apply(state, 'week.apply', { ...payload, allowPartial: true }, snap).nativeActions
      .length,
    2,
  );
  rejects(
    () =>
      apply(
        state,
        'week.apply',
        {
          ...payload,
          allowPartial: true,
          assignments: [{ taskId: 'b', date: '2026-10-22' }],
        },
        snap,
      ),
    'DEPENDENCY_ORDER',
  );
});

test('links are bounded HTTP metadata and queries are pure', () => {
  const state = emptyWorkflow();
  const snap = snapshot();
  const frozen = JSON.stringify([state, snap]);
  workflowView(state, snap, { view: 'review' });
  assert.equal(JSON.stringify([state, snap]), frozen);
  rejects(
    () =>
      apply(state, 'task.link', {
        taskId: 'a',
        provider: 'jira',
        externalId: 'A',
        url: 'javascript:alert(1)',
      }),
    'INVALID_COMMAND',
  );
  const next = apply(state, 'task.link', {
    taskId: 'a',
    provider: 'jira',
    externalId: 'A',
    url: 'https://example.test/A',
  }).state;
  assert.equal(next.tasks.a.links.length, 1);
});

test('weekly explicit selection excludes unselected work and rejects overcapacity without mutation', () => {
  const state = emptyWorkflow();
  const snap = snapshot();
  const result = workflowView(state, snap, {
    view: 'week',
    from: '2026-10-22',
    to: '2026-10-22',
    taskIds: ['b'],
  });
  assert.deepEqual(result.proposal.assignments, [{ taskId: 'b', date: '2026-10-22' }]);
  rejects(
    () =>
      apply(
        state,
        'week.apply',
        {
          weekRevision: 'fresh',
          assignments: ['a', 'b', 'c'].map((taskId) => ({ taskId, date: '2026-10-22' })),
        },
        snap,
      ),
    'CAPACITY_EXCEEDED',
  );
  rejects(
    () => workflowView(state, snap, { view: 'week', from: '2026-02-30' }),
    'INVALID_QUERY',
  );
  rejects(
    () =>
      apply(
        state,
        'week.apply',
        {
          weekRevision: 'fresh',
          assignments: [
            { taskId: 'a', date: '2026-10-22' },
            { taskId: 'a', date: '2026-10-22' },
          ],
        },
        snap,
      ),
    'INVALID_COMMAND',
  );
});

test('metadata state with missing cycle remains rejected and external tracking warns on WIP', () => {
  const state = emptyWorkflow();
  state.tasks = { missing: { dependsOn: ['a'] }, a: { dependsOn: ['missing'] } };
  rejects(() => validateWorkflow(state), 'INVALID_STATE');
  const active = emptyWorkflow();
  active.wipLimit = 1;
  active.tasks.a = { column: 'in_progress' };
  const snap = snapshot();
  snap.currentTaskId = 'b';
  const view = workflowView(active, snap, { view: 'board' });
  assert.equal(view.wip.count, 2);
  assert.ok(view.issues.some((i) => i.code === 'wip_exceeded'));
});

test('scheduled prerequisites with a manual block cannot admit dependent weekly work', () => {
  const state = emptyWorkflow();
  state.tasks = {
    a: { blockReason: 'Waiting', column: 'blocked' },
    b: { dependsOn: ['a'] },
  };
  const snap = snapshot([task('a', { dueDay: '2026-10-22' }), task('b')]);
  rejects(
    () =>
      apply(
        state,
        'week.apply',
        { weekRevision: 'fresh', assignments: [{ taskId: 'b', date: '2026-10-22' }] },
        snap,
      ),
    'TASK_BLOCKED',
  );
});

test('queries reject wrongly typed fields and operation IDs permit bounded Unicode without oversized task IDs', () => {
  rejects(
    () =>
      workflowView(emptyWorkflow(), snapshot(), {
        view: 'board',
        includeSubtasks: 'yes',
      }),
    'INVALID_QUERY',
  );
  const state = apply(emptyWorkflow(), 'template.save', {
    template: {
      id: 't',
      title: 'Template',
      steps: [{ title: 'Step', timeEstimate: 0 }],
      criteria: [],
    },
  }).state;
  const result = applyWorkflowCommand(
    state,
    { type: 'template.apply', payload: { templateId: 't', projectId: 'p' } },
    snapshot(),
    { operationId: 'ü'.repeat(150) },
  );
  assert.ok(result.nativeActions[0].parent.id.length <= 200);
});

test('tracking blocked work still consumes WIP and transitive unscheduled prerequisites prevent scheduling', () => {
  const state = emptyWorkflow();
  state.wipLimit = 1;
  state.tasks = {
    a: { column: 'blocked', blockReason: 'Waiting' },
    b: { dependsOn: ['a'] },
    c: { dependsOn: ['b'] },
  };
  const snap = snapshot([task('a'), task('b', { dueDay: '2026-10-22' }), task('c')]);
  snap.currentTaskId = 'a';
  assert.equal(workflowView(state, snap, { view: 'board' }).wip.count, 1);
  rejects(
    () =>
      apply(
        state,
        'week.apply',
        { weekRevision: 'fresh', assignments: [{ taskId: 'c', date: '2026-10-22' }] },
        snap,
      ),
    'TASK_BLOCKED',
  );
  state.tasks.a = {};
  rejects(
    () =>
      apply(
        state,
        'week.apply',
        { weekRevision: 'fresh', assignments: [{ taskId: 'c', date: '2026-10-22' }] },
        snap,
      ),
    'DEPENDENCY_ORDER',
  );
});

test('manual blocking needs a reason and review includes native deadlines and due block reviews', () => {
  rejects(
    () => apply(emptyWorkflow(), 'task.move', { taskId: 'a', column: 'blocked' }),
    'INVALID_COMMAND',
  );
  const state = apply(emptyWorkflow(), 'task.block', {
    taskId: 'a',
    reason: 'Waiting',
    reviewOn: '2026-10-22',
  }).state;
  const view = workflowView(
    state,
    snapshot([task('a'), task('b', { deadlineDay: '2026-10-21' })]),
    { view: 'review' },
  );
  assert.ok(view.issues.some((i) => i.taskId === 'a' && i.code === 'review_due'));
  assert.ok(view.issues.some((i) => i.taskId === 'b' && i.code === 'overdue'));
});

test('host recommendations receive all blocked IDs independently of display limits', () => {
  const state = emptyWorkflow();
  state.tasks.c = { dependsOn: ['missing'] };
  assert.deepEqual(workflowBlockedTaskIds(state, snapshot()), ['c']);
  assert.equal(
    workflowView(state, snapshot(), { view: 'board', limit: 1 }).cards.length,
    1,
  );
});

test('week defaults propose template leaf steps and retain existing leaf capacity before display limits', () => {
  const snap = snapshot([
    task('parent', { subTaskIds: ['step', 'scheduled'], timeEstimate: 0 }),
    task('step', { parentId: 'parent' }),
    task('scheduled', { parentId: 'parent', dueDay: '2026-10-22' }),
  ]);
  const week = workflowView(emptyWorkflow(), snap, {
    view: 'week',
    from: '2026-10-22',
    to: '2026-10-22',
    limit: 1,
  });
  assert.deepEqual(week.proposal.assignments, [{ taskId: 'step', date: '2026-10-22' }]);
  assert.equal(week.days[0].work.plannedMinutes, 30);
  assert.deepEqual(
    workflowView(emptyWorkflow(), snap, { view: 'board' }).cards.map((c) => c.taskId),
    ['parent'],
  );
  assert.ok(
    workflowView(emptyWorkflow(), snap, { view: 'week' }).cards.some(
      (c) => c.taskId === 'step',
    ),
  );
});

test('external workflow links require HTTPS', () => {
  rejects(
    () =>
      apply(emptyWorkflow(), 'task.link', {
        taskId: 'a',
        provider: 'jira',
        externalId: 'A',
        url: 'http://example.test/A',
      }),
    'INVALID_COMMAND',
  );
});

test('last child completion enforces automatically completed parent criteria while native done wins', () => {
  const state = emptyWorkflow();
  state.tasks.parent = { criteria: [{ id: 'c', text: 'Review output', isDone: false }] };
  const snap = snapshot([
    task('parent', { subTaskIds: ['first', 'last'] }),
    task('first', { parentId: 'parent', isDone: true }),
    task('last', { parentId: 'parent' }),
  ]);
  snap.autoMarkParentDone = true;
  rejects(
    () => apply(state, 'task.move', { taskId: 'last', column: 'done' }, snap),
    'CRITERIA_INCOMPLETE',
  );
  snap.autoMarkParentDone = false;
  assert.equal(
    apply(state, 'task.move', { taskId: 'last', column: 'done' }, snap).nativeActions
      .length,
    1,
  );
  snap.autoMarkParentDone = true;
  snap.tasks[1].isDone = false;
  assert.equal(
    apply(state, 'task.move', { taskId: 'last', column: 'done' }, snap).nativeActions
      .length,
    1,
  );
  snap.tasks[0].isDone = true;
  snap.tasks[1].isDone = true;
  assert.equal(
    apply(state, 'task.move', { taskId: 'last', column: 'done' }, snap).nativeActions
      .length,
    1,
  );
});

test('automatic completion checks ancestor blockers recursively against predicted native completion', () => {
  const state = emptyWorkflow();
  const snap = snapshot([
    task('grand', { subTaskIds: ['parent'] }),
    task('parent', { parentId: 'grand', subTaskIds: ['child'] }),
    task('child', { parentId: 'parent' }),
  ]);
  snap.autoMarkParentDone = true;
  state.tasks.parent = { dependsOn: ['missing'] };
  rejects(
    () => apply(state, 'task.move', { taskId: 'child', column: 'done' }, snap),
    'TASK_BLOCKED',
  );
  state.tasks.parent = { dependsOn: ['child'] };
  state.tasks.grand = { criteria: [{ id: 'c', text: 'Check', isDone: false }] };
  rejects(
    () => apply(state, 'task.move', { taskId: 'child', column: 'done' }, snap),
    'CRITERIA_INCOMPLETE',
  );
  state.tasks.grand = { dependsOn: ['parent'] };
  assert.deepEqual(
    apply(state, 'task.move', { taskId: 'child', column: 'done' }, snap).nativeActions,
    [{ type: 'task.update', taskId: 'child', fields: { isDone: true } }],
  );
});

test('explicit parent completion follows native one-task behavior without completing guarded children', () => {
  const state = emptyWorkflow();
  state.tasks.child = {
    blockReason: 'Waiting',
    criteria: [{ id: 'c', text: 'Check', isDone: false }],
  };
  const snap = snapshot([
    task('parent', { subTaskIds: ['child'] }),
    task('child', { parentId: 'parent' }),
  ]);
  snap.autoMarkParentDone = true;
  assert.deepEqual(
    apply(state, 'task.move', { taskId: 'parent', column: 'done' }, snap).nativeActions,
    [{ type: 'task.update', taskId: 'parent', fields: { isDone: true } }],
  );
});

test('project board migration, isolation, custom stage identity and WIP', () => {
  const legacy = emptyWorkflow(),
    snap = snapshot([task('a'), task('b'), task('q', { projectId: 'q' })]);
  snap.projects.push({ id: 'q' });
  assert.deepEqual(validateWorkflow(legacy), legacy);
  let state = apply(
    legacy,
    'board.column.save',
    { projectId: 'p', column: { id: 'draft', title: 'Draft', status: 'ready' } },
    snap,
  ).state;
  state = apply(state, 'board.configure', { projectId: 'p', wipLimit: 1 }, snap).state;
  state = apply(
    state,
    'task.move',
    { taskId: 'a', column: 'ready', columnId: 'draft' },
    snap,
  ).state;
  assert.equal(workflowView(state, snap, { projectId: 'p' }).cards[0].columnId, 'draft');
  assert.equal(
    workflowView(state, snap, { projectId: 'p' }).columns.at(-1).title,
    'Draft',
  );
  assert.equal(workflowView(state, snap, { projectId: 'q' }).columns.length, 5);
  assert.equal(workflowView(state, snap, { projectId: 'q' }).wip.limit, 2);
  state = apply(state, 'task.move', { taskId: 'q', column: 'in_progress' }, snap).state;
  state = apply(state, 'task.move', { taskId: 'a', column: 'in_progress' }, snap).state;
  rejects(
    () => apply(state, 'task.move', { taskId: 'b', column: 'in_progress' }, snap),
    'WIP_LIMIT',
  );
  assert.equal(workflowView(state, snap, { projectId: 'p' }).wip.count, 1);
  assert.equal(legacy.projectBoards, undefined);
});
test('column ordering and occupied removal preserve semantics and native state', () => {
  const snap = snapshot();
  let state = apply(
    emptyWorkflow(),
    'board.column.save',
    { projectId: 'p', column: { id: 'draft', title: 'Draft', status: 'ready' } },
    snap,
  ).state;
  state = apply(
    state,
    'task.move',
    { taskId: 'a', column: 'ready', columnId: 'draft' },
    snap,
  ).state;
  rejects(
    () =>
      apply(
        state,
        'board.column.save',
        { projectId: 'p', column: { id: 'draft', title: 'Done', status: 'done' } },
        snap,
      ),
    'COLUMN_OCCUPIED',
  );
  rejects(
    () =>
      apply(
        state,
        'board.column.reorder',
        { projectId: 'p', columnIds: ['draft'] },
        snap,
      ),
    'INVALID_COMMAND',
  );
  const ids = state.projectBoards.p.columns.map((c) => c.id).reverse();
  state = apply(
    state,
    'board.column.reorder',
    { projectId: 'p', columnIds: ids },
    snap,
  ).state;
  assert.deepEqual(
    workflowView(state, snap, { projectId: 'p' }).columns.map((c) => c.id),
    ids,
  );
  rejects(
    () =>
      apply(state, 'board.column.remove', { projectId: 'p', columnId: 'draft' }, snap),
    'COLUMN_OCCUPIED',
  );
  rejects(
    () =>
      apply(
        state,
        'board.column.remove',
        { projectId: 'p', columnId: 'draft', targetColumnId: 'done' },
        snap,
      ),
    'INVALID_COMMAND',
  );
  const result = apply(
    state,
    'board.column.remove',
    { projectId: 'p', columnId: 'draft', targetColumnId: 'ready' },
    snap,
  );
  assert.deepEqual(result.nativeActions, []);
  assert.equal(
    workflowView(result.state, snap, { projectId: 'p' }).cards[0].columnId,
    'ready',
  );
  assert.equal(
    workflowView(state, snapshot([task('a', { projectId: 'q' })]), { projectId: 'q' })
      .cards[0].columnId,
    'ready',
  );
  rejects(
    () =>
      apply(state, 'task.move', { taskId: 'a', column: 'done', columnId: 'draft' }, snap),
    'INVALID_COMMAND',
  );
});
test('removed semantic columns reappear only when native cards require a lossless fallback', () => {
  const snap = snapshot();
  let state = apply(
    emptyWorkflow(),
    'board.column.remove',
    { projectId: 'p', columnId: 'done' },
    snap,
  ).state;
  assert.equal(
    workflowView(state, snap, { projectId: 'p' }).columns.some((c) => c.id === 'done'),
    false,
  );
  const native = snapshot([task('a', { isDone: true })]);
  const view = workflowView(state, native, { projectId: 'p' });
  assert.equal(view.columns.find((c) => c.status === 'done').cards[0].taskId, 'a');
});
test('extensions fail closed in older strict validators and reject malformed board metadata', () => {
  const state = apply(emptyWorkflow(), 'board.configure', {
    projectId: 'p',
    wipLimit: 1,
  }).state;
  assert.equal(
    Object.keys(state).every((k) =>
      ['schemaVersion', 'wipLimit', 'tasks', 'templates'].includes(k),
    ),
    false,
  );
  rejects(
    () =>
      validateWorkflow({ ...state, projectBoards: { p: { columns: [], wipLimit: 1 } } }),
    'INVALID_STATE',
  );
  rejects(
    () => validateWorkflow({ ...state, tasks: { a: { columnId: 'draft' } } }),
    'INVALID_STATE',
  );
});

test('fallback groups expose hidden task occupancy and accept safe native-status destinations', () => {
  const snap = snapshot([task('a', { isDone: true, parentId: 'parent' }), task('b')]);
  let state = apply(
    emptyWorkflow(),
    'board.column.remove',
    { projectId: 'p', columnId: 'done' },
    snapshot(),
  ).state;
  const view = workflowView(state, snap, { projectId: 'p' });
  const done = view.columns.find((c) => c.status === 'done');
  assert.equal(done.fallback, true);
  assert.equal(done.taskCount, 1);
  assert.deepEqual(done.cards, []);
  const moved = apply(
    state,
    'task.move',
    { taskId: 'b', column: 'done', columnId: done.id },
    snap,
  );
  assert.deepEqual(moved.nativeActions, [
    { type: 'task.update', taskId: 'b', fields: { isDone: true } },
  ]);
  assert.equal(
    moved.state.projectBoards.p.columns.some((c) => c.status === 'done'),
    false,
  );
});
