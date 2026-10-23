import test from 'node:test';
import assert from 'node:assert/strict';
import {
  emptyProfile as blankProfile,
  createArea,
  validateProfile,
} from '../src/model.mjs';
import {
  localDay,
  addDays,
  weekDays,
  instant,
  daySchedule,
  union,
  availability,
  scenario,
} from '../src/schedule.mjs';
import { taskSnapshot, areaMetrics, scheduledDay } from '../src/metrics.mjs';
const emptyProfile = () => {
  const p = blankProfile();
  p.areas = [
    ['learning', 'Aprendizaje ficticio'],
    ['curriculum', 'Formación ficticia'],
    ['language', 'Idioma ficticio'],
    ['project', 'Proyecto ficticio'],
  ].map(([id, name]) => createArea(name, id));
  p.areas[0].workTime = true;
  return p;
};
const ms = (m) => m * 60000;
const task = (id, fields = {}) => ({
  id,
  title: id,
  timeEstimate: 0,
  timeSpent: 0,
  isDone: false,
  projectId: 'p',
  tagIds: [],
  subTaskIds: [],
  timeSpentOnDay: {},
  ...fields,
});
const event = (id, start, end, kind = 'busy', fields = {}) => ({
  id,
  title: id,
  start,
  end,
  kind,
  weekdays: [1, 2, 3, 4, 5],
  excludedDates: [],
  ...fields,
});

