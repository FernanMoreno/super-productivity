const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const {
  isPublicAppFile,
  validatePreload,
  runtimeNames,
  resolveRuntime,
  stageApplication,
} = require('./pipeline.cjs');
test('distribution source allowlist excludes tests, source, credentials and profile data', () => {
  for (const name of [
    'electron/main.js',
    'electron/preload.js',
    'electron/assets/icons/icon.png',
    '.tmp/angular-dist/browser/index.html',
    '.tmp/angular-dist/3rdpartylicenses.txt',
    'LICENSE',
  ])
    assert.equal(isPublicAppFile(name), true, name);
  for (const name of [
    '.env',
    'private-profile.json',
    'electron/main.ts',
    'electron/main.js.map',
    'electron/runtime.test.cjs',
    'electron/scripts/bundle-preload.js',
    'electron/wayland-idle-helper/Cargo.toml',
    'node_modules/private.json',
    '.tmp/profile.json',
  ])
    assert.equal(isPublicAppFile(name), false, name);
});
test('sandbox preload is bundled and imports only electron', () => {
  assert.doesNotThrow(() => validatePreload(`const api = require('electron');`));
  assert.doesNotThrow(() => validatePreload(''));
  for (const source of [
    `require('./common.const')`,
    `require('fs')`,
    `require('node:fs')`,
    `require(name)`,
  ])
    assert.throws(() => validatePreload(source), /preload.*bundl|sandbox/i);
});
test('runtime packages derived from compiled imports exclude builtins and dev-only imports', () => {
  const root = {
    dependencies: { 'runtime-a': '^1.0.0', '@example/b': '^2' },
    devDependencies: { devtool: '^3' },
  };
  assert.deepEqual(
    runtimeNames(
      [
        `const a=require('runtime-a');require('node:fs');require('./local');import('@example/b/subpath');require('electron');`,
      ],
      root,
    ),
    ['@example/b', 'runtime-a'],
  );
  assert.throws(
    () => runtimeNames([`require('devtool')`], root),
    /runtime.*dependencies/i,
  );
});
test('runtime resolution pins installed versions and staging keeps only public source and runtime closure', async () => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'sp-distribution-fixture-'));
  try {
    const root = {
      name: 'fictitious-app',
      version: '1.0.0',
      main: 'electron/main.js',
      devDependencies: { electron: '44.7.0' },
      dependencies: { 'runtime-a': '^1.0.0' },
    };
    const put = async (name, data) => {
      const file = path.join(temp, name);
      await fs.mkdir(path.dirname(file), { recursive: true });
      await fs.writeFile(file, data);
    };
    await put('package.json', JSON.stringify(root));
    await put(
      'package-lock.json',
      JSON.stringify({
        lockfileVersion: 3,
        packages: {
          'node_modules/runtime-a': { version: '1.2.3' },
          'node_modules/transitive': { version: '2.0.0' },
        },
      }),
    );
    await put('electron/main.js', `require('runtime-a');`);
    await put('electron/preload.js', '');
    await put('electron/private.test.cjs', 'not runtime');
    await put('.tmp/angular-dist/browser/index.html', 'fictitious');
    await put('.tmp/angular-dist/3rdpartylicenses.txt', 'MIT');
    await put('LICENSE', 'MIT');
    await put('private-profile.json', 'fictitious private fixture');
    await put(
      'node_modules/runtime-a/package.json',
      JSON.stringify({
        name: 'runtime-a',
        version: '1.2.3',
        main: 'index.js',
        dependencies: { transitive: '^2' },
      }),
    );
    await put('node_modules/runtime-a/index.js', `module.exports=require('transitive');`);
    await put(
      'node_modules/transitive/package.json',
      JSON.stringify({ name: 'transitive', version: '2.0.0', main: 'index.js' }),
    );
    await put('node_modules/transitive/index.js', `module.exports=42;`);
    assert.deepEqual((await resolveRuntime(temp)).dependencies, { 'runtime-a': '1.2.3' });
    await put('electron/preload.js', `require('./common.const')`);
    await assert.rejects(resolveRuntime(temp), /preload.*bundled/i);
    await put('electron/preload.js', '');
    const stage = path.join(temp, 'output-stage');
    await stageApplication(temp, stage, { platform: 'win32' });
    assert.deepEqual(
      JSON.parse(await fs.readFile(path.join(stage, 'package.json'), 'utf8'))
        .dependencies,
      { 'runtime-a': '1.2.3' },
    );
    const metadata = JSON.parse(
      await fs.readFile(path.join(stage, 'package.json'), 'utf8'),
    );
    assert.equal(metadata.name, 'super-productivity-planner');
    assert.equal(metadata.productName, 'Super Productivity Planner');
    assert.equal(require(path.join(stage, 'node_modules/runtime-a')), 42);
    await assert.rejects(fs.access(path.join(stage, 'private-profile.json')));
    await assert.rejects(fs.access(path.join(stage, 'electron/private.test.cjs')));
    const alternate = path.join(temp, 'alternate-frontend');
    await put('alternate-frontend/browser/index.html', 'alternate compiled frontend');
    await put('alternate-frontend/3rdpartylicenses.txt', 'fictitious license');
    const alternateStage = path.join(temp, 'alternate-stage');
    await stageApplication(temp, alternateStage, { frontendDirectory: alternate });
    assert.equal(
      await fs.readFile(
        path.join(alternateStage, '.tmp/angular-dist/browser/index.html'),
        'utf8',
      ),
      'alternate compiled frontend',
    );
    await fs.unlink(path.join(alternate, '3rdpartylicenses.txt'));
    await assert.rejects(
      stageApplication(temp, path.join(temp, 'unlicensed-stage'), {
        frontendDirectory: alternate,
      }),
      /3rdpartylicenses/,
    );
    await put('alternate-frontend/3rdpartylicenses.txt', 'fictitious license');
    await fs.symlink(
      path.join(temp, 'private-profile.json'),
      path.join(alternate, 'browser/escape.json'),
    );
    await assert.rejects(
      stageApplication(temp, path.join(temp, 'escaped-stage'), {
        frontendDirectory: alternate,
      }),
      /symlink/,
    );
    await put('node_modules/runtime-a/native.node', 'fictitious native addon');
    await assert.rejects(
      stageApplication(temp, path.join(temp, 'native-stage'), { platform: 'win32' }),
      /native Node addons/,
    );
    await put(
      'node_modules/runtime-a/package.json',
      JSON.stringify({ name: 'runtime-a', version: '9.0.0', main: 'index.js' }),
    );
    await assert.rejects(resolveRuntime(temp), /lock|installed/i);
  } finally {
    await fs.rm(temp, { recursive: true, force: true });
  }
});
