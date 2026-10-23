// Actual packaged renderer/MCP/native persistence; fictitious isolated profile only.
const { _electron: electron, expect } = require('@playwright/test');
const assert = require('node:assert/strict'),
  fs = require('node:fs'),
  path = require('node:path'),
  http = require('node:http');
const { randomUUID } = require('node:crypto');
const {
  ASSISTANT_ACCESS_SCOPES,
} = require('../../electron/shared-with-frontend/assistant-access.model.js');
const root = fs.mkdtempSync('/tmp/sp-workflow-smoke-');
fs.chmodSync(root, 0o700);
const profile = path.join(root, 'profile'),
  xdg = path.join(root, 'xdg');
fs.mkdirSync(xdg);
let app,
  page,
  key,
  requestId = 0;
const scenarios = [];
const record = (name) => {
  scenarios.push(name);
  console.log('PASS ' + name);
};
const rpc = (method, params = {}) =>
  new Promise((resolve, reject) => {
    const body = JSON.stringify({ jsonrpc: '2.0', id: ++requestId, method, params });
    const req = http.request(
      'http://127.0.0.1:3876/mcp',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + key },
        timeout: 60000,
      },
      (res) => {
        let data = '';
        res.setEncoding('utf8');
        res.on('data', (s) => (data += s));
        res.on('end', () => {
          try {
            resolve(JSON.parse(data));
          } catch (e) {
            reject(e);
          }
        });
      },
    );
    req.on('error', reject);
    req.on('timeout', () => req.destroy(new Error('MCP timeout')));
    req.end(body);
  });
