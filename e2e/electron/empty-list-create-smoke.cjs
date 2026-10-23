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
      (scopes) => window.ea.setAssistantAccessScopes(scopes),
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
    const project = await call('project_manage', {
      command: 'create',
      operationId: randomUUID(),
      fields: { title: 'Empty list regression' },
    });
    const other = await call('project_manage', {
      command: 'create',
      operationId: randomUUID(),
      fields: { title: 'Overdue fixture' },
    });
    const overdue = await call('planner_task', {
      operationId: randomUUID(),
      fields: {
        title: 'Unrelated overdue fixture',
        projectId: other.id,
        dueDay: '2020-01-01',
      },
    });
    await page.evaluate((id) => (location.hash = `/project/${id}/tasks`), project.id);
    const empty = page.locator('work-view-page .no-tasks-illu-wrapper');
    await expect(empty.locator('.no-tasks-label')).toBeVisible();
    const add = empty.getByRole('button', { name: /Add task|Añadir tarea/i });
    await expect(add).toBeVisible();
    for (const width of [1200, 390]) {
      await page.setViewportSize({ width, height: 800 });
      const label = await empty.locator('h2').boundingBox(),
        button = await add.boundingBox();
      assert(
        button.y >= label.y + label.height && button.y - label.y - label.height < 40,
        'create action stays beside the empty message',
      );
      assert(
        button.x >= 0 && button.x + button.width <= width,
        'create action fits the viewport',
      );
    }
    await page.screenshot({ path: '/tmp/sp-empty-list-fixed.png' });
    await add.click();
    const input = page.locator('add-task-bar .main-input');
    await expect(input).toBeVisible();
    await input.fill('Created from empty list');
    await input.press('Enter');
    await expect
      .poll(async () => {
        const tasks = await call('list_tasks', { includeDone: true, limit: 100 });
        return tasks.tasks.find((t) => t.title === 'Created from empty list')?.projectId;
      })
      .toBe(project.id);
    await input.press('Escape');
    await expect(input).toBeHidden();
    const dayString = (date) =>
      [
        date.getFullYear(),
        String(date.getMonth() + 1).padStart(2, '0'),
        String(date.getDate()).padStart(2, '0'),
      ].join('-');
    const nextDate = new Date();
    nextDate.setDate(nextDate.getDate() + 2);
    const todayTask = await call('planner_task', {
      operationId: randomUUID(),
      fields: {
        title: 'Today fixture',
        projectId: other.id,
        dueDay: dayString(new Date()),
      },
    });
    const futureTask = await call('planner_task', {
      operationId: randomUUID(),
      fields: {
        title: 'Future fixture',
        projectId: other.id,
        dueDay: dayString(nextDate),
      },
    });
    const undatedTask = await call('planner_task', {
      operationId: randomUUID(),
      fields: { title: 'Unscheduled fixture', projectId: other.id },
    });
    await page.evaluate((id) => (location.hash = `/project/${id}/tasks`), other.id);
    for (const [kind, id] of [
      ['today', todayTask.taskId],
      ['scheduled', futureTask.taskId],
      ['unscheduled', undatedTask.taskId],
    ]) {
      await expect(
        page.locator(`work-view-page [data-date-group="${kind}"] task[id="t-${id}"]`),
      ).toHaveCount(1);
      await expect(page.locator(`work-view-page task[id="t-${id}"]`)).toHaveCount(1);
    }
    const overduePanel = page.locator('work-view-page .overdue-tasks');
    await expect(overduePanel).toBeVisible();
    await expect(overduePanel).toContainText(
      /(?:From previous days|De días anteriores).*\(1\)/i,
    );
    const toggle = overduePanel.locator('collapsible').first();
    if (
      (await toggle.locator('.collapsible-header').getAttribute('aria-expanded')) ===
      'false'
    ) {
      await toggle.locator('.collapsible-header').first().click();
    }
    await expect(overduePanel.locator('task')).toHaveCount(1);
    await expect(
      page.locator(`work-view-page task[id="t-${overdue.taskId}"]`),
    ).toHaveCount(1);
    await page.screenshot({ path: '/tmp/sp-project-overdue-fixed.png' });
    await call('planner_task', {
      operationId: randomUUID(),
      taskId: overdue.taskId,
      fields: { isDone: true },
    });
    await expect(overduePanel).toBeHidden();
    await page.evaluate((id) => (location.hash = `/project/${id}/tasks`), project.id);
    await expect(page.locator('work-view-page .overdue-tasks')).toBeHidden();
    console.log(
      'PASS empty list creation and scoped project overdue section without duplicate rows; completion removes overdue task',
    );
  } finally {
    if (app) await app.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