test('unión usa intervalos semiabiertos y no duplica ocupación', () => {
  assert.deepEqual(
    union([
      [0, 60],
      [30, 90],
      [90, 100],
    ]),
    [[0, 100]],
  );
});
test('solapamiento real y contigüidad se distinguen con datos ficticios', () => {
  const p = emptyProfile();
  p.commitments = [event('a', '09:00', '12:00'), event('b', '11:30', '13:00')];
  let d = daySchedule(p, '2027-02-03');
  assert.equal(d.conflicts[0].minutes, 30);
  p.commitments[1].start = '12:00';
  d = daySchedule(p, '2027-02-03');
  assert.equal(d.conflicts.length, 0);
  assert.equal(d.transitions.length, 1);
});
test('formación laboral no vuelve a restar capacidad personal', () => {
  const p = emptyProfile();
  p.commitments = [event('work', '08:00', '16:00', 'work')];
  const before = availability(p, '2027-02-01');
  p.commitments.push(event('study', '10:00', '11:00', 'study', { areaId: 'learning' }));
  const after = availability(p, '2027-02-01');
  assert.equal(after.personalMinutes, before.personalMinutes);
  assert.equal(after.workMinutes, before.workMinutes - 60);
  assert.equal(after.conflicts.length, 0);
});
test('fechas Madrid, lunes y días DST de 23/25 horas', () => {
  assert.equal(localDay(Date.parse('2027-01-10T23:30:00Z')), '2027-01-11');
  assert.equal(weekDays('2027-01-10')[0], '2027-01-04');
  assert.equal(addDays('2027-03-28', 1), '2027-03-29');
  assert.equal(availability(emptyProfile(), '2027-03-28').personalMinutes, 1380);
  assert.equal(availability(emptyProfile(), '2027-10-31').personalMinutes, 1500);
  assert.throws(() => instant('2027-03-28', '02:30'), /inexistente/);
  assert.throws(() => instant('2027-10-31', '02:30'), /ambigua/);
});
test('eventos nocturnos, excepciones y exclusiones de formación', () => {
  const p = emptyProfile();
  p.commitments = [
    event('sleep', '23:00', '07:00', 'sleep', { weekdays: [0, 1, 2, 3, 4, 5, 6] }),
  ];
  assert.equal(availability(p, '2027-02-02').personalMinutes, 16 * 60);
  p.commitments[0].excludedDates = ['2027-02-01'];
  assert.equal(availability(p, '2027-02-02').personalMinutes, 23 * 60);
});
test('archivo, ids duplicados y padres agregados no duplican tiempos; herencia de etiquetas', () => {
  const parent = task('parent', {
    tagIds: ['en'],
    subTaskIds: ['child'],
    timeSpent: ms(30),
    timeSpentOnDay: { '2027-02-01': ms(30) },
  });
  const child = task('child', {
    parentId: 'parent',
    timeSpent: ms(30),
    timeSpentOnDay: { '2027-02-01': ms(30) },
  });
  const archived = task('archived', {
    tagIds: ['en'],
    timeSpent: ms(10),
    timeSpentOnDay: { '2027-02-01': ms(10) },
  });
  const s = taskSnapshot([parent, child], [child, archived]);
  assert.equal(s.leaves.length, 2);
  const m = areaMetrics(s, { projectIds: [], tagIds: ['en'] }, '2027-02-01');
  assert.equal(m.totalMinutes, 40);
  assert.equal(m.dailyMinutes, 40);
});
test('registro del domingo no satisface objetivo de otro día', () => {
  const s = taskSnapshot(
    [task('t', { timeSpent: ms(240), timeSpentOnDay: { '2027-02-07': ms(240) } })],
    [],
  );
  const a = { projectIds: ['p'], tagIds: [] };
  assert.equal(areaMetrics(s, a, '2027-02-01').dailyMinutes, 0);
  assert.equal(areaMetrics(s, a, '2027-02-07').dailyMinutes, 240);
});
test('hijos ausentes y registros sin desglose indican incertidumbre', () => {
  const s = taskSnapshot([task('p', { subTaskIds: ['missing'], timeSpent: ms(12) })], []);
  assert.ok(s.warnings.length);
  assert.equal(
    areaMetrics(s, { projectIds: ['p'], tagIds: [] }, '2027-02-01').dailyMinutes,
    null,
  );
});
test('fecha prevista usa dueDay/dueWithTime y hereda padre; TODAY no es etiqueta', () => {
  const s = taskSnapshot(
    [
      task('p', { dueDay: '2027-02-01', subTaskIds: ['c'] }),
      task('c', { parentId: 'p' }),
    ],
    [],
  );
  assert.equal(scheduledDay(s.leaves[0], s), '2027-02-01');
});
test('extra se añade/quita y recalcula, conserva objetivos; no modifica perfil', () => {
  const p = emptyProfile();
  p.areas.find((a) => a.id === 'language').dailyMinutes = 45;
  p.commitments = [
    event('busy', '01:00', '23:00', 'busy', { date: '2027-02-06', weekdays: [] }),
  ];
  const s = taskSnapshot([], []);
  const before = scenario(p, s, '2027-02-06');
  const extra = event('extra', '00:00', '01:00', 'extra', {
    date: '2027-02-06',
    weekdays: [],
  });
  const after = scenario(
    { ...p, commitments: [...p.commitments, extra] },
    s,
    '2027-02-06',
  );
  assert.equal(after.capacity.personalMinutes, before.capacity.personalMinutes - 60);
  assert.equal(after.personalLoad, 45);
  assert.equal(p.commitments.length, 1);
});
test('perfil valida rangos, versión, fechas y referencias antes de persistir', () => {
  assert.doesNotThrow(() => validateProfile(emptyProfile()));
  assert.throws(
    () => validateProfile({ ...emptyProfile(), schemaVersion: 99 }),
    /versión/i,
  );
  const p = emptyProfile();
  p.areas[0].dailyMinutes = -1;
  assert.throws(() => validateProfile(p), /objetivo/i);
  p.areas[0].dailyMinutes = null;
  p.commitments = [event('bad', '25:00', '10:00')];
  assert.throws(() => validateProfile(p), /hora/i);
});
test('bloque de estudio cubre carga del área sin duplicarla como exceso', () => {
  const p = emptyProfile();
  p.commitments = [
    event('work', '08:00', '16:00', 'work'),
    event('course', '08:00', '16:00', 'study', { areaId: 'learning' }),
  ];
  p.areas[0].projectIds = ['p'];
  const s = taskSnapshot(
    [task('lesson', { dueDay: '2027-02-01', timeEstimate: ms(90) })],
    [],
  );
  const result = scenario(p, s, '2027-02-01');
  assert.equal(result.workExcess, 0);
  assert.equal(result.personalLoad, 0);
});
test('propuestas no alteran intervalos de capacidad ni coinciden con tareas con hora', () => {
  const p = emptyProfile();
  p.areas.find((a) => a.id === 'language').dailyMinutes = 30;
  const s = taskSnapshot(
    [
      task('timed', {
        dueWithTime: instant('2027-02-01', '00:00'),
        timeEstimate: ms(60),
      }),
    ],
    [],
  );
  const r = scenario(p, s, '2027-02-01');
  assert.equal(r.capacity.personalFree[0][0], instant('2027-02-01'));
  assert.ok(r.proposals[0].interval[0] >= instant('2027-02-01', '01:00'));
});
test('datos de tiempo inconsistentes no inventan un objetivo diario cumplido', () => {
  const s = taskSnapshot(
    [task('inconsistent', { timeSpent: ms(60), timeSpentOnDay: {} })],
    [],
  );
  assert.equal(
    areaMetrics(s, { projectIds: ['p'], tagIds: [] }, '2027-02-01').dailyMinutes,
    null,
  );
});
test('trabajo extra que ocupa bloque de estudio deja su carga sin cubrir', () => {
  const p = emptyProfile();
  p.areas[0].projectIds = ['p'];
  p.commitments = [
    event('work', '08:00', '16:00', 'work'),
    event('study', '08:00', '16:00', 'study', { areaId: 'learning' }),
    event('extra', '08:00', '16:00', 'extra'),
  ];
  const s = taskSnapshot(
    [task('lesson', { dueDay: '2027-02-01', timeEstimate: ms(90) })],
    [],
  );
  const r = scenario(p, s, '2027-02-01');
  assert.equal(r.workExcess, 90);
  assert.equal(r.potentiallyAffected.length, 1);
});
test('carga de subtarea hereda fecha del padre con hora', () => {
  const p = emptyProfile();
  const s = taskSnapshot(
    [
      task('parent', {
        dueWithTime: instant('2027-02-01', '10:00'),
        subTaskIds: ['child'],
      }),
      task('child', { parentId: 'parent', timeEstimate: ms(35) }),
    ],
    [],
  );
  assert.equal(scenario(p, s, '2027-02-01').personalLoad, 35);
});
test('exclusión de formación conserva jornada laboral', () => {
  const p = emptyProfile();
  p.commitments = [
    event('work', '08:00', '16:00', 'work'),
    event('course', '10:00', '11:00', 'study', { areaId: 'learning' }),
  ];
  p.trainingExclusions = [{ areaId: 'learning', start: '2027-02-01', end: '2027-02-02' }];
  assert.equal(availability(p, '2027-02-01').workMinutes, 480);
  assert.equal(availability(p, '2027-02-03').workMinutes, 420);
});
test('dos objetivos se proponen en huecos distintos sin modificar compromisos', () => {
  const p = emptyProfile();
  p.areas.find((a) => a.id === 'language').dailyMinutes = 45;
  p.areas.find((a) => a.id === 'project').dailyMinutes = 15;
  const s = taskSnapshot([], []);
  const r = scenario(p, s, '2027-02-01');
  assert.equal(r.proposals.length, 2);
  assert.ok(r.proposals[1].interval[0] >= r.proposals[0].interval[1]);
  assert.equal(p.commitments.length, 0);
});
test('bloque ya reservado para objetivo no genera propuesta adicional', () => {
  const p = emptyProfile();
  p.areas.find((a) => a.id === 'language').dailyMinutes = 45;
  p.commitments = [event('study', '09:00', '09:45', 'study', { areaId: 'language' })];
  assert.equal(scenario(p, taskSnapshot([], []), '2027-02-01').proposals.length, 0);
});
