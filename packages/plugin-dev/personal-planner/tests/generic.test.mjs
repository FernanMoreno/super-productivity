import test from 'node:test';
import assert from 'node:assert/strict';
import {
  emptyProfile,
  createArea,
  validateProfile,
  migrateProfile,
  areaGoalsOn,
  areaStateOn,
  setGoalsFrom,
  setStateFrom,
  editCommitment,
} from '../src/model.mjs';
import { availability, daySchedule, scenario } from '../src/schedule.mjs';
import { taskSnapshot } from '../src/metrics.mjs';
const block = (id, kind, fields = {}) => ({
  id,
  title: id,
  kind,
  date: '2027-02-01',
  weekdays: [],
  start: '09:00',
  end: '17:00',
  excludedDates: [],
  ...fields,
});
test('inicio vacío válido, actividades con ids estables y jerarquía general', () => {
  const p = emptyProfile();
  assert.equal(p.areas.length, 0);
  p.areas = [
    createArea('Lectura', 'a'),
    { ...createArea('Sección', 'b'), parentAreaId: 'a' },
  ];
  validateProfile(p);
  p.areas[0].name = 'Nuevo nombre';
  assert.equal(p.areas[0].id, 'a');
  p.areas[0].parentAreaId = 'b';
  assert.throws(() => validateProfile(p), /ciclo/i);
});
test('migración v1 conserva ids, asociaciones, objetivos y fechas sin imponer nombres', () => {
  const old = {
    ...emptyProfile(),
    schemaVersion: 1,
    areas: [
      {
        ...createArea('Actividad ficticia', 'stable'),
        dailyMinutes: 37,
        projectIds: ['p'],
      },
    ],
  };
  const p = migrateProfile(old);
  assert.equal(p.schemaVersion, 2);
  assert.equal(p.areas[0].id, 'stable');
  assert.equal(p.areas[0].dailyMinutes, 37);
  assert.deepEqual(p.areas[0].projectIds, ['p']);
  assert.equal(old.schemaVersion, 1);
  assert.throws(() => migrateProfile({ ...old, schemaVersion: 8 }), /versión/i);
});
test('objetivos y estados desde fecha preservan pasado', () => {
  let a = { ...createArea('General', 'a'), dailyMinutes: 30 };
  a = setGoalsFrom(
    a,
    { dailyMinutes: 50, weeklyMinutes: null, targetHours: null },
    '2027-02-02',
  );
  assert.equal(areaGoalsOn(a, '2027-02-01').dailyMinutes, 30);
  assert.equal(areaGoalsOn(a, '2027-02-02').dailyMinutes, 50);
  a = setStateFrom(a, 'paused', '2027-02-03');
  assert.equal(areaStateOn(a, '2027-02-02'), 'active');
  assert.equal(areaStateOn(a, '2027-02-03'), 'paused');
});
test('editar ocurrencia no cambia próximas semanas; futuras conserva pasado y excepciones', () => {
  let p = emptyProfile();
  p.commitments = [
    block('series', 'busy', {
      date: '',
      weekdays: [1],
      startDate: '2027-01-01',
      excludedDates: ['2027-02-15'],
    }),
  ];
  const q = editCommitment(
    p,
    'series',
    { start: '10:00', end: '11:00' },
    { scope: 'occurrence', date: '2027-02-01' },
  );
  assert.equal(daySchedule(q, '2027-02-01').events[0].start, '10:00');
  assert.equal(daySchedule(q, '2027-02-08').events[0].start, '09:00');
  assert.equal(p.commitments[0].excludedDates.length, 1);
  const r = editCommitment(
    p,
    'series',
    { start: '12:00', end: '13:00' },
    { scope: 'future', date: '2027-02-08' },
  );
  assert.equal(daySchedule(r, '2027-02-01').events[0].start, '09:00');
  assert.equal(daySchedule(r, '2027-02-08').events[0].start, '12:00');
  assert.equal(daySchedule(r, '2027-02-15').events.length, 0);
});
test('vacaciones laborales suspenden jornada y liberan capacidad personal; ausencia ambos bloquea', () => {
  const p = emptyProfile();
  p.commitments = [
    block('work', 'work'),
    block('holiday', 'absence', { scope: 'work', allDay: true }),
  ];
  assert.equal(availability(p, '2027-02-01').workMinutes, 0);
  assert.equal(availability(p, '2027-02-01').personalMinutes, 1440);
  p.commitments[1].scope = 'all';
  assert.equal(availability(p, '2027-02-01').personalMinutes, 0);
});
test('ventanas disponibles no ocupan ni generan conflictos; flexible no resta capacidad', () => {
  const p = emptyProfile();
  p.commitments = [
    block('window', 'available', { scope: 'personal', start: '18:00', end: '20:00' }),
    block('flex', 'flexible', {
      start: '18:00',
      end: '20:00',
      durationMinutes: 45,
      scope: 'personal',
    }),
  ];
  const a = availability(p, '2027-02-01');
  assert.equal(a.personalMinutes, 120);
  assert.equal(a.conflicts.length, 0);
  const s = scenario(p, taskSnapshot([], []), '2027-02-01');
  assert.equal(s.personalLoad, 45);
  assert.ok(s.proposals.some((v) => v.title === 'flex' && v.interval));
});
test('actividad pausada no genera demanda nueva, conserva métricas históricas', () => {
  const p = emptyProfile();
  p.areas = [{ ...createArea('Pausada', 'a'), state: 'paused', dailyMinutes: 60 }];
  assert.equal(scenario(p, taskSnapshot([], []), '2027-02-01').personalLoad, 0);
});
test('editar futuras permite quitar final y cambiar excepciones', () => {
  const p = emptyProfile();
  p.commitments = [
    block('s', 'busy', {
      date: '',
      weekdays: [1],
      startDate: '2027-01-01',
      endDate: '2027-03-31',
      excludedDates: ['2027-02-15'],
    }),
  ];
  const q = editCommitment(
    p,
    's',
    { endDate: null, excludedDates: ['2027-02-08'] },
    { scope: 'future', date: '2027-02-01' },
  );
  const successor = q.commitments.find((c) => c.id !== 's');
  assert.equal(successor.endDate, null);
  assert.deepEqual(successor.excludedDates, ['2027-02-08']);
  assert.equal(q.commitments[0].endDate, '2027-01-31');
});
test('completitud manual futura no elimina demanda de fechas anteriores', async () => {
  const { setCompletionFrom } = await import('../src/model.mjs');
  const p = emptyProfile();
  p.areas = [
    setCompletionFrom(
      { ...createArea('Curso ficticio', 'a'), dailyMinutes: 30 },
      'completed',
      '2027-02-02',
    ),
  ];
  assert.equal(scenario(p, taskSnapshot([], []), '2027-02-01').personalLoad, 30);
  assert.equal(scenario(p, taskSnapshot([], []), '2027-02-02').personalLoad, 0);
});