const call = async (name, args = {}) => {
  const r = await rpc('tools/call', { name, arguments: args });
  assert(!r.error, JSON.stringify(r.error));
  assert(!r.result?.isError, JSON.stringify(r.result));
  return r.result.structuredContent;
};
const query = (view = 'board', extra = {}) => call('workflow_query', { view, ...extra });
const command = async (type, payload, extra = {}) => {
  const q = await query();
  return call('workflow_command', {
    operationId: randomUUID(),
    baseRevision: q.revision,
    nativeRevision: q.nativeRevision,
    command: { type, payload },
    ...extra,
  });
};
const applied = async (type, payload, extra = {}) => {
  const r = await command(type, payload, extra);
  assert.equal(r.status, 'applied', JSON.stringify(r));
  return r;
};
async function launch() {
  app = await electron.launch({
    executablePath: process.argv[2],
    args: [
      `--user-data-dir=${profile}`,
      '--no-protocol-registration',
      '--no-sandbox',
      '--disable-gpu',
    ],
    env: {
      ...process.env,
      NODE_ENV: 'PROD',
      WSL_INTEROP: '/run/WSL/2_interop',
      XDG_CONFIG_HOME: xdg,
      XDG_CACHE_HOME: xdg,
      XDG_DATA_HOME: xdg,
    },
    timeout: 60000,
  });
  page = await app.firstWindow();
  page.on('pageerror', (error) => console.log('RENDERER_ERROR', error.message));
  page.setDefaultTimeout(30000);
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows().forEach((w) => {
      w.hide();
      w.show = () => {};
      w.showInactive = () => {};
      w.focus = () => {};
      w.restore = () => {};
    }),
  );
  await page.waitForFunction(() => !!window.ea?.getAssistantAccessState);
  await page.evaluate(() => {
    for (const k of [
      'SUP_ONBOARDING_PRESET_DONE',
      'SUP_ONBOARDING_HINTS_DONE',
      'SUP_IS_SHOW_TOUR',
      'SUP_EXAMPLE_TASKS_CREATED',
    ])
      localStorage.setItem(k, 'true');
  });
}
(async () => {
  try {
    await launch();
    await page.evaluate(() => window.ea.setAssistantAccessEnabled(true));
    key = (await page.evaluate(() => window.ea.rotateAssistantAccessCredential()))
      .credential;
    await page.evaluate(
      (s) => window.ea.setAssistantAccessScopes(s),
      ASSISTANT_ACCESS_SCOPES,
    );
    await expect
      .poll(
        async () => {
          try {
            return (await call('get_status')).isReady;
          } catch {
            return false;
          }
        },
        { timeout: 60000 },
      )
      .toBe(true);
    const publishedTools = (await rpc('tools/list')).result.tools;
    const workflowTool = publishedTools.find((tool) => tool.name === 'workflow_command');
    assert(workflowTool);
    assert(
      workflowTool.inputSchema.properties.command.oneOf.some(
        (branch) => branch.properties.type.const === 'integration.move',
      ),
      'installed MCP publishes Trello list movement',
    );
    record('new workflow tools discoverable on real Electron');
    const p = await call('project_manage', {
      command: 'create',
      operationId: randomUUID(),
      fields: { title: 'Workflow fixture' },
    });
    const ids = [];
    for (const title of ['First', 'Second', 'Third']) {
      const r = await call('planner_task', {
        operationId: randomUUID(),
        fields: { title, projectId: p.id, timeEstimate: 1800000 },
      });
      assert.equal(r.status, 'applied');
      ids.push(r.taskId);
    }
    await applied('task.dependencies', { taskId: ids[1], dependsOn: [ids[0]] });
    assert.equal(
      (await command('task.move', { taskId: ids[1], column: 'in_progress' })).code,
      'TASK_BLOCKED',
    );
    assert.equal(
      (await command('task.dependencies', { taskId: ids[0], dependsOn: [ids[1]] })).code,
      'DEPENDENCY_CYCLE',
    );
    await applied('task.move', { taskId: ids[0], column: 'done' });
    await applied('task.move', { taskId: ids[1], column: 'in_progress' });
    assert.equal((await call('task_timer', { command: 'status' })).currentTaskId, null);
    record(
      'native completion unlocks dependencies, cycles rejected, card movement never starts timer',
    );
    await applied('board.configure', { wipLimit: 1 });
    assert.equal(
      (await command('task.move', { taskId: ids[2], column: 'in_progress' })).code,
      'WIP_LIMIT',
    );
    await applied('task.block', {
      taskId: ids[2],
      reason: 'Fixture dependency',
      reviewOn: '2026-10-22',
    });
    const review = await query('review');
    assert(review.issues.some((i) => i.taskId === ids[2]));
    await applied('task.review', { taskId: ids[2], date: '2026-10-22' });
    await applied('task.unblock', { taskId: ids[2] });
    record('WIP, manual blockers and review persist through shared coordinator');
    await applied('template.save', {
      template: {
        id: 'fixture-template',
        title: 'Literal #template',
        steps: [
          { title: 'Literal @tomorrow', timeEstimate: 60000 },
          { title: 'Step two', timeEstimate: 120000 },
        ],
        criteria: [{ id: 'check', text: 'Review output', isDone: false }],
      },
    });
    const q = await query(),
      operationId = randomUUID(),
      args = {
        operationId,
        baseRevision: q.revision,
        nativeRevision: q.nativeRevision,
        command: {
          type: 'template.apply',
          payload: { templateId: 'fixture-template', projectId: p.id },
        },
      };
    const created = await call('workflow_command', args);
    assert.equal(created.status, 'applied', JSON.stringify(created));
    assert.equal(created.taskIds.length, 2);
    const parent = (await call('get_task', { id: created.parentId })).task;
    assert.equal(parent.title, 'Literal #template');
    assert.equal(parent.subTaskIds.length, 2);
    const child = (await call('get_task', { id: created.taskIds[0] })).task;
    assert.equal(child.title, 'Literal @tomorrow');
    assert.equal(child.parentId, parent.id);
    assert.equal((await call('workflow_command', args)).replayed, true);
    record('literal native template hierarchy and estimates created exactly once');
    const weekly = await query('week', { from: '2026-10-22', to: '2026-10-28' });
    assert(weekly.cards.some((t) => t.taskId === created.taskIds[0]));
    const assignment = weekly.proposal.assignments.find(
      (a) => a.taskId === created.taskIds[0],
    );
    assert(assignment, 'estimated native child proposed');
    await applied('week.apply', {
      assignments: [assignment],
      weekRevision: weekly.weekRevision,
      allowPartial: true,
    });
    assert.equal(
      (await call('get_task', { id: assignment.taskId })).task.dueDay,
      assignment.date,
    );
    record(
      'weekly native subtask proposal uses capacity and explicit partial confirmation',
    );
    const tasksSettings = await call('app_settings', {
      command: 'read',
      section: 'tasks',
    });
    await call('app_settings', {
      command: 'update',
      section: 'tasks',
      operationId: randomUUID(),
      changes: { isAutoMarkParentAsDone: true },
      expected: {
        isAutoMarkParentAsDone: tasksSettings.settings.tasks.isAutoMarkParentAsDone,
      },
    });
    await applied('task.move', { taskId: created.taskIds[0], column: 'done' });
    assert.equal(
      (await command('task.move', { taskId: created.taskIds[1], column: 'done' })).code,
      'CRITERIA_INCOMPLETE',
    );
    assert.equal((await call('get_task', { id: created.parentId })).task.isDone, false);
    await applied('task.criteria', {
      taskId: created.parentId,
      criteria: [{ id: 'check', text: 'Review output', isDone: true }],
    });
    await applied('task.move', { taskId: created.taskIds[1], column: 'done' });
    assert.equal((await call('get_task', { id: created.parentId })).task.isDone, true);
    record('native automatic parent completion honors template criteria');
    const old = await query();
    await applied('task.priority', { taskId: ids[2], priority: 'high' });
    const stale = await call('workflow_command', {
      operationId: randomUUID(),
      baseRevision: old.revision,
      nativeRevision: old.nativeRevision,
      command: { type: 'task.move', payload: { taskId: ids[2], column: 'ready' } },
    });
    assert.equal(stale.code, 'STALE_DATA');
    const integrations = await query('integrations');
    assert.equal(integrations.providers.length, 0);
    record('stale commands rejected and disconnected integrations remain truthful');
    await page.evaluate(() => {
      location.hash = '/config';
    });
    await page.getByRole('tab').nth(4).click();
    await page
      .locator('input[type="file"][accept=".zip"]')
      .setInputFiles(
        path.resolve('packages/plugin-dev/personal-planner/dist/personal-planner.zip'),
      );
    await page.locator('dialog-confirm button[e2e="confirmBtn"]').click();
    const pluginCard = page
      .locator('plugin-management mat-card')
      .filter({ hasText: 'Mi planificación' });
    await pluginCard.waitFor();
    if (!(await pluginCard.getByRole('switch').isChecked()))
      await pluginCard.getByRole('switch').click();
    await expect(pluginCard.getByRole('switch')).toBeChecked();
    // Verify installed assets after a fresh start, independently of hot-reload lifecycle.
    await app.close();
    app = null;
    await launch();
    await page.evaluate((projectId) => {
      location.hash = `/project/${projectId}/board`;
    }, p.id);
    const frame = page.frameLocator('plugin-index iframe'),
      card = frame.locator(`[data-wf-card="${ids[2]}"]`);
    await page.screenshot({ path: '/tmp/sp-application-before-board.png' });
    console.log(
      'WORKSPACE_DEBUG',
      await page
        .locator('body')
        .innerText()
        .then((text) => text.slice(0, 300)),
    );
    console.log(
      'FRAME_DEBUG',
      await frame
        .locator('body')
        .innerText()
        .then((text) => text.slice(0, 1000)),
    );
    await card.waitFor();
    assert.equal(await frame.locator('#workspace-sidebar').isVisible(), false);
    await card
      .locator('summary')
      .filter({ hasText: /Mover tarea|Move task/ })
      .click();
    await card.locator('select[name="column"]').selectOption('ready');
    await card.locator('[data-wf="move"]').click();
    await expect
      .poll(async () => (await query()).cards?.find((t) => t.taskId === ids[2])?.column)
      .toBe('ready');
    record('real installed plugin UI changes the same native workflow seen by MCP');
    const otherProject = await call('project_manage', {
      command: 'create',
      operationId: randomUUID(),
      fields: { title: 'Different workflow fixture' },
    });
    await applied('board.column.save', {
      projectId: p.id,
      column: { id: 'practice-stage', title: 'Practice fixture', status: 'ready' },
    });
    await applied('board.column.save', {
      projectId: otherProject.id,
      column: { id: 'practice-stage', title: 'Different steps', status: 'ready' },
    });
    await applied('board.configure', { projectId: p.id, wipLimit: 3 });
    await applied('board.configure', { projectId: otherProject.id, wipLimit: 1 });
    assert.equal(
      (await query('board', { projectId: p.id })).columns.find(
        (c) => c.id === 'practice-stage',
      ).title,
      'Practice fixture',
    );
    assert.equal(
      (await query('board', { projectId: otherProject.id })).columns.find(
        (c) => c.id === 'practice-stage',
      ).title,
      'Different steps',
    );
    assert.equal((await query('board', { projectId: p.id })).wip.limit, 3);
    assert.equal((await query('board', { projectId: otherProject.id })).wip.limit, 1);
    await frame.locator('[data-wf-column="practice-stage"]').waitFor();
    await frame.locator('[data-wf="new-column"]').click();
    const columnForm = frame.locator('[data-wf-form="column"]');
    await columnForm.locator('[name="title"]').fill('Created through native UI');
    await columnForm.locator('button').click();
    await expect
      .poll(
        async () =>
          !!(await query('board', { projectId: p.id })).columns.find(
            (c) => c.title === 'Created through native UI',
          ),
      )
      .toBe(true);
    await applied('task.move', {
      taskId: ids[2],
      column: 'ready',
      columnId: 'practice-stage',
    });
    assert.equal(
      (await query('board', { projectId: p.id })).cards.find((c) => c.taskId === ids[2])
        .columnId,
      'practice-stage',
    );
    record(
      'project boards, custom column UI and per-project limits use authoritative MCP state',
    );
    await page
      .locator('plugin-index iframe')
      .evaluate((el) => (el.dataset.workspaceFixture = 'retained'));
    for (const [route, section] of [
      ['/projects', 'workflow'],
      ['/calendar', 'week'],
      ['/review', 'review'],
      ['/review/issues', 'workflow'],
      ['/review/changes', 'history'],
      ['/goals', 'goals'],
      ['/templates', 'workflow'],
      ['/settings/planner', 'settings'],
      ['/settings/integrations', 'workflow'],
      ['/settings/diagnostics', 'diagnostics'],
    ]) {
      await page.evaluate((route) => (location.hash = route), route);
      await frame.locator(`#${section}`).waitFor();
      assert.equal(
        await page.locator('plugin-index iframe').getAttribute('data-workspace-fixture'),
        'retained',
        'workspace navigation preserves mounted iframe',
      );
    }
    await page.evaluate(() => (location.hash = '/goals'));
    const goalName = frame.locator('[data-form="new-area"] [name="name"]');
    await goalName.fill('Unsaved native workspace fixture');
    await page.evaluate(() => (location.hash = '/calendar'));
    await frame.locator('#week').waitFor();
    await page.evaluate(() => (location.hash = '/goals'));
    await frame.locator('#goals').waitFor();
    assert.equal(await goalName.inputValue(), 'Unsaved native workspace fixture');
    record(
      'all unified destinations retain the iframe and safe view changes preserve drafts',
    );
    await app.close();
    app = null;
    await launch();
    await expect
      .poll(
        async () => {
          try {
            return (await call('get_status')).isReady;
          } catch {
            return false;
          }
        },
        { timeout: 60000 },
      )
      .toBe(true);
    assert.equal((await call('workflow_command', args)).replayed, true);
    assert.equal((await query('receipt', { operationId })).status, 'applied');
    assert.equal(
      (await call('get_task', { id: created.parentId })).task.subTaskIds.length,
      2,
    );
    assert.equal(
      (await query('board', { projectId: p.id })).cards.find((c) => c.taskId === ids[2])
        .columnId,
      'practice-stage',
    );
    assert(
      (await query('board', { projectId: p.id })).columns.some(
        (c) => c.title === 'Created through native UI',
      ),
    );
    assert.equal(
      (await query('board', { projectId: otherProject.id })).columns.find(
        (c) => c.id === 'practice-stage',
      ).title,
      'Different steps',
    );
    record(
      'whole app restart preserves native hierarchy, metadata and durable replay receipt',
    );
    await page.evaluate(
      (s) => window.ea.setAssistantAccessScopes(s),
      ['planner:read', 'tasks:read', 'issues:read'],
    );
    assert.equal((await query('integrations')).providers.length, 0);
    const denied = await rpc('tools/call', { name: 'workflow_command', arguments: args });
    assert(denied.error || denied.result?.isError);
    record('read-only issue grants work and revoked writes cannot replay');
    fs.writeFileSync(
      '/tmp/sp-workflow-smoke-result.json',
      JSON.stringify(
        { passed: true, profile: 'isolated fictitious profile', scenarios },
        null,
        2,
      ),
    );
    console.log(JSON.stringify({ passed: true, scenarios: scenarios.length }));
  } finally {
    if (app) await app.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
