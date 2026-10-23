import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { unzipSync, zipSync, strFromU8, strToU8 } from 'fflate';
import { patchBackground } from './patch.mjs';

const root = new URL('../', import.meta.url);
const archive = await readFile(new URL('vendor/quest-arc-2.2.0.zip', root));
if (
  createHash('sha256').update(archive).digest('hex') !==
  'a279403b8319a8cfc7dfcf474bf9bdc0287d6dfcbdf932f97d6f80553e613207'
) {
  throw new Error('QuestArc upstream ZIP checksum mismatch');
}
const files = unzipSync(archive);
files['plugin.js'] = strToU8(patchBackground(strFromU8(files['plugin.js'])));
const manifest = JSON.parse(strFromU8(files['manifest.json']));
const pkg = JSON.parse(await readFile(new URL('package.json', root), 'utf8'));
manifest.version = pkg.version;
files['manifest.json'] = strToU8(JSON.stringify(manifest, null, 2) + '\n');
files['COMPATIBILITY.md'] = new Uint8Array(await readFile(new URL('README.md', root)));
await mkdir(new URL('dist/', root), { recursive: true });
for (const [name, data] of Object.entries(files)) {
  await writeFile(new URL('dist/' + name, root), data);
}
await writeFile(new URL('quest-arc-compat.zip', root), zipSync(files));
console.log(
  'Built QuestArc ' + manifest.version + ' with the original plugin ID and assets',
);
