/** Optional client-parser/discovery smoke test. No LLM call and no real app. */
'use strict';
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { once } = require('node:events');
const assert = require('node:assert/strict');
const execute = promisify(execFile);
const token = 'sp_mcp_fictitious_fixture_only';
async function main() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'sp-mcp-client-fixture-'));
  const requests = [];
  const server = http.createServer((req, res) => {
    if (req.method !== 'POST') {
      res.writeHead(405);
      res.end();
      return;
    }
    let body = '';
    req.on('data', (chunk) => (body += chunk));
    req.on('end', () => {
      const request = JSON.parse(body);
      requests.push(request.method);
      assert.equal(req.headers.authorization, `Bearer ${token}`);
      if (!Object.hasOwn(request, 'id')) {
        res.writeHead(202);
        res.end();
        return;
      }
      const result =
        request.method === 'initialize'
          ? {
              protocolVersion: '2025-11-25',
              capabilities: { tools: {} },
              serverInfo: { name: 'fictitious-planner-fixture', version: '0.0.0' },
            }
          : request.method === 'tools/list'
            ? {
                tools: [
                  {
                    name: 'planner_activities',
                    description: 'Fictitious fixture: no real app or data',
                    inputSchema: { type: 'object', properties: {} },
                  },
                ],
              }
            : request.method === 'prompts/list'
              ? { prompts: [] }
              : request.method === 'resources/list'
                ? { resources: [] }
                : { ok: true };
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ jsonrpc: '2.0', id: request.id, result }));
    });
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const url = `http://127.0.0.1:${server.address().port}/mcp`;
  const result = { fixtureOnly: true, modelCalls: 0 };
  try {
    const baseEnv = {
      PATH: process.env.PATH,
      LANG: 'C.UTF-8',
      TERM: 'dumb',
      SP_ACCESS_KEY: token,
    };
    const codexConfig = `mcp_servers={super_productivity_fixture={url="${url}",bearer_token_env_var="SP_ACCESS_KEY"}}`;
    const codex = await execute(
      'codex',
      ['-c', codexConfig, 'mcp', 'get', 'super_productivity_fixture', '--json'],
      { cwd: root, env: { ...baseEnv }, timeout: 15000 },
    );
    const config = JSON.parse(codex.stdout);
    assert.equal(config.transport.url, url);
    assert.equal(config.transport.bearer_token_env_var, 'SP_ACCESS_KEY');
    result.codex = { parser: 'passed', discovery: 'not performed by mcp get' };
    const env = {
      ...baseEnv,
      XDG_CONFIG_HOME: path.join(root, 'config'),
      XDG_CACHE_HOME: path.join(root, 'cache'),
      XDG_DATA_HOME: path.join(root, 'data'),
      XDG_STATE_HOME: path.join(root, 'state'),
    };
    await fs.writeFile(
      path.join(root, 'opencode.json'),
      JSON.stringify({
        mcp: {
          servers: {
            super_productivity_fixture: {
              type: 'remote',
              url,
              oauth: false,
              codemode: false,
              headers: { Authorization: 'Bearer {env:SP_ACCESS_KEY}' },
            },
          },
        },
      }),
    );
    await execute(
      'opencode',
      [
        'mcp',
        'add',
        'fixture_added',
        '--url',
        url,
        '--header',
        'Authorization=Bearer {env:SP_ACCESS_KEY}',
      ],
      { cwd: root, env, timeout: 10000 },
    );
    const createdConfig = JSON.parse(
      await fs.readFile(path.join(root, 'opencode.json'), 'utf8'),
    );
    assert.equal(createdConfig.mcp.servers.fixture_added.url, url);
    result.opencode = {
      parser: 'passed using mcp add in isolated directory',
      discovery: 'not run',
    };
    // mcp list in OpenCode V2 uses a background service; do not attach this
    // isolated parser check to an already-running user service.
    assert.equal(requests.length, 0);
    console.log(JSON.stringify(result, null, 2));
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    await fs.rm(root, { recursive: true, force: true });
  }
}
main().catch((error) => {
  console.error(
    'Client fixture check failed: ' +
      error.message.replaceAll(token, '[fixture token redacted]') +
      ' (code=' +
      error.code +
      ', killed=' +
      error.killed +
      ', signal=' +
      error.signal +
      ')',
  );
  process.exitCode = 1;
});
