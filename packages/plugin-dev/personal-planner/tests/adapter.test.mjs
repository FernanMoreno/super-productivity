import test from 'node:test';
import assert from 'node:assert/strict';
import { createAdapter } from '../src/adapter.mjs';
import { emptyProfile, createArea } from '../src/model.mjs';
import { areaMetrics } from '../src/metrics.mjs';

test('avisos informativos del archivo no invalidan días con datos conocidos', async () => {
  const snapshot = await createAdapter(api()).snapshot();
  assert.equal(
    areaMetrics(snapshot, { projectIds: [], tagIds: [] }, '2027-02-01').dailyMinutes,
    0,
  );
});
function api() {
  const stored = new Map();
  return {
    getTasks: async () => [],
    getArchivedTasks: async () => [],
    getAllProjects: async () => [],
    getAllTags: async () => [],
    getAppState: async () => ({
      globalConfig: { misc: { startOfNextDayTime: '00:00' } },
    }),
    loadSyncedData: async (key) => stored.get(key) ?? null,
    compareAndSwapSyncedData: async (expected, value, key) => {
      if ((stored.get(key) ?? null) !== expected) return false;
      stored.set(key, value);
      return true;
    },
    persistDataSynced: async () => {
      throw Error('Legacy writes must not be used');
    },
  };
}
test('persistencia usa string y carga al crear nuevo panel', async () => {
  const a = api(),
    first = createAdapter(a);
  const p = emptyProfile();
  p.areas.push({ ...createArea('Aprendizaje ficticio', 'example'), targetHours: 72 });
  await first.save(p);
  assert.equal((await createAdapter(a).load()).areas[0].targetHours, 72);
});
test('fallo de guardado no se anuncia como éxito y perfil inválido no escribe', async () => {
  const a = api();
  let calls = 0;
  a.compareAndSwapSyncedData = async () => {
    calls++;
    throw Error('denied');
  };
  const b = createAdapter(a);
  await assert.rejects(b.save(emptyProfile()), /guardar|confirmación/);
  await assert.rejects(b.save({ ...emptyProfile(), schemaVersion: 7 }), /Versión/);
  assert.equal(calls, 1);
});
test('fallo de tareas es explícito; archivo fallido conserva activos con aviso', async () => {
  const a = api();
  a.getTasks = async () => {
    throw Error('denied');
  };
  await assert.rejects(createAdapter(a).snapshot(), /tareas/);
  a.getTasks = async () => [];
  a.getArchivedTasks = async () => {
    throw Error('denied');
  };
  assert.ok(
    (await createAdapter(a).snapshot()).warnings.some((v) => v.includes('archivo')),
  );
});
test('carga corrupta no se sustituye por perfil vacío', async () => {
  const a = api();
  a.loadSyncedData = async () => '{';
  await assert.rejects(createAdapter(a).load(), /perfil/);
});
test('API ausente produce error de acceso comprensible', () => {
  assert.throws(() => createAdapter(undefined), /PluginAPI/);
});
test('archivo rechazado hace explícita la falta de desglose completo', async () => {
  const a = api();
  a.getArchivedTasks = async () => {
    throw Error('denied');
  };
  const s = await createAdapter(a).snapshot();
  assert.equal(
    areaMetrics(s, { projectIds: [], tagIds: [] }, '2027-02-01').dailyMinutes,
    null,
  );
});

test('CAS rechaza perfil obsoleto y recibos no reemplazan profile-v1', async () => {
  const native = api(),
    first = createAdapter(native),
    second = createAdapter(native);
  const a = await first.loadState(),
    b = await second.loadState();
  const candidate = emptyProfile();
  candidate.areas = [createArea('Actual', 'current')];
  await first.save(candidate, {
    baseRevision: a.revision,
    operationId: 'test_operation_one',
  });
  await assert.rejects(
    second.save(emptyProfile(), {
      baseRevision: b.revision,
      operationId: 'test_operation_two',
    }),
    (e) => e.code === 'STALE_DATA',
  );
  assert.equal((await first.load()).areas[0].name, 'Actual');
  assert.equal(
    JSON.parse(await native.loadSyncedData('op-test_operation_one')).result.status,
    'applied',
  );
});
test('repetir guardado con operationId devuelve mismo recibo sin segunda modificación', async () => {
  const native = api(),
    adapter = createAdapter(native),
    state = await adapter.loadState(),
    candidate = emptyProfile();
  const args = { baseRevision: state.revision, operationId: 'test_repeated_operation' };
  const first = await adapter.save(candidate, args),
    second = await adapter.save(candidate, args);
  assert.equal(first.status, 'applied');
  assert.equal(second.replayed, true);
});
test('anfitrión sin CAS no degrada a escritura no protegida', async () => {
  const native = api();
  delete native.compareAndSwapSyncedData;
  let writes = 0;
  native.persistDataSynced = () => {
    writes++;
  };
  await assert.rejects(
    createAdapter(native).save(emptyProfile()),
    /compareAndSwapSyncedData|actualiza|compatible/,
  );
  assert.equal(writes, 0);
});
test('hooks distinguen perfil externo de cambios nativos y no transmiten contenido', () => {
  const native = api(),
    handlers = new Map(),
    seen = [];
  native.registerHook = (name, handler) => handlers.set(name, handler);
  createAdapter(native).watch((value) => seen.push(value));
  handlers.get('persistedDataChanged')();
  handlers.get('anyTaskUpdate')({ title: 'Contenido ficticio' });
  handlers.get('currentTaskChange')();
  handlers.get('projectListUpdate')();
  assert.deepEqual(seen, [false, true, true, true]);
});
