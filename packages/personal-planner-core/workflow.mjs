const COLUMNS = ['inbox', 'ready', 'in_progress', 'blocked', 'done'];
const PRIORITIES = ['low', 'normal', 'high', 'urgent'];
const DAY = 86400000;
export class WorkflowError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'WorkflowError';
    this.code = code;
    this.details = details;
  }
}
const fail = (code, message, details) => {
  throw new WorkflowError(code, message, details);
};
const object = (v) =>
  !!v &&
  typeof v === 'object' &&
  !Array.isArray(v) &&
  (Object.getPrototypeOf(v) === Object.prototype || Object.getPrototypeOf(v) === null);
const text = (v, max = 500) =>
  typeof v === 'string' && v.trim().length > 0 && v.length <= max;
const id = (v) => text(v, 200) && !['__proto__', 'constructor', 'prototype'].includes(v);
const date = (v) =>
  typeof v === 'string' &&
  /^\d{4}-\d{2}-\d{2}$/.test(v) &&
  Number.isFinite(Date.parse(v)) &&
  new Date(v).toISOString().slice(0, 10) === v;
const keys = (v, allowed) =>
  object(v) && Object.keys(v).every((k) => allowed.includes(k));
const unique = (v) => new Set(v).size === v.length;
// A stable 128-bit identifier for native task IDs, not an authorization token.
function operationKey(value) {
  const hashes = [2166136261, 2246822507, 3266489909, 668265263];
  for (const char of value)
    for (let i = 0; i < hashes.length; i++)
      hashes[i] = Math.imul(hashes[i] ^ char.codePointAt(0), 16777619 + i * 2) >>> 0;
  return hashes.map((h) => h.toString(16).padStart(8, '0')).join('');
}
const criteriaValid = (v) =>
  Array.isArray(v) &&
  v.length <= 50 &&
  v.every(
    (c) =>
      keys(c, ['id', 'text', 'isDone']) &&
      id(c.id) &&
      text(c.text, 1000) &&
      typeof c.isDone === 'boolean',
  ) &&
  unique(v.map((c) => c.id));
const linkValid = (v) => {
  if (
    !keys(v, ['provider', 'externalId', 'url']) ||
    !['jira', 'trello'].includes(v.provider) ||
    !id(v.externalId) ||
    !text(v.url, 2048)
  )
    return false;
  try {
    const u = new URL(v.url);
    return u.protocol === 'https:' && !u.username && !u.password;
  } catch {
    return false;
  }
};
const templateValid = (v) =>
  keys(v, ['id', 'title', 'steps', 'criteria']) &&
  id(v.id) &&
  text(v.title) &&
  Array.isArray(v.steps) &&
  v.steps.length >= 1 &&
  v.steps.length <= 50 &&
  v.steps.every(
    (s) =>
      keys(s, ['title', 'timeEstimate']) &&
      text(s.title) &&
      Number.isSafeInteger(s.timeEstimate) &&
      s.timeEstimate >= 0 &&
      s.timeEstimate <= DAY,
  ) &&
  criteriaValid(v.criteria);
const metadataValid = (m) =>
  keys(m, [
    'column',
    'columnId',
    'columnProjectId',
    'dependsOn',
    'blockReason',
    'reviewOn',
    'criteria',
    'priority',
    'reviewedOn',
    'links',
  ]) &&
  (m.column === undefined || COLUMNS.includes(m.column)) &&
  ((m.columnId === undefined && m.columnProjectId === undefined) ||
    (id(m.columnId) && id(m.columnProjectId))) &&
  (m.dependsOn === undefined ||
    (Array.isArray(m.dependsOn) &&
      m.dependsOn.length <= 50 &&
      m.dependsOn.every(id) &&
      unique(m.dependsOn))) &&
  (m.blockReason === undefined || text(m.blockReason, 2000)) &&
  (m.reviewOn === undefined || date(m.reviewOn)) &&
  (m.reviewedOn === undefined || date(m.reviewedOn)) &&
  (m.criteria === undefined || criteriaValid(m.criteria)) &&
  (m.priority === undefined || PRIORITIES.includes(m.priority)) &&
  (m.links === undefined ||
    (Array.isArray(m.links) &&
      m.links.length <= 20 &&
      m.links.every(linkValid) &&
      unique(m.links.map((l) => `${l.provider}:${l.url}`))));
