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
    document.addEventListener('planner-workflow-attention', (event) =>
      window.attention.push(event.detail.pending),
    );
    let revision = 0;
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
        title: 'Second',
        column: 'ready',
        criteria: [],
        dependsOn: [],
        blockers: [],
        priority: 'normal',
        timeEstimate: 60000,
      },
    ];
    window.bumpRevision = () => revision++;
    window.workflow = createWorkflow({
      current: () => ({
        date: '2026-10-22',
        profile: { weekStartsOn: 1 },
        data: { projects: [{ id: 'p', title: 'Project' }] },
      }),
      refresh: async () => {},
      reportError: (error) => window.errors.push(error),
      adapter: {
        selectTask: async (id) => {
          window.selectedNativeTask = id;
        },
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
            if (args.command.type === 'task.move')
              cards.find((c) => c.taskId === args.command.payload.taskId).column =
                args.command.payload.column;
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
            cards: args.includeSubtasks ? cards : cards.filter((card) => !card.parentId),
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
                  ...(window.integrationFixture || {}),
                }
              : {}),
          };
        },
      },
    });
    await window.workflow.initialize();
    await window.workflow.navigate({ mode: 'board', projectId: 'p' });
  });
  assert.equal(
    await page.locator('#workflow-content img').count(),
    0,
    'task text must be escaped',
  );
  assert.equal(
    await page.locator('[data-wf-card="a"] select[name="column"]').isVisible(),
    false,
    'movement stays in a per-card disclosure',
  );
  assert.equal(
    await page.locator('[data-wf-form="wip"]').isVisible(),
    false,
    'WIP configuration stays in disclosure',
  );
  assert.equal(
    await page.locator('[data-wf-column="inbox"] .workflow-count').textContent(),
    '1',
  );
  assert.match(await page.locator('[data-wf-card="a"]').textContent(), /Project/);
  const initialCommands = await page.evaluate(
    () => window.calls.filter((c) => c.action === 'workflow_command').length,
  );
  await page.locator('[data-wf="edit"][data-id="a"]').focus();
  await page.keyboard.press('Enter');
  assert.equal(await page.locator('#workflow-editor[role="region"]').isVisible(), true);
  await page.locator('[data-wf="open-native"]').click();
  assert.equal(
    await page.evaluate(() => window.selectedNativeTask),
    'a',
    'native detail receives the same authoritative task identity',
  );
  assert.equal(
    await page.evaluate(
      () => window.calls.filter((c) => c.action === 'workflow_command').length,
    ),
    initialCommands,
    'opening native detail does not write workflow state',
  );
  await page.locator('textarea[name="reason"]').fill('Retained after Escape');
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('#workflow-editor').isVisible(), false);
  assert.equal(
    await page
      .locator('[data-wf="edit"][data-id="a"]')
      .evaluate((el) => el === document.activeElement),
    true,
  );
  await page.evaluate(() => {
    window.bumpRevision();
    return window.workflow.refresh();
  });
  await page.locator('[data-wf="edit"][data-id="a"]').click();
  assert.equal(
    await page.locator('textarea[name="reason"]').inputValue(),
    'Retained after Escape',
  );
  await page.setViewportSize({ width: 360, height: 800 });
  assert.equal(
    await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    true,
    'mobile board scroll stays inside its labelled region',
  );
  assert.equal(await page.locator('#workflow-editor').isVisible(), true);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.locator('#workflow-editor [data-wf="discard-editor"]').click();
  assert.equal(
    await page.evaluate(
      () => window.calls.filter((c) => c.action === 'workflow_command').length,
    ),
    initialCommands,
    'opening, closing and discarding only change presentation',
  );
  await page.locator('[data-wf-card="a"] details > summary').click();
  await page.locator('[data-wf-card="a"] select[name="column"]').selectOption('ready');
  await page.locator('[data-wf-card="a"] [data-wf="move"]').click();
  await page.waitForFunction(() =>
    window.calls.some((c) => c.action === 'workflow_command'),
  );
  assert.equal(
    await page.evaluate(
      () => window.calls.find((c) => c.action === 'workflow_command').args.baseRevision,
    ),
    '1',
  );
  await page.locator('[data-wf="edit"][data-id="a"]').click();
  await page.locator('textarea[name="reason"]').fill('Keep my unsaved reason');
  await page.evaluate(() => window.bumpRevision());
  await page.evaluate(() => window.workflow.refresh());
  assert.equal(
    await page.locator('textarea[name="reason"]').inputValue(),
    'Keep my unsaved reason',
    'refresh must preserve dirty editor',
  );
  await page.locator('form[data-wf-form="block"] button').click();
  await page.waitForFunction(
    () => document.querySelector('#workflow').getAttribute('aria-busy') === 'false',
  );
  assert.equal(
    await page.evaluate(
      () =>
        window.calls.find((c) => c.args.command?.type === 'task.block').args.baseRevision,
    ),
    '2',
    'dirty form submits original revision',
  );
  await page.locator('[data-wf="edit"][data-id="a"]').click();
  await page.locator('input[name="dependsOn"][value="b"]').check();
  await page.locator('form[data-wf-form="dependencies"] button').click();
  await page.waitForFunction(
    () => document.querySelector('#workflow').getAttribute('aria-busy') === 'false',
  );
  assert.deepEqual(
    await page.evaluate(
      () =>
        window.calls.find((c) => c.args.command?.type === 'task.dependencies').args
          .command.payload.dependsOn,
    ),
    ['b'],
  );
  await page.locator('[data-wf="edit"][data-id="a"]').click();
  await page.locator('textarea[name="newCriteria"]').fill('<script>evil()</script>');
  await page.locator('form[data-wf-form="criteria"] button').click();
  await page.waitForFunction(
    () => document.querySelector('#workflow').getAttribute('aria-busy') === 'false',
  );
  assert.equal(
    await page.evaluate(
      () =>
        window.calls.find((c) => c.args.command?.type === 'task.criteria').args.command
          .payload.criteria[0].text,
    ),
    '<script>evil()</script>',
  );
  await page.evaluate(() => window.workflow.navigate({ mode: 'templates' }));
  await page.locator('[data-wf="new-template"]').click();
  await page
    .locator('form[data-wf-form="template"] input[name="title"]')
    .fill('Reusable');
  await page.locator('textarea[name="steps"]').fill('First | 10\nSecond | 20');
  await page.locator('form[data-wf-form="template"] button').click();
  await page.waitForFunction(
    () => document.querySelector('#workflow').getAttribute('aria-busy') === 'false',
  );
  assert.deepEqual(
    await page.evaluate(
      () =>
        window.calls.find((c) => c.args.command?.type === 'template.save').args.command
          .payload.template.steps,
    ),
    [
      { title: 'First', timeEstimate: 600000 },
      { title: 'Second', timeEstimate: 1200000 },
    ],
  );
  await page.locator('.workflow-template > details > summary').click();
  const applyTemplate = page.locator('[data-wf-form="apply-template"]');
  await applyTemplate.locator('[name="projectId"]').selectOption('p');
  await applyTemplate.locator('[name="confirm"]').check();
  await applyTemplate.locator('button').click();
  await page.waitForFunction(
    () => document.querySelector('#workflow').getAttribute('aria-busy') === 'false',
  );
  assert.equal(
    await page.evaluate(
      () => window.calls.filter((c) => c.args.command?.type === 'template.apply').length,
    ),
    1,
  );
  await page.evaluate(() => window.workflow.navigate({ mode: 'board' }));
  assert.equal(
    await page.locator('[data-wf-card="template-child"]').count(),
    0,
    'board starts with top-level cards',
  );
  assert.equal(
    await page.getByRole('checkbox', { name: 'Mostrar subtareas' }).count(),
    1,
    'board offers accessible subtask toggle',
  );
  await page.getByRole('checkbox', { name: 'Mostrar subtareas' }).check();
  await page.locator('[data-wf-card="template-child"] details > summary').click();
  await page
    .locator('[data-wf-card="template-child"] select[name="column"]')
    .selectOption('ready');
  await page.locator('[data-wf-card="template-child"] [data-wf="move"]').click();
  await page.waitForFunction(
    () => document.querySelector('#workflow').getAttribute('aria-busy') === 'false',
  );
  assert.equal(
    await page.evaluate(() =>
      window.calls.some(
        (c) =>
          c.args.command?.type === 'task.move' &&
          c.args.command.payload.taskId === 'template-child',
      ),
    ),
    true,
  );
  await page.locator('[data-wf="edit"][data-id="template-child"]').click();
  await page.locator('textarea[name="reason"]').fill('Child draft');
  await page.getByRole('checkbox', { name: 'Mostrar subtareas' }).uncheck();
  await page.evaluate(() => window.workflow.refresh());
  assert.equal(
    await page.locator('textarea[name="reason"]').inputValue(),
    'Child draft',
    'toggle and refresh preserve dirty child editor',
  );
  await page.locator('#workflow-editor [data-wf="discard-editor"]').click();
  await page.evaluate(() => window.workflow.navigate({ mode: 'week' }));
  assert.equal(
    await page
      .locator('[data-wf-form="prepare-week"] [name="taskIds"][value="template-parent"]')
      .count(),
    0,
    'template parent aggregate is not independently scheduled',
  );
  await page
    .locator('[data-wf-form="prepare-week"] [name="taskIds"][value="template-child"]')
    .check();
  await page.locator('[data-wf-form="prepare-week"] button').click();
  await page.waitForFunction(
    () => document.querySelector('#workflow').getAttribute('aria-busy') === 'false',
  );
  assert.equal(
    await page
      .locator('[data-wf-form="apply-week"]')
      .textContent()
      .then((text) => text.includes('Estimated child')),
    true,
    'estimated template child appears in proposal',
  );
  await page
    .locator('[data-wf-form="prepare-week"] [name="taskIds"][value="template-child"]')
    .uncheck();
  await page.locator('[data-wf-form="prepare-week"] [name="taskIds"][value="a"]').check();
  await page.locator('[data-wf-form="prepare-week"] button').click();
  await page.waitForFunction(
    () => document.querySelector('#workflow').getAttribute('aria-busy') === 'false',
  );
  assert.equal(
    await page.evaluate(
      () => window.calls.filter((c) => c.args.command?.type === 'week.apply').length,
    ),
    0,
    'proposal must not schedule',
  );
  await page.locator('[data-wf-form="apply-week"] [name="assignments"]').check();
  await page.locator('[data-wf-form="apply-week"] [name="confirm"]').check();
  await page.locator('[data-wf-form="apply-week"] button').click();
  await page.waitForFunction(
    () => document.querySelector('#workflow').getAttribute('aria-busy') === 'false',
  );
  assert.deepEqual(
    await page.evaluate(
      () =>
        window.calls.find((c) => c.args.command?.type === 'week.apply').args.command
          .payload,
    ),
    { assignments: [{ taskId: 'a', date: '2026-10-23' }], weekRevision: 'week' },
  );
  await page.evaluate(() => window.workflow.navigate({ mode: 'review' }));
  await page.locator('[data-wf="reviewed"]').click();
  await page.waitForFunction(
    () => document.querySelector('#workflow').getAttribute('aria-busy') === 'false',
  );
  assert.equal(
    await page.evaluate(
      () =>
        window.calls.find((c) => c.args.command?.type === 'task.review').args.command
          .payload.taskId,
    ),
    'b',
  );
  await page.evaluate(() => window.workflow.navigate({ mode: 'integrations' }));
  await page
    .locator('[data-wf-form="integration-link"] [name="issueId"]')
    .fill('ISSUE-1');
  await page.locator('[data-wf-form="integration-link"] button').click();
  await page.waitForFunction(
    () => document.querySelector('#workflow').getAttribute('aria-busy') === 'false',
  );
  await page.locator('[data-wf-filter="integration-task"]').selectOption('a');
  await page.locator('[data-wf-form="integration-sync"] [name="confirm"]').check();
  await page.locator('[data-wf-form="integration-sync"] button').click();
  await page.waitForFunction(
    () => document.querySelector('#workflow').getAttribute('aria-busy') === 'false',
  );
  assert.deepEqual(
    await page.evaluate(
      () =>
        window.calls.find((c) => c.args.command?.type === 'integration.sync').args.command
          .payload,
    ),
    { taskId: 'a', targetStatus: 'done', expectedRemoteStatus: 'open' },
  );
  await page.evaluate(async () => {
    window.integrationFixture = {
      provider: 'trello',
      boardId: 'board-original',
      listId: 'list-original',
      status: 'open',
      moveSupported: true,
      lists: [
        { id: 'list-original', name: 'Current <list>', supported: true },
        {
          id: 'target&"list',
          name: 'Next <img src=x onerror="window.injected=1">',
          supported: true,
        },
        { id: 'unsupported', name: 'Unavailable', supported: false },
      ],
    };
    await window.workflow.refresh();
  });
  const moveForm = page.locator('[data-wf-form="integration-move"]');
  assert.equal(await moveForm.count(), 1, 'Trello lists have a separate movement form');
  assert.match(await moveForm.textContent(), /Current <list>/);
  assert.equal(await moveForm.locator('img').count(), 0, 'remote list names are escaped');
  assert.equal(
    await moveForm.locator('[name="targetListId"]').inputValue(),
    '',
    'no implicit destination',
  );
  assert.equal(
    await moveForm.locator('option[value="list-original"]:enabled').count(),
    0,
  );
  assert.equal(await moveForm.locator('option[value="unsupported"]:enabled').count(), 0);
  const moveCount = () =>
    page.evaluate(
      () =>
        window.calls.filter((c) => c.args.command?.type === 'integration.move').length,
    );
  await moveForm.locator('button').click();
  assert.equal(await moveCount(), 0, 'no move without selection and confirmation');
  await moveForm.locator('[name="targetListId"]').selectOption('target&"list');
  await moveForm.locator('button').click();
  assert.equal(await moveCount(), 0, 'selection alone does not move');
  await moveForm.locator('[name="confirm"]').check();
  await page.evaluate(async () => {
    window.integrationFixture = {
      ...window.integrationFixture,
      boardId: 'board-new',
      listId: 'list-new',
    };
    await window.workflow.refresh();
  });
  await moveForm.locator('button').click();
  await page.waitForFunction(() =>
    window.calls.some((c) => c.args.command?.type === 'integration.move'),
  );
  await page.waitForFunction(
    () => document.querySelector('#workflow').getAttribute('aria-busy') === 'false',
  );
  assert.deepEqual(
    await page.evaluate(
      () =>
        window.calls.find((c) => c.args.command?.type === 'integration.move').args.command
          .payload,
    ),
    {
      taskId: 'a',
      targetListId: 'target&"list',
      expectedListId: 'list-original',
      expectedBoardId: 'board-original',
    },
    'movement uses the rendered integration snapshot',
  );
  for (const fixture of [{ moveSupported: false }, { status: 'closed' }, { lists: [] }]) {
    await page.evaluate(async (fixture) => {
      window.integrationFixture = {
        provider: 'trello',
        boardId: 'board',
        listId: 'list',
        status: 'open',
        moveSupported: true,
        lists: [{ id: 'target', name: 'Target', supported: true }],
        ...fixture,
      };
    }, fixture);
    await page.locator('[data-wf-filter="integration-task"]').selectOption('a');
    await page.waitForFunction(
      () => document.querySelector('#workflow').getAttribute('aria-busy') === 'false',
    );
    assert.equal(
      await moveForm.locator('button:enabled').count(),
      0,
      'unavailable movement cannot submit',
    );
    assert.match(await moveForm.textContent(), /no está disponible/);
  }
  await page.evaluate(async () => {
    window.integrationFixture = {};
    await window.workflow.refresh();
  });
  assert.equal(
    await moveForm.count(),
    0,
    'providers without Trello metadata do not expose list movement',
  );
  await page.evaluate(() => window.workflow.navigate({ mode: 'board' }));
  await page.locator('[data-wf="edit"][data-id="a"]').click();
  await page.locator('#workflow-editor [data-wf="close-editor"]').click();
  await page
    .locator('[data-wf-card="b"]')
    .dragTo(page.locator('[data-wf-column="in_progress"]'));
  await page.waitForFunction(() =>
    window.calls.some((c) => c.args.command?.payload.column === 'in_progress'),
  );
  await page.locator('#workflow-pending > details > summary').click();
  await page
    .locator('#workflow-pending input[name="operationId"]')
    .fill('review-operation-123');
  await page.evaluate(() => window.workflow.refresh());
  assert.equal(
    await page.locator('#workflow-pending input[name="operationId"]').inputValue(),
    'review-operation-123',
    'receipt draft survives hooks',
  );
  await page.evaluate(() => (window.failCommand = true));
  await page.locator('[data-wf-card="a"] details > summary').click();
  await page.locator('[data-wf-card="a"] select[name="column"]').selectOption('inbox');
  await page.locator('[data-wf-card="a"] [data-wf="move"]').click();
  await page.waitForFunction(() => window.errors.length > 0);
  const attempts = await page.evaluate(
    () => window.calls.filter((c) => c.action === 'workflow_command').length,
  );
  assert.equal(
    await page.evaluate(() => window.attention.at(-1)),
    1,
    'workspace receives attention for unresolved workflow operations',
  );
  await page.evaluate(() => window.workflow.refresh());
  assert.equal(
    await page.evaluate(
      () => window.calls.filter((c) => c.action === 'workflow_command').length,
    ),
    attempts,
    'uncertain mutation must not retry',
  );
  await page.locator('[data-wf="receipt"]').click();
  await page.waitForFunction(() => window.calls.some((c) => c.args.view === 'receipt'));
  await page.waitForFunction(
    () => document.querySelector('#workflow').getAttribute('aria-busy') === 'false',
  );
  assert.equal(
    await page.locator('[data-wf-form="acknowledge"] [name="confirm"]').count(),
    1,
    'queried uncertain receipt offers explicit manual acknowledgement',
  );
  await page.locator('[data-wf-form="acknowledge"] button').click();
  assert.equal(
    await page.evaluate(() => window.savedUi.pending.length),
    1,
    'unchecked acknowledgement leaves pending notice',
  );
  const uncertainId = await page.evaluate(() => window.savedUi.pending[0].operationId);
  await page.locator('[data-wf-form="acknowledge"] [name="confirm"]').check();
  await page.locator('[data-wf-form="acknowledge"] button').click();
  await page.waitForFunction(
    () => document.querySelector('#workflow').getAttribute('aria-busy') === 'false',
  );
  assert.equal(
    await page.evaluate(
      () => window.calls.filter((c) => c.action === 'workflow_command').length,
    ),
    attempts,
    'acknowledgement does not repeat any command',
  );
  assert.equal(await page.evaluate(() => window.savedUi.pending.length), 0);
  assert.equal(
    await page.evaluate(() => window.attention.at(-1)),
    0,
    'workspace attention clears only after explicit acknowledgement',
  );
  assert.equal(
    await page.evaluate(() => window.savedUi.closedNotices[0].receiptStatus),
    'pending',
    'manual closure does not claim confirmed result',
  );
  await page.evaluate(() => (window.failCommand = false));
  await page.locator('[data-wf-card="b"] details > summary').click();
  await page.locator('[data-wf-card="b"] select[name="column"]').selectOption('ready');
  await page.locator('[data-wf-card="b"] [data-wf="move"]').click();
  await page.waitForFunction(
    () => document.querySelector('#workflow').getAttribute('aria-busy') === 'false',
  );
  assert.equal(
    await page.evaluate(
      () => window.calls.filter((c) => c.action === 'workflow_command').length,
    ),
    attempts + 1,
    'unrelated command is usable after manual closure',
  );
  assert.equal(
    await page.evaluate(
      (id) =>
        window.calls.filter(
          (c) => c.action === 'workflow_command' && c.args.operationId === id,
        ).length,
      uncertainId,
    ),
    1,
    'uncertain operation remains unrepeated',
  );
  assert.equal(await page.evaluate(() => window.injected), undefined);
  console.log(
    'Workflow browser: escaped cards, keyboard/select and drag/drop moves, draft revision, dependencies, blocks, criteria, templates, explicit weekly dates, review, provider status and uncertain receipt passed.',
  );
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
