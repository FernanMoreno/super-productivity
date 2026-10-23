import { readFile, mkdir, writeFile, copyFile } from 'node:fs/promises';
import { stripTypeScriptTypes } from 'node:module';
const root = new URL('../', import.meta.url);
const dist = new URL('dist/', root);
await mkdir(dist, { recursive: true });
const source = await readFile(new URL('src/plugin.ts', root), 'utf8');
await writeFile(
  new URL('plugin.js', dist),
  stripTypeScriptTypes(source, { mode: 'transform' }),
);
const manifest = JSON.parse(await readFile(new URL('src/manifest.json', root), 'utf8'));
manifest.version = JSON.parse(
  await readFile(new URL('package.json', root), 'utf8'),
).version;
manifest.name = 'Obsidian (compatibility fixes)';
await writeFile(new URL('manifest.json', dist), JSON.stringify(manifest, null, 2) + '\n');
await copyFile(new URL('src/icon.svg', root), new URL('icon.svg', dist));
await copyFile(new URL('LICENSE', root), new URL('LICENSE', dist));
await copyFile(new URL('README.md', root), new URL('README.md', dist));

// ZIP's uncompressed format needs no packaging dependency. All files live at
// archive root, as required by the native plugin installer.
function crc32(data) {
  let value = 0xffffffff;
  for (const byte of data) {
    value ^= byte;
    for (let bit = 0; bit < 8; bit++)
      value = (value >>> 1) ^ (value & 1 ? 0xedb88320 : 0);
  }
  return (value ^ 0xffffffff) >>> 0;
}
const chunks = [];
const directory = [];
let offset = 0;
const names = ['manifest.json', 'plugin.js', 'icon.svg', 'LICENSE', 'README.md'];
for (const filename of names) {
  const name = Buffer.from(filename);
  const data = await readFile(new URL(filename, dist));
  const checksum = crc32(data);
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(20, 4);
  local.writeUInt32LE(checksum, 14);
  local.writeUInt32LE(data.length, 18);
  local.writeUInt32LE(data.length, 22);
  local.writeUInt16LE(name.length, 26);
  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(20, 4);
  central.writeUInt16LE(20, 6);
  central.writeUInt32LE(checksum, 16);
  central.writeUInt32LE(data.length, 20);
  central.writeUInt32LE(data.length, 24);
  central.writeUInt16LE(name.length, 28);
  central.writeUInt32LE(offset, 42);
  chunks.push(local, name, data);
  directory.push(central, name);
  offset += local.length + name.length + data.length;
}
const centralData = Buffer.concat(directory);
const end = Buffer.alloc(22);
end.writeUInt32LE(0x06054b50, 0);
end.writeUInt16LE(names.length, 8);
end.writeUInt16LE(names.length, 10);
end.writeUInt32LE(centralData.length, 12);
end.writeUInt32LE(offset, 16);
await writeFile(
  new URL('obsidian-issue-provider-compat.zip', root),
  Buffer.concat([...chunks, centralData, end]),
);
console.log('Built dist/ and obsidian-issue-provider-compat.zip');
