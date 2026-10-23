const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');
const path = require('node:path');
const { promisify } = require('node:util');
require('ts-node').register({ transpileOnly: true, preferTsExts: true });
let output;
let hostSamples = [];
const commands = [];
const exec = () => {};
exec[promisify.custom] = async (command) => {
  commands.push(command);
  if (output instanceof Error) throw output;
  return { stdout: output };
};
const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (parent && path.basename(parent.filename) === 'idle-time-handler.ts') {
    if (request === './wsl-idle-time')
      return {
        readWindowsHostIdleTime: async () => {
          const sample = hostSamples.shift();
          if (sample instanceof Error) throw sample;
          return sample;
        },
      };
    if (request === 'child_process') return { ...require('node:child_process'), exec };
    if (request === 'electron') return { app: {}, powerMonitor: {} };
    if (request === 'electron-log/main')
      return { scope: () => ({ debug() {}, info() {}, warn() {} }) };
  }
  return originalLoad.call(this, request, parent, isMain);
};
let IdleTimeHandler;
try {
  ({ IdleTimeHandler } = require('./idle-time-handler.ts'));
} finally {
  Module._load = originalLoad;
}
const handler = Object.create(IdleTimeHandler.prototype);
handler._environment = { isSnap: false, isGnomeWayland: false };
const stale = Date.now() * 1000 - 97 * 3600 * 1e6;

test('loginctl explicitly queries the caller session, never global manager idle', async () => {
  output = 'IdleHint=yes\nIdleSinceHint=' + stale;
  await handler._getLoginctlIdleTime();
  assert.match(commands.at(-1), /show-session self\b/);
});
test('global manager output without a graphical session is unavailable', async () => {
  output = 'IdleHint=yes\nIdleSinceHint=' + stale;
  assert.equal(await handler._getLoginctlIdleTime(), null);
});
test('a tty session cannot report desktop inactivity', async () => {
  output = 'Type=tty\nIdleHint=yes\nIdleSinceHint=' + stale;
  assert.equal(await handler._getLoginctlIdleTime(), null);
});
test('an active graphical session ignores its historical idle timestamp', async () => {
  output = 'Type=wayland\nIdleHint=no\nIdleSinceHint=' + stale;
  assert.equal(await handler._getLoginctlIdleTime(), 0);
});
test('an idle graphical session retains its real idle duration', async () => {
  output = 'Type=x11\nIdleHint=yes\nIdleSinceHint=' + (Date.now() * 1000 - 120e6);
  const result = await handler._getLoginctlIdleTime();
  assert.ok(result >= 120000 && result < 121000, String(result));
});
test('WSL without a caller session rejects loginctl as an idle candidate', async () => {
  output = new Error('Caller does not belong to any known session.');
  const candidate = handler._buildWaylandCandidates().find((c) => c.name === 'loginctl');
  assert.equal(await candidate.test(), false);
});

const wslHandler = () => {
  const value = Object.create(IdleTimeHandler.prototype);
  value._environment = { isWsl: true, isWayland: true, isSnap: false };
  value._buildWaylandCandidates = () => [];
  return value;
};

test('WSL selects host input measurement even when Linux has no idle provider', async () => {
  assert.equal(await wslHandler()._determineWorkingMethod(), 'wslWindows');
});

test('WSL reads increasing host samples and resets after desktop input', async () => {
  const value = wslHandler();
  value._methodDetectionPromise = Promise.resolve('wslWindows');
  value._ensureWaylandIdleHelperStarted = async () => false;
  hostSamples = [120000, 150000, 25];
  assert.equal(await value.getIdleTime(), 120000);
  assert.equal(await value.getIdleTime(), 150000);
  assert.equal(await value.getIdleTime(), 25);
});

test('a failed host sample is not cached and the next poll recovers', async () => {
  const value = wslHandler();
  value._methodDetectionPromise = Promise.resolve('wslWindows');
  value._ensureWaylandIdleHelperStarted = async () => false;
  hostSamples = [70000, new Error('host timeout'), 500];
  assert.equal(await value.getIdleTime(), 70000);
  assert.equal(await value.getIdleTime(), 0);
  assert.equal(await value.getIdleTime(), 500);
});

test('host input tracking cannot be promoted to a Linux-only Wayland provider', async () => {
  const value = wslHandler();
  let attempts = 0;
  value._ensureWaylandIdleHelperStarted = async () => {
    attempts++;
    return true;
  };
  value._maybePromoteToWaylandIdleNotify('wslWindows');
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(attempts, 0);
});

test('non-WSL native sessions retain powerMonitor detection', async () => {
  const value = wslHandler();
  value._environment = { isWsl: false, isWayland: false };
  assert.equal(await value._determineWorkingMethod(), 'powerMonitor');
});

test('WSL environment is detected independently of the display protocol', () => {
  const previous = process.env.WSL_DISTRO_NAME;
  process.env.WSL_DISTRO_NAME = 'Ubuntu';
  try {
    assert.equal(handler._detectEnvironment().isWsl, process.platform === 'linux');
  } finally {
    if (previous === undefined) delete process.env.WSL_DISTRO_NAME;
    else process.env.WSL_DISTRO_NAME = previous;
  }
});
