import { build } from 'esbuild';
import { readFile, writeFile, mkdir, copyFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
const dist = new URL('../dist/', import.meta.url);
await mkdir(dist, { recursive: true });
const result = await build({
  entryPoints: [`${root}src/app.mjs`],
  bundle: true,
  format: 'iife',
  target: 'es2022',
  minify: true,
  write: false,
});
const template = await readFile(`${root}src/index.html`, 'utf8');
const styles = (
  await Promise.all(
    ['workspace.css', 'workflow.css'].map((file) =>
      readFile(`${root}src/${file}`, 'utf8'),
    ),
  )
).join('\n');
const script = result.outputFiles[0].text.replace(/<\/script/gi, '<\\/script');
await writeFile(
  new URL('index.html', dist),
  template
    .replace('<!-- BUILD:STYLES -->', () => `<style>${styles}</style>`)
    .replace('<!-- BUILD:SCRIPT -->', () => `<script>${script}</script>`),
);
await mkdir(new URL('i18n/', dist), { recursive: true });
for (const file of ['manifest.json', 'i18n/en.json', 'i18n/es.json'])
  await copyFile(`${root}src/${file}`, new URL(file, dist));
await copyFile(new URL('../../../../LICENSE', import.meta.url), new URL('LICENSE', dist));
await writeFile(
  new URL('NOTICE', dist),
  'Mi planificación es una adaptación mediante plugin de Super Productivity. Proyecto original: https://github.com/super-productivity/super-productivity. Licencia MIT; se conserva LICENSE original.\n',
);
// Explicit public file allowlist. No profile, task data, local paths or fixtures can enter the ZIP.
execFileSync(process.platform === 'win32' ? 'python' : 'python3', [
  '-c',
  `import zipfile,pathlib,sys
p=pathlib.Path(sys.argv[1])
with zipfile.ZipFile(p/'personal-planner.zip','w',compression=zipfile.ZIP_DEFLATED) as z:
 for name in ['manifest.json','index.html','LICENSE','NOTICE','i18n/en.json','i18n/es.json']:
  info=zipfile.ZipInfo(name,date_time=(2026,1,1,0,0,0));info.compress_type=zipfile.ZIP_DEFLATED;info.external_attr=0o644 << 16
  z.writestr(info,(p/name).read_bytes())`,
  fileURLToPath(dist),
]);
console.log('ZIP creado: dist/personal-planner.zip');
