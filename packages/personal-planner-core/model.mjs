export const KINDS = {
  work: 'Jornada laboral',
  busy: 'Compromiso fijo',
  study: 'Bloque de estudio',
  sleep: 'Sueño',
  commute: 'Desplazamiento',
  meal: 'Comida',
  buffer: 'Margen',
  extra: 'Trabajo extra',
  available: 'Franja disponible',
  absence: 'Ausencia o vacaciones',
  flexible: 'Actividad flexible',
};
export const STATES = { active: 'Activa', paused: 'Pausada', archived: 'Archivada' };
export const SCOPES = {
  all: 'Laboral y personal',
  work: 'Laboral',
  personal: 'Personal',
};
export function emptyProfile() {
  return {
    schemaVersion: 2,
    timezone: 'Europe/Madrid',
    weekStartsOn: 1,
    areas: [],
    commitments: [],
    deadlines: [],
    milestones: [],
    trainingExclusions: [],
    completeness: { sleep: false, commute: false, meal: false, buffer: false },
  };
}
export function createArea(name, id = crypto.randomUUID()) {
  return {
    id,
    name,
    projectIds: [],
    tagIds: [],
    dailyMinutes: null,
    weeklyMinutes: null,
    targetHours: null,
    workTime: false,
    status: 'pending',
    state: 'active',
    stateHistory: [],
    statusHistory: [],
    goalHistory: [],
    priority: 3,
    order: 0,
    color: '#3979b8',
    icon: '',
    estimateMinutes: null,
    dueDate: null,
    plannedDate: null,
    startDate: null,
    endDate: null,
    allowedWeekdays: [0, 1, 2, 3, 4, 5, 6],
    earliest: null,
    latest: null,
  };
}
export const validDate = (v) =>
  typeof v === 'string' &&
  /^\d{4}-\d{2}-\d{2}$/.test(v) &&
  !Number.isNaN(Date.parse(`${v}T12:00:00Z`)) &&
  new Date(`${v}T12:00:00Z`).toISOString().slice(0, 10) === v;
export const validTime = (v) =>
  typeof v === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(v);