function cyclic(tasks) {
  const seen = new Set(),
    visiting = new Set();
  const visit = (key) => {
    if (visiting.has(key)) return true;
    if (seen.has(key)) return false;
    visiting.add(key);
    for (const dep of tasks[key]?.dependsOn || []) if (visit(dep)) return true;
    visiting.delete(key);
    seen.add(key);
    return false;
  };
  return Object.keys(tasks).some(visit);
}
const defaultColumns = () =>
  COLUMNS.map((status) => ({ id: status, title: status, status }));
const columnValid = (c) =>
  keys(c, ['id', 'title', 'status']) &&
  id(c.id) &&
  text(c.title) &&
  COLUMNS.includes(c.status);
const boardValid = (b) =>
  keys(b, ['columns', 'wipLimit']) &&
  Number.isInteger(b.wipLimit) &&
  b.wipLimit >= 1 &&
  b.wipLimit <= 20 &&
  Array.isArray(b.columns) &&
  b.columns.length >= 1 &&
  b.columns.length <= 50 &&
  b.columns.every(columnValid) &&
  unique(b.columns.map((c) => c.id));
const boardFor = (state, projectId) =>
  state.projectBoards?.[projectId] || {
    columns: defaultColumns(),
    wipLimit: state.wipLimit,
  };
// Native status changes are authoritative. Missing semantic stages receive a
// collision-free presentation fallback only while cards actually need them.
function fallbackColumn(columns, status) {
  const existing = columns.find((c) => c.status === status);
  if (existing) return existing;
  let key = status;
  while (columns.some((c) => c.id === key)) key = `fallback-${key}`;
  return { id: key, title: status, status };
}
export function emptyWorkflow() {
  return { schemaVersion: 1, wipLimit: 2, tasks: {}, templates: {} };
}
export function validateWorkflow(state) {
  if (
    !keys(state, ['schemaVersion', 'wipLimit', 'tasks', 'templates', 'projectBoards']) ||
    state.schemaVersion !== 1 ||
    !Number.isInteger(state.wipLimit) ||
    state.wipLimit < 1 ||
    state.wipLimit > 20 ||
    !object(state.tasks) ||
    !object(state.templates) ||
    Object.entries(state.tasks).some(
      ([key, value]) => !id(key) || !metadataValid(value),
    ) ||
    Object.entries(state.templates).some(
      ([key, value]) => !id(key) || !templateValid(value) || key !== value.id,
    ) ||
    (state.projectBoards !== undefined &&
      (!object(state.projectBoards) ||
        Object.entries(state.projectBoards).some(
          ([key, value]) => !id(key) || !boardValid(value),
        ))) ||
    cyclic(state.tasks)
  )
    fail('INVALID_STATE', 'Invalid or unsupported workflow data.');
  return structuredClone(state);
}
const nativeTasks = (s) => s.tasks || [...(s.byId?.values() || [])];
const archived = (t, s) =>
  !!(
    t.archived ||
    t.isArchived ||
    s.projects?.some((p) => p.id === t.projectId && p.isArchived)
  );
const remaining = (t) => Math.max(0, (t.timeEstimate || 0) - (t.timeSpent || 0)) / 60000;
const scope = (s, t) => (s.scopeByTask?.[t.id] === 'personal' ? 'personal' : 'work');
const planned = (s, t) => (s.plannedDay ? s.plannedDay(t) : t.dueDay || null);
function blockers(
  state,
  snapshot,
  taskId,
  byId = new Map(nativeTasks(snapshot).map((t) => [t.id, t])),
) {
  const meta = state.tasks[taskId] || {};
  const result =
    meta.blockReason || meta.column === 'blocked'
      ? [{ reason: 'manual', message: meta.blockReason || 'Manually blocked' }]
      : [];
  for (const dep of meta.dependsOn || []) {
    const t = byId.get(dep);
    if (!t) result.push({ taskId: dep, reason: 'missing' });
    else if (archived(t, snapshot)) result.push({ taskId: dep, reason: 'archived' });
    else if (!t.isDone) result.push({ taskId: dep, reason: 'incomplete' });
  }
  return result;
}
function cardsFor(state, snapshot) {
  const byId = new Map(nativeTasks(snapshot).map((t) => [t.id, t]));
  return nativeTasks(snapshot)
    .filter((t) => !archived(t, snapshot))
    .map((t) => {
      const m = state.tasks[t.id] || {},
        blocked = blockers(state, snapshot, t.id, byId);
      const card = {
        taskId: t.id,
        title: t.title,
        projectId: t.projectId || null,
        parentId: t.parentId || null,
        isDone: !!t.isDone,
        timeEstimate: t.timeEstimate || 0,
        timeSpent: t.timeSpent || 0,
        dueDay: planned(snapshot, t),
        deadlineDay: t.deadlineDay || null,
        column: t.isDone
          ? 'done'
          : blocked.length
            ? 'blocked'
            : snapshot.currentTaskId === t.id
              ? 'in_progress'
              : m.column && m.column !== 'done'
                ? m.column
                : 'inbox',
        dependsOn: m.dependsOn || [],
        blockers: blocked,
        criteria: m.criteria || [],
        priority: m.priority || 'normal',
        links: m.links || [],
        blockReason: m.blockReason || null,
        reviewOn: m.reviewOn || null,
        reviewedOn: m.reviewedOn || null,
      };
      const columns = boardFor(state, t.projectId).columns;
      card.columnId =
        (m.columnProjectId === t.projectId &&
          columns.find((c) => c.id === m.columnId && c.status === card.column)?.id) ||
        fallbackColumn(columns, card.column).id;
      return card;
    });
}
const wipCount = (cards, snapshot, excludeId) =>
  cards.filter(
    (c) =>
      c.taskId !== excludeId &&
      !c.isDone &&
      (c.column === 'in_progress' || c.taskId === snapshot.currentTaskId),
  ).length;
