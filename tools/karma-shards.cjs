const fs = require('node:fs');
const path = require('node:path');

module.exports = function (config) {
  const shardIndex = Number(process.env.SP_TEST_SHARD_INDEX);
  const totalShards = Number(process.env.SP_TEST_SHARDS);
  const reportPath = process.env.SP_TEST_SHARD_REPORT;
  const seed = process.env.SP_TEST_SHARD_SEED;
  if (
    !Number.isInteger(shardIndex) ||
    !Number.isInteger(totalShards) ||
    totalShards < 1 ||
    shardIndex < 0 ||
    shardIndex >= totalShards ||
    !reportPath ||
    !/^\d{1,12}$/.test(seed || '')
  ) {
    throw new Error('Use tools/test-angular-shards.cjs to configure this runner');
  }
  require('../src/karma.conf.js')(config);
  function AuditReporter() {
    const report = { shardIndex, totalShards, completed: false, total: 0, specs: [] };
    const checkpoint = () => {
      fs.writeFileSync(`${reportPath}.tmp`, JSON.stringify(report));
      fs.renameSync(`${reportPath}.tmp`, reportPath);
    };
    checkpoint();
    // Preserve an explicitly incomplete report even if the external job
    // deadline must terminate Karma before it can emit run_complete.
    const timer = setInterval(checkpoint, 2000);
    timer.unref();
    this.onBrowserInfo = (_browser, info) => {
      if (info.type === 'spec-start')
        report.lastSpec = { id: info.specId, name: info.specName };
    };
    this.onSpecComplete = (browser, result) => {
      report.total = browser.lastResult.total;
      report.specs.push({
        id: result.id,
        name: result.fullName,
        skipped: !!result.skipped,
        disabled: !!result.disabled,
        pending: !!result.pending,
        success: !!result.success,
      });
    };
    this.onBrowserComplete = (browser) => {
      // Karma consumes info.total without forwarding browser_info. Its final
      // BrowserResult retains that authoritative discovery count.
      report.total = browser.lastResult.total;
      report.completed = !browser.lastResult.error && !browser.lastResult.disconnected;
    };
    this.onRunComplete = () => {
      clearInterval(timer);
      checkpoint();
    };
  }
  function StartHooks(files) {
    // Framework initialization runs after Karma reapplies Angular's CLI file
    // list. Adding this in config.set({files}) would silently lose the hook.
    files.push({
      pattern: path.resolve(
        __dirname,
        '../src/test-helpers/jasmine-spec-reporter-hook.js',
      ),
      included: true,
      served: true,
      watched: false,
    });
  }
  StartHooks.$inject = ['config.files'];
  config.set({
    client: {
      ...config.client,
      shardIndex,
      totalShards,
      jasmine: { ...config.client?.jasmine, random: true, seed },
    },
    frameworks: [...config.frameworks, 'shard-start-hooks'],
    plugins: [
      ...config.plugins,
      {
        'reporter:shard-audit': ['type', AuditReporter],
        'framework:shard-start-hooks': ['factory', StartHooks],
      },
    ],
    reporters: [...config.reporters, 'shard-audit'],
  });
};
