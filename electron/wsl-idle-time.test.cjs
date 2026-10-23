const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');
const path = require('node:path');
const { promisify } = require('node:util');
require('ts-node').register({ transpileOnly: true, preferTsExts: true });
let stdout;
let failure;
let invocation;
const execFile = () => {};
execFile[promisify.custom] = async (...args) => {
  invocation = args;
  if (failure) throw failure;
  return { stdout };
};
const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (
    request === 'child_process' &&
    parent &&
    path.basename(parent.filename) === 'wsl-idle-time.ts'
  )
    return { execFile };
  return originalLoad.call(this, request, parent, isMain);
};
let readWindowsHostIdleTime;
let missing;
try {
  ({ readWindowsHostIdleTime } = require('./wsl-idle-time.ts'));
} catch (e) {
  missing = e;
} finally {
  Module._load = originalLoad;
}

test('host read accepts fresh unsigned millisecond samples', async () => {
  assert.equal(missing, undefined, 'Host idle reader must exist');
  for (const value of [0, 125000, 4294967295]) {
    stdout = String(value) + '\r\n';
    assert.equal(await readWindowsHostIdleTime(), value);
  }
});
test('host invocation is bounded, hidden and uses fixed arguments without a shell', async () => {
  assert.equal(missing, undefined, 'Host idle reader must exist');
  stdout = '1';
  await readWindowsHostIdleTime();
  const [command, args, options] = invocation;
  assert.equal(command, 'powershell.exe');
  assert.ok(args.includes('-NoProfile') && args.includes('-NonInteractive'));
  assert.equal(args[args.indexOf('-WindowStyle') + 1], 'Hidden');
  assert.ok(args.includes('-EncodedCommand'));
  assert.equal(options.timeout, 5000);
  assert.equal(options.windowsHide, true);
  assert.equal(options.maxBuffer, 1024);
  assert.equal(options.shell, undefined);
});
test('host read rejects malformed output instead of reporting a false duration', async () => {
  assert.equal(missing, undefined, 'Host idle reader must exist');
  for (stdout of ['', '-1', '1.5', 'NaN', '1\n2', '4294967296', 'error'])
    await assert.rejects(readWindowsHostIdleTime());
});
test('a process timeout rejects and does not poison later reads', async () => {
  assert.equal(missing, undefined, 'Host idle reader must exist');
  failure = new Error('ETIMEDOUT');
  await assert.rejects(readWindowsHostIdleTime(), /ETIMEDOUT/);
  failure = undefined;
  stdout = '10';
  assert.equal(await readWindowsHostIdleTime(), 10);
});
