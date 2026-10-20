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
  let stored = null;
  return {
    getTasks: async () => [],
    getArchivedTasks: async () => [],
    getAllProjects: async () => [],
    getAllTags: async () => [],
    getAppState: async () => ({
      globalConfig: { misc: { startOfNextDayTime: '00:00' } },
    }),
    loadSyncedData: async () => stored,
    persistDataSynced: async (v) => {
      stored = v;
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
  a.persistDataSynced = async () => {
    calls++;
    throw Error('denied');
  };
  const b = createAdapter(a);
  await assert.rejects(b.save(emptyProfile()), /guardar/);
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
