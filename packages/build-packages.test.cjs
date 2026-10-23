const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { pluginAssets, buildPlugin } = require('./build-packages.js');
const assets = ['manifest.json', 'index.html', 'LICENSE', 'NOTICE'];

test('uploaded QuestArc adaptation builds without copying it into host assets', async () => {
  const { getPlugins } = require('./build-packages.js');
  const plugin = (await getPlugins()).find((p) => p.name === 'quest-arc-compat');
  assert.equal(plugin.skipCopy, true);
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'sp-uploaded-plugin-'));
  const previous = process.cwd();
  try {
    process.chdir(root);
    assert.equal(
      (await buildPlugin({ ...plugin, path: root, buildCommand: undefined })).success,
      true,
    );
    await assert.rejects(
      fs.access(path.join(root, 'src/assets/bundled-plugins/quest-arc-compat')),
    );
  } finally {
    process.chdir(previous);
    await fs.rm(root, { recursive: true, force: true });
  }
});
test('explicit plugin assets replace inferred runtime and translation files', () => {
  const result = pluginAssets({ superProductivity: { pluginAssets: assets } });
  assert.deepEqual(result, assets);
  assert.equal(pluginAssets({}), undefined);
  for (const invalid of [
    [],
    ['index.html'],
    ['manifest.json', '../profile.json'],
    ['manifest.json', '/private.json'],
    ['manifest.json', 'manifest.json'],
    ['manifest.json', 'C:\\private.json'],
  ])
    assert.throws(
      () => pluginAssets({ superProductivity: { pluginAssets: invalid } }),
      /pluginAssets/,
    );
});
test('allowlisted dist copies only public files; missing required asset fails', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'sp-plugin-assets-')),
    previous = process.cwd();
  try {
    const fixture = path.join(root, 'fixture');
    await fs.mkdir(path.join(fixture, 'dist'), { recursive: true });
    for (const name of [...assets, 'unlisted-fictitious.json', 'personal-planner.zip'])
      await fs.writeFile(path.join(fixture, 'dist', name), 'fictitious fixture');
    process.chdir(root);
    const plugin = {
      name: 'fixture',
      path: fixture,
      sourcePath: 'dist',
      files: assets,
      requiredFiles: assets,
      explicitAssets: true,
    };
    assert.equal((await buildPlugin(plugin)).success, true);
    assert.deepEqual(
      (await fs.readdir(path.join(root, 'src/assets/bundled-plugins/fixture'))).sort(),
      [...assets].sort(),
    );
    assert.equal(
      (await buildPlugin({ ...plugin, name: 'legacy-fixture', explicitAssets: false }))
        .success,
      true,
    );
    assert.ok(
      (
        await fs.readdir(path.join(root, 'src/assets/bundled-plugins/legacy-fixture'))
      ).includes('unlisted-fictitious.json'),
    );
    await fs.rm(path.join(fixture, 'dist', 'NOTICE'));
    assert.equal((await buildPlugin(plugin)).success, false);
  } finally {
    process.chdir(previous);
    await fs.rm(root, { recursive: true, force: true });
  }
});
