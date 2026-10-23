'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { once } = require('node:events');
const { verifyClaudeCodeRuntime } = require('./claude-code-runtime.cjs');
const { verifyOpenCodeRuntime } = require('./opencode-runtime.cjs');

async function withFixture(check) {
  const token = 'sp_mcp_fictitious_admin_fixture_only';
  const requests = [];
  let invalidAuthorization = false;
  const server = http.createServer((req, res) => {
    if (req.method !== 'POST') {
      res.writeHead(405).end();
      return;
    }
    let body = '';
    req.on('data', (bytes) => {
      body += bytes;
    });
    req.on('end', () => {
      if (req.headers.authorization !== 'Bearer ' + token) {
        invalidAuthorization = true;
        res.writeHead(401).end();
        return;
      }
      const request = JSON.parse(body);
      requests.push(request.method);
      if (!Object.hasOwn(request, 'id')) {
        res.writeHead(202).end();
        return;
      }
      const response = { jsonrpc: '2.0', id: request.id };
      if (request.method === 'initialize') {
        response.result = {
          protocolVersion: request.params.protocolVersion,
          capabilities: { tools: {} },
          serverInfo: { name: 'fictitious-admin-fixture', version: '0' },
        };
      } else if (request.method === 'tools/list') {
        response.result = {
          tools: [
            {
              name: 'planner_activities',
              description: 'Fictitious data only',
              inputSchema: { type: 'object', properties: {} },
            },
          ],
        };
      } else {
        response.error = { code: -32601, message: 'Unsupported fixture method' };
      }
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify(response));
    });
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  try {
    const checked = await check({
      url: `http://127.0.0.1:${server.address().port}/mcp`,
      token,
    });
    assert.equal(invalidAuthorization, false);
    assert.ok(requests.includes('initialize'));
    assert.ok(requests.includes('tools/list'));
    assert.equal(checked.modelCalls, 0);
    assert.equal(checked.toolStatus, 'not-exposed-administratively');
    assert.equal(requests.includes('tools/call'), false);
    assert.equal(requests.includes('turn/start'), false);
    return checked;
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
}
const skip = process.env.SP_TEST_ADMIN_CLIENTS !== '1';
test(
  'Claude Code administration discovers authenticated tools without a model',
  { skip, timeout: 30000 },
  async () => {
    const result = await withFixture(verifyClaudeCodeRuntime);
    assert.match(result.version, /Claude Code/);
    assert.equal(result.discovery, 'connected-health-check');
  },
);
test(
  'OpenCode private server discovers authenticated tools without a model',
  { skip, timeout: 30000 },
  async () => {
    const result = await withFixture(verifyOpenCodeRuntime);
    assert.match(result.version, /opencode v2\./);
    assert.equal(result.discovery, 'connected');
  },
);
