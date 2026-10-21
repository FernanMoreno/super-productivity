'use strict';
// Administrative Codex app-server client. Never starts a turn or invokes a model.
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { spawn, execFile } = require('node:child_process');
const { promisify } = require('node:util');

async function runCodexMcpClient({ url, accessKey, calls = [], timeoutMs = 20000 }) {
  const parsed = new URL(url);
  if (
    parsed.protocol !== 'http:' ||
    !['127.0.0.1', 'localhost', '[::1]'].includes(parsed.hostname)
  ) {
    throw new Error('Expected loopback HTTP MCP URL');
  }
  if (!accessKey || /[\r\n]/.test(accessKey))
    throw new Error('Missing or invalid MCP access key');
  const root = await fs.mkdtemp(
    path.join(process.env.TMPDIR || os.tmpdir(), 'sp-codex-mcp-'),
  );
  await fs.chmod(root, 0o700);
  let child;
  const pending = new Map();
  let seq = 0;
  let buffer = '';
  const rpc = (method, params) =>
    new Promise((resolve, reject) => {
      const id = ++seq;
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`Codex app-server request timed out: ${method}`));
      }, timeoutMs);
      pending.set(id, {
        resolve: (value) => {
          clearTimeout(timer);
          resolve(value);
        },
        reject: (error) => {
          clearTimeout(timer);
          reject(error);
        },
      });
      child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
    });
  try {
    await fs.writeFile(
      path.join(root, 'config.toml'),
      `[mcp_servers.super_productivity]\nurl = ${JSON.stringify(url)}\nbearer_token_env_var = "SP_CODEX_FIXTURE_KEY"\n`,
      { mode: 0o600 },
    );
    child = spawn('codex', ['app-server', '--stdio'], {
      cwd: root,
      env: {
        PATH: process.env.PATH,
        HOME: process.env.HOME,
        CODEX_HOME: root,
        TMPDIR: process.env.TMPDIR || os.tmpdir(),
        SP_CODEX_FIXTURE_KEY: accessKey,
      },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    // Consume diagnostic bytes, but do not expose any server/client diagnostics or secrets.
    child.stderr.on('data', () => {});
    child.on('error', () => {
      for (const item of pending.values())
        item.reject(new Error('Could not launch Codex app-server'));
      pending.clear();
    });
    child.on('exit', () => {
      for (const item of pending.values())
        item.reject(new Error('Codex app-server exited'));
      pending.clear();
    });
    child.stdout.on('data', (bytes) => {
      buffer += bytes;
      let end;
      while ((end = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, end);
        buffer = buffer.slice(end + 1);
        let message;
        try {
          message = JSON.parse(line);
        } catch {
          continue;
        }
        const item = pending.get(message.id);
        if (!item) continue;
        pending.delete(message.id);
        // Do not echo errors containing server-controlled text; errors are actionable by code.
        if (message.error)
          item.reject(new Error(`Codex JSON-RPC error ${message.error.code}`));
        else item.resolve(message.result);
      }
    });
    await rpc('initialize', {
      clientInfo: { name: 'sp-planner-e2e', version: '1.0.0' },
      capabilities: { experimentalApi: true },
    });
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'initialized' }) + '\n');
    const inventory = await rpc('mcpServerStatus/list', {
      serverName: 'super_productivity',
      detail: 'toolsAndAuthOnly',
    });
    const server = inventory.data.find((entry) => entry.name === 'super_productivity');
    if (!server || server.toolsError)
      throw new Error('Codex failed to discover MCP tools');
    const results = [];
    if (calls.length) {
      const thread = await rpc('thread/start', {
        cwd: root,
        approvalPolicy: 'never',
        ephemeral: true,
      });
      for (const call of calls) {
        results.push(
          await rpc('mcpServer/tool/call', {
            threadId: thread.thread.id,
            server: 'super_productivity',
            tool: call.tool,
            arguments: call.arguments || {},
          }),
        );
      }
    }
    return {
      tools: Object.keys(server.tools).sort(),
      authStatus: server.authStatus,
      modelCalls: 0,
      results,
    };
  } finally {
    for (const item of pending.values()) item.reject(new Error('Codex client cleanup'));
    pending.clear();
    if (child && child.exitCode === null) {
      await new Promise((resolve) => {
        const timer = setTimeout(() => {
          child.kill('SIGKILL');
          resolve();
        }, 2000);
        child.once('exit', () => {
          clearTimeout(timer);
          resolve();
        });
        child.kill('SIGTERM');
      });
    }
    await fs.rm(root, { recursive: true, force: true });
  }
}
async function verifyCodexRuntime({
  url,
  token,
  tool = 'planner_activities',
  args = {},
}) {
  const versionResult = await promisify(execFile)('codex', ['--version'], {
    timeout: 10000,
    env: { PATH: process.env.PATH, HOME: process.env.HOME },
  });
  const version = versionResult.stdout.trim();
  const checked = await runCodexMcpClient({
    url,
    accessKey: token,
    calls: [{ tool, arguments: args }],
  });
  if (!checked.tools.includes(tool))
    throw new Error('Expected tool missing from Codex inventory');
  const calledResult = checked.results[0];
  return {
    version,
    discovery: 'passed',
    tools: checked.tools,
    authStatus: checked.authStatus,
    toolStatus: calledResult.isError ? 'error' : 'completed',
    modelCalls: 0,
    calledResult,
  };
}
module.exports = { verifyCodexRuntime };
