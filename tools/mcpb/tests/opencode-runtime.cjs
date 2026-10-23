'use strict';
// An isolated OpenCode server exercises its MCP client without an agent/model.
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { spawn, execFile } = require('node:child_process');
const { promisify } = require('node:util');
async function verifyOpenCodeRuntime({ url, token, timeoutMs = 20000 }) {
  const parsed = new URL(url);
  if (
    parsed.protocol !== 'http:' ||
    !['127.0.0.1', 'localhost', '[::1]'].includes(parsed.hostname)
  ) {
    throw new Error('Expected loopback HTTP MCP URL');
  }
  if (!token || /[\r\n]/.test(token))
    throw new Error('Missing or invalid MCP access key');
  const root = await fs.mkdtemp(
    path.join(process.env.TMPDIR || os.tmpdir(), 'sp-opencode-mcp-'),
  );
  await fs.chmod(root, 0o700);
  const password = randomUUID();
  const env = {
    PATH: process.env.PATH,
    HOME: root,
    XDG_CONFIG_HOME: path.join(root, 'config'),
    XDG_CACHE_HOME: path.join(root, 'cache'),
    XDG_DATA_HOME: path.join(root, 'data'),
    XDG_STATE_HOME: path.join(root, 'state'),
    TMPDIR: process.env.TMPDIR || os.tmpdir(),
    OPENCODE_PASSWORD: password,
  };
  let child;
  try {
    const version = (
      await promisify(execFile)('opencode', ['--version'], {
        cwd: root,
        env,
        timeout: 10000,
      })
    ).stdout.trim();
    child = spawn('opencode', ['serve', '--hostname', '127.0.0.1', '--port', '0'], {
      cwd: root,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    let base;
    let spawnFailed = false;
    const onOutput = (bytes) => {
      output = (output + bytes.toString()).slice(-8192);
      const found = output.match(/http:\/\/127\.0\.0\.1:\d+/);
      if (found) base = found[0];
    };
    child.stdout.on('data', onOutput);
    child.stderr.on('data', onOutput);
    child.on('error', () => {
      spawnFailed = true;
    });
    const deadline = Date.now() + timeoutMs;
    const pause = () => new Promise((resolve) => setTimeout(resolve, 100));
    while (!base && Date.now() < deadline && child.exitCode === null && !spawnFailed)
      await pause();
    if (!base) throw new Error('Private OpenCode server did not start');
    const authorization =
      'Basic ' + Buffer.from('opencode:' + password).toString('base64');
    const request = (route, options = {}) =>
      fetch(base + route, {
        ...options,
        headers: { Authorization: authorization, ...options.headers },
        signal: AbortSignal.timeout(Math.max(1, deadline - Date.now())),
      });
    const added = await request('/api/experimental/mcp/super-productivity-runtime', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        config: {
          type: 'remote',
          url,
          oauth: false,
          codemode: false,
          headers: { Authorization: 'Bearer ' + token },
        },
      }),
    });
    if (added.status !== 204)
      throw new Error('OpenCode MCP runtime registration rejected');
    while (Date.now() < deadline) {
      const response = await request('/api/mcp');
      if (!response.ok) throw new Error('OpenCode MCP status unavailable');
      const status = await response.json();
      const server = status.data?.find(
        (entry) => entry.name === 'super-productivity-runtime',
      );
      if (server?.status?.status === 'connected') {
        return {
          version,
          discovery: 'connected',
          toolStatus: 'not-exposed-administratively',
          modelCalls: 0,
        };
      }
      if (server?.status?.status === 'failed')
        throw new Error('OpenCode MCP connection failed');
      await pause();
    }
    throw new Error('OpenCode MCP discovery timed out');
  } catch {
    // Do not expose diagnostics, response bodies, URL credentials or configured headers.
    throw new Error('OpenCode administrative MCP check failed or timed out');
  } finally {
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
module.exports = { verifyOpenCodeRuntime };