const shift = (day, n) => {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
export function migrateProfile(raw) {
  if (!raw || ![1, 2].includes(raw.schemaVersion))
    throw Error('Versión de perfil no compatible. No se han reemplazado los datos.');
  const p = structuredClone(raw);
  if (p.schemaVersion === 1) {
    p.schemaVersion = 2;
    p.weekStartsOn = 1;
    p.areas = p.areas.map((a) => ({ ...createArea(a.name, a.id), ...a }));
  }
  return validateProfile(p);
}
export function areaStateOn(a, date) {
  if ((a.startDate && date < a.startDate) || (a.endDate && date > a.endDate))
    return 'inactive';
  let state = a.state || 'active';
  for (const h of [...(a.stateHistory || [])].sort((x, y) =>
    x.from.localeCompare(y.from),
  ))
    if (h.from <= date) state = h.state;
  return state;
}
export function areaCompletionOn(a, date) {
  let status = a.status || 'pending';
  for (const h of [...(a.statusHistory || [])].sort((x, y) =>
    x.from.localeCompare(y.from),
  ))
    if (h.from <= date) status = h.status;
  return status;
}
export function setCompletionFrom(area, status, from) {
  if (!['pending', 'in-progress', 'completed'].includes(status) || !validDate(from))
    throw Error('Progreso o fecha inválidos.');
  return {
    ...structuredClone(area),
    statusHistory: [
      ...(area.statusHistory || []).filter((h) => h.from !== from),
      { from, status },
    ].sort((a, b) => a.from.localeCompare(b.from)),
  };
}
export function areaGoalsOn(a, date) {
  let goals = {
    dailyMinutes: a.dailyMinutes,
    weeklyMinutes: a.weeklyMinutes,
    targetHours: a.targetHours,
  };
  for (const h of [...(a.goalHistory || [])].sort((x, y) => x.from.localeCompare(y.from)))
    if (h.from <= date && (!h.until || date <= h.until))
      goals = {
        dailyMinutes: h.dailyMinutes,
        weeklyMinutes: h.weeklyMinutes,
        targetHours: h.targetHours,
      };
  return goals;
}
export function setGoalsFrom(area, goals, from) {
  if (!validDate(from)) throw Error('Fecha de aplicación de objetivos inválida.');
  const a = structuredClone(area),
    history = a.goalHistory || [];
  const future = history
    .filter((h) => h.from > from)
    .sort((x, y) => x.from.localeCompare(y.from));
  a.goalHistory = history
    .filter((h) => h.from !== from)
    .map((h) =>
      h.from < from && (!h.until || h.until >= from)
        ? { ...h, until: shift(from, -1) }
        : h,
    );
  a.goalHistory.push({
    id: crypto.randomUUID(),
    from,
    until: future.length ? shift(future[0].from, -1) : null,
    ...goals,
  });
  return a;
}
export function setStateFrom(area, state, from) {
  if (!Object.hasOwn(STATES, state) || !validDate(from))
    throw Error('Estado o fecha de aplicación inválidos.');
  return {
    ...structuredClone(area),
    stateHistory: [
      ...(area.stateHistory || []).filter((h) => h.from !== from),
      { from, state },
    ].sort((a, b) => a.from.localeCompare(b.from)),
  };
}
export const orderedAreas = (p) =>
  [...p.areas].sort(
    (a, b) => (a.order || 0) - (b.order || 0) || a.id.localeCompare(b.id),
  );
export function editCommitment(profile, id, updates, { scope = 'future', date } = {}) {
  const p = structuredClone(profile),
    index = p.commitments.findIndex((c) => c.id === id);
  if (index < 0) throw Error('Compromiso no encontrado.');
  const original = p.commitments[index];
  if (original.date) {
    if (updates === null) p.commitments.splice(index, 1);
    else p.commitments[index] = { ...original, ...updates, id };
    return validateProfile(p);
  }
  if (
    !validDate(date) ||
    (original.startDate && date < original.startDate) ||
    (original.endDate && date > original.endDate)
  )
    throw Error('Fecha de edición fuera de la vigencia de la serie.');
  if (scope === 'occurrence') {
    const weekday = new Date(`${date}T12:00:00Z`).getUTCDay();
    if (!original.weekdays.includes(weekday) || original.excludedDates.includes(date))
      throw Error('No existe esa ocurrencia; selecciona su fecha original.');
    original.excludedDates = [...new Set([...original.excludedDates, date])];
    if (updates !== null)
      p.commitments.push({
        ...original,
        ...updates,
        id: crypto.randomUUID(),
        seriesId: original.seriesId || id,
        date: updates.date || date,
        weekdays: [],
        excludedDates: [],
        startDate: null,
        endDate: null,
      });
  } else {
    if (!updates)
      throw Error('Para cancelar futuras ocurrencias usa una fecha de finalización.');
    const successor = {
      ...original,
      ...updates,
      id: crypto.randomUUID(),
      seriesId: original.seriesId || id,
      date: '',
      startDate: date,
      endDate: Object.hasOwn(updates, 'endDate')
        ? updates.endDate
        : original.endDate || null,
      excludedDates: (Object.hasOwn(updates, 'excludedDates')
        ? updates.excludedDates
        : original.excludedDates
      ).filter((d) => d >= date),
    };
    if (original.startDate && date === original.startDate) {
      successor.id = original.id;
      p.commitments[index] = successor;
    } else {
      original.endDate = shift(date, -1);
      original.excludedDates = original.excludedDates.filter((d) => d < date);
      p.commitments.push(successor);
    }
  }
  return validateProfile(p);
}
export function demoProfile() {
  const p = emptyProfile();
  p.areas = [
    {
      ...createArea('Aprendizaje de ejemplo', 'demo-learning'),
      dailyMinutes: 30,
      targetHours: 12,
    },
    {
      ...createArea('Proyecto de ejemplo', 'demo-project'),
      dailyMinutes: 15,
      order: 1,
      priority: 2,
    },
  ];
  p.commitments = [
    {
      id: 'demo-work',
      title: 'Jornada de ejemplo',
      kind: 'work',
      weekdays: [1, 2, 3, 4, 5],
      date: '',
      start: '09:00',
      end: '16:00',
      excludedDates: [],
    },
    {
      id: 'demo-window',
      title: 'Disponibilidad de ejemplo',
      kind: 'available',
      scope: 'personal',
      weekdays: [1, 2, 3, 4, 5],
      date: '',
      start: '18:00',
      end: '20:00',
      excludedDates: [],
    },
  ];
  return p;
}
export function validateProfile(p) {
  const require = (ok, msg) => {
      if (!ok) throw Error(msg);
    },
    text = (v) => typeof v === 'string' && v.trim().length > 0 && v.length <= 300,
    list = (v) => Array.isArray(v) && v.length <= 2000,
    num = (v, max) => v === null || (Number.isFinite(v) && v >= 0 && v <= max),
    optionalDate = (v) => v == null || v === '' || validDate(v),
    days = (v) =>
      Array.isArray(v) && v.every((d) => Number.isInteger(d) && d >= 0 && d <= 6);
  require(p &&
    p.schemaVersion ===
      2, 'Versión de perfil no compatible. No se han reemplazado los datos.');
  try {
    new Intl.DateTimeFormat('es', { timeZone: p.timezone }).format();
  } catch {
    throw Error('Zona horaria IANA inválida.');
  }
  require(text(p.timezone), 'Zona horaria inválida.');
  require(p.weekStartsOn === undefined ||
    (Number.isInteger(p.weekStartsOn) &&
      p.weekStartsOn >= 0 &&
      p.weekStartsOn <= 6), 'Inicio de semana inválido.');
  for (const key of [
    'areas',
    'commitments',
    'deadlines',
    'milestones',
    'trainingExclusions',
  ])
    require(list(p[key]), `Lista inválida: ${key}.`);
  const ids = new Set();
  const goals = (a) =>
    num(a.dailyMinutes, 1440) &&
    num(a.weeklyMinutes, 10080) &&
    num(a.targetHours, 100000);
  for (const a of p.areas) {
    require(a &&
      text(a.id) &&
      text(a.name) &&
      !ids.has(a.id), 'Actividad inválida o repetida.');
    ids.add(a.id);
    require(list(a.projectIds) &&
      a.projectIds.every(text) &&
      list(a.tagIds) &&
      a.tagIds.every(text), 'Asociaciones inválidas.');
    require(goals(a), 'Objetivo fuera de rango.');
    require(typeof a.workTime === 'boolean' &&
      ['pending', 'in-progress', 'completed'].includes(
        a.status,
      ), 'Estado de progreso inválido.');
    require(a.state === undefined ||
      Object.hasOwn(STATES, a.state), 'Estado de actividad inválido.');
    require(a.priority === undefined ||
      (Number.isInteger(a.priority) &&
        a.priority >= 1 &&
        a.priority <= 5), 'Prioridad inválida.');
    require(a.order === undefined || Number.isFinite(a.order), 'Orden inválido.');
    require(a.color === undefined || /^#[0-9a-f]{6}$/i.test(a.color), 'Color inválido.');
    require(a.icon === undefined ||
      (typeof a.icon === 'string' && a.icon.length <= 16), 'Icono inválido.');
    require(a.estimateMinutes === undefined ||
      num(a.estimateMinutes, 10080), 'Estimación inválida.');
    for (const key of ['dueDate', 'plannedDate', 'startDate', 'endDate'])
      require(optionalDate(a[key]), 'Fecha de actividad inválida.');
    require(!a.startDate ||
      !a.endDate ||
      a.endDate >= a.startDate, 'Vigencia de actividad inválida.');
    require(a.allowedWeekdays === undefined ||
      days(a.allowedWeekdays), 'Restricción de días inválida.');
    require(!a.earliest || validTime(a.earliest), 'Hora de restricción inválida.');
    require(!a.latest || validTime(a.latest), 'Hora de restricción inválida.');
    require(a.stateHistory === undefined ||
      (list(a.stateHistory) &&
        a.stateHistory.every(
          (h) => validDate(h.from) && Object.hasOwn(STATES, h.state),
        ) &&
        new Set(a.stateHistory.map((h) => h.from)).size ===
          a.stateHistory.length), 'Historial de estados inválido.');
    require(a.statusHistory === undefined ||
      (list(a.statusHistory) &&
        a.statusHistory.every(
          (h) =>
            validDate(h.from) &&
            ['pending', 'in-progress', 'completed'].includes(h.status),
        ) &&
        new Set(a.statusHistory.map((h) => h.from)).size ===
          a.statusHistory.length), 'Historial de progreso inválido.');
    require(a.goalHistory === undefined ||
      (list(a.goalHistory) &&
        a.goalHistory.every(
          (h) =>
            text(h.id) &&
            validDate(h.from) &&
            optionalDate(h.until) &&
            (!h.until || h.until >= h.from) &&
            goals(h),
        )), 'Historial de objetivos inválido.');
    const history = [...(a.goalHistory || [])].sort((x, y) =>
      x.from.localeCompare(y.from),
    );
    for (let i = 1; i < history.length; i++)
      require(history[i - 1].until &&
        history[i - 1].until < history[i].from, 'Objetivos con vigencias solapadas.');
  }
  for (const a of p.areas) {
    const seen = new Set([a.id]);
    let current = a;
    while (current.parentAreaId) {
      require(ids.has(current.parentAreaId), 'Actividad superior no disponible.');
      require(!seen.has(current.parentAreaId), 'La jerarquía contiene un ciclo.');
      seen.add(current.parentAreaId);
      current = p.areas.find((v) => v.id === current.parentAreaId);
    }
  }
  const unique = (items) => new Set(items.map((v) => v?.id)).size === items.length;
  require(unique(p.commitments) &&
    unique(p.deadlines) &&
    unique(p.milestones), 'Identificadores repetidos.');
  for (const c of p.commitments) {
    require(c &&
      text(c.id) &&
      text(c.title) &&
      Object.hasOwn(KINDS, c.kind), 'Compromiso inválido.');
    require(c.allDay === true ||
      (validTime(c.start) &&
        validTime(c.end) &&
        c.start !==
          c.end), 'Hora inválida; usa día completo para una ausencia de 24 horas.');
    require(c.date
      ? validDate(c.date)
      : days(c.weekdays) && c.weekdays.length > 0, 'Fecha o recurrencia inválida.');
    require(list(c.excludedDates) &&
      c.excludedDates.every(validDate), 'Fechas excluidas inválidas.');
    require(!c.areaId || ids.has(c.areaId), 'Compromiso sin actividad válida.');
    require(optionalDate(c.startDate) &&
      optionalDate(c.endDate) &&
      (!c.startDate ||
        !c.endDate ||
        c.endDate >= c.startDate), 'Vigencia de recurrencia inválida.');
    require(c.scope === undefined || Object.hasOwn(SCOPES, c.scope), 'Ámbito inválido.');
    require(c.kind !== 'flexible' ||
      (Number.isFinite(c.durationMinutes) &&
        c.durationMinutes > 0 &&
        c.durationMinutes <= 1440), 'Duración flexible inválida.');
  }
  for (const d of [...p.deadlines, ...p.milestones]) {
    require(d &&
      text(d.id) &&
      text(d.title) &&
      validDate(d.date) &&
      (!d.areaId || ids.has(d.areaId)), 'Entrega o hito inválido.');
    require(d.hours === undefined || num(d.hours, 100000), 'Horas de hito inválidas.');
    require(d.provisional === undefined ||
      typeof d.provisional === 'boolean', 'Estado provisional inválido.');
    require(d.completed === undefined ||
      typeof d.completed === 'boolean', 'Estado de entrega inválido.');
  }
  for (const e of p.trainingExclusions)
    require(e &&
      validDate(e.start) &&
      validDate(e.end) &&
      e.end >= e.start &&
      ids.has(e.areaId), 'Exclusión de formación inválida.');
  require(p.completeness &&
    ['sleep', 'commute', 'meal', 'buffer'].every(
      (k) => typeof p.completeness[k] === 'boolean',
    ), 'Indicadores de disponibilidad incompletos.');
  return p;
}
