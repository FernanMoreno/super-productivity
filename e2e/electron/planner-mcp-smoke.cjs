// Run after npm run electron:build and npm run buildFrontend:prod:es6.
// Uses an isolated profile; quit any app using port 3876 before running.
// Optionally pass a packaged Electron executable as the first argument.
const { _electron: electron, expect } = require('@playwright/test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const profile = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'sp-mcp-real-'));
const xdgDir = path.join(profile, 'xdg');
fs.mkdirSync(xdgDir);
let app;
let key;
let id;
const endpoint = 'http://127.0.0.1:3876/mcp';
async function rpc(method, params, headers = {}) {
  // Node fetch replaces Host; use HTTP directly to exercise the rebinding check.
  return new Promise((resolve, reject) => {
    const request = http.request(
      endpoint,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${key}`,
          ...headers,
        },
        timeout: 60000,
      },
      (response) => {
        let body = '';
        response.setEncoding('utf8');
        response.on('data', (chunk) => {
          body += chunk;
        });
        response.on('error', reject);
        response.on('end', () => {
          try {
            resolve({ status: response.statusCode, body: JSON.parse(body) });
          } catch (error) {
            reject(error);
          }
        });
      },
    );
    request.on('error', reject);
    request.on('timeout', () => request.destroy(new Error('MCP request timed out')));
    request.end(JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }));
  });
}
async function call(name, args = {}) {
  const reply = await rpc('tools/call', { name, arguments: args });
  assert.equal(reply.status, 200);
  assert.ok(reply.body.result, 'Expected tool result');
  return reply.body.result;
}
async function waitUntilReady() {
  // expect.poll stops at the first thrown error, and right after a launch or
  // reload the listener or renderer may not answer yet. Returning the message
  // keeps polling and shows the last error if it times out.
  await expect
    .poll(
      async () => {
        try {
          return (await call('get_status')).structuredContent.isReady;
        } catch (error) {
          return error.message;
        }
      },
      { timeout: 60000 },
    )
    .toBe(true);
}
async function launch() {
  app = await electron.launch({
    ...(process.argv[2] ? { executablePath: process.argv[2] } : {}),
    args: [
      ...(process.argv[2] ? [] : [process.env.SP_SMOKE_APP_DIR || '.']),
      `--user-data-dir=${profile}`,
      '--no-sandbox',
      '--disable-gpu',
    ],
    env: {
      ...process.env,
      NODE_ENV: 'PROD',
      SP_FORCE_LOCAL_REST_API: '0',
      // The single-instance lock is acquired before --user-data-dir is applied.
      XDG_CONFIG_HOME: xdgDir,
      XDG_CACHE_HOME: xdgDir,
      XDG_DATA_HOME: xdgDir,
    },
    timeout: 60000,
  });
  const page = await app.firstWindow();
  await page.waitForFunction(() => !!window.ea?.getAssistantAccessState);
  await page.evaluate(() => {
    for (const key of [
      'SUP_ONBOARDING_PRESET_DONE',
      'SUP_ONBOARDING_HINTS_DONE',
      'SUP_IS_SHOW_TOUR',
      'SUP_EXAMPLE_TASKS_CREATED',
    ])
      localStorage.setItem(key, 'true');
  });
  return page;
}
// Fictitious data only. No model inference or personal client configuration.
(async () => {
  let sdkClient;
  try {
    let page = await launch();
    await page.evaluate(() => window.ea.setAssistantAccessEnabled(true));
    key = (await page.evaluate(() => window.ea.rotateAssistantAccessCredential()))
      .credential;
    await page.evaluate(() => window.ea.setAssistantAccessScopes(['planner:read']));
    await expect
      .poll(async () => {
        try {
          return (await rpc('tools/list', {})).body.result.tools.map((t) => t.name);
        } catch {
          return [];
        }
      })
      .toContain('planner_activities');
    assert.deepEqual(
      (await rpc('tools/list', {})).body.result.tools.map((t) => t.name),
      ['get_status', 'planner_activities'],
    );
    const denied = await rpc('tools/call', {
      name: 'planner_task',
      arguments: { operationId: 'denied-operation', fields: { title: 'Denied' } },
    });
    assert.ok(denied.body.error || denied.body.result?.isError);
    const scopes = [
      'planner:read',
      'planner:write',
      'tasks:read',
      'tasks:read_history',
      'tasks:write',
      'time:write',
    ];
    await page.evaluate((scopes) => window.ea.setAssistantAccessScopes(scopes), scopes);
    let state;
    await expect
      .poll(
        async () => {
          const result = await call('planner_activities');
          state = result.structuredContent;
          return !!state?.profile;
        },
        { timeout: 60000 },
      )
      .toBe(true);
    const edit = async (command) => {
      state = (await call('planner_activities')).structuredContent;
      const result = (
        await call('planner_edit', {
          operationId: require('node:crypto').randomUUID(),
          baseRevision: state.revision,
          command,
        })
      ).structuredContent;
      assert.equal(result?.status, 'applied', JSON.stringify(result));
      return result;
    };
    await edit({
      type: 'activity.create',
      payload: { id: 'smoke-area', name: 'Área ficticia MCP' },
    });
    await edit({
      type: 'activity.update',
      payload: { id: 'smoke-area', updates: { projectIds: ['INBOX_PROJECT'] } },
    });
    const today = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Europe/Madrid',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date());
    await edit({
      type: 'activity.goals',
      payload: {
        id: 'smoke-area',
        from: today,
        goals: { dailyMinutes: 25, weeklyMinutes: null, targetHours: null },
      },
    });
    const taskRequest = {
      operationId: 'create-task-smoke',
      fields: {
        title: 'Tarea ficticia MCP #literal',
        dueDay: today,
        timeEstimate: 1200000,
      },
    };
    const created = (await call('planner_task', taskRequest)).structuredContent;
    assert.equal(created.status, 'applied', JSON.stringify(created));
    id = created.taskId;
    assert.equal(
      (await call('planner_task', taskRequest)).structuredContent.replayed,
      true,
    );
    const timeRequest = {
      operationId: 'record-time-smoke',
      taskId: id,
      activityId: 'smoke-area',
      date: today,
      durationMs: 60000,
    };
    assert.equal(
      (await call('planner_log_time', timeRequest)).structuredContent.status,
      'applied',
    );
    assert.equal(
      (await call('planner_log_time', timeRequest)).structuredContent.replayed,
      true,
    );
    let query = (await call('planner_query', { from: today, to: today }))
      .structuredContent;
    assert.equal(query.days[0].progress[0].dailyMinutes, 1);
    assert.equal(query.days[0].tasks.filter((t) => t.id === id).length, 1);

    // Real plugin ZIP import and real iframe bridge on this Electron profile.
    await page.evaluate(() => {
      location.hash = '/config';
    });
    await page.locator('.page-settings').waitFor();
    await page.getByRole('tab').filter({ hasText: 'Plugins' }).click();
    await page
      .locator('input[type="file"][accept=".zip"]')
      .setInputFiles(
        path.resolve('packages/plugin-dev/personal-planner/dist/personal-planner.zip'),
      );
    await page.locator('dialog-confirm button[e2e="confirmBtn"]').click();
    const card = page
      .locator('plugin-management mat-card')
      .filter({ hasText: 'Mi planificación' });
    await card.waitFor();
    if ((await card.getByRole('switch').getAttribute('aria-checked')) === 'false')
      await card.getByRole('switch').click();
    await page.evaluate(() => {
      location.hash = '/plugins/personal-planner/index';
    });
    const frame = page.frameLocator('plugin-index iframe');
    await frame.locator('#status').filter({ hasText: 'Datos actualizados' }).waitFor();
    await frame
      .locator('summary')
      .filter({ hasText: 'Actividades, objetivos y organización' })
      .click();
    const area = frame.locator('form[data-form="area"]');
    assert.equal(await area.locator('[name="dailyMinutes"]').inputValue(), '25');
    await area.locator('[name="dailyMinutes"]').fill('35');
    await area
      .getByRole('button', { name: 'Guardar Área ficticia MCP', exact: true })
      .click();
    await frame
      .locator('#status')
      .filter({ hasText: 'Configuración guardada' })
      .waitFor();
    state = (await call('planner_activities')).structuredContent;
    assert.equal(state.profile.areas[0].goalHistory.at(-1).dailyMinutes, 35);
    await edit({
      type: 'activity.goals',
      payload: {
        id: 'smoke-area',
        from: today,
        goals: { dailyMinutes: 40, weeklyMinutes: null, targetHours: null },
      },
    });
    await expect(area.locator('[name="dailyMinutes"]')).toHaveValue('40', {
      timeout: 20000,
    });
    // Native task changes invalidate a prepared proposal; nothing moves silently.
    const from = new Date(Date.parse(today + 'T12:00:00Z') + 86400000)
      .toISOString()
      .slice(0, 10);
    const prepared = (await call('planner_prepare', { from, to: from }))
      .structuredContent;
    assert.ok(prepared.proposals.length);
    assert.equal(
      (
        await call('planner_task', {
          operationId: 'update-task-smoke',
          taskId: id,
          fields: { title: 'Tarea ficticia modificada' },
        })
      ).structuredContent.status,
      'applied',
    );
    const stale = (
      await call('planner_apply', {
        operationId: 'stale-apply-smoke',
        proposalId: prepared.proposalId,
        selection: [prepared.proposals[0].id],
      })
    ).structuredContent;
    assert.equal(stale.code, 'STALE_PLAN');
    const fresh = (await call('planner_prepare', { from, to: from })).structuredContent;
    const applyRequest = {
      operationId: 'fresh-apply-smoke',
      proposalId: fresh.proposalId,
      selection: [fresh.proposals[0].id],
    };
    assert.equal(
      (await call('planner_apply', applyRequest)).structuredContent.status,
      'applied',
    );
    assert.equal(
      (await call('planner_apply', applyRequest)).structuredContent.replayed,
      true,
    );
    // An official SDK client exercises discovery and a real query without inference.
    if (process.env.PLANNER_MCP_SDK_PATH) {
      const { Client } = require(
        path.join(process.env.PLANNER_MCP_SDK_PATH, 'dist/cjs/client/index.js'),
      );
      const { StreamableHTTPClientTransport } = require(
        path.join(process.env.PLANNER_MCP_SDK_PATH, 'dist/cjs/client/streamableHttp.js'),
      );
      sdkClient = new Client({ name: 'planner-smoke', version: '1.0.0' });
      await sdkClient.connect(
        new StreamableHTTPClientTransport(new URL(endpoint), {
          requestInit: { headers: { Authorization: `Bearer ${key}` } },
        }),
      );
      assert.ok(
        (await sdkClient.listTools()).tools.some((t) => t.name === 'planner_query'),
      );
      assert.ok(
        (
          await sdkClient.callTool({
            name: 'planner_query',
            arguments: { from: today, to: today },
          })
        ).structuredContent.days.length,
      );
      await sdkClient.close();
      sdkClient = undefined;
      const { StdioClientTransport } = require(
        path.join(process.env.PLANNER_MCP_SDK_PATH, 'dist/cjs/client/stdio.js'),
      );
      const tokenFile = path.join(profile, 'mcp-test.token');
      await fs.promises.writeFile(tokenFile, key, { mode: 0o600 });
      sdkClient = new Client({ name: 'planner-stdio-smoke', version: '1.0.0' });
      await sdkClient.connect(
        new StdioClientTransport({
          command: process.execPath,
          args: [path.resolve('tools/mcpb/server/index.js')],
          env: {
            PATH: process.env.PATH,
            SP_ACCESS_KEY_FILE: tokenFile,
            SP_MCP_URL: endpoint,
          },
        }),
      );
      const bridged = await sdkClient.callTool({
        name: 'planner_activities',
        arguments: {},
      });
      assert.equal(bridged.structuredContent.profile.areas[0].id, 'smoke-area');
      await sdkClient.close();
      sdkClient = undefined;
      console.log(
        'PASS official SDK 1.32.1: native HTTP and stdio bridge against real Electron.',
      );
    }
    if (process.env.PLANNER_MCP_CODEX === '1') {
      const { verifyCodexRuntime } = require('../../tools/mcpb/tests/codex-runtime.cjs');
      const client = await verifyCodexRuntime({
        url: endpoint,
        token: key,
        tool: 'planner_query',
        args: { from: today, to: today },
      });
      assert.equal(client.discovery, 'passed');
      assert.equal(client.toolStatus, 'completed');
      assert.equal(client.modelCalls, 0);
      assert.ok(client.tools.includes('planner_apply'));
      console.log(
        'PASS Codex real: ' +
          client.version +
          '; discovery and planner_query; zero model calls.',
      );
    }
    await page.reload();
    await expect
      .poll(
        async () => {
          try {
            return (await call('planner_activities')).structuredContent.profile.areas
              .length;
          } catch {
            return 0;
          }
        },
        { timeout: 60000 },
      )
      .toBe(1);
    assert.equal(
      (await call('planner_log_time', timeRequest)).structuredContent.replayed,
      true,
    );
    assert.equal(
      (await call('planner_query', { from: today, to: today })).structuredContent.days[0]
        .progress[0].dailyMinutes,
      1,
    );
    await app.close();
    app = undefined;
    await assert.rejects(fetch(endpoint, { method: 'POST' }));
    console.log(
      'PASS real Electron: filtered discovery, denied scope, native task/time and retries, ZIP import, MCP→UI and UI→MCP, stale proposal, selected apply, reload/IndexedDB receipts, app closed, optional official SDK. Fictitious profile only.',
    );
  } finally {
    if (sdkClient) await sdkClient.close();
    if (app) await app.close();
    await fs.promises.rm(profile, {
      recursive: true,
      force: true,
      maxRetries: 5,
      retryDelay: 100,
    });
  }
})().catch((error) => {
  console.error(error.stack);
  process.exitCode = 1;
});
