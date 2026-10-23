// Run against a locally packaged build; quit other users of MCP port 3876 first.
// Uses only fictitious entities and a fresh profile, without sync credentials.
const { _electron: electron, expect } = require('@playwright/test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { spawn } = require('node:child_process');
const { randomUUID } = require('node:crypto');
const {
  ASSISTANT_ACCESS_SCOPES,
} = require('../../electron/shared-with-frontend/assistant-access.model.js');
const root = fs.mkdtempSync('/tmp/sp-assistant-controls-');
fs.chmodSync(root, 0o700);
const profile = path.join(root, 'profile'),
  xdg = path.join(root, 'xdg');
fs.mkdirSync(xdg);
let app, page, key;
let requestId = 0;
const evidence = { profile: 'fresh isolated profile', scenarios: [] };
const record = (name) => {
  evidence.scenarios.push(name);
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
const call = async (name, args) => {
  const response = await rpc('tools/call', { name, arguments: args });
  assert(!response.error, JSON.stringify(response.error));
  assert(!response.result?.isError, JSON.stringify(response.result));
  return response.result.structuredContent;
};
const write = (name, args, operationId = randomUUID()) =>
  call(name, { ...args, operationId });
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
  page.setDefaultTimeout(20000);
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
async function stdioDiscovery() {
  const token = path.join(root, 'access.token');
  fs.writeFileSync(token, key, { mode: 0o600 });
  const child = spawn(process.execPath, ['tools/mcpb/server/index.js'], {
    env: { ...process.env, SP_ACCESS_KEY_FILE: token },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  let buffer = '';
  const replies = new Map();
  child.stdout.on('data', (chunk) => {
    buffer += chunk;
    let end;
    while ((end = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, end);
      buffer = buffer.slice(end + 1);
      if (line) {
        const r = JSON.parse(line);
        replies.set(r.id, r);
      }
    }
  });
  try {
    child.stdin.write(
      JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2025-11-25',
          capabilities: {},
          clientInfo: { name: 'control-smoke', version: '1' },
        },
      }) + '\n',
    );
    await expect.poll(() => replies.has(1)).toBe(true);
    child.stdin.write(
      JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} }) + '\n',
    );
    await expect.poll(() => replies.has(2)).toBe(true);
    assert(replies.get(2).result.tools.some((t) => t.name === 'idle_review'));
    record('configured stdio bridge discovers controls from real Electron');
  } finally {
    child.kill();
  }
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
            return (await call('get_status', {})).isReady;
          } catch {
            return false;
          }
        },
        { timeout: 60000 },
      )
      .toBe(true);
    const tools = (await rpc('tools/list')).result.tools;
    for (const name of [
      'task_timer',
      'task_time',
      'task_notes',
      'project_manage',
      'tag_manage',
      'idle_review',
      'app_settings',
      'app_sync',
      'app_update',
      'control_operation_status',
    ])
      assert(
        tools.some((t) => t.name === name),
        name,
      );
    record('all ten control tools discoverable');
    await stdioDiscovery();
    const project = await write('project_manage', {
      command: 'create',
      fields: { title: 'MCP fictitious project', color: '#123456' },
    });
    await write('project_manage', {
      command: 'update',
      id: project.id,
      fields: { title: 'MCP updated project' },
    });
    const tag = await write('tag_manage', {
      command: 'create',
      fields: { title: 'MCP fictitious tag' },
    });
    await write('tag_manage', {
      command: 'update',
      id: tag.id,
      fields: { title: 'MCP updated tag', color: '#345678' },
    });
    const task = await call('planner_task', {
      operationId: randomUUID(),
      fields: { title: 'MCP fictitious task', projectId: project.id, tagIds: [tag.id] },
    });
    assert.equal(task.status, 'applied');
    const taskId = task.taskId;
    await write('task_notes', {
      command: 'write',
      taskId,
      notes: 'Fictitious MCP note',
      expectedNotes: '',
    });
    assert.equal(
      (await call('task_notes', { command: 'read', taskId })).notes,
      'Fictitious MCP note',
    );
    record('native project, tag and task notes writes persist');
    await write('task_timer', { command: 'start', taskId });
    assert.equal((await call('task_timer', { command: 'status' })).currentTaskId, taskId);
    await write('task_timer', { command: 'pause', expectedCurrentTaskId: taskId });
    assert.equal((await call('task_timer', { command: 'status' })).currentTaskId, null);
    await write('task_timer', { command: 'start', taskId });
    await write('task_timer', { command: 'stop', expectedCurrentTaskId: taskId });
    record('native timer start, pause, resume and stop');
    const timeArgs = { command: 'add', taskId, date: '2026-10-20', duration: 300000 };
    const timeOp = randomUUID();
    await write('task_time', timeArgs, timeOp);
    await write('task_time', timeArgs, timeOp);
    const corrected = await write('task_time', {
      command: 'set',
      taskId,
      date: '2026-10-20',
      duration: 600000,
      expectedDuration: 300000,
    });
    assert.equal(corrected.duration, 600000);
    const receipt = await call('control_operation_status', {
      command: 'status',
      operationId: timeOp,
    });
    assert.equal(receipt.duration, 300000);
    assert(!Object.hasOwn(receipt, '_requiredScopes'));
    record('manual time add/set, duplicate suppression and permissioned receipts');
    const settings = await call('app_settings', { command: 'read', section: 'misc' });
    const old = settings.settings.misc.isDisableAnimations;
    await write('app_settings', {
      command: 'update',
      section: 'misc',
      changes: { isDisableAnimations: !old },
      expected: { isDisableAnimations: old },
    });
    assert.equal(
      (await call('app_settings', { command: 'read', section: 'misc' })).settings.misc
        .isDisableAnimations,
      !old,
    );
    await write('app_settings', {
      command: 'update',
      section: 'misc',
      changes: { isDisableAnimations: old },
      expected: { isDisableAnimations: !old },
    });
    const idleSettings = await call('app_settings', { command: 'read', section: 'idle' });
    const idleChanges = {
      isEnableIdleTimeTracking: true,
      isOnlyOpenIdleWhenCurrentTask: false,
      minIdleTime: 60000,
    };
    await write('app_settings', {
      command: 'update',
      section: 'idle',
      changes: idleChanges,
      expected: Object.fromEntries(
        Object.keys(idleChanges).map((k) => [k, idleSettings.settings.idle[k]]),
      ),
    });
    record('supported preferences update with expected values');
    assert.equal((await call('app_sync', { command: 'status' })).status, 'disabled');
    assert.equal((await write('app_sync', { command: 'run' })).status, 'disabled');
    assert.equal(
      (await write('app_update', { command: 'install' })).status,
      'unsupported',
    );
    assert.equal((await call('app_update', { command: 'status' })).canInstall, false);
    record('sync disabled and unsupported installer reported truthfully');
    // End an absence through actual main->preload->renderer IPC, then resolve it over MCP.
    await page.evaluate(() => {
      const real = Date.now;
      Date.now = () => real() + 600000;
    });
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].webContents.send('IDLE_TIME', 300000),
    );
    await page.locator('dialog-idle').waitFor();
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].webContents.send('IDLE_END', 300000),
    );
    let idle;
    await expect
      .poll(async () => {
        idle = await call('idle_review', { command: 'status' });
        return idle.isFrozen;
      })
      .toBe(true);
    const idleOp = randomUUID(),
      idleArgs = {
        command: 'track_task',
        taskId,
        reviewId: idle.reviewId,
        expectedIdleTime: idle.idleTime,
      };
    await write('idle_review', idleArgs, idleOp);
    await write('idle_review', idleArgs, idleOp);
    assert.equal((await call('idle_review', { command: 'status' })).status, 'none');
    assert.equal((await call('task_timer', { command: 'status' })).currentTaskId, taskId);
    await write('task_timer', { command: 'stop' });
    record('real idle review resolved once through native dialog and tracking');
    await write('tag_manage', { command: 'delete', id: tag.id });
    assert(!(await call('get_task', { id: taskId })).task.tagIds.includes(tag.id));
    await write('project_manage', { command: 'archive', id: project.id });
    assert(!(await call('list_projects', {})).projects.some((p) => p.id === project.id));
    await write('project_manage', { command: 'reopen', id: project.id });
    assert((await call('list_projects', {})).projects.some((p) => p.id === project.id));
    record('tag membership cleanup and project archive/reopen');
    await app.close();
    app = null;
    await launch();
    await expect
      .poll(
        async () => {
          try {
            return (await call('get_status', {})).isReady;
          } catch {
            return false;
          }
        },
        { timeout: 60000 },
      )
      .toBe(true);
    await write('task_time', timeArgs, timeOp);
    assert.equal(
      (await call('control_operation_status', { command: 'status', operationId: timeOp }))
        .duration,
      300000,
    );
    assert.equal(
      (await call('task_notes', { command: 'read', taskId })).notes,
      'Fictitious MCP note',
    );
    record('real app restart preserves native writes and suppresses command replay');
    await page.evaluate(
      (scopes) => window.ea.setAssistantAccessScopes(scopes),
      ['tasks:read'],
    );
    const denied = await rpc('tools/call', {
      name: 'task_timer',
      arguments: { command: 'start', taskId, operationId: randomUUID() },
    });
    assert(denied.result?.isError || denied.error);
    const hidden = (await rpc('tools/list')).result.tools.map((t) => t.name);
    assert(!hidden.includes('app_settings'));
    record('revoked grants block writes and discovery');
    evidence.passed = true;
    fs.writeFileSync(
      '/tmp/sp-assistant-controls-smoke-result.json',
      JSON.stringify(evidence, null, 2),
    );
    console.log(JSON.stringify({ passed: true, scenarios: evidence.scenarios.length }));
  } finally {
    if (app) await app.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
