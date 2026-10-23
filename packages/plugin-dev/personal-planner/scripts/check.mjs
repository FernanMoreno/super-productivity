import { readFile, readdir } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
const root = new URL('../', import.meta.url),
  src = new URL('src/', root);
const core = new URL('../../../personal-planner-core/', src);
assert.ok(
  /\b(?:window|document|localStorage|PluginAPI)\s*(?:\.|\[)/.test(
    'document.createElement("div")',
  ),
  'Detector de acceso al navegador no funciona.',
);
const graph = new Map();
const visitModule = async (url) => {
  const key = url.href;
  if (graph.has(key)) return;
  assert.ok(
    key.startsWith(src.href) || key.startsWith(core.href),
    'Import fuera de plugin y núcleo compartido.',
  );
  const code = await readFile(url, 'utf8');
  const imports = [...code.matchAll(/from\s+['"]([^'"]+)['"]/g)].map((v) => v[1]);
  assert.ok(
    imports.every((v) => v.startsWith('.') && v.endsWith('.mjs')),
    `Dependencia externa de ejecución: ${url.pathname}`,
  );
  const targets = imports.map((v) => new URL(v, url));
  if (key.startsWith(core.href)) {
    assert.ok(
      targets.every((v) => v.href.startsWith(core.href)),
      'El núcleo no puede depender del plugin o adaptador.',
    );
    assert.ok(
      !/\b(?:window|document|localStorage|PluginAPI)\s*(?:\.|\[)/.test(code),
      'El núcleo debe ser independiente del navegador/anfitrión.',
    );
  }
  graph.set(
    key,
    targets.map((v) => v.href),
  );
  for (const target of targets) await visitModule(target);
};
for (const name of await readdir(src))
  if (name.endsWith('.mjs')) await visitModule(new URL(name, src));
for (const name of ['model', 'metrics', 'schedule']) {
  const code = (await readFile(new URL(name + '.mjs', src), 'utf8')).trim();
  assert.equal(
    code,
    `export * from '../../../personal-planner-core/${name}.mjs';`,
    'El plugin debe reutilizar el núcleo, sin copiar algoritmos.',
  );
}
assert.ok(
  graph.has(new URL('operations.mjs', core).href),
  'Operaciones compartidas no conectadas al plugin.',
);
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
assert.deepEqual(graph.get(new URL('model.mjs', core).href), []);
assert.ok(
  !graph.get(new URL('metrics.mjs', core).href).some((v) => v.endsWith('/adapter.mjs')),
);
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
  'compareAndSwapSyncedData',
  'plannerOperation',
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
 assert 'compareAndSwapSyncedData' in m['permissions'] and 'persistedDataChanged' in m['hooks']
 h=z.read('index.html').decode(); assert '<html lang="es">' in h and 'BUILD:SCRIPT' not in h
 assert '<script src=' not in h and 'fetch(' not in h
 assert b'MIT' in z.read('LICENSE')`,
  new URL('dist/personal-planner.zip', root).pathname,
]);
console.log(
  'PASS arquitectura, detector de ciclos, contrato API/iframe y estructura pública del ZIP.',
);
