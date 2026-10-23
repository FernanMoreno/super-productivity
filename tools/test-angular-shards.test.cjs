const test = require('node:test');
const assert = require('node:assert/strict');
const { parseArgs, summarize, runShard } = require('./test-angular-shards.cjs');

test('an expired job rejects instead of becoming a successful check', async () => {
  await assert.rejects(runShard(['--help'], process.env, 1), /exceeded 1 ms/);
});

test('uses six serial shards with bounded jobs and a fixed seed', () => {
  assert.deepEqual(parseArgs([]), {
    shards: 6,
    timeoutMs: 360000,
    seed: '248163',
    args: [],
  });
  assert.deepEqual(parseArgs(['--shards=3', '--timeout-ms=10000', '--', '--include=x']), {
    shards: 3,
    timeoutMs: 10000,
    seed: '248163',
    args: ['--include=x'],
  });
  for (const input of ['--shards=0', '--shards=1.5', '--timeout-ms=0', '--oops']) {
    assert.throws(() => parseArgs([input]));
  }
});

test('counts every executed specification exactly once and distinguishes pending specs', () => {
  const reports = [
    {
      shardIndex: 0,
      totalShards: 2,
      total: 3,
      completed: true,
      specs: [
        { id: 'a', name: 'A', skipped: false, success: true },
        { id: 'b', name: 'B', skipped: true, disabled: true, success: true },
        { id: 'c', name: 'C', skipped: true, disabled: true, success: true },
      ],
    },
    {
      shardIndex: 1,
      totalShards: 2,
      total: 3,
      completed: true,
      specs: [
        { id: 'a', name: 'A', skipped: true, disabled: true, success: true },
        { id: 'b', name: 'B', skipped: false, success: true },
        { id: 'c', name: 'C', skipped: true, pending: true, success: true },
      ],
    },
  ];
  assert.deepEqual(summarize(reports), {
    defined: 3,
    passed: 2,
    failed: 0,
    pending: 1,
    disabled: 0,
  });
  assert.throws(() => summarize(reports.slice(0, 1)), /shard/i);
  assert.throws(
    () => summarize([reports[0], { ...reports[1], completed: false }]),
    /incomplete/i,
  );
  const duplicate = structuredClone(reports);
  duplicate[1].specs[0] = { id: 'a', name: 'A', skipped: false, success: true };
  assert.throws(() => summarize(duplicate), /more than once/i);
  const mismatch = structuredClone(reports);
  mismatch[1].specs[0].name = 'Changed';
  assert.throws(() => summarize(mismatch), /discovery/i);
});

test('wrapper retains checks and checkpoints incomplete progress before browser completion', async () => {
  const fs = require('node:fs');
  const os = require('node:os');
  const path = require('node:path');
  const configFactory = require('./karma-shards.cjs');
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'sp-shard-config-'));
  const keys = [
    'SP_TEST_SHARD_INDEX',
    'SP_TEST_SHARDS',
    'SP_TEST_SHARD_REPORT',
    'SP_TEST_SHARD_SEED',
  ];
  const previous = keys.map((key) => process.env[key]);
  try {
    process.env.SP_TEST_SHARD_INDEX = '1';
    process.env.SP_TEST_SHARDS = '3';
    process.env.SP_TEST_SHARD_REPORT = path.join(directory, 'report.json');
    process.env.SP_TEST_SHARD_SEED = '12345';
    const config = {
      LOG_INFO: 'info',
      files: [{ pattern: 'existing-spec.js' }],
      set(value) {
        Object.assign(this, value);
      },
    };
    configFactory(config);
    assert.equal(config.client.shardIndex, 1);
    assert.equal(config.client.totalShards, 3);
    assert.equal(config.client.jasmine.seed, '12345');
    assert.equal(config.browserNoActivityTimeout, 30000);
    assert.equal(config.specReporter.failFast, false);
    assert.equal(config.files[0].pattern, 'existing-spec.js');
    // Karma reapplies Angular's CLI files after the configuration module.
    const parsed = await require('karma/lib/config').parseConfig(
      path.resolve(__dirname, 'karma-shards.cjs'),
      { files: [{ pattern: path.resolve(directory, 'compiled-spec.js') }] },
      { promiseConfig: true, throwErrors: true },
    );
    assert.ok(parsed.frameworks.includes('shard-start-hooks'));
    const hook = parsed.plugins.find((plugin) => plugin['framework:shard-start-hooks'])[
      'framework:shard-start-hooks'
    ];
    const injector = new (require('di').Injector)([
      { 'config.files': ['value', parsed.files], 'framework:shard-start-hooks': hook },
    ]);
    injector.get('framework:shard-start-hooks');
    assert.ok(
      parsed.files.some((file) => file.pattern.endsWith('jasmine-spec-reporter-hook.js')),
    );
    assert.ok(config.reporters.includes('running-spec'));
    const Reporter = config.plugins.at(-1)['reporter:shard-audit'][1];
    const reporter = new Reporter();
    assert.equal(
      JSON.parse(fs.readFileSync(process.env.SP_TEST_SHARD_REPORT)).completed,
      false,
    );
    // Karma consumes info.total itself; unlike other info messages, it never
    // emits browser_info for it. Exercise the actual installed Karma boundary.
    const { EventEmitter } = require('node:events');
    const Browser = require('karma/lib/browser');
    const emitter = new EventEmitter();
    emitter.on('browser_info', reporter.onBrowserInfo);
    emitter.on('spec_complete', reporter.onSpecComplete);
    emitter.on('browser_complete', reporter.onBrowserComplete);
    const browser = new Browser(
      'browser1',
      'Chromium',
      {},
      emitter,
      {},
      { clearTimeout() {} },
      0,
      0,
      true,
      {},
    );
    browser.onStart({ total: 0 });
    browser.onInfo({ total: 1 });
    browser.onInfo({ type: 'spec-start', specName: 'Real assertion', specId: 'spec1' });
    browser.onResult({ id: 'spec1', fullName: 'Real assertion', success: false });
    await new Promise((resolve) => setTimeout(resolve, 2100));
    const partial = JSON.parse(fs.readFileSync(process.env.SP_TEST_SHARD_REPORT));
    assert.equal(partial.completed, false);
    assert.equal(partial.total, 1);
    assert.equal(partial.specs.length, 1);
    assert.equal(partial.lastSpec.id, 'spec1');
    reporter.onRunComplete();
    assert.equal(
      JSON.parse(fs.readFileSync(process.env.SP_TEST_SHARD_REPORT)).completed,
      false,
    );
    browser.onComplete({});
    reporter.onRunComplete();
    const report = JSON.parse(fs.readFileSync(process.env.SP_TEST_SHARD_REPORT));
    assert.equal(report.completed, true);
    assert.equal(report.total, 1);
    assert.equal(report.lastSpec.id, 'spec1');
    assert.equal(report.specs[0].success, false);
    process.env.SP_TEST_SHARD_INDEX = '3';
    assert.throws(() => configFactory(config), /configure this runner/);
  } finally {
    keys.forEach((key, i) => {
      if (previous[i] === undefined) delete process.env[key];
      else process.env[key] = previous[i];
    });
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