export function workflowBlockedTaskIds(input, snapshot) {
  return cardsFor(validateWorkflow(input), snapshot)
    .filter((c) => !c.isDone && c.blockers.length)
    .map((c) => c.taskId);
}
function dependencyIssue(state, snapshot, taskId, assigned, targetDate, all) {
  const pending = [{ taskId, date: targetDate }],
    seen = new Set();
  while (pending.length) {
    const item = pending.pop();
    if (seen.has(item.taskId)) continue;
    seen.add(item.taskId);
    for (const dep of state.tasks[item.taskId]?.dependsOn || []) {
      const task = all.get(dep),
        meta = state.tasks[dep] || {};
      if (!task || archived(task, snapshot))
        return { code: 'TASK_BLOCKED', dependency: dep };
      if (task.isDone) continue;
      if (meta.blockReason || meta.column === 'blocked')
        return { code: 'TASK_BLOCKED', dependency: dep };
      const day = assigned.get(dep) || planned(snapshot, task);
      if (!day || day > item.date) return { code: 'DEPENDENCY_ORDER', dependency: dep };
      pending.push({ taskId: dep, date: day });
    }
  }
  return null;
}
const daysBetween = (from, to) =>
  Array.from(
    { length: Math.round((Date.parse(to) - Date.parse(from)) / DAY) + 1 },
    (_, i) => new Date(Date.parse(from) + i * DAY).toISOString().slice(0, 10),
  );
