import { areaStateOn, areaGoalsOn, areaCompletionOn, orderedAreas } from './model.mjs';
export const ZONE = 'Europe/Madrid';
const formatters = new Map();
function formatter(timezone) {
  if (!formatters.has(timezone))
    formatters.set(
      timezone,
      new Intl.DateTimeFormat('en-CA', {
        timeZone: timezone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        hourCycle: 'h23',
      }),
    );
  return formatters.get(timezone);
}
const parts = (epoch, timezone) =>
  Object.fromEntries(
    formatter(timezone)
      .formatToParts(epoch)
      .map((p) => [p.type, p.value]),
  );
export function localDay(epoch = Date.now(), timezone = ZONE) {
  const p = parts(epoch, timezone);
  return `${p.year}-${p.month}-${p.day}`;
}
export function addDays(day, n) {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
export function weekDays(day, weekStartsOn = 1) {
  const weekday = new Date(`${day}T12:00:00Z`).getUTCDay();
  const first = addDays(day, -((weekday - weekStartsOn + 7) % 7));
  return Array.from({ length: 7 }, (_, i) => addDays(first, i));
}
const instantCache = new Map();
export function instant(day, time = '00:00', timezone = ZONE) {
  const wall = `${day}T${time}`,
    key = `${timezone}:${wall}`;
  if (instantCache.has(key)) return instantCache.get(key);
  const nominal = Date.parse(`${wall}:00Z`),
    offsets = new Set(),
    candidates = [];
  // Sample both sides of timezone transitions; reject gaps and ambiguous wall times.
  for (const hours of [-24, 0, 24]) {
    const epoch = nominal + hours * 3600000,
      p = parts(epoch, timezone);
    offsets.add(
      Date.parse(`${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:00Z`) - epoch,
    );
  }
  for (const offset of offsets) {
    const candidate = nominal - offset,
      p = parts(candidate, timezone);
    if (`${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}` === wall)
      candidates.push(candidate);
  }
  if (candidates.length !== 1)
    throw Error(
      `Hora ${candidates.length ? 'ambigua' : 'inexistente'} en ${timezone}: ${wall}. Ajusta el compromiso.`,
    );
  if (instantCache.size > 10000) instantCache.clear();
  instantCache.set(key, candidates[0]);
  return candidates[0];
}
export function union(intervals) {
  const sorted = intervals
    .filter(([s, e]) => e > s)
    .map((v) => [...v])
    .sort((a, b) => a[0] - b[0]);
  const out = [];
  for (const [s, e] of sorted) {
    const last = out.at(-1);
    if (last && s <= last[1]) last[1] = Math.max(e, last[1]);
    else out.push([s, e]);
  }
  return out;
}
const length = (intervals) =>
  union(intervals).reduce((total, [s, e]) => total + (e - s) / 60000, 0);
function intersect(a, b) {
  return a.flatMap(([s, e]) =>
    b.map(([x, y]) => [Math.max(s, x), Math.min(e, y)]).filter(([x, y]) => y > x),
  );
}
function subtract(a, b) {
  let out = union(a);
  for (const [s, e] of union(b))
    out = out.flatMap(([x, y]) =>
      e <= x || s >= y
        ? [[x, y]]
        : [
            [x, Math.min(s, y)],
            [Math.max(e, x), y],
          ].filter(([v, w]) => w > v),
    );
  return out;
}
const interval = (e) => [e.from, e.to];
const active = (a, date) =>
  areaStateOn(a, date) === 'active' && areaCompletionOn(a, date) !== 'completed';
const occupied = (e) => !['available', 'absence', 'flexible'].includes(e.kind);
const scopeIncludes = (e, scope) => !e.scope || e.scope === 'all' || e.scope === scope;
export function daySchedule(profile, day) {
  const zone = profile.timezone || ZONE,
    start = instant(day, '00:00', zone),
    end = instant(addDays(day, 1), '00:00', zone);
  const events = [],
    warnings = [];
  for (const date of [addDays(day, -1), day]) {
    const weekday = new Date(`${date}T12:00:00Z`).getUTCDay();
    for (const c of profile.commitments) {
      if (c.date ? c.date !== date : !c.weekdays.includes(weekday)) continue;
      if (
        (c.startDate && date < c.startDate) ||
        (c.endDate && date > c.endDate) ||
        c.excludedDates.includes(date)
      )
        continue;
      const area = c.areaId && profile.areas.find((a) => a.id === c.areaId);
      if (area && !active(area, date)) continue;
      if (
        c.kind === 'study' &&
        profile.trainingExclusions.some(
          (e) => e.areaId === c.areaId && date >= e.start && date <= e.end,
        )
      )
        continue;
      try {
        const s = instant(date, c.allDay ? '00:00' : c.start, zone);
        const endDate = c.allDay || c.end < c.start ? addDays(date, 1) : date;
        const e = instant(endDate, c.allDay ? '00:00' : c.end, zone);
        if (s < end && e > start)
          events.push({
            ...c,
            occurrenceDate: date,
            from: Math.max(start, s),
            to: Math.min(end, e),
          });
      } catch (error) {
        warnings.push(error.message);
      }
    }
  }
  events.sort((a, b) => a.from - b.from);
  const conflicts = [],
    transitions = [],
    fixed = events.filter(occupied);
  for (let i = 0; i < fixed.length; i++)
    for (let j = i + 1; j < fixed.length; j++) {
      const a = fixed[i],
        b = fixed[j],
        from = Math.max(a.from, b.from),
        to = Math.min(a.to, b.to);
      const allowed = (w, s) =>
        w.kind === 'work' &&
        s.kind === 'study' &&
        (profile.areas.find((a) => a.id === s.areaId)?.workTime ||
          (!s.areaId && s.scope === 'work'));
      if (to > from && !allowed(a, b) && !allowed(b, a))
        conflicts.push({ a, b, from, to, minutes: (to - from) / 60000 });
      if (a.to === b.from || b.to === a.from)
        transitions.push({ a, b, at: a.to === b.from ? a.to : b.to });
    }
  return { events, conflicts, transitions, warnings, start, end };
}
export function availability(profile, day) {
  const d = daySchedule(profile, day),
    absences = d.events.filter((e) => e.kind === 'absence');
  const work = subtract(
    d.events.filter((e) => e.kind === 'work').map(interval),
    absences.filter((e) => scopeIncludes(e, 'work')).map(interval),
  );
  const busy = d.events.filter((e) => occupied(e) && e.kind !== 'work');
  let workFree = subtract(
    work,
    busy.filter((e) => scopeIncludes(e, 'work')).map(interval),
  );
  let personalFree = subtract(
    [[d.start, d.end]],
    [
      ...work,
      ...busy.filter((e) => scopeIncludes(e, 'personal')).map(interval),
      ...absences.filter((e) => scopeIncludes(e, 'personal')).map(interval),
    ],
  );
  for (const scope of ['work', 'personal']) {
    const windows = d.events
      .filter((e) => e.kind === 'available' && scopeIncludes(e, scope))
      .map(interval);
    const defined =
      windows.length ||
      profile.commitments.some(
        (e) =>
          e.kind === 'available' &&
          scopeIncludes(e, scope) &&
          (!e.date || e.date === day) &&
          (!e.startDate || day >= e.startDate) &&
          (!e.endDate || day <= e.endDate) &&
          (!e.areaId ||
            active(
              profile.areas.find((a) => a.id === e.areaId),
              day,
            )),
      );
    if (defined) {
      if (scope === 'work') workFree = intersect(workFree, union(windows));
      else personalFree = intersect(personalFree, union(windows));
    }
  }
  for (const e of d.events.filter(
    (e) => e.kind === 'study' && profile.areas.find((a) => a.id === e.areaId)?.workTime,
  ))
    if (length(intersect([interval(e)], work)) < (e.to - e.from) / 60000)
      d.warnings.push(
        `${e.title}: actividad laboral fuera de la jornada; revisa el bloque.`,
      );
  return {
    ...d,
    workWindows: work,
    workMinutes: length(workFree),
    personalMinutes: length(personalFree),
    workFree,
    personalFree,
    partial: Object.values(profile.completeness).some((v) => !v) || d.warnings.length > 0,
  };
}
function taskDay(t, snapshot, timezone) {
  const seen = new Set();
  let current = t;
  while (current && !seen.has(current.id)) {
    seen.add(current.id);
    if (current.dueWithTime) return localDay(current.dueWithTime, timezone);
    if (current.dueDay) return current.dueDay;
    current = snapshot.byId.get(current.parentId);
  }
  return null;
}
const pending = (snapshot) => snapshot.leaves.filter((t) => !t.isDone && !t.archived);
const remainingTask = (t) =>
  Math.max(0, (t.timeEstimate || 0) - (t.timeSpent || 0)) / 60000;
function taskTime(t, snapshot) {
  const seen = new Set();
  let current = t;
  while (current && !seen.has(current.id)) {
    seen.add(current.id);
    if (current.dueWithTime) return current.dueWithTime;
    if (current.dueDay) return null;
    current = snapshot.byId.get(current.parentId);
  }
  return null;
}
function timedIntervals(snapshot) {
  return pending(snapshot).flatMap((t) => {
    const from = taskTime(t, snapshot);
    return from ? [[from, from + remainingTask(t) * 60000]] : [];
  });
}
function restricted(free, area, day, zone) {
  if (
    !active(area, day) ||
    (area.allowedWeekdays &&
      !area.allowedWeekdays.includes(new Date(`${day}T12:00:00Z`).getUTCDay())) ||
    (area.dueDate && day > area.dueDate)
  )
    return [];
  const from = instant(day, area.earliest || '00:00', zone);
  const to = area.latest
    ? instant(day, area.latest, zone)
    : instant(addDays(day, 1), '00:00', zone);
  return intersect(free, [[from, to]]);
}
function reserve(pools, work, free, minutes) {
  const candidate = free.find(([s, e]) => (e - s) / 60000 >= minutes);
  if (!candidate) return null;
  const taken = [candidate[0], candidate[0] + minutes * 60000];
  pools.work = subtract(pools.work, [taken]);
  pools.personal = subtract(pools.personal, [taken]);
  return taken;
}
const orderedByPriority = (p) =>
  orderedAreas(p).sort((a, b) => (a.priority || 3) - (b.priority || 3));
function descendants(profile, area) {
  const out = [],
    seen = new Set();
  const visit = (a) => {
    if (seen.has(a.id)) return;
    seen.add(a.id);
    out.push(a);
    for (const child of profile.areas.filter((v) => v.parentAreaId === a.id))
      visit(child);
  };
  visit(area);
  return out;
}
function effectiveArea(profile, area) {
  const family = descendants(profile, area);
  return {
    ...area,
    projectIds: [...new Set(family.flatMap((a) => a.projectIds))],
    tagIds: [...new Set(family.flatMap((a) => a.tagIds))],
  };
}
function plannedEstimate(a, snapshot, day, profile) {
  return a.plannedDate === day &&
    !pending(snapshot).some((t) => snapshot.matches(t, effectiveArea(profile, a)))
    ? a.estimateMinutes || 0
    : 0;
}
function studyCredit(profile, capacity, id, work) {
  const blocks = capacity.events
    .filter(
      (e) =>
        e.kind === 'study' &&
        (e.areaId === id ||
          (!profile.areas.some((a) => a.id === id) &&
            id.startsWith('flex:') &&
            !e.areaId &&
            e.sourceId === id.slice(5))),
    )
    .map(interval);
  const eligible = work
    ? intersect(blocks, capacity.workWindows)
    : subtract(blocks, capacity.workWindows);
  const interruptions = capacity.events
    .filter(
      (e) =>
        ((occupied(e) && !['work', 'study'].includes(e.kind)) || e.kind === 'absence') &&
        scopeIncludes(e, work ? 'work' : 'personal'),
    )
    .map(interval);
  return subtract(eligible, interruptions);
}
// Native tasks remain the only source for task progress and recorded time.
export function scenario(profile, snapshot, day) {
  const zone = profile.timezone || ZONE,
    capacity = availability(profile, day),
    affected = [],
    potentiallyAffected = [],
    groups = new Map();
  const ensure = (id, work) => {
    if (!groups.has(id)) groups.set(id, { task: 0, goal: 0, estimate: 0, flex: 0, work });
    return groups.get(id);
  };
  for (const t of pending(snapshot)) {
    if (taskDay(t, snapshot, zone) !== day) continue;
    const time = taskTime(t, snapshot),
      areas = profile.areas.filter((a) => snapshot.matches(t, a));
    const specific = areas.filter(
      (a) =>
        !areas.some(
          (b) => b.id !== a.id && descendants(profile, a).some((c) => c.id === b.id),
        ),
    );
    if (specific.length > 1)
      capacity.warnings.push(
        'Una tarea está vinculada a varias actividades no relacionadas; se cuenta una vez según prioridad y orden.',
      );
    const area = orderedByPriority({ ...profile, areas: specific })[0],
      work = !!area?.workTime;
    // Existing native tasks remain visible even when the linked activity is paused.
    ensure(area?.id || 'unassigned', work).task += remainingTask(t);
    if (!time && capacity.events.some((e) => e.kind === 'extra'))
      potentiallyAffected.push(t);
    if (
      time &&
      capacity.events.some(
        (e) =>
          (occupied(e) || e.kind === 'absence') &&
          scopeIncludes(e, work ? 'work' : 'personal') &&
          (e.kind !== 'work' || !work) &&
          time < e.to &&
          time + remainingTask(t) * 60000 > e.from,
      )
    )
      affected.push(t);
  }
  for (const a of profile.areas.filter((a) => active(a, day))) {
    const goals = areaGoalsOn(a, day),
      logged = snapshot.dailyForArea?.(effectiveArea(profile, a), day) ?? 0,
      g = ensure(a.id, a.workTime);
    g.goal = Math.max(0, (goals.dailyMinutes || 0) - logged);
    g.estimate = plannedEstimate(a, snapshot, day, profile);
  }
  const flexible = capacity.events.filter(
    (e) => e.kind === 'flexible' && e.occurrenceDate === day,
  );
  for (const e of flexible) {
    const area = profile.areas.find((a) => a.id === e.areaId);
    ensure(e.areaId || `flex:${e.id}`, e.scope === 'work' || !!area?.workTime).flex +=
      e.durationMinutes;
  }
  // Keep every ancestor in the budget, even when it has no direct target.
  for (const a of profile.areas) ensure(a.id, a.workTime);
  const reserved = [];
  for (const [id, g] of groups) {
    g.creditIntervals = subtract(studyCredit(profile, capacity, id, g.work), reserved);
    reserved.push(...g.creditIntervals);
    g.credit = length(g.creditIntervals);
    const windows = flexible
      .filter((e) => (e.areaId || `flex:${e.id}`) === id)
      .map(interval);
    g.flexCovered = Math.min(g.flex, length(intersect(g.creditIntervals, windows)));
    // Reservations outside a flexible window cannot satisfy its timed restriction.
    g.flexBudget = g.flex ? g.flex + g.credit - g.flexCovered : 0;
  }
  const budgets = new Map();
  const budget = (id, work) => {
    const key = `${id}:${work}`;
    if (budgets.has(key)) return budgets.get(key);
    const g = groups.get(id),
      children = profile.areas
        .filter((a) => a.parentAreaId === id)
        .map((a) => budget(a.id, work));
    const childGross = children.reduce((n, c) => n + c.gross, 0),
      childCredit = children.reduce((n, c) => n + c.credit, 0),
      own = g.work === work;
    const gross = Math.max(
      own ? g.goal : 0,
      own ? g.estimate : 0,
      own ? g.flexBudget : 0,
      (own ? g.task : 0) + childGross,
    );
    const credit = (own ? g.credit : 0) + childCredit;
    const result = { gross, credit, childGross, remaining: Math.max(0, gross - credit) };
    budgets.set(key, result);
    return result;
  };
  const roots = [...groups.keys()].filter(
    (id) => !profile.areas.find((a) => a.id === id)?.parentAreaId,
  );
  const workLoad = roots.reduce((n, id) => n + budget(id, true).remaining, 0);
  const personalLoad = roots.reduce((n, id) => n + budget(id, false).remaining, 0);
  for (const a of profile.areas) {
    const g = groups.get(a.id);
    if (!g.credit) continue;
    const descendantsWithTargets = descendants(profile, a)
      .slice(1)
      .filter(
        (child) =>
          active(child, day) &&
          (budget(child.id, !!a.workTime).gross > 0 || child.estimateMinutes > 0),
      );
    const signature = (v) =>
      JSON.stringify({
        days: [...(v.allowedWeekdays || [0, 1, 2, 3, 4, 5, 6])].sort(),
        earliest: v.earliest || null,
        latest: v.latest || null,
        start: v.startDate || null,
        end: v.endDate || null,
        due: v.dueDate || null,
        work: !!v.workTime,
      });
    const ownAdditional = Math.max(
      0,
      budget(a.id, !!a.workTime).gross - budget(a.id, !!a.workTime).childGross,
    );
    if (
      descendantsWithTargets.some((child) => signature(child) !== signature(a)) &&
      (g.credit > ownAdditional ||
        descendantsWithTargets.some(
          (child) => child.estimateMinutes > 0 && !child.plannedDate,
        ))
    ) {
      capacity.warnings.push(
        'Reserva de actividad superior con restricciones distintas en descendientes: presupuesto orientativo. Asigna la reserva a la actividad concreta para comprobar su factibilidad.',
      );
      capacity.partial = true;
    }
  }
  const proposalBudgets = new Map();
  const proposalKey = (id, work) => {
    let area = profile.areas.find((a) => a.id === id);
    while (area?.parentAreaId) {
      id = area.parentAreaId;
      area = profile.areas.find((a) => a.id === id);
    }
    return `${id}:${work}`;
  };
  for (const id of roots)
    for (const work of [true, false])
      proposalBudgets.set(proposalKey(id, work), budget(id, work).remaining);
  const proposals = [],
    timed = timedIntervals(snapshot),
    pools = {
      work: subtract(capacity.workFree, timed),
      personal: subtract(capacity.personalFree, timed),
    },
    flexProposed = new Map(),
    flexCreditUsed = new Map();
  // Narrow flexible windows are proposed before broad daily goals to preserve scarce slots.
  for (const e of [...flexible].sort((a, b) => a.to - a.from - (b.to - b.from))) {
    const area = profile.areas.find((a) => a.id === e.areaId),
      g = groups.get(e.areaId || `flex:${e.id}`),
      work = g.work;
    const creditKey = e.areaId || `flex:${e.id}`,
      availableCredit = subtract(g.creditIntervals, flexCreditUsed.get(creditKey) || []),
      matchedCredit = intersect(availableCredit, [interval(e)]);
    const covered = Math.min(e.durationMinutes, length(matchedCredit)),
      key = proposalKey(creditKey, !!work),
      minutes = Math.min(e.durationMinutes - covered, proposalBudgets.get(key) || 0);
    // Consume only the part needed by this occurrence, not all intersecting reservations.
    let creditRemaining = covered;
    const consumed = [];
    for (const [from, to] of matchedCredit) {
      const used = Math.min((to - from) / 60000, creditRemaining);
      if (used > 0) consumed.push([from, from + used * 60000]);
      creditRemaining -= used;
    }
    flexCreditUsed.set(creditKey, [
      ...(flexCreditUsed.get(creditKey) || []),
      ...consumed,
    ]);
    if (!minutes) continue;
    proposalBudgets.set(key, proposalBudgets.get(key) - minutes);
    const free = intersect(pools[work ? 'work' : 'personal'], [interval(e)]);
    let eligible = free;
    try {
      if (area) eligible = restricted(free, area, day, zone);
    } catch (error) {
      eligible = [];
      capacity.warnings.push(error.message);
      capacity.partial = true;
    }
    const proposed = reserve(pools, work, eligible, minutes);
    proposals.push({
      area: area?.name || e.title,
      areaId: area?.id || null,
      sourceId: e.id,
      scope: work ? 'work' : 'personal',
      title: e.title,
      minutes,
      date: day,
      interval: proposed,
      reason: proposed
        ? 'Propuesta dentro de la franja flexible; requiere revisión.'
        : 'Sin hueco suficiente dentro de la franja flexible.',
    });
    flexProposed.set(
      e.areaId,
      (flexProposed.get(e.areaId) || 0) + (proposed ? minutes : 0),
    );
  }
  for (const a of orderedByPriority(profile).filter((a) => active(a, day))) {
    const g = groups.get(a.id);
    if (!g) continue;
    const key = proposalKey(a.id, !!a.workTime);
    const minutes = Math.min(
      proposalBudgets.get(key) || 0,
      Math.max(
        0,
        Math.max(g.goal, g.estimate) -
          budget(a.id, !!a.workTime).childGross -
          g.credit -
          (flexProposed.get(a.id) || 0),
      ),
    );
    if (!minutes) continue;
    proposalBudgets.set(key, proposalBudgets.get(key) - minutes);
    let free = [];
    try {
      free = restricted(pools[a.workTime ? 'work' : 'personal'], a, day, zone);
    } catch (error) {
      capacity.warnings.push(error.message);
      capacity.partial = true;
    }
    const proposed = reserve(pools, a.workTime, free, minutes);
    proposals.push({
      area: a.name,
      areaId: a.id,
      scope: a.workTime ? 'work' : 'personal',
      title: a.name,
      minutes,
      date: day,
      interval: proposed,
      reason: proposed
        ? 'Propuesta según objetivo, prioridad y restricciones; requiere revisión.'
        : 'Sin hueco suficiente con las restricciones configuradas.',
    });
  }
  return {
    capacity,
    workLoad,
    personalLoad,
    workExcess: Math.max(0, workLoad - capacity.workMinutes),
    personalExcess: Math.max(0, personalLoad - capacity.personalMinutes),
    affected,
    potentiallyAffected,
    proposals,
  };
}
export function proposeActivitiesWeek(profile, snapshot, days) {
  const zone = profile.timezone || ZONE,
    dates = [...new Set(days)].sort(),
    pools = new Map(),
    capacities = new Map(),
    out = [];
  for (const day of dates) {
    const s = scenario(profile, snapshot, day),
      taken = [
        ...timedIntervals(snapshot),
        ...s.proposals.filter((p) => p.interval).map((p) => p.interval),
      ];
    capacities.set(day, s.capacity);
    pools.set(day, {
      work: subtract(s.capacity.workFree, taken),
      personal: subtract(s.capacity.personalFree, taken),
    });
  }
  const weekly = new Map();
  for (const a of profile.areas) {
    const eligibleDates = dates.filter(
      (day) => active(a, day) && (!a.dueDate || day <= a.dueDate),
    );
    const estimate =
      !a.plannedDate &&
      !pending(snapshot).some((t) => snapshot.matches(t, effectiveArea(profile, a))) &&
      eligibleDates.length
        ? a.estimateMinutes || 0
        : 0;
    const accepted = eligibleDates.flatMap((day) =>
      studyCredit(profile, capacities.get(day), a.id, !!a.workTime),
    );
    weekly.set(a.id, { estimate, eligibleDates, accepted });
  }
  const weeklyBudgets = new Map();
  const weeklyBudget = (id, work) => {
    const key = `${id}:${work}`;
    if (weeklyBudgets.has(key)) return weeklyBudgets.get(key);
    const a = profile.areas.find((a) => a.id === id),
      own = !!a.workTime === work,
      entry = weekly.get(id),
      children = profile.areas
        .filter((a) => a.parentAreaId === id)
        .map((a) => weeklyBudget(a.id, work));
    const childGross = children.reduce((n, c) => n + c.gross, 0),
      gross = Math.max(own ? entry.estimate : 0, childGross);
    const accepted = union([
      ...(own ? entry.accepted : []),
      ...children.flatMap((c) => c.accepted),
    ]);
    const result = {
      gross,
      childGross,
      accepted,
      remaining: Math.max(0, gross - length(accepted)),
    };
    weeklyBudgets.set(key, result);
    return result;
  };
  const rootKey = (a) => {
    while (a.parentAreaId) a = profile.areas.find((v) => v.id === a.parentAreaId);
    return a.id;
  };
  const remainingBudgets = new Map();
  for (const a of profile.areas.filter((a) => !a.parentAreaId))
    for (const work of [true, false])
      remainingBudgets.set(`${a.id}:${work}`, weeklyBudget(a.id, work).remaining);
  for (const a of orderedByPriority(profile)) {
    const entry = weekly.get(a.id),
      eligibleDates = entry.eligibleDates;
    if (!entry.estimate || !eligibleDates.length) continue;
    const key = `${rootKey(a)}:${!!a.workTime}`;
    const minutes = Math.min(
      remainingBudgets.get(key) || 0,
      Math.max(
        0,
        entry.estimate -
          weeklyBudget(a.id, !!a.workTime).childGross -
          length(entry.accepted),
      ),
    );
    if (!minutes) continue;
    remainingBudgets.set(key, remainingBudgets.get(key) - minutes);
    let result = null,
      restrictionError = '';
    for (const day of eligibleDates) {
      let free;
      try {
        free = restricted(pools.get(day)[a.workTime ? 'work' : 'personal'], a, day, zone);
      } catch (error) {
        restrictionError = error.message;
        continue;
      }
      const proposed = reserve(pools.get(day), a.workTime, free, minutes);
      if (proposed) {
        result = {
          area: a.name,
          areaId: a.id,
          scope: a.workTime ? 'work' : 'personal',
          title: a.name,
          minutes,
          date: day,
          interval: proposed,
          reason:
            'Propuesta semanal según prioridad, vigencia y restricciones; no cambia el calendario.',
        };
        break;
      }
    }
    out.push(
      result || {
        area: a.name,
        areaId: a.id,
        scope: a.workTime ? 'work' : 'personal',
        title: a.name,
        minutes,
        date: eligibleDates[0],
        interval: null,
        reason:
          restrictionError ||
          'Sin hueco semanal suficiente antes de la fecha límite y con las restricciones configuradas.',
      },
    );
  }
  return out;
}
