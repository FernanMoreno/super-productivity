import { readFile, readdir } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
const root = new URL('../', import.meta.url),
  src = new URL('src/', root);
const graph = new Map();
for (const name of await readdir(src)) {
  if (!name.endsWith('.mjs')) continue;
  const code = await readFile(new URL(name, src), 'utf8');
  const imports = [...code.matchAll(/from\s+['"]([^'"]+)['"]/g)].map((v) => v[1]);
  assert.ok(
    imports.every((v) => /^\.\/[\w.-]+\.mjs$/.test(v)),
    `Dependencia externa de ejecución: ${name}`,
  );
  graph.set(
    name,
    imports.map((v) => v.slice(2)),
  );
}
function acyclic(graph) {
  const done = new Set(),
    active = new Set();
  const visit = (n) => {
    if (active.has(n)) throw Error('Ciclo');
    if (done.has(n)) return;
    active.add(n);
    for (const d of graph.get(n) || []) visit(d);
    active.delete(n);
    done.add(n);
  };
  for (const n of graph.keys()) visit(n);
}
acyclic(graph);
assert.throws(
  () =>
    acyclic(
      new Map([
        ['a', ['b']],
        ['b', ['a']],
      ]),
    ),
  /Ciclo/,
);
assert.deepEqual(graph.get('model.mjs'), []);
assert.deepEqual(graph.get('schedule.mjs'), ['model.mjs']);
assert.ok(!graph.get('metrics.mjs').includes('adapter.mjs'));
const types = await readFile(
  new URL('../../../plugin-api/src/types.ts', import.meta.url),
  'utf8',
);
const iframe = await readFile(
  new URL('../../../../src/app/plugins/util/plugin-iframe.util.ts', import.meta.url),
  'utf8',
);
for (const method of [
  'getTasks',
  'getArchivedTasks',
  'getAllProjects',
  'getAllTags',
  'getAppState',
  'loadSyncedData',
  'persistDataSynced',
  'selectTask',
]) {
  assert.ok(types.includes(`${method}(`), `Método ausente en API: ${method}`);
  assert.ok(iframe.includes(`${method}:`), `Método ausente en iframe: ${method}`);
}
execFileSync('python3', [
  '-c',
  `import zipfile,json,sys
with zipfile.ZipFile(sys.argv[1]) as z:
 assert set(z.namelist())=={'manifest.json','index.html','LICENSE','NOTICE'}
 m=json.loads(z.read('manifest.json')); assert m['iFrame'] and m['id']=='personal-planner'
 h=z.read('index.html').decode(); assert '<html lang="es">' in h and 'BUILD:SCRIPT' not in h
 assert '<script src=' not in h and 'fetch(' not in h
 assert b'MIT' in z.read('LICENSE')`,
  new URL('dist/personal-planner.zip', root).pathname,
]);
console.log(
  'PASS arquitectura, detector de ciclos, contrato API/iframe y estructura pública del ZIP.',
);
