'use strict';
// Administrative MCP health check only. Never starts a Claude conversation.
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const execute = promisify(execFile);
async function verifyClaudeCodeRuntime({ url, token }) {
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
    path.join(process.env.TMPDIR || os.tmpdir(), 'sp-claude-mcp-'),
  );
  await fs.chmod(root, 0o700);
  const env = {
    PATH: process.env.PATH,
    HOME: root,
    CLAUDE_CONFIG_DIR: path.join(root, 'claude'),
    CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
    DISABLE_AUTOUPDATER: '1',
    TMPDIR: process.env.TMPDIR || os.tmpdir(),
    SP_RUNTIME_FIXTURE_KEY: token,
  };
  try {
    await fs.mkdir(env.CLAUDE_CONFIG_DIR, { mode: 0o700 });
    const opts = { cwd: root, env, timeout: 20000, maxBuffer: 256 * 1024 };
    const version = (await execute('claude', ['--version'], opts)).stdout.trim();
    await execute(
      'claude',
      [
        'mcp',
        'add-json',
        'super-productivity-runtime',
        JSON.stringify({
          type: 'http',
          url,
          headers: { Authorization: 'Bearer ${SP_RUNTIME_FIXTURE_KEY}' },
        }),
        '-s',
        'user',
      ],
      opts,
    );
    const checked = await execute(
      'claude',
      ['mcp', 'get', 'super-productivity-runtime'],
      opts,
    );
    if (!/Status:.*Connected/.test(checked.stdout))
      throw new Error('Claude Code MCP health check failed');
    return {
      version,
      discovery: 'connected-health-check',
      toolStatus: 'not-exposed-administratively',
      modelCalls: 0,
    };
  } catch {
    // CLI diagnostics can contain headers. Never forward them to test logs.
    throw new Error('Claude Code administrative MCP check failed or timed out');
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
}
module.exports = { verifyClaudeCodeRuntime };
