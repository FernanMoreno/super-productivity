// Optional complete Angular run with a fresh browser per serial native Karma shard.
// This does not alter the default test configuration or suppress any failures.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

function parseArgs(argv) {
  const result = { shards: 6, timeoutMs: 360000, seed: '248163', args: [] };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--') {
      result.args = argv.slice(i + 1);
      break;
    }
    if (arg.startsWith('--shards=')) result.shards = Number(arg.slice(9));
    else if (arg.startsWith('--timeout-ms=')) result.timeoutMs = Number(arg.slice(13));
    else if (arg.startsWith('--seed=')) result.seed = arg.slice(7);
    else throw new Error(`Unknown option: ${arg}`);
  }
  if (!Number.isInteger(result.shards) || result.shards < 1 || result.shards > 100)
    throw new Error('Invalid shard count');
  if (!Number.isInteger(result.timeoutMs) || result.timeoutMs < 1000)
    throw new Error('Invalid timeout');
  if (!/^\d{1,12}$/.test(result.seed)) throw new Error('Invalid Jasmine seed');
  if (result.args.some((arg) => /^(--karma-config|--watch|--browsers)(=|$)/.test(arg)))
    throw new Error('Cannot override shard runner configuration');
  return result;
}

function summarize(reports) {
  if (!reports.length || reports.length !== reports[0].totalShards)
    throw new Error('Missing shard reports');
  const expected = new Map(reports[0].specs.map((spec) => [spec.id, spec.name]));
  const results = new Map();
  for (let i = 0; i < reports.length; i++) {
    const report = reports[i];
    if (!report.completed) throw new Error(`Incomplete shard ${i}`);
    if (report.shardIndex !== i || report.totalShards !== reports.length)
      throw new Error('Invalid shard report sequence');
    if (
      report.total !== expected.size ||
      report.specs.length !== expected.size ||
      new Set(report.specs.map((spec) => spec.id)).size !== expected.size
    )
      throw new Error('Specification discovery changed between shards');
    for (const spec of report.specs) {
      if (expected.get(spec.id) !== spec.name)
        throw new Error('Specification discovery changed between shards');
      if (!spec.disabled) {
        if (results.has(spec.id))
          throw new Error(`Specification executed more than once: ${spec.name}`);
        results.set(spec.id, spec);
      }
    }
  }
  const summary = {
    defined: expected.size,
    passed: 0,
    failed: 0,
    pending: 0,
    disabled: expected.size - results.size,
  };
  for (const spec of results.values()) {
    if (spec.pending || spec.skipped) summary.pending++;
    else if (!spec.success) summary.failed++;
    else summary.passed++;
  }
  if (!summary.passed) throw new Error('No passing specifications were executed');
  return summary;
}

function runShard(args, env, timeoutMs) {
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [require.resolve('@angular/cli/bin/ng.js'), ...args],
      {
        cwd: path.join(__dirname, '..'),
        env,
        stdio: 'inherit',
        detached: process.platform !== 'win32',
      },
    );
    let expired = false;
    let forceTimer;
    const kill = (signal) => {
      try {
        if (process.platform === 'win32')
          spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
        else process.kill(-child.pid, signal);
      } catch (error) {
        if (error.code !== 'ESRCH') reject(error);
      }
    };
    const timer = setTimeout(() => {
      expired = true;
      kill('SIGTERM');
      forceTimer = setTimeout(() => kill('SIGKILL'), 5000);
    }, timeoutMs);
    const interrupt = () => kill('SIGTERM');
    const cleanup = () => {
      clearTimeout(timer);
      clearTimeout(forceTimer);
      process.removeListener('SIGINT', interrupt);
      process.removeListener('SIGTERM', interrupt);
    };
    process.once('SIGINT', interrupt);
    process.once('SIGTERM', interrupt);
    child.once('error', (error) => {
      cleanup();
      reject(error);
    });
    child.once('close', (code) => {
      if (expired) kill('SIGKILL');
      cleanup();
      if (expired)
        reject(new Error(`Shard exceeded ${timeoutMs} ms; its process tree was stopped`));
      else if (code !== 0) reject(new Error(`Shard exited with code ${code}`));
      else resolve();
    });
  });
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const output = fs.mkdtempSync(path.join(os.tmpdir(), 'sp-angular-shards-'));
  console.log(`Shard reports: ${output}`);
  const reports = [];
  for (let index = 0; index < options.shards; index++) {
    const reportPath = path.join(output, `${index}.json`);
    console.log(`Angular shard ${index + 1}/${options.shards}; seed ${options.seed}`);
    await runShard(
      ['test', '--watch=false', '--karma-config=tools/karma-shards.cjs', ...options.args],
      {
        ...process.env,
        TZ: process.env.TZ || 'Europe/Berlin',
        SP_TEST_SHARD_INDEX: String(index),
        SP_TEST_SHARDS: String(options.shards),
        SP_TEST_SHARD_SEED: options.seed,
        SP_TEST_SHARD_REPORT: reportPath,
      },
      options.timeoutMs,
    );
    reports.push(JSON.parse(fs.readFileSync(reportPath, 'utf8')));
  }
  const summary = summarize(reports);
  fs.writeFileSync(path.join(output, 'summary.json'), JSON.stringify(summary, null, 2));
  console.log(`Complete Angular shard results: ${JSON.stringify(summary)}`);
  if (summary.failed) process.exitCode = 1;
}

module.exports = { parseArgs, summarize, runShard };
if (require.main === module)
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
