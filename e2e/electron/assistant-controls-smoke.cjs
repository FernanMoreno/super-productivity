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
      'task_repeat',
      'task_manage',
      'task_structure',
      'task_attachment',
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
    record('all control tools discoverable');
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
    const recurringTask = await call('planner_task', {
      operationId: randomUUID(),
      fields: {
        title: 'MCP repeat fixture',
        projectId: project.id,
        timeEstimate: 900000,
      },
    });
    const repeatTaskId = recurringTask.taskId;
    assert.equal(
      (await call('task_repeat', { command: 'read', taskId: repeatTaskId })).revision,
      null,
    );
    const repeatArgs = {
      command: 'set',
      taskId: repeatTaskId,
      cycle: 'weekly',
      every: 2,
      weekdays: ['wed', 'fri'],
      startDay: '2099-10-28',
      expectedRevision: null,
    };
    const repeatOp = randomUUID();
    const firstRepeat = await write('task_repeat', repeatArgs, repeatOp);
    assert.deepEqual(await write('task_repeat', repeatArgs, repeatOp), firstRepeat);
    let repeatRead = await call('task_repeat', { command: 'read', taskId: repeatTaskId });
    assert.equal(repeatRead.schedule.cycle, 'weekly');
    assert.equal(repeatRead.schedule.every, 2);
    assert.deepEqual(repeatRead.schedule.weekdays, ['wed', 'fri']);
    assert(repeatRead.dueDay >= repeatArgs.startDay);
    assert([3, 5].includes(new Date(repeatRead.dueDay + 'T12:00:00Z').getUTCDay()));
    const stale = await rpc('tools/call', {
      name: 'task_repeat',
      arguments: { ...repeatArgs, operationId: randomUUID() },
    });
    assert.match(stale.result.content[0].text, /STALE_DATA/);
    await write('task_repeat', {
      command: 'set',
      taskId: repeatTaskId,
      cycle: 'monthly',
      startDay: '2099-11-30',
      expectedRevision: repeatRead.revision,
    });
    repeatRead = await call('task_repeat', { command: 'read', taskId: repeatTaskId });
    assert.equal(repeatRead.repeatCfgId, firstRepeat.repeatCfgId);
    assert.equal(repeatRead.schedule.cycle, 'monthly');
    assert.equal(repeatRead.schedule.every, 1);
    assert.equal(repeatRead.dueDay, '2099-11-30');
    record(
      'native repeat creation, weekly days/interval, monthly editing, stale rejection and duplicate suppression',
    );
    await write('task_repeat', {
      command: 'set',
      taskId: repeatTaskId,
      cycle: 'monthly',
      startDay: '2099-11-30',
      startTime: '12:00',
      reminder: null,
      repeatUntilDay: '2099-12-16',
      paused: false,
      template: {
        title: 'Literal future #task +name',
        timeEstimate: 7200000,
        notes: 'Private series fixture',
      },
      expectedRevision: repeatRead.revision,
    });
    repeatRead = await call('task_repeat', { command: 'read', taskId: repeatTaskId });
    assert.equal(repeatRead.schedule.startTime, '12:00');
    assert.equal(repeatRead.schedule.repeatUntilDay, '2099-12-16');
    assert(!JSON.stringify(repeatRead).includes('Private series fixture'));
    assert.equal(
      (await call('task_repeat', { command: 'read_template', taskId: repeatTaskId }))
        .template.notes,
      'Private series fixture',
    );
    record('complete recurrence time/end/template edits and protected note readback');

    const fixture = await call('planner_task', {
      operationId: randomUUID(),
      fields: { title: 'Task controls fixture', projectId: project.id },
    });
    const managedId = fixture.taskId;
    const managedRead = (id = managedId, location) =>
      call('task_manage', {
        command: 'read',
        taskId: id,
        ...(location ? { location } : {}),
      });
    const managedWrite = async (
      command,
      extra = {},
      id = managedId,
      tool = 'task_manage',
    ) =>
      write(tool, {
        command,
        taskId: id,
        expectedRevision: (await managedRead(id)).revision,
        ...extra,
      });
    const metadataOp = randomUUID();
    const metadataArgs = {
      command: 'update',
      taskId: managedId,
      expectedRevision: (await managedRead()).revision,
      fields: { title: 'Literal #keep +keep 2h', priority: 3, timeEstimate: 7200000 },
    };
    await write('task_manage', metadataArgs, metadataOp);
    await write('task_manage', metadataArgs, metadataOp);
    let managed = await managedRead();
    assert.equal(managed.title, 'Literal #keep +keep 2h');
    assert.equal(managed.priority, 3);
    const staleTask = await rpc('tools/call', {
      name: 'task_manage',
      arguments: { ...metadataArgs, operationId: randomUUID() },
    });
    assert.match(staleTask.result.content[0].text, /STALE_DATA/);
    const scheduleAt = new Date('2099-12-01T12:00:00').getTime();
    const deadlineAt = new Date('2099-12-16T17:00:00').getTime();
    await managedWrite('schedule', { at: scheduleAt, remindAt: scheduleAt - 300000 });
    await managedWrite('deadline', { at: deadlineAt, remindAt: deadlineAt - 600000 });
    managed = await managedRead();
    assert.equal(managed.dueWithTime, scheduleAt);
    assert.equal(managed.deadlineWithTime, deadlineAt);
    assert.equal(managed.remindAt, scheduleAt - 300000);
    assert.equal(managed.deadlineRemindAt, deadlineAt - 600000);
    await managedWrite('unschedule');
    assert.equal((await managedRead()).deadlineWithTime, deadlineAt);
    await managedWrite('clear_deadline');
    assert(!(await managedRead()).deadlineWithTime);
    const beforePlacement = await managedRead();
    const structure = await call('task_structure', {
      command: 'read',
      taskId: managedId,
    });
    assert(structure.contexts.some((c) => c.contextId === project.id));
    if (structure.contexts.find((c) => c.contextId === project.id).isEnableBacklog) {
      await managedWrite(
        'reorder',
        {
          contextId: project.id,
          contextType: 'PROJECT',
          source: 'UNDONE',
          target: 'BACKLOG',
          afterTaskId: null,
        },
        managedId,
        'task_structure',
      );
      await managedWrite(
        'reorder',
        {
          contextId: project.id,
          contextType: 'PROJECT',
          source: 'BACKLOG',
          target: 'UNDONE',
          afterTaskId: null,
        },
        managedId,
        'task_structure',
      );
      assert.equal((await managedRead()).dueDay, beforePlacement.dueDay);
    } else {
      const disabledBacklog = await rpc('tools/call', {
        name: 'task_structure',
        arguments: {
          command: 'reorder',
          taskId: managedId,
          operationId: randomUUID(),
          expectedRevision: (await managedRead()).revision,
          contextId: project.id,
          contextType: 'PROJECT',
          source: 'UNDONE',
          target: 'BACKLOG',
          afterTaskId: null,
        },
      });
      assert.match(disabledBacklog.result.content[0].text, /INVALID_ARGUMENTS/);
    }
    assert.equal((await managedRead()).dueWithTime, beforePlacement.dueWithTime);
    record(
      'literal task metadata, native priority, independent scheduling/deadlines, CAS and replay',
    );
    const child = await managedWrite(
      'add_subtask',
      { title: 'Literal child #keep +keep' },
      managedId,
      'task_structure',
    );
    assert.equal((await managedRead(child.taskId)).title, 'Literal child #keep +keep');
    assert((await managedRead()).subTaskIds.includes(child.taskId));
    await managedWrite('detach', {}, child.taskId, 'task_structure');
    assert(!(await managedRead(child.taskId)).parentId);
    await managedWrite(
      'reparent',
      { parentId: managedId, afterTaskId: null },
      child.taskId,
      'task_structure',
    );
    assert.equal((await managedRead(child.taskId)).parentId, managedId);
    await managedWrite('update', { fields: { timeEstimate: 0 } }, child.taskId);
    const secondChild = await managedWrite(
      'add_subtask',
      { title: 'Second child' },
      managedId,
      'task_structure',
    );
    await managedWrite(
      'update',
      { fields: { timeEstimate: 600000 } },
      secondChild.taskId,
    );
    const copied = await managedWrite('duplicate');
    const copiedTask = await managedRead(copied.taskId);
    assert.equal(copiedTask.subTaskIds.length, 2);
    assert.equal(copiedTask.timeEstimate, 600000);
    assert.equal((await managedRead(copiedTask.subTaskIds[0])).timeEstimate, 0);
    assert.equal((await managedRead(copiedTask.subTaskIds[1])).timeEstimate, 600000);
    record('single literal subtask, detach/reparent and native duplication');
    await managedWrite(
      'add',
      {
        attachment: {
          type: 'LINK',
          title: 'Stored reference',
          path: 'https://example.com/fixture',
        },
      },
      managedId,
      'task_attachment',
    );
    let attached = await call('task_attachment', { command: 'read', taskId: managedId });
    const reference = attached.attachments.find(
      (a) => a.path === 'https://example.com/fixture',
    );
    assert(reference);
    await managedWrite(
      'update',
      { attachmentId: reference.id, attachment: { title: 'Updated reference' } },
      managedId,
      'task_attachment',
    );
    await managedWrite(
      'remove',
      { attachmentId: reference.id },
      managedId,
      'task_attachment',
    );
    attached = await call('task_attachment', { command: 'read', taskId: managedId });
    assert(!attached.attachments.some((a) => a.id === reference.id));
    await managedWrite('wont_do');
    managed = await managedRead();
    assert.equal(managed.isDone, true);
    assert.equal(managed.doneOn, managed.wontDoOn);
    await managedWrite('reopen');
    await managedWrite('archive');
    const archived = await managedRead(managedId, 'archive');
    assert(archived.subTaskIds.includes(child.taskId));
    await write('task_manage', {
      command: 'restore',
      taskId: managedId,
      expectedRevision: archived.revision,
    });
    assert.equal((await managedRead(child.taskId)).parentId, managedId);
    await managedWrite('delete', { confirm: true }, copied.taskId);
    record(
      'attachment CRUD, wont-do/reopen, archive/restore subtree and explicit deletion',
    );
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
    const repeatAfterRestart = await call('task_repeat', {
      command: 'read',
      taskId: repeatTaskId,
    });
    assert.equal(repeatAfterRestart.repeatCfgId, firstRepeat.repeatCfgId);
    assert.equal(repeatAfterRestart.schedule.startDay, '2099-11-30');
    assert.equal(repeatAfterRestart.schedule.startTime, '12:00');
    assert.equal(repeatAfterRestart.schedule.repeatUntilDay, '2099-12-16');
    assert.equal((await managedRead()).priority, 3);
    assert.equal((await managedRead(child.taskId)).parentId, managedId);
    assert.deepEqual(await write('task_repeat', repeatArgs, repeatOp), firstRepeat);
    record('native repeat configuration and duplicate receipt survive restart');
    await page.evaluate(
      (scopes) => window.ea.setAssistantAccessScopes(scopes),
      ['tasks:read'],
    );
    const denied = await rpc('tools/call', {
      name: 'task_timer',
      arguments: { command: 'start', taskId, operationId: randomUUID() },
    });
    assert(denied.result?.isError || denied.error);
    const repeatDenied = await rpc('tools/call', {
      name: 'task_repeat',
      arguments: {
        ...repeatArgs,
        expectedRevision: repeatAfterRestart.revision,
        operationId: randomUUID(),
      },
    });
    assert(repeatDenied.result?.isError || repeatDenied.error);
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
