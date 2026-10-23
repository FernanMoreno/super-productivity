import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { unzipSync, strFromU8 } from 'fflate';
import { patchBackground } from '../scripts/patch.mjs';

test('installable ZIP preserves identity, permissions and all original UI assets', async () => {
  const root = new URL('../', import.meta.url);
  await promisify(execFile)(process.execPath, [
    fileURLToPath(new URL('scripts/build.mjs', root)),
  ]);
  const original = unzipSync(await readFile(new URL('vendor/quest-arc-2.2.0.zip', root)));
  const built = unzipSync(await readFile(new URL('quest-arc-compat.zip', root)));
  const before = JSON.parse(strFromU8(original['manifest.json']));
  const after = JSON.parse(strFromU8(built['manifest.json']));
  assert.equal(after.version, '2.2.0-compat.1');
  assert.deepEqual({ ...after, version: before.version }, before);
  assert.equal(
    strFromU8(built['plugin.js']),
    patchBackground(strFromU8(original['plugin.js'])),
  );
  for (const name of Object.keys(original).filter(
    (n) => !['plugin.js', 'manifest.json'].includes(n),
  )) {
    assert.deepEqual(built[name], original[name], name);
  }
  assert.deepEqual(
    Object.keys(built).sort(),
    [...Object.keys(original), 'COMPATIBILITY.md'].sort(),
  );
});
