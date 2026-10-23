import test from 'node:test';
import assert from 'node:assert/strict';
import { emptyProfile, createArea, setStateFrom, setGoalsFrom } from '../src/model.mjs';
import {
  availability,
  daySchedule,
  scenario,
  instant,
  localDay,
  weekDays,
  proposeActivitiesWeek,
} from '../src/schedule.mjs';
import { taskSnapshot } from '../src/metrics.mjs';
const day = '2027-02-01';
const block = (id, kind, extra = {}) => ({
  id,
  title: id,
  kind,
  date: day,
  weekdays: [],
  start: '09:00',
  end: '17:00',
  excludedDates: [],
  ...extra,
});
const snap = () => taskSnapshot([], []);
test('zona y primer día de semana configurables; DST y errores explícitos', () => {
  assert.equal(
    localDay(Date.parse('2027-02-01T01:00:00Z'), 'America/New_York'),
    '2027-01-31',
  );
  assert.equal(
    instant(day, '09:00', 'America/New_York'),
    Date.parse('2027-02-01T14:00:00Z'),
  );
  assert.equal(weekDays('2027-02-03', 0)[0], '2027-01-31');
  for (const [date, hours] of [
    ['2027-03-28', 23],
    ['2027-10-31', 25],
  ])
    assert.equal(
      (instant(
        new Date(Date.parse(date + 'T12:00Z') + 86400000).toISOString().slice(0, 10),
      ) -
        instant(date)) /
        3600000,
      hours,
    );
  assert.throws(() => instant('2027-03-28', '02:30'), /inexistente/);
  assert.throws(() => instant('2027-10-31', '02:30'), /ambigua/);
});
test('vigencia inclusiva, exclusiones, estado histórico y bloques nocturnos', () => {
  const p = emptyProfile();
  p.areas = [setStateFrom(createArea('Ejemplo', 'a'), 'paused', '2027-02-08')];
  p.commitments = [
    block('r', 'busy', {
      date: '',
      weekdays: [1],
      startDate: day,
      endDate: '2027-02-15',
      areaId: 'a',
      start: '23:00',
      end: '01:00',
    }),
  ];
  assert.equal(daySchedule(p, '2027-01-25').events.length, 0);
  assert.equal(daySchedule(p, day).events.length, 1);
  assert.equal(
    daySchedule(p, '2027-02-02').events[0].to - daySchedule(p, '2027-02-02').start,
    3600000,
  );
  assert.equal(daySchedule(p, '2027-02-08').events.length, 0);
  p.areas[0].stateHistory = [];
  assert.equal(daySchedule(p, '2027-02-15').events.length, 1);
  assert.equal(daySchedule(p, '2027-02-22').events.length, 0);
  p.commitments[0].excludedDates = [day];
  assert.equal(daySchedule(p, day).events.length, 0);
});
test('vacaciones por ámbito, disponibilidad laboral y personal no se mezclan', () => {
  const p = emptyProfile();
  p.commitments = [
    block('work', 'work'),
    block('available', 'available', { scope: 'work', start: '10:00', end: '12:00' }),
    block('personal', 'available', { scope: 'personal', start: '18:00', end: '20:00' }),
  ];
  assert.equal(availability(p, day).workMinutes, 120);
  assert.equal(availability(p, day).personalMinutes, 120);
  assert.equal(daySchedule(p, day).conflicts.length, 0);
  p.commitments.push(block('holiday', 'absence', { scope: 'work', allDay: true }));
  assert.equal(availability(p, day).workMinutes, 0);
  assert.equal(availability(p, day).personalMinutes, 120);
  p.commitments.at(-1).scope = 'all';
  assert.equal(availability(p, day).personalMinutes, 0);
});
test('objetivos históricos, pausas y completadas no generan demanda', () => {
  const p = emptyProfile();
  p.areas = [
    setGoalsFrom(
      { ...createArea('Ejemplo', 'a'), dailyMinutes: 30 },
      { dailyMinutes: 70, weeklyMinutes: null, targetHours: null },
      '2027-02-02',
    ),
  ];
  assert.equal(scenario(p, snap(), day).personalLoad, 30);
  assert.equal(scenario(p, snap(), '2027-02-02').personalLoad, 70);
  p.areas[0] = setStateFrom(p.areas[0], 'paused', '2027-02-03');
  assert.equal(scenario(p, snap(), '2027-02-03').personalLoad, 0);
  p.areas[0].status = 'completed';
  assert.equal(scenario(p, snap(), day).personalLoad, 0);
});
test('flexible usa ventana y reserva propuestas sin ocupar capacidad', () => {
  const p = emptyProfile();
  p.commitments = [
    block('avail', 'available', { scope: 'personal', start: '18:00', end: '20:00' }),
    block('flex', 'flexible', {
      scope: 'personal',
      start: '19:00',
      end: '20:00',
      durationMinutes: 45,
    }),
  ];
  p.areas = [
    {
      ...createArea('Lectura', 'a'),
      dailyMinutes: 30,
      earliest: '18:00',
      latest: '20:00',
    },
  ];
  const s = scenario(p, snap(), day);
  assert.equal(s.personalLoad, 75);
  assert.equal(s.capacity.personalMinutes, 120);
  const f = s.proposals.find((v) => v.title === 'flex');
  assert.equal(f.interval[0], instant(day, '19:00'));
  const a = s.proposals.find((v) => v.areaId === 'a');
  assert.ok(a.interval[1] <= f.interval[0] || a.interval[0] >= f.interval[1]);
});
test('estimación semanal una vez, prioridad, límites y tareas nativas evitan duplicación', () => {
  const p = emptyProfile();
  p.areas = [
    { ...createArea('Baja', 'b'), estimateMinutes: 60, priority: 5 },
    {
      ...createArea('Alta', 'a'),
      estimateMinutes: 60,
      priority: 1,
      allowedWeekdays: [2],
      earliest: '19:00',
      latest: '20:00',
      dueDate: '2027-02-02',
    },
  ];
  p.commitments = [
    block('avail', 'available', {
      date: '',
      weekdays: [1, 2, 3, 4, 5, 6, 0],
      scope: 'personal',
      start: '19:00',
      end: '20:00',
    }),
  ];
  const result = proposeActivitiesWeek(p, snap(), weekDays(day));
  assert.equal(result.length, 2);
  assert.equal(result[0].areaId, 'a');
  assert.equal(result[0].date, '2027-02-02');
  assert.equal(result.filter((v) => v.areaId === 'b').length, 1);
  assert.ok(result[0].interval);
  assert.notEqual(result[1].date, result[0].date);
  p.areas[0].projectIds = ['native'];
  const tasks = taskSnapshot(
    [
      {
        id: 't',
        title: 'Tarea',
        projectId: 'native',
        tagIds: [],
        subTaskIds: [],
        timeEstimate: 3600000,
        timeSpent: 0,
        isDone: false,
      },
    ],
    [],
  );
  assert.equal(
    proposeActivitiesWeek(p, tasks, weekDays(day)).some((v) => v.areaId === 'b'),
    false,
  );
});
test('estimación planificada cuenta ese día sin duplicar objetivo y respeta tareas con hora', () => {
  const p = emptyProfile();
  p.areas = [
    {
      ...createArea('Ejemplo', 'a'),
      plannedDate: day,
      estimateMinutes: 60,
      dailyMinutes: 30,
      earliest: '18:00',
      latest: '20:00',
    },
  ];
  p.commitments = [
    block('avail', 'available', { scope: 'personal', start: '18:00', end: '20:00' }),
  ];
  const tasks = taskSnapshot(
    [
      {
        id: 't',
        title: 'Otra',
        projectId: 'x',
        tagIds: [],
        subTaskIds: [],
        timeEstimate: 3600000,
        timeSpent: 0,
        isDone: false,
        dueWithTime: instant(day, '18:00'),
      },
    ],
    [],
  );
  const s = scenario(p, tasks, day);
  assert.equal(s.personalLoad, 120);
  const proposal = s.proposals.find((v) => v.areaId === 'a');
  assert.equal(proposal.minutes, 60);
  assert.equal(proposal.interval[0], instant(day, '19:00'));
  assert.equal(scenario(p, snap(), '2027-02-02').personalLoad, 30);
});
test('ventana semanal no convierte días sin disponibilidad en días enteros libres', () => {
  const p = emptyProfile();
  p.commitments = [
    block('window', 'available', {
      date: '',
      weekdays: [1],
      scope: 'personal',
      start: '18:00',
      end: '20:00',
      startDate: day,
      endDate: '2027-02-07',
    }),
  ];
  assert.equal(availability(p, '2027-02-02').personalMinutes, 0);
  assert.equal(availability(p, '2027-02-08').personalMinutes, 1440);
  p.commitments[0].excludedDates = [day];
  assert.equal(availability(p, day).personalMinutes, 0);
});
test('flexible nocturna demanda solo día de inicio', () => {
  const p = emptyProfile();
  p.commitments = [
    block('night', 'flexible', { start: '23:00', end: '01:00', durationMinutes: 30 }),
  ];
  assert.equal(scenario(p, snap(), day).personalLoad, 30);
  assert.equal(scenario(p, snap(), '2027-02-02').personalLoad, 0);
});
test('reservas laborales, extras, objetivos y tareas conservan fuente única y no mutan datos', () => {
  const p = emptyProfile();
  p.areas = [
    {
      ...createArea('Aprendizaje', 'a'),
      projectIds: ['p'],
      workTime: true,
      dailyMinutes: 120,
    },
  ];
  p.commitments = [
    block('work', 'work'),
    block('study', 'study', { areaId: 'a', start: '09:00', end: '11:00' }),
  ];
  const tasks = taskSnapshot(
    [
      {
        id: 't',
        title: 'Tarea',
        projectId: 'p',
        tagIds: [],
        subTaskIds: [],
        timeEstimate: 7200000,
        timeSpent: 0,
        isDone: false,
        dueDay: day,
      },
    ],
    [],
  );
  const before = structuredClone(p);
  let s = scenario(p, tasks, day);
  assert.equal(s.workLoad, 0);
  assert.equal(s.workExcess, 0);
  assert.equal(s.capacity.personalMinutes, 960);
  assert.equal(s.capacity.conflicts.length, 0);
  assert.equal(s.proposals.length, 0);
  p.commitments.push(block('extra', 'extra', { start: '09:00', end: '10:00' }));
  s = scenario(p, tasks, day);
  assert.equal(s.workLoad, 60);
  assert.equal(s.potentiallyAffected.length, 1);
  assert.equal(s.capacity.workMinutes, 360);
  p.commitments.pop();
  assert.deepEqual(p, before);
  assert.equal(scenario(p, tasks, day).workLoad, 0);
});
test('conflictos, contigüidad, error DST e imposibilidad de propuesta visibles', () => {
  const p = emptyProfile();
  p.commitments = [
    block('first', 'busy', { start: '18:00', end: '19:00' }),
    block('second', 'busy', { start: '18:30', end: '20:00' }),
    block('third', 'busy', { start: '20:00', end: '21:00' }),
  ];
  const d = daySchedule(p, day);
  assert.equal(d.conflicts[0].minutes, 30);
  assert.equal(d.transitions.length, 1);
  p.commitments = [
    block('invalid', 'busy', { date: '2027-03-28', start: '02:30', end: '04:00' }),
  ];
  assert.match(daySchedule(p, '2027-03-28').warnings[0], /inexistente/);
  p.areas = [
    {
      ...createArea('Sin hueco', 'a'),
      dailyMinutes: 60,
      earliest: '20:00',
      latest: '19:00',
      estimateMinutes: 120,
    },
  ];
  assert.equal(scenario(p, snap(), day).proposals[0].interval, null);
  assert.equal(proposeActivitiesWeek(p, snap(), [day])[0].interval, null);
});
test('tarea con hora y zona propia detecta conflicto e ignora etiquetas archivadas para carga', () => {
  const p = emptyProfile();
  p.timezone = 'America/New_York';
  p.commitments = [block('meeting', 'busy', { start: '18:00', end: '19:00' })];
  const t = {
    id: 'parent',
    title: 'Principal',
    projectId: 'p',
    tagIds: [],
    subTaskIds: ['child'],
    timeEstimate: 3600000,
    timeSpent: 0,
    isDone: false,
    dueWithTime: instant(day, '18:00', p.timezone),
  };
  const child = {
    ...t,
    id: 'child',
    parentId: 'parent',
    subTaskIds: [],
    dueWithTime: null,
  };
  const snapshot = taskSnapshot([t, child], []);
  const s = scenario(p, snapshot, day);
  assert.equal(s.personalLoad, 60);
  assert.equal(s.affected.length, 1);
});
test('restricción horaria DST inválida no derriba propuestas flexibles', () => {
  const p = emptyProfile();
  p.areas = [{ ...createArea('Zona', 'a'), earliest: '02:30', latest: '04:00' }];
  p.commitments = [
    block('flex', 'flexible', {
      date: '2027-03-28',
      start: '01:00',
      end: '04:00',
      areaId: 'a',
      durationMinutes: 30,
    }),
  ];
  const result = scenario(p, snap(), '2027-03-28');
  assert.equal(result.proposals[0].interval, null);
  assert.match(result.capacity.warnings[0], /inexistente/);
  assert.equal(result.capacity.partial, true);
});
test('reserva aceptada satisface flexible solo para ocurrencia correspondiente', () => {
  const p = emptyProfile();
  p.areas = [createArea('Flexible', 'a')];
  p.commitments = [
    block('flex', 'flexible', {
      date: '',
      weekdays: [1, 2],
      start: '10:00',
      end: '11:00',
      areaId: 'a',
      durationMinutes: 30,
    }),
    block('accepted', 'study', { start: '10:00', end: '10:30', areaId: 'a' }),
  ];
  assert.equal(
    scenario(p, snap(), day).proposals.filter((v) => v.title === 'flex').length,
    0,
  );
  assert.equal(
    scenario(p, snap(), '2027-02-02').proposals.filter((v) => v.title === 'flex').length,
    1,
  );
});
test('reserva semanal aceptada satisface estimación, admite crédito parcial sin duplicar', () => {
  const p = emptyProfile();
  p.areas = [{ ...createArea('Semanal', 'a'), estimateMinutes: 60 }];
  p.commitments = [
    block('accepted', 'study', { areaId: 'a', start: '10:00', end: '11:00' }),
  ];
  assert.equal(proposeActivitiesWeek(p, snap(), weekDays(day)).length, 0);
  p.commitments[0].end = '10:30';
  assert.equal(proposeActivitiesWeek(p, snap(), weekDays(day))[0].minutes, 30);
  assert.equal(proposeActivitiesWeek(p, snap(), weekDays('2027-02-08'))[0].minutes, 60);
});
test('presupuesto jerárquico máximo objetivo padre frente a tareas y objetivos descendientes', () => {
  const p = emptyProfile();
  p.areas = [
    { ...createArea('Padre', 'parent'), dailyMinutes: 60 },
    {
      ...createArea('Hijo', 'child'),
      parentAreaId: 'parent',
      projectIds: ['p'],
      dailyMinutes: 60,
    },
  ];
  const tasks = taskSnapshot(
    [
      {
        id: 't',
        title: 'Ficticia',
        projectId: 'p',
        tagIds: [],
        subTaskIds: [],
        timeEstimate: 3600000,
        timeSpent: 0,
        isDone: false,
        dueDay: day,
      },
    ],
    [],
  );
  let s = scenario(p, tasks, day);
  assert.equal(s.personalLoad, 60);
  assert.equal(
    s.proposals.reduce((n, v) => n + v.minutes, 0),
    60,
  );
  p.areas[0].dailyMinutes = 90;
  s = scenario(p, tasks, day);
  assert.equal(s.personalLoad, 90);
  assert.equal(
    s.proposals.reduce((n, v) => n + v.minutes, 0),
    90,
  );
  p.areas[1].dailyMinutes = null;
  p.areas[0].dailyMinutes = 60;
  s = scenario(p, tasks, day);
  assert.equal(s.personalLoad, 60);
  assert.equal(s.proposals.length, 0);
  p.areas.push({ ...createArea('Otra', 'unrelated'), projectIds: ['p'] });
  s = scenario(p, tasks, day);
  assert.equal(s.personalLoad, 60);
  assert.match(s.capacity.warnings.join(' '), /varias actividades/i);
});
test('ausencias afectan tareas según ámbito sin falsos conflictos personales', () => {
  const p = emptyProfile();
  p.areas = [{ ...createArea('Laboral', 'a'), projectIds: ['p'], workTime: true }];
  p.commitments = [block('absence', 'absence', { allDay: true, scope: 'all' })];
  const tasks = taskSnapshot(
    [
      {
        id: 't',
        title: 'Ficticia',
        projectId: 'p',
        tagIds: [],
        subTaskIds: [],
        timeEstimate: 1800000,
        timeSpent: 0,
        isDone: false,
        dueWithTime: instant(day, '10:00'),
      },
    ],
    [],
  );
  assert.equal(scenario(p, tasks, day).affected.length, 1);
  p.commitments[0].scope = 'personal';
  assert.equal(scenario(p, tasks, day).affected.length, 0);
  p.areas[0].workTime = false;
  assert.equal(scenario(p, tasks, day).affected.length, 1);
  p.commitments[0].scope = 'work';
  assert.equal(scenario(p, tasks, day).affected.length, 0);
});
test('crédito parcial de hijo no se descuenta dos veces del presupuesto padre', () => {
  const p = emptyProfile();
  p.areas = [
    { ...createArea('Padre', 'parent'), dailyMinutes: 120 },
    { ...createArea('Hijo', 'child'), parentAreaId: 'parent', dailyMinutes: 60 },
  ];
  p.commitments = [
    block('reservation', 'study', { areaId: 'child', start: '10:00', end: '10:30' }),
  ];
  let result = scenario(p, snap(), day);
  assert.equal(result.personalLoad, 90);
  assert.equal(
    result.proposals.reduce((n, v) => n + v.minutes, 0),
    90,
  );
  p.areas[0].dailyMinutes = 60;
  p.commitments[0] = { ...p.commitments[0], areaId: 'parent', end: '11:00' };
  result = scenario(p, snap(), day);
  assert.equal(result.personalLoad, 0);
  assert.equal(result.proposals.length, 0);
});
test('estimaciones semanales padre e hijo comparten presupuesto jerárquico y reserva aceptada', () => {
  const p = emptyProfile();
  p.areas = [
    { ...createArea('Padre', 'parent'), estimateMinutes: 60 },
    { ...createArea('Hijo', 'child'), parentAreaId: 'parent', estimateMinutes: 60 },
  ];
  let proposals = proposeActivitiesWeek(p, snap(), weekDays(day));
  assert.equal(
    proposals.reduce((n, v) => n + v.minutes, 0),
    60,
  );
  p.commitments = [
    block('accepted', 'study', { areaId: 'child', start: '10:00', end: '11:00' }),
  ];
  assert.equal(proposeActivitiesWeek(p, snap(), weekDays(day)).length, 0);
});
test('reserva posterior al límite no satisface estimación semanal vencida', () => {
  const p = emptyProfile();
  p.areas = [{ ...createArea('Con límite', 'a'), estimateMinutes: 60, dueDate: day }];
  p.commitments = [
    block('late', 'study', {
      date: '2027-02-02',
      areaId: 'a',
      start: '10:00',
      end: '11:00',
    }),
  ];
  assert.equal(proposeActivitiesWeek(p, snap(), weekDays(day))[0].minutes, 60);
});
test('tareas propias y descendientes nunca se pierden; dominios se calculan aparte', () => {
  const p = emptyProfile();
  p.areas = [
    { ...createArea('Padre', 'parent'), dailyMinutes: 60, projectIds: ['p'] },
    { ...createArea('Hijo', 'child'), parentAreaId: 'parent', projectIds: ['c'] },
  ];
  const make = (id, projectId, minutes) => ({
    id,
    title: id,
    projectId,
    tagIds: [],
    subTaskIds: [],
    timeEstimate: minutes * 60000,
    timeSpent: 0,
    isDone: false,
    dueDay: day,
  });
  const tasks = taskSnapshot([make('one', 'p', 60), make('two', 'c', 30)], []);
  assert.equal(scenario(p, tasks, day).personalLoad, 90);
  p.areas[1].workTime = true;
  let s = scenario(p, tasks, day);
  assert.equal(s.personalLoad, 60);
  assert.equal(s.workLoad, 30);
});
test('flexible sin actividad conserva sourceId y reserva aceptada satisface solo esa demanda', () => {
  const p = emptyProfile();
  p.commitments = [
    block('standalone', 'flexible', {
      start: '10:00',
      end: '11:00',
      durationMinutes: 30,
    }),
  ];
  let result = scenario(p, snap(), day);
  const proposal = result.proposals[0];
  assert.equal(proposal.sourceId, 'standalone');
  p.commitments.push(
    block('accepted', 'study', {
      sourceId: proposal.sourceId,
      start: '10:00',
      end: '10:30',
    }),
  );
  result = scenario(p, snap(), day);
  assert.equal(result.proposals.length, 0);
  assert.equal(result.personalLoad, 0);
  p.commitments[0].id = 'different';
  assert.equal(scenario(p, snap(), day).proposals.length, 1);
});
test('crédito superior con restricciones distintas advierte factibilidad parcial', () => {
  const p = emptyProfile();
  p.areas = [
    { ...createArea('Padre', 'parent'), dailyMinutes: 60 },
    {
      ...createArea('Hijo', 'child'),
      parentAreaId: 'parent',
      dailyMinutes: 60,
      earliest: '18:00',
      latest: '20:00',
    },
  ];
  p.commitments = [
    block('generic', 'study', { areaId: 'parent', start: '10:00', end: '11:00' }),
  ];
  let result = scenario(p, snap(), day);
  assert.match(result.capacity.warnings.join(' '), /reserva.*superior.*restricciones/i);
  assert.equal(result.capacity.partial, true);
  p.areas[1].earliest = null;
  p.areas[1].latest = null;
  result = scenario(p, snap(), day);
  assert.equal(result.capacity.warnings.length, 0);
});
test('flexible laboral independiente conserva ámbito; reserva no entra en conflicto con jornada', () => {
  const p = emptyProfile();
  p.commitments = [
    block('work', 'work'),
    block('standalone-work', 'flexible', {
      scope: 'work',
      start: '10:00',
      end: '11:00',
      durationMinutes: 30,
    }),
  ];
  const proposal = scenario(p, snap(), day).proposals[0];
  assert.equal(proposal.scope, 'work');
  p.commitments.push(
    block('accepted', 'study', {
      sourceId: proposal.sourceId,
      scope: proposal.scope,
      start: '10:00',
      end: '10:30',
    }),
  );
  const result = scenario(p, snap(), day);
  assert.equal(result.proposals.length, 0);
  assert.equal(result.workLoad, 0);
  assert.equal(result.capacity.conflicts.length, 0);
});
