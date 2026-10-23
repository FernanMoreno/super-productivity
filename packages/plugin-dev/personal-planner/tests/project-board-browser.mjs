import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { build } from 'esbuild';

// Isolated module harness: real controls, host contract fixtures, no native writes.
const root = new URL('../src/', import.meta.url);
const server = createServer(async (request, response) => {
  try {
    if (request.url === '/') {
      response.setHeader('Content-Type', 'text/html');
      response.end(
        `<style>:root{--bg:Canvas;--card-bg:Canvas;--text-color:CanvasText;--text-color-muted:GrayText;--c-primary:LinkText;--divider-color:GrayText;--s:4px;--s2:8px;--s3:12px;--s4:16px}body{margin:8px}${await readFile(new URL('workflow.css', root), 'utf8').catch(() => '')}</style><main id="workflow"><div id="workflow-controls"></div><div id="workflow-notice" role="status"></div><div id="workflow-pending"></div><div id="workflow-content"></div></main>`,
      );
    } else {
      response.setHeader('Content-Type', 'text/javascript');
      response.end(
        (
          await build({
            entryPoints: [new URL('workflow.mjs', root).pathname],
            bundle: true,
            format: 'esm',
            write: false,
          })
        ).outputFiles[0].text,
      );
    }
  } catch {
    response.statusCode = 404;
    response.end('missing');
  }
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.CHROME_BIN || undefined,
});
try {
  const page = await browser.newPage();
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  await page.evaluate(async () => {
    const { createWorkflow } = await import('/workflow.mjs');
    window.calls = [];
    window.failCommand = false;
    window.errors = [];
    window.savedUi = { pending: [] };
    window.attention = [];
    window.dirtyEvents = [];
    document.addEventListener('planner:dirty-state', (event) =>
      window.dirtyEvents.push(event.detail),
    );
    document.addEventListener('planner-workflow-attention', (event) =>
      window.attention.push(event.detail.pending),
    );
    let revision = 0;
    const projectBoards = {
      p: [
        { id: 'inbox', title: 'Capture', status: 'inbox' },
        { id: 'ready', title: 'Study', status: 'ready' },
        { id: 'practice', title: 'Practice', status: 'ready' },
        { id: 'done', title: 'Complete', status: 'done' },
      ],
      q: [
        { id: 'inbox', title: 'Research', status: 'inbox' },
        { id: 'ready', title: 'Write', status: 'ready' },
      ],
    };
    window.projectBoards = projectBoards;
    const cards = [
      {
        taskId: 'a',
        projectId: 'p',
        title: '<img src=x onerror="window.injected=1">',
        column: 'inbox',
        criteria: [],
        dependsOn: [],
        blockers: [],
        priority: 'normal',
        timeEstimate: 60000,
      },
      {
        taskId: 'b',
        projectId: 'q',
        title: 'Second',
        column: 'ready',
        criteria: [],
        dependsOn: [],
        blockers: [],
        priority: 'normal',
        timeEstimate: 60000,
      },
      {
        taskId: 'child',
        parentId: 'a',
        projectId: 'p',
        title: 'Hidden subtask',
        column: 'ready',
        columnId: 'practice',
        criteria: [],
        dependsOn: [],
        blockers: [],
      },
    ];
    window.bumpRevision = () => revision++;
    window.workflow = createWorkflow({
      current: () => ({
        date: '2026-10-22',
        profile: { weekStartsOn: 1 },
        data: {
          projects: [
            { id: 'p', title: 'Project' },
            { id: 'q', title: 'Other project' },
          ],
        },
      }),
      refresh: async () => {},
      reportError: (error) => window.errors.push(error),
      adapter: {
        loadWorkflowUiState: async () => ({
          raw: null,
          value: structuredClone(window.savedUi),
        }),
        saveWorkflowUiState: async (raw, value) => {
          if (window.failStorage) throw Error('Storage failed');
          window.savedUi = structuredClone(value);
          return JSON.stringify(value);
        },
        operation: async (action, args) => {
          window.calls.push({ action, args });
          if (action === 'workflow_command') {
            if (window.failCommand) throw Error('Connection lost');
            const { type, payload } = args.command;
            if (type === 'board.column.save') {
              const stages = projectBoards[payload.projectId];
              const found = stages.findIndex((c) => c.id === payload.column.id);
              if (found < 0) stages.push(payload.column);
              else stages[found] = payload.column;
            }
            if (type === 'board.column.reorder')
              projectBoards[payload.projectId] = payload.columnIds.map((id) =>
                projectBoards[payload.projectId].find((c) => c.id === id),
              );
            if (type === 'board.column.remove') {
              for (const task of cards.filter(
                (c) =>
                  c.projectId === payload.projectId &&
                  (c.columnId || c.column) === payload.columnId,
              ))
                task.columnId = payload.targetColumnId;
              projectBoards[payload.projectId] = projectBoards[payload.projectId].filter(
                (c) => c.id !== payload.columnId,
              );
            }
            if (type === 'task.move')
              Object.assign(
                cards.find((c) => c.taskId === payload.taskId),
                { column: payload.column, columnId: payload.columnId },
              );
            if (args.command.type === 'template.apply')
              cards.push(
                {
                  taskId: 'template-parent',
                  title: 'Created template',
                  column: 'inbox',
                  criteria: [],
                  dependsOn: [],
                  blockers: [],
                  priority: 'normal',
                  timeEstimate: 0,
                },
                {
                  taskId: 'template-child',
                  parentId: 'template-parent',
                  title: 'Estimated child',
                  column: 'inbox',
                  criteria: [],
                  dependsOn: [],
                  blockers: [],
                  priority: 'normal',
                  timeEstimate: 600000,
                },
              );
            revision++;
            return {
              status: 'applied',
              operationId: args.operationId,
              revision: String(revision),
              nativeRevision: 'native',
            };
          }
          if (args.view === 'receipt')
            return { status: 'pending', operationId: args.operationId };
          return {
            revision: String(revision),
            nativeRevision: 'native',
            weekRevision: 'week',
            cards: cards.filter(
              (c) =>
                (!args.projectId || c.projectId === args.projectId) &&
                (args.includeSubtasks || !c.parentId),
            ),
            ...(args.projectId
              ? {
                  columns: projectBoards[args.projectId].map((column) => ({
                    ...column,
                    taskCount: cards.filter(
                      (c) =>
                        c.projectId === args.projectId &&
                        (c.columnId || c.column) === column.id,
                    ).length,
                    cards: cards.filter(
                      (c) =>
                        c.projectId === args.projectId &&
                        (c.columnId || c.column) === column.id &&
                        (args.includeSubtasks || !c.parentId),
                    ),
                  })),
                }
              : {}),
            templates: [
              {
                id: 'tpl',
                title: 'Release',
                steps: [{ title: 'Check', timeEstimate: 60000 }],
                criteria: [],
              },
            ],
            issues: [{ taskId: 'b', code: 'missing_estimate' }],
            wip: { limit: 2, count: 0 },
            days: [],
            proposal: {
              assignments: [
                {
                  taskId: args.taskIds?.includes('template-child')
                    ? 'template-child'
                    : 'a',
                  date: '2026-10-23',
                },
              ],
            },
            providers: [{ id: 'jira', provider: 'jira', name: 'Jira' }],
            ...(args.taskId
              ? {
                  taskId: args.taskId,
                  linked: true,
                  status: 'open',
                  statuses: [{ id: 'done', name: 'Done', supported: true }],
                }
              : {}),
          };
        },
      },
    });
    await window.workflow.initialize();
  });
  assert.equal(
    await page.locator('[data-wf-card]').count(),
    0,
    'global entry is a project overview, never a mixed board',
  );
  assert.equal(await page.locator('[data-wf="open-project"][data-id="p"]').count(), 1);
  await page.locator('[data-wf="open-project"][data-id="p"]').click();
  await page.evaluate(() =>
    window.workflow.navigate({ mode: 'board', projectId: 'p', taskId: 'child' }),
  );
  assert.match(
    await page.locator('#workflow-editor').textContent(),
    /Hidden subtask/,
    'native subtask deep link opens editor even before subtask toggle',
  );
  await page.locator('#workflow-editor [data-wf="close-editor"]').click();
  await page.locator('[data-wf-filter="subtasks"]').uncheck();
  await page.waitForFunction(
    () => document.querySelector('#workflow').getAttribute('aria-busy') === 'false',
  );
  assert.equal(await page.locator('[data-wf="new-column"]').count(), 1);
  assert.match(await page.locator('#workflow-controls').textContent(), /Project/);
  assert.equal(await page.locator('[data-wf-card="child"]').count(), 0);
  await page.locator('[data-wf-column="practice"] .workflow-column-menu summary').click();
  await page.locator('[data-wf="remove-column"][data-id="practice"]').click();
  assert.equal(
    await page
      .locator('[data-wf-form="remove-column"] [name="targetColumnId"][required]')
      .count(),
    1,
    'hidden subtasks still require a compatible removal destination',
  );
  await page.locator('#workflow-editor [data-wf="discard-editor"]').click();
  await page.locator('[data-wf="new-column"]').click();
  await page.locator('[data-wf-form="column"] [name="title"]').fill('My own step');
  await page.locator('[data-wf-form="column"] button').click();
  await page.waitForFunction(() =>
    window.calls.some((c) => c.args.command?.type === 'board.column.save'),
  );
  assert.equal(
    await page.evaluate(
      () =>
        window.calls.find((c) => c.args.command?.type === 'board.column.save').args
          .command.payload.projectId,
    ),
    'p',
  );
  assert.equal(
    await page.evaluate(
      () =>
        window.calls.find((c) => c.args.command?.type === 'board.column.save').args
          .command.payload.column.status,
    ),
    'ready',
  );
  await page.waitForFunction(
    () => document.querySelector('#workflow').getAttribute('aria-busy') === 'false',
  );
  assert.equal(
    await page.locator('[data-wf-card="b"]').count(),
    0,
    'other project tasks never enter current board',
  );
  const customId = await page.evaluate(
    () =>
      window.calls.find((c) => c.args.command?.type === 'board.column.save').args.command
        .payload.column.id,
  );
  await page
    .locator(`[data-wf-column="${customId}"] .workflow-column-menu summary`)
    .click();
  await page.locator(`[data-wf="edit-column"][data-id="${customId}"]`).click();
  await page.locator('[data-wf-form="column"] [name="title"]').fill('Done');
  await page.locator('[data-wf-form="column"] button').click();
  await page.waitForFunction(
    () => document.querySelector('#workflow').getAttribute('aria-busy') === 'false',
  );
  await page.locator('[data-wf-card="a"] details > summary').click();
  await page.locator('[data-wf-card="a"] [name="column"]').selectOption(customId);
  await page.evaluate(() => window.workflow.refresh());
  assert.equal(
    await page.locator('[data-wf-card="a"] details').evaluate((node) => node.open),
    true,
    'background refresh keeps the move menu open',
  );
  assert.equal(
    await page.locator('[data-wf-card="a"] [name="column"]').inputValue(),
    customId,
    'background refresh retains the chosen destination',
  );
  await page.locator('[data-wf-card="a"] [data-wf="move"]').click();
  await page.waitForFunction(
    () => document.querySelector('#workflow').getAttribute('aria-busy') === 'false',
  );
  assert.deepEqual(
    await page.evaluate(
      () =>
        window.calls.find((c) => c.args.command?.type === 'task.move').args.command
          .payload,
    ),
    { taskId: 'a', column: 'ready', columnId: customId },
    'a title Done must never imply native completion',
  );
  await page
    .locator(`[data-wf-column="${customId}"] .workflow-column-menu summary`)
    .click();
  await page.locator(`[data-wf="column-left"][data-id="${customId}"]`).click();
  await page.waitForFunction(
    () => document.querySelector('#workflow').getAttribute('aria-busy') === 'false',
  );
  await page.setViewportSize({ width: 360, height: 800 });
  assert.equal(
    await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    true,
    'custom stage board scroll stays inside its labelled region',
  );
  await page.setViewportSize({ width: 1280, height: 900 });
  const pOrder = await page
    .locator('[data-wf-column]')
    .evaluateAll((nodes) => nodes.map((n) => n.dataset.wfColumn));
  assert.equal(pOrder.at(-2), customId);
  await page.locator('[data-wf-filter="project"]').selectOption('q');
  await page.waitForSelector('[data-wf-column="ready"][aria-label="Write"]');
  assert.equal(await page.locator('[data-wf-card="a"]').count(), 0);
  assert.equal(
    await page.locator(`[data-wf-column="${customId}"]`).count(),
    0,
    'project columns stay isolated',
  );
  await page.locator('[data-wf-filter="project"]').selectOption('p');
  await page.waitForSelector(`[data-wf-column="${customId}"]`);
  assert.deepEqual(
    await page
      .locator('[data-wf-column]')
      .evaluateAll((nodes) => nodes.map((n) => n.dataset.wfColumn)),
    pOrder,
    'project keeps configured order when reopened',
  );
  await page
    .locator(`[data-wf-column="${customId}"] .workflow-column-menu summary`)
    .click();
  await page.locator(`[data-wf="remove-column"][data-id="${customId}"]`).click();
  const destination = page.locator(
    '[data-wf-form="remove-column"] [name="targetColumnId"]',
  );
  assert.deepEqual(
    await destination.locator('option').evaluateAll((nodes) => nodes.map((n) => n.value)),
    ['', 'ready', 'practice'],
    'occupied stage offers only compatible semantic destinations',
  );
  const beforeRemove = await page.evaluate(
    () =>
      window.calls.filter((c) => c.args.command?.type === 'board.column.remove').length,
  );
  await page.locator('[data-wf-form="remove-column"] button').click();
  assert.equal(
    await page.evaluate(
      () =>
        window.calls.filter((c) => c.args.command?.type === 'board.column.remove').length,
    ),
    beforeRemove,
    'required destination blocks occupied stage removal',
  );
  await destination.selectOption('practice');
  await page.locator('[data-wf-form="remove-column"] button').click();
  await page.waitForFunction(
    () => document.querySelector('#workflow').getAttribute('aria-busy') === 'false',
  );
  assert.equal(await page.locator(`[data-wf-column="${customId}"]`).count(), 0);
  assert.equal(
    await page.locator('[data-wf-column="practice"] [data-wf-card="a"]').count(),
    1,
    'removed column retains native task identity in chosen stage',
  );
  await page.locator('[data-wf="edit"][data-id="a"]').click();
  await page.locator('[name="reason"]').fill('Keep draft in project');
  assert.equal(
    await page.evaluate(() =>
      window.workflow.canNavigate({ mode: 'board', projectId: 'q' }),
    ),
    false,
  );
  assert.deepEqual(await page.evaluate(() => window.dirtyEvents.at(-1)), {
    source: 'workflow',
    dirty: true,
  });
  await page.evaluate(() =>
    document.dispatchEvent(
      new CustomEvent('planner:workflow-context', {
        detail: { mode: 'board', projectId: 'q' },
      }),
    ),
  );
  await page.waitForFunction(
    () => document.querySelector('#workflow').getAttribute('aria-busy') === 'false',
  );
  assert.equal(
    await page.locator('[name="reason"]').inputValue(),
    'Keep draft in project',
  );
  assert.equal(
    await page.locator('[data-wf-filter="project"]').inputValue(),
    'p',
    'dirty draft blocks incompatible host context',
  );
  await page.evaluate(() => window.workflow.discardDraft());
  assert.equal(
    await page.evaluate(() =>
      window.workflow.canNavigate({ mode: 'board', projectId: 'q' }),
    ),
    true,
  );
  assert.deepEqual(await page.evaluate(() => window.dirtyEvents.at(-1)), {
    source: 'workflow',
    dirty: false,
  });
  await page.evaluate(() => {
    window.workspaceRequests = [];
    document.body.classList.add('workspace-embedded');
    document.addEventListener('planner:workspace-request', (event) => {
      window.workspaceRequests.push(event.detail);
      event.preventDefault();
    });
  });
  await page.locator('[data-wf-filter="project"]').selectOption('q');
  await page.waitForFunction(
    () => document.querySelector('#workflow').getAttribute('aria-busy') === 'false',
  );
  assert.deepEqual(await page.evaluate(() => window.workspaceRequests.at(-1)), {
    section: 'workflow',
    projectId: 'q',
  });
  assert.equal(
    await page.locator('[data-wf-filter="project"]').inputValue(),
    'p',
    'embedded project switch waits for native route rather than contradicting its context',
  );
  assert.equal(await page.evaluate(() => window.injected), undefined);
  console.log(
    'Project board browser: isolated project boards, custom stage add/rename/reorder, explicit semantics, compatible occupied removal and dirty context guard passed.',
  );
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