function weekDays(snapshot, from, to, excludedIds = new Set()) {
  return daysBetween(from, to).map((day) => {
    const c = snapshot.capacityByDay?.[day];
    const row = {
      date: day,
      partial: !c || !!c.partial,
      warnings: [...(c?.warnings || [])],
    };
    for (const kind of ['work', 'personal']) {
      const capacityMinutes = Math.max(0, c?.[`${kind}Minutes`] || 0);
      const scheduledTasks = nativeTasks(snapshot).filter(
        (t) =>
          !t.isDone &&
          !archived(t, snapshot) &&
          !t.subTaskIds?.length &&
          planned(snapshot, t) === day &&
          scope(snapshot, t) === kind &&
          !excludedIds.has(t.id),
      );
      const plannedMinutes = scheduledTasks.reduce((sum, t) => sum + remaining(t), 0);
      if (scheduledTasks.some((t) => !(t.timeEstimate > 0))) {
        row.partial = true;
        row.warnings.push('missing_estimate');
      }
      row[kind] = {
        capacityMinutes,
        plannedMinutes,
        remainingMinutes: Math.max(0, capacityMinutes - plannedMinutes),
      };
    }
    return row;
  });
}
function proposal(state, snapshot, cards, from, to, selected) {
  const days = weekDays(snapshot, from, to),
    available = structuredClone(days),
    assignments = [],
    excluded = [];
  const all = new Map(nativeTasks(snapshot).map((t) => [t.id, t]));
  const candidates = cards.filter(
    (c) =>
      !c.isDone &&
      (!selected || selected.includes(c.taskId)) &&
      !all.get(c.taskId)?.subTaskIds?.length &&
      (!c.dueDay || c.dueDay < from || c.dueDay > to),
  );
  const pending = new Map(candidates.map((c) => [c.taskId, c])),
    visited = new Set(),
    ordered = [];
  const visit = (c) => {
    if (visited.has(c.taskId)) return;
    visited.add(c.taskId);
    for (const dep of c.dependsOn) if (pending.has(dep)) visit(pending.get(dep));
    ordered.push(c);
  };
  candidates.forEach(visit);
  for (const c of ordered) {
    const task = all.get(c.taskId),
      meta = state.tasks[c.taskId] || {};
    if (meta.blockReason || meta.column === 'blocked') {
      excluded.push({ taskId: c.taskId, code: 'blocked' });
      continue;
    }
    if (!(task.timeEstimate > 0)) {
      excluded.push({ taskId: c.taskId, code: 'missing_estimate' });
      continue;
    }
    let earliest = from,
      blocked = false;
    for (const dep of c.dependsOn) {
      const dependency = all.get(dep);
      if (!dependency || archived(dependency, snapshot)) {
        blocked = true;
        break;
      }
      if (dependency.isDone) continue;
      const assigned =
        assignments.find((a) => a.taskId === dep)?.date || planned(snapshot, dependency);
      if (
        !assigned ||
        assigned > to ||
        blockers(state, snapshot, dep).some((b) => b.reason !== 'incomplete')
      ) {
        blocked = true;
        break;
      }
      if (assigned > earliest) earliest = assigned;
    }
    if (
      dependencyIssue(
        state,
        snapshot,
        c.taskId,
        new Map(assignments.map((a) => [a.taskId, a.date])),
        to,
        all,
      )
    )
      blocked = true;
    if (blocked) {
      excluded.push({ taskId: c.taskId, code: 'blocked' });
      continue;
    }
    const kind = scope(snapshot, task),
      slot = available.find(
        (d) => d.date >= earliest && d[kind].remainingMinutes >= remaining(task),
      );
    if (!slot) {
      excluded.push({ taskId: c.taskId, code: 'capacity' });
      continue;
    }
    slot[kind].remainingMinutes -= remaining(task);
    assignments.push({ taskId: c.taskId, date: slot.date });
  }
  return {
    days,
    proposal: { assignments, partial: days.some((d) => d.partial), excluded },
  };
}
export function workflowView(input, snapshot, options = {}) {
  const state = validateWorkflow(input),
    view = options.view || 'board';
  if (
    !['board', 'week', 'review', 'templates'].includes(view) ||
    (options.projectId !== undefined && !id(options.projectId)) ||
    (options.includeSubtasks !== undefined &&
      typeof options.includeSubtasks !== 'boolean') ||
    (options.limit !== undefined &&
      (!Number.isInteger(options.limit) || options.limit < 1 || options.limit > 1000)) ||
    (options.taskIds !== undefined &&
      (!Array.isArray(options.taskIds) ||
        options.taskIds.length > 500 ||
        !options.taskIds.every(id))) ||
    (options.date !== undefined && !date(options.date)) ||
    (options.from !== undefined && !date(options.from)) ||
    (options.to !== undefined && !date(options.to))
  )
    fail('INVALID_QUERY', 'Invalid workflow query.');
  const all = cardsFor(state, snapshot),
    today = options.date || snapshot.today;
  const board = boardFor(state, options.projectId);
  const scoped = all.filter(
    (c) => !options.projectId || c.projectId === options.projectId,
  );
  const count = wipCount(scoped, snapshot);
  const issues = count > board.wipLimit ? [{ code: 'wip_exceeded' }] : [];
  for (const c of all) {
    if (c.blockers.length && !c.isDone)
      issues.push({ taskId: c.taskId, code: 'blocked' });
    if (!c.isDone && !c.timeEstimate)
      issues.push({ taskId: c.taskId, code: 'missing_estimate' });
    if (c.isDone && (c.criteria.some((x) => !x.isDone) || c.blockers.length))
      issues.push({
        taskId: c.taskId,
        code: c.criteria.some((x) => !x.isDone)
          ? 'criteria_mismatch'
          : 'dependency_mismatch',
      });
    if (
      !c.isDone &&
      ((c.dueDay && c.dueDay < today) || (c.deadlineDay && c.deadlineDay < today))
    )
      issues.push({ taskId: c.taskId, code: 'overdue' });
    if (
      !c.isDone &&
      c.reviewOn &&
      c.reviewOn <= today &&
      (!c.reviewedOn || c.reviewedOn < c.reviewOn)
    )
      issues.push({ taskId: c.taskId, code: 'review_due' });
    if (!c.isDone && c.dueDay && c.dueDay <= today)
      issues.push({ taskId: c.taskId, code: 'unfinished' });
  }
  const cards = all.filter(
    (c) =>
      (!options.projectId || c.projectId === options.projectId) &&
      (!options.taskIds || options.taskIds.includes(c.taskId)) &&
      ((options.includeSubtasks ?? view === 'week') || !c.parentId),
  );
  const visible = cards.slice(0, options.limit || 1000),
    visibleIds = new Set(cards.map((c) => c.taskId));
  const columns = options.projectId ? [...board.columns] : defaultColumns();
  if (options.projectId)
    for (const card of scoped) {
      if (!columns.some((c) => c.id === card.columnId))
        columns.push({ ...fallbackColumn(columns, card.column), fallback: true });
    }
  const result = {
    view,
    cards: visible,
    columns: columns.map((column) => ({
      ...column,
      taskCount: scoped.filter((c) =>
        options.projectId ? c.columnId === column.id : c.column === column.status,
      ).length,
      cards: visible.filter((c) =>
        options.projectId ? c.columnId === column.id : c.column === column.status,
      ),
    })),
    wip: { count, limit: board.wipLimit, overLimit: count > board.wipLimit },
    issues: issues.filter((i) => !i.taskId || visibleIds.has(i.taskId)),
    templates: Object.values(state.templates),
  };
  if (view === 'week') {
    const from = options.from || today,
      to =
        options.to ||
        (date(from)
          ? new Date(Date.parse(from) + 6 * DAY).toISOString().slice(0, 10)
          : null);
    if (
      !date(from) ||
      !date(to) ||
      from > to ||
      (Date.parse(to) - Date.parse(from)) / DAY > 30
    )
      fail('INVALID_QUERY', 'Week range must contain at most 31 civil days.');
    Object.assign(
      result,
      { from, to },
      proposal(state, snapshot, cards, from, to, options.taskIds),
    );
  }
  return structuredClone(result);
}
function checkWeek(state, snapshot, payload, nativeActions) {
  const { assignments, weekRevision, allowPartial } = payload;
  if (
    !text(weekRevision, 500) ||
    !Array.isArray(assignments) ||
    assignments.length < 1 ||
    assignments.length > 500 ||
    !assignments.every(
      (a) => keys(a, ['taskId', 'date']) && id(a.taskId) && date(a.date),
    ) ||
    !unique(assignments.map((a) => a.taskId)) ||
    (allowPartial !== undefined && typeof allowPartial !== 'boolean')
  )
    fail('INVALID_COMMAND', 'Invalid week assignments.');
  const dates = assignments.map((a) => a.date).sort(),
    from = dates[0],
    to = dates.at(-1);
  if ((Date.parse(to) - Date.parse(from)) / DAY > 30)
    fail('INVALID_COMMAND', 'Week assignments span more than 31 days.');
  const all = new Map(nativeTasks(snapshot).map((t) => [t.id, t])),
    assigned = new Map(assignments.map((a) => [a.taskId, a.date]));
  const days = weekDays(snapshot, from, to, new Set(assigned.keys()));
  for (const a of assignments) {
    const task = all.get(a.taskId),
      meta = state.tasks[a.taskId] || {};
    if (!task || archived(task, snapshot))
      fail('TASK_NOT_FOUND', 'Task is unavailable.', { taskId: a.taskId });
    if (task.isDone || task.subTaskIds?.length || !(task.timeEstimate > 0))
      fail(
        'TASK_NOT_SCHEDULABLE',
        'Only unfinished estimated leaf tasks can be scheduled.',
        { taskId: a.taskId },
      );
    if (meta.blockReason || meta.column === 'blocked')
      fail('TASK_BLOCKED', 'Unblock the task before scheduling.', { taskId: a.taskId });
    const dependency = dependencyIssue(state, snapshot, a.taskId, assigned, a.date, all);
    if (dependency)
      fail(dependency.code, 'Resolve and schedule prerequisites before dependent work.', {
        taskId: a.taskId,
        dependency: dependency.dependency,
      });
    const day = days.find((d) => d.date === a.date),
      kind = scope(snapshot, task);
    if (day.partial && !allowPartial)
      fail('PARTIAL_CAPACITY', 'Confirm partial capacity explicitly.', { date: a.date });
    if (day[kind].remainingMinutes < remaining(task))
      fail('CAPACITY_EXCEEDED', 'Assignments exceed available capacity.', {
        date: a.date,
        scope: kind,
      });
    day[kind].remainingMinutes -= remaining(task);
    nativeActions.push({
      type: 'task.update',
      taskId: a.taskId,
      fields: { dueDay: a.date },
    });
  }
}
function checkAutomaticParentCompletion(state, snapshot, task) {
  if (!snapshot.autoMarkParentDone || task.isDone) return;
  const predicted = new Map(nativeTasks(snapshot).map((t) => [t.id, t]));
  let completed = { ...task, isDone: true };
  predicted.set(completed.id, completed);
  const visited = new Set([completed.id]);
  while (completed.parentId && !visited.has(completed.parentId)) {
    const parent = predicted.get(completed.parentId);
    // The native effect stops at an already done parent. It completes only
    // when every sibling is done; this command itself is a real completion.
    if (
      !parent ||
      parent.isDone ||
      !parent.subTaskIds?.length ||
      !parent.subTaskIds.every((id) => predicted.get(id)?.isDone)
    )
      return;
    const unresolved = blockers(state, snapshot, parent.id, predicted);
    if (unresolved.length)
      fail(
        'TASK_BLOCKED',
        'Resolve the automatically completed parent prerequisites and blocks first.',
        { taskId: parent.id, blockers: unresolved },
      );
    if (state.tasks[parent.id]?.criteria?.some((criterion) => !criterion.isDone))
      fail(
        'CRITERIA_INCOMPLETE',
        'Complete the automatically completed parent criteria first.',
        { taskId: parent.id },
      );
    completed = { ...parent, isDone: true };
    predicted.set(completed.id, completed);
    visited.add(completed.id);
  }
}
export function applyWorkflowCommand(input, command, snapshot, options = {}) {
  const state = validateWorkflow(input),
    nativeActions = [];
  if (
    !id(options.operationId) ||
    !object(command) ||
    !text(command.type, 100) ||
    !object(command.payload)
  )
    fail('INVALID_COMMAND', 'A command payload and stable operation ID are required.');
  const p = command.payload,
    task = nativeTasks(snapshot).find((t) => t.id === p.taskId);
  const requireTask = () => {
    if (!id(p.taskId) || !task || archived(task, snapshot))
      fail('TASK_NOT_FOUND', 'Task is unavailable.', { taskId: p.taskId });
    return (state.tasks[p.taskId] ||= {});
  };
  const invalid = () =>
    fail('INVALID_COMMAND', 'Invalid command fields.', { type: command.type });
  const requireBoard = () => {
    if (!id(p.projectId)) invalid();
    if (
      !snapshot.projects?.some(
        (project) => project.id === p.projectId && !project.isArchived,
      )
    )
      fail('PROJECT_NOT_FOUND', 'Project is unavailable.');
    state.projectBoards ||= {};
    return (state.projectBoards[p.projectId] ||= structuredClone(
      boardFor(state, p.projectId),
    ));
  };
  let result;
  switch (command.type) {
    case 'task.move': {
      const m = requireTask();
      if (
        !keys(p, ['taskId', 'column', 'columnId']) ||
        !COLUMNS.includes(p.column) ||
        (p.columnId !== undefined && (!id(p.columnId) || !id(task.projectId)))
      )
        invalid();
      const board = boardFor(state, task.projectId);
      const destination =
        p.columnId === undefined
          ? fallbackColumn(board.columns, p.column)
          : board.columns.find((c) => c.id === p.columnId && c.status === p.column) ||
            (fallbackColumn(board.columns, p.column).id === p.columnId
              ? fallbackColumn(board.columns, p.column)
              : undefined);
      if (!destination) invalid();
      if (p.column === 'blocked' && !m.blockReason)
        fail(
          'INVALID_COMMAND',
          'Provide a reason with task.block before manually blocking work.',
        );
      if (
        ['ready', 'in_progress', 'done'].includes(p.column) &&
        blockers(state, snapshot, p.taskId).length
      )
        fail('TASK_BLOCKED', 'Resolve prerequisites and manual blocks first.', {
          blockers: blockers(state, snapshot, p.taskId),
        });
      if (p.column === 'done' && m.criteria?.some((c) => !c.isDone))
        fail('CRITERIA_INCOMPLETE', 'Complete all criteria first.');
      if (p.column === 'done') checkAutomaticParentCompletion(state, snapshot, task);
      const wip = wipCount(
        cardsFor(state, snapshot).filter((c) => c.projectId === (task.projectId || null)),
        snapshot,
        p.taskId,
      );
      if (p.column === 'in_progress' && wip >= board.wipLimit)
        fail('WIP_LIMIT', 'Finish or move active work before starting another task.', {
          limit: board.wipLimit,
        });
      if (task.isDone !== (p.column === 'done'))
        nativeActions.push({
          type: 'task.update',
          taskId: p.taskId,
          fields: { isDone: p.column === 'done' },
        });
      if (p.column === 'done') delete m.column;
      else m.column = p.column;
      if (p.columnId !== undefined) {
        m.columnId = destination.id;
        m.columnProjectId = task.projectId;
      } else {
        delete m.columnId;
        delete m.columnProjectId;
      }
      break;
    }
    case 'task.dependencies': {
      const m = requireTask();
      if (
        !keys(p, ['taskId', 'dependsOn']) ||
        !Array.isArray(p.dependsOn) ||
        p.dependsOn.length > 50 ||
        !p.dependsOn.every(id) ||
        !unique(p.dependsOn)
      )
        invalid();
      m.dependsOn = [...p.dependsOn];
      if (cyclic(state.tasks))
        fail('DEPENDENCY_CYCLE', 'Prerequisites cannot contain a cycle.');
      break;
    }
    case 'task.block': {
      const m = requireTask();
      if (
        !keys(p, ['taskId', 'reason', 'reviewOn']) ||
        !text(p.reason, 2000) ||
        (p.reviewOn !== undefined && !date(p.reviewOn))
      )
        invalid();
      m.blockReason = p.reason;
      m.column = 'blocked';
      if (p.reviewOn) m.reviewOn = p.reviewOn;
      else delete m.reviewOn;
      break;
    }
    case 'task.unblock': {
      const m = requireTask();
      if (!keys(p, ['taskId'])) invalid();
      delete m.blockReason;
      delete m.reviewOn;
      if (m.column === 'blocked') m.column = 'ready';
      break;
    }
    case 'task.criteria': {
      const m = requireTask();
      if (!keys(p, ['taskId', 'criteria']) || !criteriaValid(p.criteria)) invalid();
      m.criteria = structuredClone(p.criteria);
      break;
    }
    case 'task.priority': {
      const m = requireTask();
      if (!keys(p, ['taskId', 'priority']) || !PRIORITIES.includes(p.priority)) invalid();
      m.priority = p.priority;
      break;
    }
    case 'task.review': {
      const m = requireTask();
      if (!keys(p, ['taskId', 'date']) || !date(p.date)) invalid();
      m.reviewedOn = p.date;
      break;
    }
    case 'task.link': {
      const m = requireTask();
      const link = { provider: p.provider, externalId: p.externalId, url: p.url };
      if (!keys(p, ['taskId', 'provider', 'externalId', 'url']) || !linkValid(link))
        invalid();
      m.links = [
        ...(m.links || []).filter(
          (l) => l.provider !== link.provider || l.url !== link.url,
        ),
        link,
      ];
      if (m.links.length > 20) invalid();
      break;
    }
    case 'task.unlink': {
      const m = requireTask();
      if (
        !keys(p, ['taskId', 'provider', 'url']) ||
        !['jira', 'trello'].includes(p.provider) ||
        !text(p.url, 2048)
      )
        invalid();
      m.links = (m.links || []).filter(
        (l) => l.provider !== p.provider || l.url !== p.url,
      );
      break;
    }
    case 'board.column.save': {
      if (!keys(p, ['projectId', 'column']) || !columnValid(p.column)) invalid();
      const board = requireBoard();
      const index = board.columns.findIndex((c) => c.id === p.column.id);
      if (index >= 0) {
        if (
          board.columns[index].status !== p.column.status &&
          cardsFor(state, snapshot).some(
            (c) => c.projectId === p.projectId && c.columnId === p.column.id,
          )
        )
          fail(
            'COLUMN_OCCUPIED',
            'Move the column tasks before changing its semantic status.',
          );
        board.columns[index] = structuredClone(p.column);
      } else {
        if (board.columns.length >= 50) invalid();
        board.columns.push(structuredClone(p.column));
      }
      break;
    }
    case 'board.column.reorder': {
      if (
        !keys(p, ['projectId', 'columnIds']) ||
        !Array.isArray(p.columnIds) ||
        !p.columnIds.every(id) ||
        !unique(p.columnIds)
      )
        invalid();
      const board = requireBoard();
      if (
        p.columnIds.length !== board.columns.length ||
        p.columnIds.some((key) => !board.columns.some((c) => c.id === key))
      )
        invalid();
      board.columns = p.columnIds.map((key) => board.columns.find((c) => c.id === key));
      break;
    }
    case 'board.column.remove': {
      if (
        !keys(p, ['projectId', 'columnId', 'targetColumnId']) ||
        !id(p.columnId) ||
        (p.targetColumnId !== undefined && !id(p.targetColumnId))
      )
        invalid();
      const board = requireBoard();
      const column = board.columns.find((c) => c.id === p.columnId);
      if (!column || board.columns.length <= 1) invalid();
      const target = board.columns.find(
        (c) =>
          c.id === p.targetColumnId && c.id !== column.id && c.status === column.status,
      );
      if (p.targetColumnId !== undefined && !target) invalid();
      const occupied = cardsFor(state, snapshot).filter(
        (c) => c.projectId === p.projectId && c.columnId === column.id,
      );
      if (occupied.length && !target)
        fail('COLUMN_OCCUPIED', 'Choose a destination with the same semantic status.');
      for (const card of occupied) {
        const meta = (state.tasks[card.taskId] ||= {});
        meta.columnId = target.id;
        meta.columnProjectId = p.projectId;
      }
      // Preserve dormant metadata as well, so a restored task cannot jump stages.
      for (const meta of Object.values(state.tasks))
        if (meta.columnProjectId === p.projectId && meta.columnId === column.id) {
          if (target) meta.columnId = target.id;
          else {
            delete meta.columnId;
            delete meta.columnProjectId;
          }
        }
      board.columns = board.columns.filter((c) => c.id !== column.id);
      break;
    }
    case 'board.configure':
      if (
        !keys(p, ['wipLimit', 'projectId']) ||
        (p.projectId !== undefined && !id(p.projectId)) ||
        !Number.isInteger(p.wipLimit) ||
        p.wipLimit < 1 ||
        p.wipLimit > 20
      )
        invalid();
      else if (p.projectId !== undefined) requireBoard().wipLimit = p.wipLimit;
      else state.wipLimit = p.wipLimit;
      break;
    case 'template.save':
      if (!keys(p, ['template']) || !templateValid(p.template)) invalid();
      else state.templates[p.template.id] = structuredClone(p.template);
      break;
    case 'template.remove':
      if (!keys(p, ['templateId']) || !id(p.templateId)) invalid();
      else delete state.templates[p.templateId];
      break;
    case 'template.apply': {
      if (
        !keys(p, ['templateId', 'projectId', 'title']) ||
        !id(p.templateId) ||
        !id(p.projectId) ||
        (p.title !== undefined && !text(p.title))
      )
        invalid();
      const template = state.templates[p.templateId];
      if (!template) fail('TEMPLATE_NOT_FOUND', 'Template is unavailable.');
      if (!snapshot.projects?.some((v) => v.id === p.projectId && !v.isArchived))
        fail('PROJECT_NOT_FOUND', 'Project is unavailable.');
      const prefix = `wf-${operationKey(options.operationId)}`,
        parent = {
          id: `${prefix}-parent`,
          title: p.title || template.title,
          projectId: p.projectId,
        },
        children = template.steps.map((s, i) => ({ id: `${prefix}-${i + 1}`, ...s }));
      if (
        [parent, ...children].some((v) =>
          nativeTasks(snapshot).some((t) => t.id === v.id),
        )
      )
        fail(
          'TASK_ID_CONFLICT',
          'Operation task IDs already exist; inspect the operation receipt.',
        );
      state.tasks[parent.id] = {
        criteria: template.criteria.map((c) => ({ ...c, isDone: false })),
      };
      nativeActions.push({ type: 'template.create', parent, children });
      result = { parentId: parent.id, taskIds: children.map((c) => c.id) };
      break;
    }
    case 'week.apply':
      if (!keys(p, ['assignments', 'weekRevision', 'allowPartial'])) invalid();
      else checkWeek(state, snapshot, p, nativeActions);
      break;
    default:
      fail('UNKNOWN_COMMAND', 'Unsupported workflow command.', { type: command.type });
  }
  return { state: validateWorkflow(state), nativeActions, ...(result ? { result } : {}) };
}
