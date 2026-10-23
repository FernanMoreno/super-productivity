'use strict';
// Run with Windows Node, against an unpacked application, never an installer.
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { spawn, spawnSync } = require('node:child_process');
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function main() {
  if (process.platform !== 'win32')
    throw Error('Run this smoke check with Windows Node.');
  const executable = path.resolve(process.argv[2] || '');
  if (!process.argv[2] || /setup|installer/i.test(path.basename(executable)))
    throw Error('Pass the unpacked application executable, not an installer.');
  await fs.access(executable);
  const archive = await fs.readFile(
    path.join(path.dirname(executable), 'resources/app.asar'),
  );
  if (!archive.includes(Buffer.from('--no-protocol-registration')))
    throw Error('This build lacks the protocol-registration opt-out.');
  const profile = await fs.mkdtemp(path.join(os.tmpdir(), 'sp-planner-smoke-'));
  const child = spawn(
    executable,
    [
      `--user-data-dir=${profile}`,
      '--no-protocol-registration',
      '--remote-debugging-port=0',
    ],
    { stdio: ['ignore', 'pipe', 'pipe'] },
  );
  // Do not expose app logs, tokens, or page contents in test output.
  let launchError;
  child.once('error', (error) => {
    launchError = error;
  });
  child.stdout.resume();
  child.stderr.resume();
  let socket;
  try {
    let exited = false;
    child.once('exit', () => {
      exited = true;
    });
    const deadline = Date.now() + 60000;
    let port;
    while (Date.now() < deadline && !port) {
      if (launchError) throw launchError;
      if (exited) throw Error('Application exited before its browser became available.');
      try {
        port = Number(
          (await fs.readFile(path.join(profile, 'DevToolsActivePort'), 'utf8')).split(
            '\n',
          )[0],
        );
      } catch {}
      if (!port) await delay(250);
    }
    if (!port) throw Error('Timed out waiting for the isolated application browser.');
    let target;
    while (Date.now() < deadline && !target) {
      const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
      target = targets.find(
        (item) => item.type === 'page' && item.url.startsWith('file:'),
      );
      if (!target) await delay(250);
    }
    if (!target) throw Error('No application page was created.');
    socket = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => {
      socket.addEventListener('open', resolve, { once: true });
      socket.addEventListener('error', reject, { once: true });
    });
    let id = 0;
    const pending = new Map();
    socket.addEventListener('message', (event) => {
      const message = JSON.parse(String(event.data));
      const callback = pending.get(message.id);
      if (callback) {
        pending.delete(message.id);
        callback(message);
      }
    });
    const evaluate = (
      expression = `({ready:document.readyState,root:!!document.querySelector('app-root'),bodyChars:document.body?.innerText.length||0,title:document.title,native:typeof window.ea?.getAssistantAccessState==='function'})`,
    ) =>
      new Promise((resolve, reject) => {
        const requestId = ++id;
        const timer = setTimeout(() => {
          pending.delete(requestId);
          reject(Error('Renderer did not answer.'));
        }, 5000);
        pending.set(requestId, (message) => {
          clearTimeout(timer);
          if (message.error || message.result?.exceptionDetails)
            reject(Error('Native renderer operation failed.'));
          else resolve(message.result?.result?.value);
        });
        socket.send(
          JSON.stringify({
            id: requestId,
            method: 'Runtime.evaluate',
            params: {
              expression,
              awaitPromise: true,
              returnByValue: true,
            },
          }),
        );
      });
    let page;
    while (Date.now() < deadline) {
      page = await evaluate();
      if (page?.root && page.native && page.bodyChars > 20 && page.ready === 'complete')
        break;
      await delay(500);
    }
    if (!page?.root || !page.native || page.bodyChars <= 20 || page.ready !== 'complete')
      throw Error('Application renderer never reached a populated Angular page.');
    const reportedProfile = await evaluate('window.ea.getUserDataPath()');
    if (
      typeof reportedProfile !== 'string' ||
      path.resolve(reportedProfile).toLowerCase() !== path.resolve(profile).toLowerCase()
    )
      throw Error('Native IPC did not confirm the isolated profile.');
    const access = await evaluate('window.ea.getAssistantAccessState()');
    if (!access || access.isEnabled !== false || access.scopes?.length !== 0)
      throw Error('The isolated profile did not start with assistant access disabled.');
    let mcp;
    if (process.argv.includes('--mcp')) {
      const credential = (await evaluate('window.ea.rotateAssistantAccessCredential()'))
        ?.credential;
      if (typeof credential !== 'string' || !credential.startsWith('sp_mcp_'))
        throw Error('Temporary credential was not created.');
      await evaluate("window.ea.setAssistantAccessScopes(['planner:read'])");
      const enabled = await evaluate('window.ea.setAssistantAccessEnabled(true)');
      if (!enabled?.isListening)
        throw Error(
          'Temporary assistant listener could not start; check port ownership.',
        );
      let rpcId = 0;
      const rpc = async (method, params = {}) => {
        const response = await fetch('http://127.0.0.1:3876/mcp', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json, text/event-stream',
            Authorization: 'Bearer ' + credential,
            'MCP-Protocol-Version': '2025-11-25',
          },
          body: JSON.stringify({ jsonrpc: '2.0', id: ++rpcId, method, params }),
          signal: AbortSignal.timeout(15000),
        });
        if (!response.ok)
          throw Error('Native MCP HTTP request failed: ' + response.status);
        const reply = await response.json();
        if (reply.error || reply.result?.isError)
          throw Error('Native MCP operation failed.');
        return reply.result;
      };
      await rpc('initialize', {
        protocolVersion: '2025-11-25',
        capabilities: {},
        clientInfo: { name: 'planner-windows-smoke', version: '1.0.0' },
      });
      const tools = (await rpc('tools/list')).tools.map((tool) => tool.name).sort();
      if (
        !tools.includes('planner_activities') ||
        tools.some(
          (name) =>
            !['get_status', 'planner_activities', 'planner_operation_status'].includes(
              name,
            ),
        )
      )
        throw Error('Native MCP tools were not filtered by the temporary read grant.');
      const activityResult = await rpc('tools/call', {
        name: 'planner_activities',
        arguments: {},
      });
      const data =
        activityResult.structuredContent || JSON.parse(activityResult.content[0].text);
      if (!Array.isArray(data.profile?.areas) || data.profile.areas.length !== 0)
        throw Error('Native MCP did not return an empty isolated planner profile.');
      mcp = { initialize: true, filteredTools: tools, activities: 0 };
      await evaluate('window.ea.setAssistantAccessEnabled(false)');
    }
    console.log(
      JSON.stringify(
        {
          platform: process.platform,
          architecture: process.arch,
          pid: child.pid,
          page,
          nativeIpc: true,
          ...(mcp ? { mcp } : {}),
          isolatedProfile: true,
          protocolRegistrationDisabled: true,
        },
        null,
        2,
      ),
    );
  } finally {
    socket?.close();
    if (child.pid && child.exitCode === null && child.signalCode === null)
      spawnSync('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], {
        stdio: 'ignore',
      });
    await fs.rm(profile, {
      recursive: true,
      force: true,
      maxRetries: 10,
      retryDelay: 300,
    });
  }
}
main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
