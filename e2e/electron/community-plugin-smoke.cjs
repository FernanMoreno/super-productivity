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
const { zipSync, strToU8 } = require('fflate');
const artifacts = {
  bulk: path.resolve('../.tmp/plugin-audit-bulk-report/bulk-release.zip'),
  reporter: path.resolve('../.tmp/plugin-audit-bulk-report/reporter-release.zip'),
  quest: path.resolve('packages/plugin-dev/quest-arc-compat/quest-arc-compat.zip'),
};
const errors = [];
async function install(file, name) {
  await page.evaluate(() => (location.hash = '/config'));
  await page.getByRole('tab').nth(4).click();
  const upload = page.locator('input[type=file][accept=".zip"]');
  await upload.setInputFiles(file);
  await page.locator('dialog-confirm button[e2e=confirmBtn]').click();
  await expect(upload).toHaveValue('', { timeout: 60000 });
  const card = page
    .locator('plugin-management mat-card')
    .filter({ has: page.locator('mat-card-title', { hasText: name }) });
  await card.waitFor();
  if (!(await card.getByRole('switch').isChecked()))
    await card.getByRole('switch').click();
  await expect(card.locator('mat-error')).toHaveCount(0);
  console.log('INSTALLED ' + name);
}
async function open(id, selector) {
  await page.evaluate((id) => (location.hash = `/plugins/${id}/index`), id);
  const frame = page.frameLocator(`plugin-index iframe[data-plugin-id="${id}"]:visible`);
  await frame.locator(selector).waitFor({ timeout: 30000 });
  return frame;
}
async function fixtureReady() {
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
}
(async () => {
  try {
    await launch();
    page.on('requestfailed', (req) =>
      errors.push('REQUEST_FAILED ' + req.url() + ':' + req.failure()?.errorText),
    );
    page.on('console', (msg) => {
      if (msg.type() === 'error') errors.push(msg.text().slice(0, 400));
    });
    await fixtureReady();
    const probeZip = path.join(root, 'probe.zip');
    fs.writeFileSync(
      probeZip,
      zipSync({
        'manifest.json': strToU8(
          JSON.stringify({
            id: 'compat-probe',
            name: 'Compatibility Fixture Probe',
            version: '1.0.0',
            manifestVersion: 1,
            minSupVersion: '19.0.0',
            permissions: [
              'getTasks',
              'getAllProjects',
              'getAllTags',
              'updateTask',
              'addTask',
              'loadSyncedData',
              'persistDataSynced',
            ],
            hooks: [],
            iFrame: false,
          }),
        ),
        'plugin.js': strToU8(
          `window.__compatProbe=PluginAPI;const proto=Object.getPrototypeOf(PluginAPI), original=proto.registerIssueProvider;proto.registerIssueProvider=function(def){(window.__compatProviders||=[]).push(def);return original.call(this,def);};`,
        ),
      }),
    );
    await install(probeZip, 'Compatibility Fixture Probe');
    await page.waitForFunction(() => !!window.__compatProbe);
    const project = await call('project_manage', {
      command: 'create',
      operationId: randomUUID(),
      fields: { title: 'Compatibility Fixture' },
    });
    const tag = await call('tag_manage', {
      command: 'create',
      operationId: randomUUID(),
      fields: { title: 'fixturetag' },
    });
    await install(artifacts.bulk, 'Bulk Add Tasks');
    let frame = await open('bulk-add-tasks', '#tasks');
    await frame
      .locator('#tasks')
      .fill(
        '[Compatibility Fixture]\nFixture parent #fixturetag ((Parent note))\n  Fixture child ((Child note))',
      );
    await frame.locator('#previewBtn').click();
    await expect(frame.locator('#errors')).toBeEmpty();
    await expect(frame.locator('#importBtn')).toBeEnabled();
    await frame.locator('#importBtn').click();
    await expect(frame.locator('#success')).toContainText(/2/);
    let native = await page.evaluate(() => window.__compatProbe.getTasks());
    const parent = native.find((t) => t.title === 'Fixture parent'),
      child = native.find((t) => t.title === 'Fixture child');
    assert(parent && child, JSON.stringify(native));
    assert.equal(parent.projectId, project.id);
    assert.equal(child.projectId, project.id);
    assert.equal(child.parentId, parent.id);
    assert(parent.tagIds.includes(tag.id));
    assert.match(parent.notes, /Parent note/);
    assert.match(child.notes, /Child note/);
    await page.evaluate((id) => (location.hash = `/project/${id}/tasks`), project.id);
    await expect(page.locator(`work-view-page task[id="t-${parent.id}"]`)).toHaveCount(1);
    record(
      'Bulk upstream ZIP: preview, projects, parent/child, inherited context, tags, notes and reorganized native list',
    );
    const today = new Date().toLocaleDateString('en-CA');
    const reported = await call('planner_task', {
      operationId: randomUUID(),
      fields: { title: 'Reported fixture', projectId: project.id },
    });
    await call('task_time', {
      command: 'add',
      operationId: randomUUID(),
      taskId: reported.taskId,
      date: today,
      duration: 600000,
    });
    await call('planner_task', {
      operationId: randomUUID(),
      taskId: reported.taskId,
      fields: { isDone: true },
    });
    await install(artifacts.reporter, 'Date Range Reporter');
    frame = await open('date-range-reporter', '#generateBtn');
    await frame.locator('#startDate').fill(today);
    await frame.locator('#endDate').fill(today);
    await frame.locator('#generateBtn').click();
    await expect(frame.locator('#modalReportContent')).toHaveValue(/Reported fixture/);
    await frame.locator('#reportNameInput').fill('Compatibility saved report');
    await frame.locator('#modalSaveBtn').click();
    await expect(frame.locator('#reportModal')).toBeHidden();
    await expect(frame.locator('body')).toContainText('Compatibility saved report');
    await page.evaluate(() => (location.hash = '/config'));
    await page.getByRole('tab').nth(4).waitFor();
    await expect(page.locator('plugin-index iframe:visible')).toHaveCount(0);
    frame = await open('date-range-reporter', '#generateBtn');
    await expect(frame.locator('body')).toContainText('Compatibility saved report');
    record(
      'Reporter upstream ZIP: native tracked/completed task, date report and saved report reload',
    );
    await install(artifacts.quest, 'QuestArc');
    frame = await open('quest-arc', 'body');
    const questMessage = async (type, payload) =>
      frame.locator('body').evaluate(
        (_, args) =>
          new Promise((resolve, reject) => {
            const messageId = 'compat-' + Math.random();
            const timer = setTimeout(() => {
              window.removeEventListener('message', handler);
              reject(Error('Quest message timeout'));
            }, 10000);
            const handler = (event) => {
              if (
                event.data?.type === 'PLUGIN_MESSAGE_RESPONSE' &&
                event.data.messageId === messageId
              ) {
                clearTimeout(timer);
                window.removeEventListener('message', handler);
                resolve(event.data.result);
              }
            };
            window.addEventListener('message', handler);
            window.parent.postMessage(
              {
                type: 'PLUGIN_MESSAGE',
                message: { type: args.type, payload: args.payload },
                messageId,
              },
              '*',
            );
          }),
        { type, payload },
      );
    await expect
      .poll(async () => (await questMessage('REQUEST_SYNC'))?.profile?.xp)
      .toBe(0);
    await expect(frame.locator('body')).toContainText(/Quest|Level|Hero|XP/i);
    const ordinary = await call('planner_task', {
      operationId: randomUUID(),
      fields: { title: 'Ordinary quest XP fixture', projectId: project.id },
    });
    await call('planner_task', {
      operationId: randomUUID(),
      taskId: ordinary.taskId,
      fields: { isDone: true },
    });
    await expect
      .poll(async () => (await questMessage('REQUEST_SYNC')).profile.xp)
      .toBe(10);
    await expect
      .poll(async () =>
        frame
          .locator('body')
          .evaluate(
            async () =>
              JSON.parse((await window.PluginAPI.loadSyncedData()) || '{}').profile?.xp,
          ),
      )
      .toBe(10);
    record(
      'Quest compat ZIP: iframe message bridge, native completion hook and ordinary XP10',
    );
    const questTemplate = await call('project_manage', {
      command: 'create',
      operationId: randomUUID(),
      fields: { title: '📜 Custom XP fixture' },
    });
    await call('planner_task', {
      operationId: randomUUID(),
      fields: { title: 'Custom XP step [XP:25]', projectId: questTemplate.id },
    });
    assert.equal(
      (await questMessage('START_QUEST', { storyId: questTemplate.id })).success,
      true,
    );
    const activeId = (await questMessage('REQUEST_SYNC')).activeStory.id;
    const compiled = (await page.evaluate(() => window.__compatProbe.getTasks())).find(
      (t) => t.projectId === activeId,
    );
    assert(compiled);
    assert(!compiled.title.includes('[XP:'));
    assert.equal(
      JSON.parse(compiled.notes.match(/```json\s*([\s\S]*?)\s*```/)[1]).reward.xp,
      25,
    );
    await call('planner_task', {
      operationId: randomUUID(),
      taskId: compiled.id,
      fields: { isDone: true },
    });
    await expect
      .poll(async () => (await questMessage('REQUEST_SYNC')).profile.xp)
      .toBe(35);
    await expect
      .poll(async () =>
        frame
          .locator('body')
          .evaluate(
            async () => JSON.parse(await window.PluginAPI.loadSyncedData()).profile.xp,
          ),
      )
      .toBe(35);
    record(
      'Quest custom XP: actual template compiler, native completion adds 25 XP to prior 10 and persists XP35',
    );
    // Same registered provider, exercising actual fetch against a disposable local REST fixture.
    let vaultContent = '# Compatibility vault\n- [ ] Vault checkbox\n',
      readStatus = 200,
      putCount = 0;
    const vaultServer = http.createServer(async (req, res) => {
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Headers', 'authorization,content-type,accept');
      res.setHeader('Access-Control-Allow-Methods', 'GET,PUT,POST,OPTIONS');
      res.setHeader('Content-Type', 'application/json');
      if (req.method === 'OPTIONS') {
        res.statusCode = 204;
        res.end();
        return;
      }
      if (req.headers.authorization !== 'Bearer fixture-only') {
        res.statusCode = 401;
        res.end(JSON.stringify({ error: 'Unauthorized' }));
        return;
      }
      const url = new URL(req.url, 'http://fixture');
      if (url.pathname === '/') {
        res.end('{}');
        return;
      }
      if (url.pathname === '/vault/' && req.method === 'GET') {
        res.end(JSON.stringify({ files: [{ name: 'Inbox.md', mtime: Date.now() }] }));
        return;
      }
      if (decodeURIComponent(url.pathname) === '/vault/Inbox.md') {
        if (req.method === 'GET') {
          res.statusCode = readStatus;
          res.end(
            JSON.stringify(
              readStatus === 200
                ? { content: vaultContent, mtime: Date.now() }
                : { error: 'Fixture read error' },
            ),
          );
          return;
        }
        if (req.method === 'PUT') {
          let body = '';
          for await (const chunk of req) body += chunk;
          vaultContent = JSON.parse(body).content;
          putCount++;
          res.end('{}');
          return;
        }
      }
      res.statusCode = 404;
      res.end('{}');
    });
    await new Promise((resolve) => vaultServer.listen(0, '127.0.0.1', resolve));
    try {
      await install(
        path.resolve(
          'packages/plugin-dev/obsidian-issue-provider-compat/obsidian-issue-provider-compat.zip',
        ),
        'Obsidian',
      );
      await page.waitForFunction(() => window.__compatProviders?.length > 0);
      const baseUrl = `http://127.0.0.1:${vaultServer.address().port}`;
      const config = {
        baseUrl,
        apiKey: 'fixture-only',
        issueType: 'tasks',
        defaultNote: 'Inbox.md',
        pollInterval: 0,
      };
      const invoke = (method, args) =>
        page.evaluate(
          async ({ method, args }) => {
            const def = window.__compatProviders.find(
              (p) => typeof p.getNewIssuesForBacklog === 'function',
            );
            return def[method](...args);
          },
          { method, args },
        );
      assert.equal(await invoke('testConnection', [config, {}]), true);
      const issues = await invoke('getNewIssuesForBacklog', [config, {}]);
      assert.equal(issues.length, 1);
      assert.match(issues[0].title, /Vault checkbox/);
      assert.match(vaultContent, /sp-id:/);
      const again = await invoke('getNewIssuesForBacklog', [config, {}]);
      assert.equal(again[0].id, issues[0].id);
      await invoke('createIssue', [
        'Appended fixture',
        { ...config, issueType: 'both' },
        {},
      ]);
      assert.match(vaultContent, /- \[ \] Appended fixture/);
      assert.match(vaultContent, /Vault checkbox/);
      const putsBefore = putCount,
        contentBefore = vaultContent;
      readStatus = 500;
      await assert.rejects(() =>
        invoke('createIssue', ['Must not overwrite', config, {}]),
      );
      assert.equal(putCount, putsBefore);
      assert.equal(vaultContent, contentBefore);
      readStatus = 200;
      record(
        'Obsidian compat ZIP: native registration, loopback REST, stable markers, checkbox append and HTTP500 no overwrite',
      );
    } finally {
      await new Promise((resolve) => vaultServer.close(resolve));
    }
    const beforeIds = (await page.evaluate(() => window.__compatProbe.getTasks()))
      .map((t) => t.id)
      .sort();
    await app.close();
    app = undefined;
    await launch();
    await fixtureReady();
    await page.waitForFunction(() => !!window.__compatProbe);
    assert.deepEqual(
      (await page.evaluate(() => window.__compatProbe.getTasks()))
        .map((t) => t.id)
        .sort(),
      beforeIds,
    );
    frame = await open('date-range-reporter', '#generateBtn');
    await expect(frame.locator('body')).toContainText('Compatibility saved report');
    await page.evaluate(() => (location.hash = '/config'));
    await page.getByRole('tab').nth(4).waitFor();
    await expect(page.locator('plugin-index iframe:visible')).toHaveCount(0);
    frame = await open('quest-arc', 'body');
    await expect
      .poll(async () => (await questMessage('REQUEST_SYNC'))?.profile?.xp)
      .toBe(35);
    record(
      'All uploaded plugins and native task IDs survive real Electron restart; saved report and XP persist',
    );
    fs.writeFileSync(
      '/tmp/sp-community-plugin-result.json',
      JSON.stringify({ profile, scenarios, errors }, null, 2),
    );
    console.log(JSON.stringify({ profile, scenarios, errors }));
  } finally {
    if (errors.length) console.log('PLUGIN_ERRORS', errors);
    if (app) await app.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
