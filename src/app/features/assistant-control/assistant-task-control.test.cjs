const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
require('ts-node').register({ transpileOnly: true, preferTsExts: true });
const harness = () => {
  const calls = [];
  const tasks = {
    entities: {
      task: {
        id: 'task',
        title: 'Task',
        projectId: 'project',
        subTaskIds: [],
        tagIds: [],
        notes: 'secret',
        attachments: [
          { id: 'note', type: 'NOTE', path: 'private' },
          { id: 'link', type: 'LINK', path: 'https://example.com' },
        ],
        timeSpentOnDay: {},
        timeSpent: 0,
        isDone: false,
      },
    },
  };
  const projects = {
    entities: {
      project: {
        id: 'project',
        taskIds: ['task'],
        backlogTaskIds: [],
        isArchived: false,
        isEnableBacklog: true,
      },
    },
  };
  const tags = [{ id: 'tag', taskIds: ['task'] }];
  const tagState = { entities: Object.fromEntries(tags.map((t) => [t.id, t])) };
  const archive = [];
  const sections = { entities: {} };
  const archiveStore = { mutationVersion: 0, mutationPending: false };
  const actions = new Proxy({}, { get: (_, name) => (arg) => ({ type: name, ...arg }) });
  const taskService = new Proxy(
    {
      getArchivedTasks: async () => archive,
      createNewTaskWithDefaults: (a) => ({
        id: 'new',
        subTaskIds: [],
        ...a.additional,
        title: a.title,
      }),
    },
    {
      get: (target, name) =>
        target[name] ||
        ((...a) => {
          calls.push([name, ...a]);
        }),
    },
  );
  const mocks = {
    Store: {
      selectSignal: (selector) => () =>
        selector === 'projects'
          ? projects
          : selector === 'sections'
            ? sections
            : selector === 'tags'
              ? tagState
              : tasks,
      dispatch: (a) => calls.push(['dispatch', a]),
    },
    TaskService: taskService,
    DateService: { todayStr: () => '2026-10-26', getStartOfNextDayDiffMs: () => 0 },
    ProjectService: { list: () => Object.values(projects.entities) },
    TagService: { tags: () => tags },
    ArchiveStoreService: archiveStore,
    SectionService: {
      addTaskToSection: (...a) => calls.push(['addTaskToSection', ...a]),
      removeTaskFromSection: (...a) => calls.push(['removeTaskFromSection', ...a]),
    },
    TaskAttachmentService: {
      addAttachment: (...a) => calls.push(['addAttachment', ...a]),
      updateAttachment: (...a) => calls.push(['updateAttachment', ...a]),
      deleteAttachment: (...a) => calls.push(['deleteAttachment', ...a]),
    },
  };
  const source = fs.readFileSync(
    `${__dirname}/assistant-task-control.service.ts`,
    'utf8',
  );
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      experimentalDecorators: true,
    },
  }).outputText;
  const exports = {};
  const requireStub = (path) => {
    if (path === '@angular/core')
      return { Injectable: () => (x) => x, inject: (t) => mocks[t] };
    if (path === '@ngrx/store') return { Store: 'Store' };
    if (path.endsWith('assistant-task-control.contract'))
      return require('../../../../electron/shared-with-frontend/assistant-task-control.contract.ts');
    if (path.endsWith('assistant-control.model'))
      return {
        ControlError: class extends Error {
          constructor(code, msg) {
            super(msg);
            this.code = code;
          }
        },
      };
    if (path.endsWith('tag.reducer')) return { selectTagFeatureState: 'tags' };
    if (path.endsWith('task.selectors')) return { selectTaskFeatureState: 'tasks' };
    if (path.endsWith('project.selectors'))
      return { selectProjectFeatureState: 'projects' };
    if (path.endsWith('section.selectors'))
      return { selectSectionFeatureState: 'sections' };
    if (path.endsWith('task-shared.actions')) return { TaskSharedActions: actions };
    if (path.endsWith('planner.actions')) return { PlannerActions: actions };
    if (path.endsWith('.actions')) return actions;
    if (path.endsWith('work-context.model'))
      return { WorkContextType: { PROJECT: 'PROJECT', TAG: 'TAG' } };
    if (path.endsWith('tag.const'))
      return { SYSTEM_TAG_IDS: new Set(['TODAY']), TODAY_TAG: { id: 'TODAY' } };
    if (path.endsWith('is-wont-do-task'))
      return {
        isWontDoTask: (t) => t.isDone && t.wontDoOn != null && t.wontDoOn === t.doneOn,
        getWontDoChanges: (n) => ({ isDone: true, doneOn: n, wontDoOn: n }),
      };
    const names = [
      'TaskService',
      'DateService',
      'ProjectService',
      'TagService',
      'ArchiveStoreService',
      'SectionService',
      'TaskAttachmentService',
    ];
    for (const name of names)
      if (
        path.endsWith(
          name
            .replace(/Service$/, '')
            .replace(/[A-Z]/g, (c, i) => (i ? '-' : '') + c.toLowerCase()) + '.service',
        )
      )
        return { [name]: name };
    throw new Error('Missing mock: ' + path);
  };
  vm.runInNewContext(compiled, {
    exports,
    require: requireStub,
    crypto: require('node:crypto').webcrypto,
    TextEncoder,
    Date,
    console,
  });
  const service = new exports.AssistantTaskControlService();
  const context = {
    authorize: async () => {},
    markMutation: () => calls.push(['mutation']),
  };
  const read = async () =>
    service.run('task_manage', { command: 'read', taskId: 'task' }, context);
  const run = async (command, extra = {}, ctx = context, tool = 'task_manage') => {
    const r = await read();
    return service.run(
      tool,
      {
        command,
        taskId: 'task',
        expectedRevision: r.revision,
        operationId: 'operation-1',
        ...extra,
      },
      ctx,
    );
  };
  return {
    calls,
    tasks,
    projects,
    tags,
    tagState,
    sections,
    taskService,
    archive,
    archiveStore,
    context,
    read,
    run,
    service,
  };
};
test('metadata reads omit notes and attachments; revisions survive timer ticks', async () => {
  const h = harness();
  const before = await h.read();
  assert.equal(JSON.stringify(before).includes('secret'), false);
  assert.equal(JSON.stringify(before).includes('private'), false);
  h.tasks.entities.task = {
    ...h.tasks.entities.task,
    timeSpent: 1000,
    timeSpentOnDay: { '2026-10-26': 1000 },
    modified: 123,
  };
  assert.equal((await h.read()).revision, before.revision);
});
test('stale and revoked writes never mark a mutation', async () => {
  const h = harness();
  await assert.rejects(
    h.run(
      'complete',
      {},
      {
        ...h.context,
        authorize: async () => {
          h.tasks.entities.task = { ...h.tasks.entities.task, title: 'Changed' };
        },
      },
    ),
    { code: 'STALE_DATA' },
  );
  await assert.rejects(
    h.run(
      'complete',
      {},
      {
        ...h.context,
        authorize: async () => {
          throw new Error('denied');
        },
      },
    ),
    /denied/,
  );
  assert.equal(h.calls.length, 0);
});
test('title updates are literal and deadline uses its native action', async () => {
  const h = harness();
  await h.run('update', { fields: { title: '#tag @tomorrow' } });
  assert.equal(h.calls.find((c) => c[0] === 'dispatch')[1].isIgnoreShortSyntax, true);
  h.calls.length = 0;
  await h.run('deadline', { day: '2026-12-16', remindAt: null });
  assert.equal(h.calls.find((c) => c[0] === 'dispatch')[1].type, 'setDeadline');
  assert.equal(h.calls.find((c) => c[0] === 'dispatch')[1].deadlineDay, '2026-12-16');
});
test('attachments hide notes by default and store command metadata without executing', async () => {
  const h = harness();
  const result = await h.service.run(
    'task_attachment',
    { command: 'read', taskId: 'task' },
    h.context,
  );
  assert.equal(result.attachments.length, 1);
  await h.run(
    'add',
    { attachment: { type: 'COMMAND', path: 'echo stored' } },
    h.context,
    'task_attachment',
  );
  assert.equal(h.calls.find((c) => c[0] === 'addAttachment')[2].path, 'echo stored');
});
test('structure rejects nested parents and literal subtask uses explicit project context', async () => {
  const h = harness();
  await h.run('add_subtask', { title: '#literal' }, h.context, 'task_structure');
  const action = h.calls.find((c) => c[0] === 'dispatch')[1];
  assert.equal(action.type, 'addSubTask');
  assert.equal(action.isIgnoreShortSyntax, true);
  assert.equal(action.task.projectId, 'project');
  h.tasks.entities.task = { ...h.tasks.entities.task, parentId: 'other' };
  await assert.rejects(
    h.run('add_subtask', { title: 'Nested' }, h.context, 'task_structure'),
  );
});
test('delete requires explicit confirmation and includes actual children', async () => {
  const h = harness();
  await assert.rejects(h.run('delete', { confirm: false }));
  assert.equal(h.calls.length, 0);
  await h.run('delete', { confirm: true });
  assert.equal(h.calls.find((c) => c[0] === 'remove')[1].id, 'task');
});
test('metadata edits preserve native wont-do timestamps and reject aggregate estimates', async () => {
  const h = harness();
  Object.assign(h.tasks.entities.task, { isDone: true, doneOn: 5, wontDoOn: 5 });
  await h.run('update', { fields: { created: 1, doneOn: 10, priority: null } });
  const fields = h.calls.find((c) => c[0] === 'update')[2];
  assert.equal(fields.created, 1);
  assert.equal(fields.doneOn, 10);
  assert.equal(fields.wontDoOn, 10);
  assert.equal(fields.priority, null);
  h.tasks.entities.child = {
    ...h.tasks.entities.task,
    id: 'child',
    parentId: 'task',
    subTaskIds: [],
  };
  h.tasks.entities.task.subTaskIds = ['child'];
  h.calls.length = 0;
  await assert.rejects(
    h.run('update', { fields: { timeEstimate: 1 } }),
    /Parent estimates/,
  );
  assert.equal(h.calls.length, 0);
});
test('complete, reopen and wont-do delegate to native lifecycle', async () => {
  const h = harness();
  await h.run('complete');
  await h.run('reopen');
  await h.run('wont_do');
  assert.ok(h.calls.some((c) => c[0] === 'setDone'));
  assert.ok(h.calls.some((c) => c[0] === 'setUnDone'));
  const changes = h.calls.find((c) => c[0] === 'update')[2];
  assert.equal(changes.isDone, true);
  assert.equal(changes.doneOn, changes.wontDoOn);
});
test('timed schedules retain reminder offset and null clears; day uses planner and unschedule native action', async () => {
  const h = harness();
  Object.assign(h.tasks.entities.task, { dueWithTime: 2000, remindAt: 1000 });
  await h.run('schedule', { at: 5000 });
  let action = h.calls.find((c) => c[0] === 'dispatch')[1];
  assert.equal(action.type, 'reScheduleTaskWithTime');
  assert.equal(action.remindAt, 4000);
  h.calls.length = 0;
  await h.run('schedule', { at: 5000, remindAt: null });
  assert.equal(h.calls.find((c) => c[0] === 'dispatch')[1].remindAt, undefined);
  h.calls.length = 0;
  await h.run('schedule', { day: '2026-12-16' });
  assert.equal(h.calls.find((c) => c[0] === 'dispatch')[1].type, 'planTaskForDay');
  h.calls.length = 0;
  await h.run('unschedule');
  assert.equal(h.calls.find((c) => c[0] === 'dispatch')[1].type, 'unscheduleTask');
});
test('deadline timestamp, preserved reminder validation and clear remain separate from schedule', async () => {
  const h = harness();
  Object.assign(h.tasks.entities.task, { deadlineRemindAt: 1500, dueWithTime: 9999 });
  await assert.rejects(h.run('deadline', { at: 1000 }), /Preserved reminder/);
  assert.equal(h.calls.length, 0);
  await h.run('deadline', { at: 5000, remindAt: 1000 });
  assert.equal(h.calls.find((c) => c[0] === 'dispatch')[1].deadlineWithTime, 5000);
  h.calls.length = 0;
  await h.run('clear_deadline');
  assert.equal(h.calls.find((c) => c[0] === 'dispatch')[1].type, 'removeDeadline');
});
test('project move includes children, tags reject system membership and duplicate copies literal notes', async () => {
  const h = harness();
  h.tasks.entities.child = {
    ...h.tasks.entities.task,
    id: 'child',
    title: '#literal child',
    parentId: 'task',
  };
  h.tasks.entities.task.subTaskIds = ['child'];
  h.projects.entities.other = { id: 'other', taskIds: [], backlogTaskIds: [] };
  await h.run('move_project', { projectId: 'other' });
  assert.equal(h.calls.find((c) => c[0] === 'moveToProject')[1].subTasks[0].id, 'child');
  h.calls.length = 0;
  await assert.rejects(h.run('set_tags', { tagIds: ['TODAY'] }));
  assert.equal(h.calls.length, 0);
  await h.run('set_tags', { tagIds: ['tag'] });
  assert.equal(h.calls.find((c) => c[0] === 'updateTags')[2][0], 'tag');
  h.calls.length = 0;
  const result = await h.run('duplicate');
  assert.equal(result.taskId, 'new');
  const actions = h.calls.filter((c) => c[0] === 'dispatch').map((c) => c[1]);
  assert.equal(actions.length, 2);
  assert.equal(actions[0].task.notes, 'secret');
  assert.equal(actions[0].isIgnoreShortSyntax, true);
  assert.equal(actions[1].task.title, '#literal child');
  assert.equal(actions[1].isIgnoreShortSyntax, true);
});
test('duplicate clears parent aggregate before native addSubTask inherits a zero first child', async () => {
  const h = harness();
  Object.assign(h.tasks.entities.task, {
    timeEstimate: 600000,
    subTaskIds: ['zero', 'estimated'],
  });
  h.tasks.entities.zero = {
    ...h.tasks.entities.task,
    id: 'zero',
    parentId: 'task',
    subTaskIds: [],
    timeEstimate: 0,
  };
  h.tasks.entities.estimated = {
    ...h.tasks.entities.task,
    id: 'estimated',
    parentId: 'task',
    subTaskIds: [],
    timeEstimate: 600000,
  };
  await h.run('duplicate');
  const actions = h.calls.filter((c) => c[0] === 'dispatch').map((c) => c[1]);
  assert.equal(
    actions[0].task.timeEstimate,
    0,
    'Native first-child inheritance must start with an empty parent estimate',
  );
  assert.equal(actions[1].task.timeEstimate, 0);
  assert.equal(actions[2].task.timeEstimate, 600000);
});
test('explicit backlog-to-regular placement does not schedule the task', async () => {
  const h = harness();
  h.projects.entities.project.taskIds = [];
  h.projects.entities.project.backlogTaskIds = ['task'];
  await h.run(
    'reorder',
    {
      contextId: 'project',
      contextType: 'PROJECT',
      source: 'BACKLOG',
      target: 'UNDONE',
      afterTaskId: null,
    },
    h.context,
    'task_structure',
  );
  const actions = h.calls.filter((c) => c[0] === 'dispatch');
  assert.equal(actions.length, 1);
  assert.equal(actions[0][1].type, 'moveProjectTaskToRegularList');
  assert.equal(h.tasks.entities.task.dueDay, undefined);
});
test('disabled backlog rejects before marking a mutation and is exposed in structure reads', async () => {
  const h = harness();
  h.projects.entities.project.isEnableBacklog = false;
  await assert.rejects(
    h.run(
      'reorder',
      {
        contextId: 'project',
        contextType: 'PROJECT',
        source: 'UNDONE',
        target: 'BACKLOG',
        afterTaskId: null,
      },
      h.context,
      'task_structure',
    ),
    /backlog is disabled/,
  );
  assert.equal(h.calls.length, 0);
  const view = await h.service.run(
    'task_structure',
    { command: 'read', taskId: 'task' },
    h.context,
  );
  assert.equal(view.contexts[0].isEnableBacklog, false);
});
test('reparent, sibling order and detach preserve native structure actions', async () => {
  const h = harness();
  h.tasks.entities.parent = { ...h.tasks.entities.task, id: 'parent', subTaskIds: [] };
  await h.run('reparent', { parentId: 'parent' }, h.context, 'task_structure');
  assert.equal(h.calls.find((c) => c[0] === 'dispatch')[1].type, 'convertToSubTask');
  h.tasks.entities.task.parentId = 'parent';
  h.tasks.entities.parent.subTaskIds = ['task'];
  h.calls.length = 0;
  await h.run('reorder', { afterTaskId: null }, h.context, 'task_structure');
  assert.equal(h.calls.find((c) => c[0] === 'dispatch')[1].type, 'moveSubTask');
  h.calls.length = 0;
  await h.run('detach', {}, h.context, 'task_structure');
  assert.equal(h.calls.find((c) => c[0] === 'dispatch')[1].type, 'convertToMainTask');
});
test('reparent rejects a destination parent in an archived project', async () => {
  const h = harness();
  h.projects.entities.archived = {
    id: 'archived',
    isArchived: true,
    taskIds: ['parent'],
    backlogTaskIds: [],
  };
  h.tasks.entities.parent = {
    ...h.tasks.entities.task,
    id: 'parent',
    projectId: 'archived',
    subTaskIds: [],
  };
  await assert.rejects(
    h.run('reparent', { parentId: 'parent' }, h.context, 'task_structure'),
    /archived/,
  );
  assert.equal(h.calls.length, 0);
});
test('native sections expose IDs, assign and remove through SectionService', async () => {
  const h = harness();
  h.sections.entities.section = {
    id: 'section',
    title: 'Section',
    contextId: 'project',
    contextType: 'PROJECT',
    taskIds: [],
  };
  const view = await h.service.run(
    'task_structure',
    { command: 'read', taskId: 'task' },
    h.context,
  );
  assert.equal(view.contexts[0].sections[0].id, 'section');
  await h.run(
    'set_section',
    { contextId: 'project', contextType: 'PROJECT', sectionId: 'section' },
    h.context,
    'task_structure',
  );
  assert.ok(h.calls.some((c) => c[0] === 'addTaskToSection'));
  h.sections.entities.section.taskIds = ['task'];
  h.calls.length = 0;
  await h.run(
    'set_section',
    { contextId: 'project', contextType: 'PROJECT', sectionId: null },
    h.context,
    'task_structure',
  );
  assert.ok(h.calls.some((c) => c[0] === 'removeTaskFromSection'));
});
test('ordinary tag order is explicit and tag backlog/sections are rejected', async () => {
  const h = harness();
  h.tasks.entities.task.tagIds = ['tag'];
  const args = {
    contextId: 'tag',
    contextType: 'TAG',
    source: 'UNDONE',
    target: 'UNDONE',
    afterTaskId: null,
  };
  await h.run('reorder', args, h.context, 'task_structure');
  assert.equal(h.calls.find((c) => c[0] === 'dispatch')[1].workContextType, 'TAG');
  h.calls.length = 0;
  await assert.rejects(
    h.run('reorder', { ...args, target: 'BACKLOG' }, h.context, 'task_structure'),
  );
  assert.equal(h.calls.length, 0);
  await assert.rejects(
    h.run(
      'set_section',
      { contextId: 'tag', contextType: 'TAG', sectionId: null },
      h.context,
      'task_structure',
    ),
  );
});
test('Today virtual membership supports native sections without persisted TODAY tags', async () => {
  const h = harness();
  h.tagState.entities.TODAY = { id: 'TODAY', taskIds: ['task'] };
  h.tasks.entities.task.dueDay = '2026-10-26';
  h.sections.entities.todaySection = {
    id: 'todaySection',
    title: 'Today section',
    contextId: 'TODAY',
    contextType: 'TAG',
    taskIds: [],
  };
  await h.run(
    'set_section',
    { contextId: 'TODAY', contextType: 'TAG', sectionId: 'todaySection' },
    h.context,
    'task_structure',
  );
  assert.ok(h.calls.some((c) => c[0] === 'addTaskToSection'));
  assert.equal(h.tasks.entities.task.tagIds.includes('TODAY'), false);
});
test('attachment update/removal validates existing ID and optional note reads', async () => {
  const h = harness();
  const result = await h.service.run(
    'task_attachment',
    { command: 'read', taskId: 'task', includeNotes: true },
    h.context,
  );
  assert.equal(result.attachments.length, 2);
  await h.run(
    'update',
    { attachmentId: 'link', attachment: { title: 'Renamed' } },
    h.context,
    'task_attachment',
  );
  assert.ok(h.calls.some((c) => c[0] === 'updateAttachment'));
  h.calls.length = 0;
  await h.run('remove', { attachmentId: 'note' }, h.context, 'task_attachment');
  assert.ok(h.calls.some((c) => c[0] === 'deleteAttachment'));
  h.calls.length = 0;
  await assert.rejects(
    h.run('remove', { attachmentId: 'missing' }, h.context, 'task_attachment'),
  );
  assert.equal(h.calls.length, 0);
});
test('archiving checks authorization both before write and before removal', async () => {
  const h = harness();
  h.taskService.moveToArchive = async (_, guards) => {
    await guards.beforeWrite();
    guards.atWrite();
    h.tasks.entities.task = { ...h.tasks.entities.task, title: 'Concurrent' };
    guards.beforeRemove();
  };
  await assert.rejects(h.run('archive'), { code: 'STALE_DATA' });
  assert.equal(h.calls.filter((c) => c[0] === 'mutation').length, 1);
});
test('archive restore preserves children and fences concurrent archive writes', async () => {
  const h = harness();
  const parent = h.tasks.entities.task;
  const child = { ...parent, id: 'child', parentId: 'task', subTaskIds: [] };
  parent.subTaskIds = ['child'];
  h.archive.push(parent, child);
  delete h.tasks.entities.task;
  const read = await h.service.run(
    'task_manage',
    { command: 'read', taskId: 'task', location: 'archive' },
    h.context,
  );
  assert.equal(JSON.stringify(read).includes('secret'), false);
  const args = {
    command: 'restore',
    taskId: 'task',
    expectedRevision: read.revision,
    operationId: 'restore-1',
  };
  await assert.rejects(
    h.service.run('task_manage', args, {
      ...h.context,
      authorize: async () => {
        h.archiveStore.mutationVersion++;
      },
    }),
    { code: 'STALE_DATA' },
  );
  assert.equal(h.calls.length, 0);
  await h.service.run('task_manage', args, h.context);
  const call = h.calls.find((c) => c[0] === 'restoreTask');
  assert.equal(call[2][0].id, 'child');
});
test('bounded active/archive listings paginate and archived projects stay hidden', async () => {
  const h = harness();
  h.tasks.entities.second = { ...h.tasks.entities.task, id: 'second' };
  let view = await h.service.run('task_manage', { command: 'read', limit: 1 }, h.context);
  assert.equal(view.nextOffset, 1);
  view = await h.service.run(
    'task_manage',
    { command: 'read', limit: 1, offset: 1 },
    h.context,
  );
  assert.equal(view.tasks[0].id, 'second');
  assert.equal(view.nextOffset, null);
  h.archive.push(h.tasks.entities.task, h.tasks.entities.second);
  view = await h.service.run(
    'task_manage',
    { command: 'read', location: 'archive', offset: 1, limit: 1 },
    h.context,
  );
  assert.equal(view.tasks[0].id, 'second');
  h.projects.entities.project.isArchived = true;
  view = await h.service.run('task_manage', { command: 'read' }, h.context);
  assert.equal(view.tasks.length, 0);
  await assert.rejects(h.read(), { code: 'TASK_NOT_FOUND' });
});
