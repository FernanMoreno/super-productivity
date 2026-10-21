const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { once } = require('node:events');
const { PassThrough } = require('node:stream');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createBridge, readSettings } = require('../server/index.js');
const token = 'sp_mcp_fictitious_fixture_only';
async function fixture(handler) {
  const server = http.createServer(handler);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return {
    url: `http://127.0.0.1:${server.address().port}/mcp`,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}
const call = {
  jsonrpc: '2.0',
  id: 1,
  method: 'tools/call',
  params: { name: 'planner_edit', arguments: {} },
};
async function exchange(bridge, message) {
  const out = [];
  await bridge(JSON.stringify(message), (value) => out.push(value));
  return out;
}
test('settings only accept loopback MCP and native independent credential', () => {
  assert.equal(
    readSettings({ SP_ACCESS_KEY: token }).endpoint.href,
    'http://127.0.0.1:3876/mcp',
  );
  for (const url of [
    'http://example.com/mcp',
    'https://127.0.0.1/mcp',
    'http://127.0.0.1/rest',
    'http://user:password@127.0.0.1/mcp',
    'http://127.0.0.1/mcp?token=secret',
    'http://127.0.0.1/mcp#secret',
  ])
    assert.throws(
      () => readSettings({ SP_ACCESS_KEY: token, SP_MCP_URL: url }),
      /loopback|endpoint/i,
    );
  assert.throws(() => readSettings({ SP_ACCESS_KEY: 'rest_fictitious' }), /MCP/);
  assert.throws(() => readSettings({}), /SP_ACCESS_KEY/);
});
test('external token file takes precedence, unreadable path and contents stay private', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sp-mcp-test-'));
  try {
    const file = path.join(dir, 'token');
    fs.writeFileSync(file, token + '\n', { mode: 0o600 });
    assert.equal(
      readSettings({ SP_ACCESS_KEY_FILE: file, SP_ACCESS_KEY: 'unused' }).accessKey,
      token,
    );
    assert.throws(
      () => readSettings({ SP_ACCESS_KEY_FILE: path.join(dir, 'not-there') }),
      (error) => !error.message.includes(dir),
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
test('bridge forwards JSON RPC and auth, no Origin, preserves negotiated protocol', async () => {
  const requests = [];
  const f = await fixture((req, res) => {
    let text = '';
    req.on('data', (chunk) => (text += chunk));
    req.on('end', () => {
      requests.push({ headers: req.headers, body: JSON.parse(text) });
      const body = JSON.parse(text);
      if (!('id' in body)) {
        res.writeHead(202);
        res.end();
        return;
      }
      res.setHeader('Content-Type', 'application/json');
      res.end(
        JSON.stringify({
          jsonrpc: '2.0',
          id: body.id,
          result:
            body.method === 'initialize'
              ? { protocolVersion: '2025-11-25', capabilities: { tools: {} } }
              : { tools: [{ name: 'planner_activities' }] },
        }),
      );
    });
  });
  try {
    const bridge = createBridge({ endpoint: new URL(f.url), accessKey: token });
    assert.equal(
      (await exchange(bridge, { jsonrpc: '2.0', id: 0, method: 'initialize' }))[0].result
        .protocolVersion,
      '2025-11-25',
    );
    assert.deepEqual(
      await exchange(bridge, { jsonrpc: '2.0', method: 'notifications/initialized' }),
      [],
    );
    assert.equal(
      (await exchange(bridge, { jsonrpc: '2.0', id: 2, method: 'tools/list' }))[0].result
        .tools[0].name,
      'planner_activities',
    );
    assert.equal(requests[0].headers.authorization, `Bearer ${token}`);
    assert.equal(requests[0].headers.origin, undefined);
    assert.equal(requests[2].headers['mcp-protocol-version'], '2025-11-25');
  } finally {
    await f.close();
  }
});
test('401 and disabled endpoint report actionable errors without reflecting headers', async () => {
  for (const [status, expected] of [
    [401, /access key/i],
    [503, /switched off/i],
  ]) {
    const f = await fixture((req, res) => {
      res.writeHead(status);
      res.end(JSON.stringify({ error: { message: token } }));
    });
    try {
      const reply = (
        await exchange(createBridge({ endpoint: new URL(f.url), accessKey: token }), call)
      )[0];
      assert.match(reply.error.message, expected);
      assert.equal(JSON.stringify(reply).includes(token), false);
    } finally {
      await f.close();
    }
  }
});
test('mutation timeout returns OUTCOME_UNKNOWN and never retries', async () => {
  let requests = 0;
  const f = await fixture(() => {
    requests++;
  });
  try {
    const reply = (
      await exchange(
        createBridge({ endpoint: new URL(f.url), accessKey: token, timeoutMs: 30 }),
        call,
      )
    )[0];
    assert.equal(reply.error.data.code, 'OUTCOME_UNKNOWN');
    assert.match(reply.error.message, /not retry/i);
    assert.equal(requests, 1);
  } finally {
    await f.close();
  }
});
test('malformed successful mutation response is unknown, invalid RPC never forwarded', async () => {
  let requests = 0;
  const f = await fixture((req, res) => {
    requests++;
    res.end('invalid');
  });
  try {
    const bridge = createBridge({ endpoint: new URL(f.url), accessKey: token });
    assert.equal((await exchange(bridge, call))[0].error.data.code, 'OUTCOME_UNKNOWN');
    for (const value of [null, [], 5, { jsonrpc: '2.0', method: 7 }])
      assert.equal((await exchange(bridge, value))[0].error.code, -32600);
    let out = [];
    await bridge('{', (value) => out.push(value));
    assert.equal(out[0].error.code, -32700);
    assert.equal(requests, 1);
  } finally {
    await f.close();
  }
});
test('stdio uses one JSON object per line, serial order and no startup logs', async () => {
  const { run } = require('../server/index.js');
  const input = new PassThrough(),
    output = new PassThrough();
  let text = '';
  output.on('data', (chunk) => (text += chunk));
  const f = await fixture((req, res) => {
    let text = '';
    req.on('data', (chunk) => (text += chunk));
    req.on('end', () => {
      const request = JSON.parse(text);
      res.end(JSON.stringify({ jsonrpc: '2.0', id: request.id, result: { ok: true } }));
    });
  });
  try {
    run({ input, output, env: { SP_MCP_URL: f.url, SP_ACCESS_KEY: token } });
    assert.equal(text, '');
    input.end(
      JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'ping' }) +
        '\n' +
        JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'ping' }) +
        '\n',
    );
    const until = Date.now() + 2000;
    while (text.trim().split('\n').length < 2 && Date.now() < until)
      await new Promise((r) => setTimeout(r, 5));
    const replies = text.trim().split('\n').map(JSON.parse);
    assert.deepEqual(
      replies.map((v) => v.id),
      [1, 2],
    );
    assert.equal(text.includes(token), false);
  } finally {
    await f.close();
  }
});
test('startup configuration error is JSON RPC, not credential-bearing stderr text', async () => {
  const { run } = require('../server/index.js');
  const input = new PassThrough(),
    output = new PassThrough();
  run({
    input,
    output,
    env: { SP_ACCESS_KEY: token, SP_MCP_URL: 'http://example.com/mcp' },
  });
  const reply = once(output, 'data');
  input.end(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize' }) + '\n');
  const [data] = await reply;
  const parsed = JSON.parse(data.toString());
  assert.equal(parsed.error.data.code, 'CONFIGURATION_ERROR');
  assert.equal(data.toString().includes(token), false);
});
test(
  'Node env-file starts stdio with external credential and never prints it',
  {
    skip:
      Number(process.versions.node.split('.')[0]) < 20 ||
      (Number(process.versions.node.split('.')[0]) === 20 &&
        Number(process.versions.node.split('.')[1]) < 6),
  },
  async () => {
    const { spawn } = require('node:child_process');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sp-mcp-env-test-'));
    const f = await fixture((req, res) => {
      assert.equal(req.headers.authorization, `Bearer ${token}`);
      let body = '';
      req.on('data', (part) => (body += part));
      req.on('end', () => {
        res.end(
          JSON.stringify({
            jsonrpc: '2.0',
            id: JSON.parse(body).id,
            result: { ok: true },
          }),
        );
      });
    });
    try {
      const file = path.join(dir, 'private.env');
      fs.writeFileSync(file, `SP_ACCESS_KEY=${token}\nSP_MCP_URL=${f.url}\n`, {
        mode: 0o600,
      });
      const child = spawn(
        process.execPath,
        [`--env-file=${file}`, path.resolve(__dirname, '../server/index.js')],
        { env: { PATH: process.env.PATH }, stdio: ['pipe', 'pipe', 'pipe'] },
      );
      let output = '',
        errors = '';
      child.stdout.on('data', (part) => (output += part));
      child.stderr.on('data', (part) => (errors += part));
      const done = once(child, 'close');
      child.stdin.end(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'ping' }) + '\n');
      const [code] = await done;
      assert.equal(code, 0);
      assert.equal(JSON.parse(output).result.ok, true);
      assert.equal(errors, '');
      assert.equal(output.includes(token), false);
    } finally {
      await f.close();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  },
);
test('app closed is actionable and does not retry a tool call', async () => {
  const f = await fixture((req, res) => res.end());
  await f.close();
  const result = await exchange(
    createBridge({ endpoint: new URL(f.url), accessKey: token }),
    call,
  );
  assert.equal(result[0].error.data.code, 'APP_UNAVAILABLE');
  assert.match(result[0].error.message, /not running/);
});
